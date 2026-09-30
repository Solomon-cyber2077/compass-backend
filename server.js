const express = require('express');
const crypto = require('crypto');
const path = require('path');
const store = require('./store');
const { emailEnabled, sendEmail } = require('./email');
const { notify } = require('./notify');
const {
  hashPassword, checkPassword, startSession, endSession, endOtherSessions, attachUser,
  createResetToken, consumeResetToken,
  isAdmin, isVerifiedTM, tmLabel, requireUser, requireAdmin
} = require('./auth');

const PUBLIC_DIR = path.join(__dirname, 'public');
const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy; this makes req.ip, req.secure and req.protocol accurate

// Browser security settings: only load scripts from this site, never be framed by other sites.
// Photos may come from any https/http link (people paste image links) or be uploaded (data:).
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: https: http:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Restoring a backup can be far bigger than a normal request, so it gets its own size limit.
// It is registered before the normal JSON parser, which then leaves this request alone.
app.post('/api/admin/restore', express.json({ limit: '100mb' }), attachUser, requireAdmin, restoreBackup);

app.use(express.json({ limit: '8mb' })); // up to 4 photos arrive as compressed data URLs
app.use(express.static(PUBLIC_DIR)); // the website itself
app.use(attachUser); // req.user = whoever is signed in (or null)

// Other websites can't send JSON here without permission (which this server never grants),
// so requiring JSON on every change stops them from acting as a signed-in visitor.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) {
    return res.status(415).json({ error: 'Requests must be sent as JSON.' });
  }
  next();
});

const CATEGORIES = [
  'Finance', 'Sales', 'Tech', 'Marketing', 'Consulting', 'Law', 'Healthcare',
  'Engineering', 'Design', 'Career Change', 'Interviews', 'Other'
];

const LIMITS = {
  title: 200,
  body: 10000,
  displayName: 40,
  email: 200,
  tmRole: 80,
  tmAbout: 1000,
  reportReason: 500,
  images: 4,
  links: 5,
  url: 1000,
  imageDataUrl: 1500000, // ~1.1 MB per photo after base64
  pageSize: 20
};

const USERNAME = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_EMAIL_MS = 60 * 60 * 1000; // reset links sent by email work for 1 hour
const RESET_ADMIN_MS = 24 * 60 * 60 * 1000; // links made by an admin work for 24 hours
const DAY_MS = 24 * 60 * 60 * 1000;

// Self-moderation: content reported by this many different members is hidden until an admin reviews it
const AUTO_HIDE_REPORTS = 3;
// Spam protection: accounts younger than this many days can only post this much per 24 hours
const NEW_ACCOUNT_DAYS = 7;
const NEW_ACCOUNT_DAILY = { question: 5, note: 20 };

// ---------- helpers ----------

function text(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function cleanLinks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(v => typeof v === 'string')
    .map(v => v.trim())
    .filter(v => v.length <= LIMITS.url && isHttpUrl(v))
    .slice(0, LIMITS.links);
}

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;

function cleanImages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(v => typeof v === 'string')
    .map(v => v.trim())
    .filter(v =>
      (v.length <= LIMITS.url && isHttpUrl(v)) ||
      (v.length <= LIMITS.imageDataUrl && DATA_IMAGE.test(v)))
    .slice(0, LIMITS.images);
}

// Returns a normalized email, '' for "none", or null if it isn't a valid address
function cleanEmail(value) {
  const email = text(value, LIMITS.email).toLowerCase();
  if (!email) return '';
  return EMAIL.test(email) ? email : null;
}

function newId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function findPost(posts, id) {
  return posts.find(p => String(p.id) === String(id));
}

function findUserByName(username) {
  const lower = String(username || '').toLowerCase();
  return store.all('users').find(u => u.username.toLowerCase() === lower);
}

function emailTaken(email, exceptUserId) {
  return Boolean(email) && store.all('users').some(u => u.email === email && u.id !== exceptUserId);
}

// Full address of the site, for links inside emails. Set SITE_URL if the guess is wrong.
function siteUrl(req) {
  return (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

function excerpt(body, max = 280) {
  return body.length > max ? body.slice(0, max).trimEnd() + '…' : body;
}

// ---------- upgrading saved data ----------

// Votes are one per account: `voters` holds user ids and `votes` is its length.
function normalizeVotes(item) {
  item.voters = Array.isArray(item.voters) ? item.voters : [];
  item.votes = item.voters.length;
}

function normalizePost(post) {
  const p = { ...post };
  if (p.body === undefined) p.body = p.snippet || ''; // the first version only had a snippet
  delete p.snippet;
  delete p.url; // the first version linked to hand-made pages; post.html?id= replaces them
  p.images = Array.isArray(p.images) ? p.images : [];
  p.links = Array.isArray(p.links) ? p.links : [];
  p.acceptedResponseId = p.acceptedResponseId || null;
  p.responses = (Array.isArray(p.responses) ? p.responses : []).map(r => {
    const copy = { ...r, images: r.images || [], links: r.links || [] };
    normalizeVotes(copy);
    return copy;
  });
  normalizeVotes(p);
  return p;
}

function normalizeUser(user) {
  return {
    ...user,
    email: user.email || '',
    emailNotifications: user.emailNotifications !== false,
    tm: user.tm && user.tm.status ? user.tm : { status: 'none' }
  };
}

// ---------- what the browser gets to see ----------

function usersById() {
  return new Map(store.all('users').map(u => [u.id, u]));
}

function isAuthor(viewer, item) {
  return Boolean(viewer && item.authorId && item.authorId === viewer.id);
}

function canDelete(viewer, item) {
  return isAuthor(viewer, item) || isAdmin(viewer);
}

// Hidden (auto-moderated) content is only visible to its author and admins until reviewed
function canSee(viewer, item) {
  return !item.hidden || isAuthor(viewer, item) || isAdmin(viewer);
}

// TM status is looked up live, so a mentor who is later rejected loses the badge everywhere.
function presentResponse(post, r, viewer, users) {
  const { voters, ...rest } = r;
  const author = r.authorId ? users.get(r.authorId) : null;
  return {
    ...rest,
    isTM: author ? isVerifiedTM(author) : Boolean(r.isTM),
    tmRole: author ? tmLabel(author) : (r.tmRole || ''),
    accepted: post.acceptedResponseId === r.id,
    voted: Boolean(viewer && voters.includes(viewer.id)),
    canDelete: canDelete(viewer, r),
    canEdit: isAuthor(viewer, r)
  };
}

function presentPost(post, viewer, users) {
  const { voters, ...rest } = post;
  return {
    ...rest,
    responses: post.responses
      .filter(r => canSee(viewer, r))
      .map(r => presentResponse(post, r, viewer, users)),
    voted: Boolean(viewer && voters.includes(viewer.id)),
    canDelete: canDelete(viewer, post),
    canEdit: isAuthor(viewer, post),
    canAccept: isAuthor(viewer, post)
  };
}

// Spam protection for brand-new accounts. Returns an error message, or null if they may post.
function newAccountLimit(user, kind) {
  if (isAdmin(user) || Date.now() - Date.parse(user.createdAt) > NEW_ACCOUNT_DAYS * DAY_MS) return null;
  const since = new Date(Date.now() - DAY_MS).toISOString();
  let count = 0;
  for (const p of store.all('posts')) {
    if (kind === 'question' && p.authorId === user.id && p.createdAt > since) count++;
    if (kind === 'note') count += p.responses.filter(r => r.authorId === user.id && r.createdAt > since).length;
  }
  const max = NEW_ACCOUNT_DAILY[kind];
  return count >= max
    ? `New accounts can post ${max} ${kind === 'question' ? 'questions' : 'notes'} a day for their first week. Try again tomorrow.`
    : null;
}

// Tell every admin about something that needs their attention
function notifyAdmins(message, link, req) {
  for (const admin of store.all('users').filter(isAdmin)) {
    notify(admin.id, {
      text: message,
      link,
      email: { subject: `[The Compass] ${message}`, body: `${message}\n\nReview it here: ${siteUrl(req)}/${link}` }
    });
  }
}

// What the feed needs: no response bodies, and at most one photo per post.
function summarize(post, viewer, users) {
  const { responses, images, body, ...rest } = presentPost(post, viewer, users);
  return {
    ...rest,
    excerpt: excerpt(body),
    thumbnail: images[0] || null,
    imageCount: images.length,
    linkCount: post.links.length,
    responseCount: responses.length,
    tmResponseCount: responses.filter(r => r.isTM).length,
    solved: Boolean(post.acceptedResponseId)
  };
}

// Sent only to the user themself (and to admins reviewing TM applications)
function privateUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    emailNotifications: user.emailNotifications,
    createdAt: user.createdAt,
    isAdmin: isAdmin(user),
    tm: user.tm,
    tmLabel: tmLabel(user)
  };
}

// ---------- simple rate limits ----------

const WINDOW_MS = 10 * 60 * 1000;
const limiters = [];

// Allows each IP at most `max` requests per 10 minutes on the routes it guards
function rateLimit(max) {
  const log = new Map(); // ip -> timestamps of recent requests
  limiters.push(log);
  return (req, res, next) => {
    const now = Date.now();
    const recent = (log.get(req.ip) || []).filter(t => now - t < WINDOW_MS);
    if (recent.length >= max) {
      return res.status(429).json({ error: 'You are doing that too often. Try again in a few minutes.' });
    }
    recent.push(now);
    log.set(req.ip, recent);
    next();
  };
}

const limitAuth = rateLimit(20);
const limitPosting = rateLimit(20);
const limitVoting = rateLimit(120);

setInterval(() => {
  const now = Date.now();
  for (const log of limiters) {
    for (const [ip, times] of log) {
      if (times.every(t => now - t >= WINDOW_MS)) log.delete(ip);
    }
  }
}, WINDOW_MS).unref();

// ---------- general ----------

// GET /api/health -> confirm the server is alive
app.get('/api/health', (req, res) => {
  res.json({ ok: true, posts: store.all('posts').length });
});

// GET /api/config -> what the pages need to know about how the site is set up
app.get('/api/config', (req, res) => {
  res.json({ emailEnabled: emailEnabled() });
});

app.get('/api/categories', (req, res) => {
  res.json(CATEGORIES);
});

// ---------- accounts ----------

app.post('/api/auth/register', limitAuth, async (req, res) => {
  const b = req.body || {};
  const username = text(b.username, 40);
  const displayName = text(b.displayName, LIMITS.displayName);
  const password = typeof b.password === 'string' ? b.password : '';
  const email = cleanEmail(b.email);

  // Spam bots fill in every field, including "website", which people never see (it's hidden on the page)
  if (b.website) return res.status(400).json({ error: 'Something went wrong. Please try again.' });
  if (!USERNAME.test(username)) {
    return res.status(400).json({ error: 'Usernames are 3–20 letters, numbers, or underscores.' });
  }
  if (displayName.length < 2) {
    return res.status(400).json({ error: 'Your display name needs at least 2 characters.' });
  }
  if (password.length < 8 || password.length > 200) {
    return res.status(400).json({ error: 'Passwords need at least 8 characters.' });
  }
  if (email === null) return res.status(400).json({ error: "That email address doesn't look right." });

  const passwordHash = await hashPassword(password);
  const result = await store.update('users', users => {
    if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) return 'username';
    if (email && users.some(u => u.email === email)) return 'email';
    const created = {
      id: newId(),
      username,
      displayName,
      email,
      emailNotifications: true,
      passwordHash,
      createdAt: new Date().toISOString(),
      tm: { status: 'none' }
    };
    users.push(created);
    return created;
  });
  if (result === 'username') return res.status(409).json({ error: 'That username is taken.' });
  if (result === 'email') return res.status(409).json({ error: 'That email is already used by another account.' });

  await startSession(req, res, result.id);
  res.status(201).json({ user: privateUser(result) });
});

app.post('/api/auth/login', limitAuth, async (req, res) => {
  const b = req.body || {};
  const password = typeof b.password === 'string' ? b.password : '';

  const user = findUserByName(text(b.username, 40));
  if (!user || !(await checkPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  await startSession(req, res, user.id);
  res.json({ user: privateUser(user) });
});

app.post('/api/auth/logout', async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
});

// POST /api/auth/forgot { login: username or email } -> emails a reset link if possible.
// Always gives the same answer so it can't be used to find out who has an account.
app.post('/api/auth/forgot', limitAuth, async (req, res) => {
  const login = text(req.body && req.body.login, LIMITS.email).toLowerCase();
  const user = store.all('users').find(u => u.username.toLowerCase() === login || (u.email && u.email === login));

  if (user && user.email && emailEnabled()) {
    const token = await createResetToken(user.id, RESET_EMAIL_MS);
    await sendEmail({
      to: user.email,
      subject: 'Reset your Compass password',
      text: `Hi ${user.displayName},\n\nSomeone (hopefully you) asked to reset the password for @${user.username} on The Compass.\n\n` +
        `Choose a new password here (the link works for 1 hour):\n${siteUrl(req)}/reset.html?token=${token}\n\n` +
        'If you did not ask for this, you can ignore this email; your password has not changed.'
    });
  }
  res.json({
    ok: true,
    message: emailEnabled()
      ? 'If that account has an email address, a reset link is on its way. Check your inbox (and spam folder).'
      : 'Password reset by email is not set up on this site yet. Ask an admin for a reset link.'
  });
});

// POST /api/auth/reset { token, password } -> sets a new password and signs in
app.post('/api/auth/reset', limitAuth, async (req, res) => {
  const b = req.body || {};
  const password = typeof b.password === 'string' ? b.password : '';
  if (password.length < 8 || password.length > 200) {
    return res.status(400).json({ error: 'Passwords need at least 8 characters.' });
  }

  const userId = await consumeResetToken(b.token);
  if (!userId) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired. Ask for a new one.' });
  }
  const passwordHash = await hashPassword(password);
  const user = await store.update('users', users => {
    const u = users.find(x => x.id === userId);
    if (u) u.passwordHash = passwordHash;
    return u;
  });
  if (!user) return res.status(400).json({ error: 'That account no longer exists.' });

  await endOtherSessions(user.id, null); // sign out everywhere, including anyone who knew the old password
  await startSession(req, res, user.id);
  res.json({ user: privateUser(user) });
});

// GET /api/me -> the signed-in user, or { user: null }
app.get('/api/me', (req, res) => {
  res.json({ user: req.user ? privateUser(req.user) : null });
});

// PATCH /api/me { displayName?, email?, emailNotifications? } -> update account settings
app.patch('/api/me', requireUser, async (req, res) => {
  const b = req.body || {};
  const changes = {};

  if (b.displayName !== undefined) {
    const displayName = text(b.displayName, LIMITS.displayName);
    if (displayName.length < 2) return res.status(400).json({ error: 'Your display name needs at least 2 characters.' });
    changes.displayName = displayName;
  }
  if (b.email !== undefined) {
    const email = cleanEmail(b.email);
    if (email === null) return res.status(400).json({ error: "That email address doesn't look right." });
    if (emailTaken(email, req.user.id)) return res.status(409).json({ error: 'That email is already used by another account.' });
    changes.email = email;
  }
  if (b.emailNotifications !== undefined) changes.emailNotifications = b.emailNotifications === true;

  const user = await store.update('users', users => {
    const u = users.find(x => x.id === req.user.id);
    Object.assign(u, changes);
    return u;
  });
  res.json({ user: privateUser(user) });
});

// POST /api/me/password { currentPassword, newPassword }
app.post('/api/me/password', requireUser, limitAuth, async (req, res) => {
  const b = req.body || {};
  const current = typeof b.currentPassword === 'string' ? b.currentPassword : '';
  const next = typeof b.newPassword === 'string' ? b.newPassword : '';

  if (!(await checkPassword(current, req.user.passwordHash))) {
    return res.status(400).json({ error: 'Your current password is not right.' });
  }
  if (next.length < 8 || next.length > 200) {
    return res.status(400).json({ error: 'Passwords need at least 8 characters.' });
  }
  const passwordHash = await hashPassword(next);
  await store.update('users', users => {
    users.find(x => x.id === req.user.id).passwordHash = passwordHash;
  });
  await endOtherSessions(req.user.id, req.sessionHash); // keep this device signed in
  res.json({ ok: true });
});

// DELETE /api/me { password } -> delete the account. Their questions and notes stay (so
// conversations still make sense) but show as "[deleted]"; their votes are removed.
app.delete('/api/me', requireUser, limitAuth, async (req, res) => {
  const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
  if (!(await checkPassword(password, req.user.passwordHash))) {
    return res.status(400).json({ error: 'Your password is not right.' });
  }
  const id = req.user.id;
  const forget = item => {
    if (item.authorId === id) {
      Object.assign(item, { authorId: null, author: '[deleted]', authorUsername: '', isTM: false, tmRole: '' });
    }
    item.voters = item.voters.filter(v => v !== id);
    item.votes = item.voters.length;
  };

  await store.update('posts', posts => {
    for (const post of posts) {
      forget(post);
      post.responses.forEach(forget);
    }
  });
  const drop = (name, belongsToUser) => store.update(name, list => {
    const kept = list.filter(item => !belongsToUser(item));
    list.splice(0, list.length, ...kept);
  });
  await drop('notifications', n => n.userId === id);
  await drop('reports', r => r.reporterId === id);
  await drop('resets', r => r.userId === id);
  await drop('sessions', s => s.userId === id);
  await drop('users', u => u.id === id);
  await endSession(req, res); // clears the cookie
  res.json({ ok: true });
});

// POST /api/me/tm-application -> apply (or re-apply) to be a verified Temporary Mentor
app.post('/api/me/tm-application', requireUser, limitPosting, async (req, res) => {
  const b = req.body || {};
  const role = text(b.role, LIMITS.tmRole);
  const years = Number(b.years);
  const proofUrl = text(b.proofUrl, LIMITS.url);
  const about = text(b.about, LIMITS.tmAbout);

  if (role.length < 2) return res.status(400).json({ error: 'Add your current or most recent role.' });
  if (!Number.isInteger(years) || years < 1 || years > 60) {
    return res.status(400).json({ error: 'Years of experience must be a whole number from 1 to 60.' });
  }
  if (!isHttpUrl(proofUrl)) {
    return res.status(400).json({ error: 'Add a link that shows your experience, like your LinkedIn profile.' });
  }
  if (about.length < 20) {
    return res.status(400).json({ error: 'Tell reviewers a bit more about your experience (at least 20 characters).' });
  }

  const user = await store.update('users', users => {
    const u = users.find(x => x.id === req.user.id);
    u.tm = { status: 'pending', role, years, proofUrl, about, appliedAt: new Date().toISOString() };
    return u;
  });
  notifyAdmins(`${user.displayName} (@${user.username}) applied to be a Temporary Mentor`, 'account.html#admin-card', req);
  res.json({ user: privateUser(user) });
});

// ---------- notifications ----------

app.get('/api/notifications', requireUser, (req, res) => {
  const mine = store.all('notifications').filter(n => n.userId === req.user.id);
  res.json({
    unread: mine.filter(n => !n.read).length,
    items: mine.slice(0, 50).map(({ userId, ...n }) => n)
  });
});

app.post('/api/notifications/read', requireUser, async (req, res) => {
  await store.update('notifications', list => {
    for (const n of list) if (n.userId === req.user.id) n.read = true;
  });
  res.json({ ok: true });
});

// ---------- public profiles ----------

// GET /api/users/:username -> public profile with recent questions and notes
app.get('/api/users/:username', (req, res) => {
  const user = findUserByName(req.params.username);
  if (!user) return res.status(404).json({ error: 'No one by that username.' });
  const users = usersById();
  const posts = store.all('posts').filter(p => canSee(req.user, p));

  const questions = posts
    .filter(p => p.authorId === user.id)
    .slice(0, 20)
    .map(p => summarize(p, req.user, users));

  const notes = [];
  for (const p of posts) {
    for (const r of p.responses) {
      if (r.authorId === user.id && canSee(req.user, r)) {
        notes.push({
          postId: p.id,
          postTitle: p.title,
          responseId: r.id,
          excerpt: excerpt(r.body, 200),
          votes: r.votes,
          accepted: p.acceptedResponseId === r.id,
          createdAt: r.createdAt
        });
      }
    }
  }
  notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  res.json({
    username: user.username,
    displayName: user.displayName,
    createdAt: user.createdAt,
    isTM: isVerifiedTM(user),
    tmLabel: tmLabel(user),
    tmAbout: isVerifiedTM(user) ? user.tm.about : '',
    questionCount: posts.filter(p => p.authorId === user.id).length,
    noteCount: notes.length,
    questions,
    notes: notes.slice(0, 20)
  });
});

// ---------- admin ----------

app.get('/api/admin/tm-applications', requireAdmin, (req, res) => {
  const pending = store.all('users')
    .filter(u => u.tm.status === 'pending')
    .sort((a, b) => a.tm.appliedAt.localeCompare(b.tm.appliedAt))
    .map(privateUser);
  res.json(pending);
});

app.post('/api/admin/tm-applications/:userId', requireAdmin, async (req, res) => {
  const decision = req.body && req.body.decision;
  if (decision !== 'approve' && decision !== 'reject') {
    return res.status(400).json({ error: 'decision must be "approve" or "reject".' });
  }
  const note = text(req.body.note, 500);

  const user = await store.update('users', users => {
    const u = users.find(x => String(x.id) === String(req.params.userId));
    if (!u || u.tm.status !== 'pending') return null;
    u.tm = {
      ...u.tm,
      status: decision === 'approve' ? 'approved' : 'rejected',
      reviewNote: note,
      reviewedAt: new Date().toISOString()
    };
    return u;
  });
  if (!user) return res.status(404).json({ error: 'No pending application for that user.' });

  const approved = decision === 'approve';
  notify(user.id, {
    text: approved
      ? 'You are now a verified Temporary Mentor. Your notes show the TM badge.'
      : 'Your Temporary Mentor application was not approved. See your account page for details.',
    link: 'account.html',
    email: {
      subject: approved ? 'You are now a verified TM on The Compass' : 'Your TM application on The Compass',
      body: approved
        ? `Hi ${user.displayName},\n\nYour Temporary Mentor application was approved. Every note you leave now carries the TM badge.\n\nQuestions waiting for a TM: ${siteUrl(req)}/?sort=unanswered`
        : `Hi ${user.displayName},\n\nYour Temporary Mentor application was not approved this time.${note ? `\n\nReviewer's note: ${note}` : ''}\n\nYou can update it and apply again: ${siteUrl(req)}/account.html`
    }
  });
  res.json(privateUser(user));
});

// POST /api/admin/reset-link { username } -> a 24-hour password reset link to pass on to that person
app.post('/api/admin/reset-link', requireAdmin, async (req, res) => {
  const user = findUserByName(text(req.body && req.body.username, 40));
  if (!user) return res.status(404).json({ error: 'No one by that username.' });
  const token = await createResetToken(user.id, RESET_ADMIN_MS);
  res.json({ username: user.username, url: `${siteUrl(req)}/reset.html?token=${token}` });
});

// Open reports, grouped per reported item, with enough content to judge them
app.get('/api/admin/reports', requireAdmin, (req, res) => {
  const posts = store.all('posts');
  const users = usersById();
  const groups = new Map();

  for (const report of store.all('reports')) {
    const key = `${report.postId}:${report.responseId || ''}`;
    if (!groups.has(key)) {
      const post = findPost(posts, report.postId);
      const response = post && report.responseId
        ? post.responses.find(r => String(r.id) === String(report.responseId))
        : null;
      if (!post || (report.responseId && !response)) continue; // already deleted
      const item = response || post;
      groups.set(key, {
        id: report.id, // any report in the group; acting on it acts on the whole group
        kind: response ? 'note' : 'question',
        postId: post.id,
        postTitle: post.title,
        author: item.author,
        authorUsername: item.authorUsername || '',
        excerpt: excerpt(item.body, 400),
        hidden: Boolean(item.hidden),
        reasons: [],
        firstReportedAt: report.createdAt
      });
    }
    const reporter = users.get(report.reporterId);
    groups.get(key).reasons.push({ reason: report.reason, by: reporter ? reporter.username : 'unknown' });
  }
  res.json([...groups.values()]);
});

// POST /api/admin/reports/:id { action: "dismiss" | "delete" }
app.post('/api/admin/reports/:id', requireAdmin, async (req, res) => {
  const action = req.body && req.body.action;
  if (action !== 'dismiss' && action !== 'delete') {
    return res.status(400).json({ error: 'action must be "dismiss" or "delete".' });
  }
  const report = store.all('reports').find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found.' });

  await store.update('posts', posts => {
    const post = findPost(posts, report.postId);
    if (!post) return;
    if (action === 'delete') {
      if (report.responseId) removeResponse(post, report.responseId);
      else posts.splice(posts.indexOf(post), 1);
    } else {
      // Dismissed: if enough reports had hidden it automatically, show it again
      const item = report.responseId
        ? post.responses.find(r => String(r.id) === String(report.responseId))
        : post;
      if (item) delete item.hidden;
    }
  });
  // Deleting a question also removes its notes, so their reports go too
  await clearReports(report.postId, report.responseId, action === 'delete' && !report.responseId);
  res.json({ ok: true });
});

// ---------- reports from members ----------

// Removes the reports about one item: a note (responseId) or the question itself (responseId null).
// With everything = true it removes reports about the question and every note on it.
async function clearReports(postId, responseId, everything = false) {
  await store.update('reports', reports => {
    const kept = reports.filter(r => {
      if (String(r.postId) !== String(postId)) return true;
      if (everything) return false;
      return String(r.responseId || '') !== String(responseId || '');
    });
    reports.splice(0, reports.length, ...kept);
  });
}

async function fileReport(req, res, postId, responseId) {
  const reason = text(req.body && req.body.reason, LIMITS.reportReason);
  if (reason.length < 3) return res.status(400).json({ error: 'Say briefly what the problem is.' });

  const post = findPost(store.all('posts'), postId);
  const exists = post && (!responseId || post.responses.some(r => String(r.id) === String(responseId)));
  if (!exists) return res.status(404).json({ error: 'That post no longer exists.' });

  const sameItem = r => String(r.postId) === String(postId) && String(r.responseId || '') === String(responseId || '');
  const reporters = await store.update('reports', reports => {
    if (!reports.some(r => r.reporterId === req.user.id && sameItem(r))) {
      reports.push({
        id: crypto.randomUUID(),
        postId: post.id,
        responseId: responseId ? Number(responseId) : null,
        reporterId: req.user.id,
        reason,
        createdAt: new Date().toISOString()
      });
    }
    return reports.filter(sameItem).length; // one report per member per item, so this counts people
  });

  const kind = responseId ? 'note' : 'question';
  if (reporters >= AUTO_HIDE_REPORTS) {
    const newlyHidden = await store.update('posts', posts => {
      const p = findPost(posts, postId);
      const item = p && (responseId ? p.responses.find(r => String(r.id) === String(responseId)) : p);
      if (!item || item.hidden) return false;
      item.hidden = true;
      return true;
    });
    if (newlyHidden) {
      notifyAdmins(`A ${kind} on "${post.title}" was hidden automatically after ${reporters} reports`, 'account.html#reports-card', req);
    }
  } else if (reporters === 1) {
    notifyAdmins(`A ${kind} on "${post.title}" was reported`, 'account.html#reports-card', req);
  }
  res.json({ ok: true, message: 'Thanks. An admin will take a look.' });
}

app.post('/api/posts/:id/report', requireUser, limitPosting, (req, res) =>
  fileReport(req, res, req.params.id, null));

app.post('/api/posts/:id/responses/:rid/report', requireUser, limitPosting, (req, res) =>
  fileReport(req, res, req.params.id, req.params.rid));

// ---------- posts ----------

// GET /api/posts?category=Finance&q=model&sort=new|top|unanswered&offset=0
// -> { posts, hasMore } in pages of 20
app.get('/api/posts', (req, res) => {
  const category = text(req.query.category, 60);
  const q = text(req.query.q, 100).toLowerCase();
  const sort = text(req.query.sort, 20) || 'new';
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const users = usersById();

  let list = store.all('posts').filter(p => canSee(req.user, p));
  if (category) list = list.filter(p => p.category === category);
  if (q) {
    list = list.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.body.toLowerCase().includes(q) ||
      p.author.toLowerCase().includes(q));
  }

  let summaries = list.map(p => summarize(p, req.user, users));
  if (sort === 'unanswered') summaries = summaries.filter(p => p.tmResponseCount === 0);
  summaries.sort((a, b) =>
    sort === 'top'
      ? b.votes - a.votes || b.createdAt.localeCompare(a.createdAt)
      : b.createdAt.localeCompare(a.createdAt));

  res.json({
    posts: summaries.slice(offset, offset + LIMITS.pageSize),
    hasMore: offset + LIMITS.pageSize < summaries.length
  });
});

// GET /api/posts/:id -> one post with all of its responses
app.get('/api/posts/:id', (req, res) => {
  const post = findPost(store.all('posts'), req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  if (!canSee(req.user, post)) {
    return res.status(404).json({ error: 'This question is hidden while an admin reviews reports about it.' });
  }
  res.json(presentPost(post, req.user, usersById()));
});

// Checks the fields shared by asking and editing a question. Returns { error } or { fields }.
function readQuestion(b) {
  const title = text(b.title, LIMITS.title);
  const category = text(b.category, 60);
  const body = text(b.body, LIMITS.body);
  if (!title || !body) return { error: 'A question and its details are both required.' };
  if (!CATEGORIES.includes(category)) return { error: 'Pick one of the listed categories.' };
  return { fields: { title, category, body, images: cleanImages(b.images), links: cleanLinks(b.links) } };
}

// POST /api/posts -> ask a new question
app.post('/api/posts', requireUser, limitPosting, async (req, res) => {
  const limited = newAccountLimit(req.user, 'question');
  if (limited) return res.status(429).json({ error: limited });
  const { error, fields } = readQuestion(req.body || {});
  if (error) return res.status(400).json({ error });

  const post = {
    id: newId(),
    ...fields,
    authorId: req.user.id,
    author: req.user.displayName,
    authorUsername: req.user.username,
    createdAt: new Date().toISOString(),
    votes: 0,
    voters: [],
    acceptedResponseId: null,
    responses: []
  };

  await store.update('posts', posts => { posts.unshift(post); });
  res.status(201).json(presentPost(post, req.user, usersById()));
});

app.delete('/api/posts/:id', requireUser, async (req, res) => {
  const result = await store.update('posts', posts => {
    const i = posts.findIndex(p => String(p.id) === String(req.params.id));
    if (i === -1) return 404;
    if (!canDelete(req.user, posts[i])) return 403;
    posts.splice(i, 1);
    return 200;
  });
  if (result === 404) return res.status(404).json({ error: 'Post not found.' });
  if (result === 403) return res.status(403).json({ error: 'You can only delete your own posts.' });
  await clearReports(req.params.id, null, true);
  res.json({ ok: true });
});

// PATCH /api/posts/:id { title, category, body, images, links } -> the author edits their question
app.patch('/api/posts/:id', requireUser, limitPosting, async (req, res) => {
  const { error, fields } = readQuestion(req.body || {});
  if (error) return res.status(400).json({ error });

  const result = await store.update('posts', posts => {
    const post = findPost(posts, req.params.id);
    if (!post) return 404;
    if (!isAuthor(req.user, post)) return 403;
    Object.assign(post, fields, { editedAt: new Date().toISOString() });
    return post;
  });
  if (result === 404) return res.status(404).json({ error: 'Post not found.' });
  if (result === 403) return res.status(403).json({ error: 'You can only edit your own questions.' });
  res.json(presentPost(result, req.user, usersById()));
});

// PATCH /api/posts/:id/responses/:rid { body, images, links } -> the author edits their note
app.patch('/api/posts/:id/responses/:rid', requireUser, limitPosting, async (req, res) => {
  const b = req.body || {};
  const body = text(b.body, LIMITS.body);
  if (!body) return res.status(400).json({ error: "A note can't be empty. Delete it instead." });

  const result = await store.update('posts', posts => {
    const post = findPost(posts, req.params.id);
    const response = post && post.responses.find(r => String(r.id) === String(req.params.rid));
    if (!response) return 404;
    if (!isAuthor(req.user, response)) return 403;
    Object.assign(response, {
      body,
      images: cleanImages(b.images),
      links: cleanLinks(b.links),
      editedAt: new Date().toISOString()
    });
    return { post, response };
  });
  if (result === 404) return res.status(404).json({ error: 'Note not found.' });
  if (result === 403) return res.status(403).json({ error: 'You can only edit your own notes.' });
  res.json(presentResponse(result.post, result.response, req.user, usersById()));
});

// POST /api/posts/:id/responses -> leave a note on a question
app.post('/api/posts/:id/responses', requireUser, limitPosting, async (req, res) => {
  const limited = newAccountLimit(req.user, 'note');
  if (limited) return res.status(429).json({ error: limited });
  const b = req.body || {};
  const body = text(b.body, LIMITS.body);
  if (!body) return res.status(400).json({ error: 'Write your note first.' });

  const response = {
    id: newId(),
    authorId: req.user.id,
    author: req.user.displayName,
    authorUsername: req.user.username,
    // Snapshot for the record; what readers see is looked up live in presentResponse
    isTM: isVerifiedTM(req.user),
    tmRole: tmLabel(req.user),
    body,
    images: cleanImages(b.images),
    links: cleanLinks(b.links),
    votes: 0,
    voters: [],
    createdAt: new Date().toISOString()
  };

  const post = await store.update('posts', posts => {
    const found = findPost(posts, req.params.id);
    if (!found || !canSee(req.user, found)) return null;
    found.responses.push(response);
    return found;
  });
  if (!post) return res.status(404).json({ error: 'Post not found.' });

  // Tell the asker (unless they answered their own question)
  if (post.authorId && post.authorId !== req.user.id) {
    const who = response.isTM ? `${req.user.displayName} (TM, ${response.tmRole})` : req.user.displayName;
    const link = `post.html?id=${post.id}#note-${response.id}`;
    notify(post.authorId, {
      text: `${who} left a note on "${post.title}"`,
      link,
      email: {
        subject: `New note on "${post.title}"`,
        body: `${who} left a note on your question "${post.title}":\n\n${excerpt(body, 600)}\n\n` +
          `Read it and reply: ${siteUrl(req)}/${link}\n\n` +
          `To stop these emails, turn off email notifications on ${siteUrl(req)}/account.html`
      }
    });
  }
  res.status(201).json(presentResponse(post, response, req.user, usersById()));
});

// Removes a response from a post, and un-marks it if it was the most helpful one
function removeResponse(post, responseId) {
  const i = post.responses.findIndex(r => String(r.id) === String(responseId));
  if (i === -1) return false;
  if (String(post.acceptedResponseId) === String(responseId)) post.acceptedResponseId = null;
  post.responses.splice(i, 1);
  return true;
}

app.delete('/api/posts/:id/responses/:rid', requireUser, async (req, res) => {
  const result = await store.update('posts', posts => {
    const post = findPost(posts, req.params.id);
    const response = post && post.responses.find(r => String(r.id) === String(req.params.rid));
    if (!response) return 404;
    if (!canDelete(req.user, response)) return 403;
    removeResponse(post, response.id);
    return 200;
  });
  if (result === 404) return res.status(404).json({ error: 'Note not found.' });
  if (result === 403) return res.status(403).json({ error: 'You can only delete your own notes.' });
  await clearReports(req.params.id, req.params.rid);
  res.json({ ok: true });
});

// POST /api/posts/:id/accept { responseId | null } -> the asker marks (or clears) the most helpful note
app.post('/api/posts/:id/accept', requireUser, async (req, res) => {
  const responseId = req.body && req.body.responseId;
  const result = await store.update('posts', posts => {
    const post = findPost(posts, req.params.id);
    if (!post) return { status: 404, error: 'Post not found.' };
    if (post.authorId !== req.user.id) return { status: 403, error: 'Only the person who asked can mark the most helpful note.' };
    if (responseId === null || responseId === undefined) {
      post.acceptedResponseId = null;
      return { status: 200, post };
    }
    const response = post.responses.find(r => String(r.id) === String(responseId));
    if (!response) return { status: 404, error: 'Note not found.' };
    post.acceptedResponseId = response.id;
    return { status: 200, post, response };
  });
  if (result.status !== 200) return res.status(result.status).json({ error: result.error });

  const { post, response } = result;
  if (response && response.authorId && response.authorId !== req.user.id) {
    notify(response.authorId, {
      text: `${req.user.displayName} marked your note on "${post.title}" as the most helpful`,
      link: `post.html?id=${post.id}#note-${response.id}`
    });
  }
  res.json({ acceptedResponseId: post.acceptedResponseId });
});

// ---------- votes: one per account, clicking again takes it back ----------

function toggleVote(item, userId) {
  const i = item.voters.indexOf(userId);
  if (i === -1) item.voters.push(userId); else item.voters.splice(i, 1);
  item.votes = item.voters.length;
  return { votes: item.votes, voted: i === -1 };
}

app.post('/api/posts/:id/vote', requireUser, limitVoting, async (req, res) => {
  const result = await store.update('posts', posts => {
    const post = findPost(posts, req.params.id);
    return post ? toggleVote(post, req.user.id) : null;
  });
  if (!result) return res.status(404).json({ error: 'Post not found.' });
  res.json(result);
});

app.post('/api/posts/:id/responses/:rid/vote', requireUser, limitVoting, async (req, res) => {
  const result = await store.update('posts', posts => {
    const post = findPost(posts, req.params.id);
    const response = post && post.responses.find(r => String(r.id) === String(req.params.rid));
    return response ? toggleVote(response, req.user.id) : null;
  });
  if (!result) return res.status(404).json({ error: 'Note not found.' });
  res.json(result);
});

// ---------- backups: so the site survives a lost or expired database ----------

// Sign-in sessions and reset links are deliberately left out of backups
const BACKUP_COLLECTIONS = ['posts', 'users', 'notifications', 'reports'];

// Signed-in admins, or the daily GitHub Action holding the BACKUP_TOKEN secret, may download backups
function backupAccess(req, res, next) {
  if (isAdmin(req.user)) return next();
  const token = Buffer.from(process.env.BACKUP_TOKEN || '');
  const header = req.get('authorization') || '';
  const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
  const ok = token.length >= 16 && given.length === token.length && crypto.timingSafeEqual(given, token);
  if (!ok) return res.status(403).json({ error: 'Only admins can download backups.' });
  next();
}

// GET /api/admin/backup -> everything needed to rebuild the site, as one JSON file
app.get('/api/admin/backup', backupAccess, (req, res) => {
  const backup = { app: 'the-compass', version: 1, createdAt: new Date().toISOString() };
  for (const name of BACKUP_COLLECTIONS) backup[name] = store.all(name);
  res.setHeader('Content-Disposition', `attachment; filename="compass-backup-${backup.createdAt.slice(0, 10)}.json"`);
  res.json(backup);
});

// POST /api/admin/restore { backup, confirm: "RESTORE" } -> replaces all posts, users,
// notifications and reports with the backup's. Registered near the top for its bigger size limit.
async function restoreBackup(req, res) {
  if (!req.is('application/json')) return res.status(415).json({ error: 'Requests must be sent as JSON.' });
  const b = req.body || {};
  if (b.confirm !== 'RESTORE') return res.status(400).json({ error: 'Type RESTORE to confirm.' });
  const backup = b.backup;
  if (!backup || backup.app !== 'the-compass' || !BACKUP_COLLECTIONS.every(name => Array.isArray(backup[name]))) {
    return res.status(400).json({ error: "That file isn't a Compass backup." });
  }

  const normalizers = { posts: normalizePost, users: normalizeUser };
  for (const name of BACKUP_COLLECTIONS) {
    const list = normalizers[name] ? backup[name].map(normalizers[name]) : backup[name];
    await store.update(name, current => {
      current.length = 0;
      for (const item of list) current.push(item);
    });
  }
  res.json({ ok: true, posts: backup.posts.length, users: backup.users.length });
}

// ---------- housekeeping: clears out stale data every 6 hours so storage stays small ----------

async function cleanUp() {
  const now = Date.now();
  const oldRead = new Date(now - 90 * DAY_MS).toISOString();
  const prune = (name, keep) => store.update(name, list => {
    const kept = list.filter(keep);
    if (kept.length === list.length) return;
    list.length = 0;
    for (const item of kept) list.push(item);
  });
  try {
    await prune('sessions', s => s.expiresAt > now);
    await prune('resets', r => r.expiresAt > now);
    await prune('notifications', n => !n.read || n.createdAt > oldRead); // read ones older than 90 days go
  } catch (err) {
    console.error('Cleanup failed:', err);
  }
}

// ---------- fallbacks ----------

// Unknown /api routes get JSON, not the website's HTML
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Any other unknown address gets the "page not found" page
app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

// Any error (bad JSON, too-large upload, storage failure) -> a readable JSON message
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That upload is too large. Try fewer or smaller photos.' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request was not valid JSON.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 3001; // Render assigns its own PORT when deployed

store.init({ posts: normalizePost, users: normalizeUser })
  .then(() => {
    if (!process.env.ADMIN_USERNAMES) {
      console.warn('ADMIN_USERNAMES is not set, so nobody can approve Temporary Mentors yet.');
    }
    if (!emailEnabled()) {
      console.warn('Email is off (set RESEND_API_KEY and EMAIL_FROM). Password resets go through admins.');
    }
    cleanUp();
    setInterval(cleanUp, 6 * 60 * 60 * 1000).unref();
    app.listen(PORT, () => console.log(`Compass running on port ${PORT}`));
  })
  .catch(err => {
    console.error('Could not load data:', err);
    process.exit(1);
  });
