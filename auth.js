// Accounts: password hashing, sign-in sessions (cookie based), and who is an admin.

const crypto = require('crypto');
const { promisify } = require('util');
const store = require('./store');

const scrypt = promisify(crypto.scrypt);

const COOKIE = 'compass_session';
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

// ---------- passwords ----------

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

async function checkPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const known = Buffer.from(hash, 'hex');
  const test = await scrypt(password, salt, 64);
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

// ---------- sessions ----------

// Only a hash of each session token is stored, so a leaked database can't be used to sign in.
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1 || part.slice(0, i).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
  }
  return null;
}

function setCookie(req, res, value, maxAgeSeconds) {
  // req.secure is true behind Render's HTTPS proxy because server.js sets 'trust proxy'
  const parts = [
    `${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`
  ];
  if (req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  await store.update('sessions', sessions => {
    const live = sessions.filter(s => s.expiresAt > now); // drop expired ones while we're here
    sessions.splice(0, sessions.length, ...live, { hash: sha256(token), userId, expiresAt: now + SESSION_MS });
  });
  setCookie(req, res, token, SESSION_DAYS * 24 * 60 * 60);
}

async function endSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) {
    const hash = sha256(token);
    await store.update('sessions', sessions => {
      const i = sessions.findIndex(s => s.hash === hash);
      if (i !== -1) sessions.splice(i, 1);
    });
  }
  setCookie(req, res, '', 0);
}

// Signs a user out everywhere except the session in keepHash (used after a password change/reset)
async function endOtherSessions(userId, keepHash) {
  await store.update('sessions', sessions => {
    const kept = sessions.filter(s => s.userId !== userId || s.hash === keepHash);
    sessions.splice(0, sessions.length, ...kept);
  });
}

// Sets req.user to the signed-in user (or null) and req.sessionHash to their session.
function attachUser(req, res, next) {
  req.user = null;
  req.sessionHash = null;
  const token = readCookie(req, COOKIE);
  if (token) {
    const hash = sha256(token);
    const session = store.all('sessions').find(s => s.hash === hash && s.expiresAt > Date.now());
    if (session) {
      req.user = store.all('users').find(u => u.id === session.userId) || null;
      req.sessionHash = req.user ? hash : null;
    }
  }
  next();
}

// ---------- password reset links ----------

// Returns a one-time token for a reset link. Like sessions, only its hash is stored.
async function createResetToken(userId, ttlMs) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  await store.update('resets', resets => {
    const live = resets.filter(r => r.expiresAt > now);
    resets.splice(0, resets.length, ...live, { hash: sha256(token), userId, expiresAt: now + ttlMs });
  });
  return token;
}

// Uses up a reset token. Returns the user id it belongs to, or null if invalid/expired.
// All of that user's outstanding reset links stop working once one is used.
async function consumeResetToken(token) {
  if (typeof token !== 'string' || !token) return null;
  const hash = sha256(token);
  return store.update('resets', resets => {
    const match = resets.find(r => r.hash === hash && r.expiresAt > Date.now());
    if (!match) return null;
    const kept = resets.filter(r => r.userId !== match.userId);
    resets.splice(0, resets.length, ...kept);
    return match.userId;
  });
}

// ---------- roles ----------

// Admins are listed in the ADMIN_USERNAMES environment variable, e.g. "solomon,alex".
function isAdmin(user) {
  if (!user) return false;
  const admins = (process.env.ADMIN_USERNAMES || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return admins.includes(user.username.toLowerCase());
}

function isVerifiedTM(user) {
  return Boolean(user && user.tm && user.tm.status === 'approved');
}

// "PE Associate · 4 yrs" shown next to a verified TM's name
function tmLabel(user) {
  if (!isVerifiedTM(user)) return '';
  const years = user.tm.years;
  return `${user.tm.role} · ${years} ${years === 1 ? 'yr' : 'yrs'}`;
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in first.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only admins can do that.' });
  next();
}

module.exports = {
  hashPassword, checkPassword, startSession, endSession, endOtherSessions, attachUser,
  createResetToken, consumeResetToken,
  isAdmin, isVerifiedTM, tmLabel, requireUser, requireAdmin
};
