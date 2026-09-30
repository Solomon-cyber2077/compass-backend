// Account page: sign in / create account / forgot password, settings, TM application,
// and (for admins) TM reviews, reported content, and reset links.

const next = safeNext(new URLSearchParams(location.search).get('next'));

const $ = id => document.getElementById(id);

let config = { emailEnabled: false };
const configReady = api('/api/config').then(c => { config = c; }).catch(() => {});

// ---------- signed out: sign in / create account / forgot password ----------

function showForm(which) {
  $('tab-login').setAttribute('aria-pressed', String(which !== 'register'));
  $('tab-register').setAttribute('aria-pressed', String(which === 'register'));
  $('login-form').hidden = which !== 'login';
  $('forgot-form').hidden = which !== 'forgot';
  $('register-form').hidden = which !== 'register';
}

$('tab-login').addEventListener('click', () => showForm('login'));
$('tab-register').addEventListener('click', () => showForm('register'));
$('show-forgot').addEventListener('click', () => showForm('forgot'));
$('hide-forgot').addEventListener('click', () => showForm('login'));

// Shared submit handling for sign in / sign up: disable the button, show errors, go to `next` on success
function handleAuthForm(form, errorEl, path, readBody) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    errorEl.textContent = '';
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      await api(path, { body: readBody() });
      location.href = next;
    } catch (err) {
      errorEl.textContent = err.message;
      button.disabled = false;
    }
  });
}

handleAuthForm($('login-form'), $('login-error'), '/api/auth/login', () => ({
  username: $('login-username').value.trim(),
  password: $('login-password').value
}));

handleAuthForm($('register-form'), $('register-error'), '/api/auth/register', () => ({
  displayName: $('reg-display').value.trim(),
  username: $('reg-username').value.trim(),
  email: $('reg-email').value.trim(),
  password: $('reg-password').value,
  website: $('reg-website').value // spam trap; stays empty for people
}));

$('forgot-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('forgot-form').querySelector('button[type=submit]');
  button.disabled = true;
  try {
    const result = await api('/api/auth/forgot', { body: { login: $('forgot-login').value.trim() } });
    $('forgot-result').textContent = result.message;
  } catch (err) {
    $('forgot-result').textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

// ---------- signed in: profile ----------

function renderProfile(me) {
  $('profile-name').replaceChildren(...[
    me.displayName,
    me.tm.status === 'approved' && el('span', { class: 'badge badge-tm' }, 'TM'),
    me.isAdmin && el('span', { class: 'badge badge-muted' }, 'Admin')
  ].filter(Boolean));
  const since = new Date(me.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('profile-meta').textContent = `@${me.username} · joined ${since}`;
  $('profile-link').href = `profile.html?u=${encodeURIComponent(me.username)}`;
}

// After a change, show the new account details everywhere on the page
function useUpdatedUser(user) {
  mePromise = Promise.resolve(user);
  renderProfile(user);
  renderTM(user);
  renderAccountSlot();
}

$('logout').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } finally {
    location.href = './';
  }
});

// ---------- signed in: TM application ----------

const TM_TEXT = {
  none: 'Have first-hand experience in a field? Apply to become a verified Temporary Mentor. Once approved, your notes carry the TM badge with your role and years of experience, and they are shown first.',
  pending: 'Your application is under review. You can still leave notes; they will show the TM badge as soon as you are approved. Submitting again replaces your application.',
  approved: 'You are a verified Temporary Mentor. Thank you for leaving notes for those who come after you. Changing your details below sends them for review again, and your badge is paused until they are approved.',
  rejected: 'Your last application was not approved. You can update it and apply again.'
};

function renderTM(me) {
  const tm = me.tm;
  const status = TM_TEXT[tm.status] ? tm.status : 'none';
  const badge = {
    none: null,
    pending: el('span', { class: 'badge badge-open' }, 'Under review'),
    approved: el('span', { class: 'badge badge-tm' }, `Verified · ${me.tmLabel}`),
    rejected: el('span', { class: 'badge badge-danger' }, 'Not approved')
  }[status];

  $('tm-status').replaceChildren(...[
    badge && el('p', {}, badge),
    el('p', {}, TM_TEXT[status]),
    status === 'rejected' && tm.reviewNote && el('p', { class: 'review-note' }, `Reviewer's note: ${tm.reviewNote}`)
  ].filter(Boolean));

  // Pre-fill with what they sent last time
  $('tm-role').value = tm.role || '';
  $('tm-years').value = tm.years || '';
  $('tm-proof').value = tm.proofUrl || '';
  $('tm-about').value = tm.about || '';
  $('tm-submit').textContent = status === 'none' ? 'Submit application' : 'Update application';
}

$('tm-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('tm-error').textContent = '';
  const me = await getMe();
  if (me.tm.status === 'approved' &&
      !confirm('Updating your details pauses your TM badge until a reviewer approves them again. Continue?')) {
    return;
  }
  $('tm-submit').disabled = true;
  try {
    const { user } = await api('/api/me/tm-application', {
      body: {
        role: $('tm-role').value.trim(),
        years: Number($('tm-years').value),
        proofUrl: $('tm-proof').value.trim(),
        about: $('tm-about').value.trim()
      }
    });
    useUpdatedUser(user);
  } catch (err) {
    $('tm-error').textContent = err.message;
  } finally {
    $('tm-submit').disabled = false;
  }
});

// ---------- signed in: settings and password ----------

function fillSettings(me) {
  $('set-display').value = me.displayName;
  $('set-email').value = me.email || '';
  $('set-notify').checked = me.emailNotifications;
  $('email-off-hint').hidden = config.emailEnabled;
}

$('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('settings-result').textContent = '';
  $('settings-error').textContent = '';
  try {
    const { user } = await api('/api/me', {
      method: 'PATCH',
      body: {
        displayName: $('set-display').value.trim(),
        email: $('set-email').value.trim(),
        emailNotifications: $('set-notify').checked
      }
    });
    useUpdatedUser(user);
    fillSettings(user);
    $('settings-result').textContent = 'Saved. New posts and notes use your new display name.';
  } catch (err) {
    $('settings-error').textContent = err.message;
  }
});

$('password-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('pw-result').textContent = '';
  $('pw-error').textContent = '';
  try {
    await api('/api/me/password', {
      body: { currentPassword: $('pw-current').value, newPassword: $('pw-new').value }
    });
    $('pw-current').value = '';
    $('pw-new').value = '';
    $('pw-result').textContent = 'Password changed. Other devices have been signed out.';
  } catch (err) {
    $('pw-error').textContent = err.message;
  }
});

$('delete-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('delete-error').textContent = '';
  if (!confirm('Delete your account permanently? This cannot be undone.')) return;
  try {
    await api('/api/me', { method: 'DELETE', body: { password: $('delete-password').value } });
    location.href = './';
  } catch (err) {
    $('delete-error').textContent = err.message;
  }
});

// ---------- admins: TM applications ----------

async function loadApplications() {
  const list = $('applications');
  try {
    const pending = await api('/api/admin/tm-applications');
    if (!pending.length) {
      list.replaceChildren(el('div', { class: 'empty' }, el('strong', {}, 'All caught up.'), 'No applications are waiting.'));
      return;
    }
    list.replaceChildren(...pending.map(applicationCard));
  } catch (err) {
    list.replaceChildren(el('p', { class: 'error' }, err.message));
  }
}

function applicationCard(user) {
  const tm = user.tm;
  const noteInput = el('input', { class: 'input', maxlength: '500', placeholder: 'Optional note to the applicant (shown if rejected)', 'aria-label': 'Note to applicant' });
  const errorEl = el('p', { class: 'error', role: 'alert' });

  const decide = decision => async () => {
    errorEl.textContent = '';
    try {
      await api(`/api/admin/tm-applications/${encodeURIComponent(user.id)}`, {
        body: { decision, note: noteInput.value.trim() }
      });
      loadApplications();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  };

  return el('article', { class: 'application' },
    el('div', { class: 'response-head' },
      el('span', { class: 'name' }, user.displayName),
      el('span', { class: 'role' }, `@${user.username}`),
      el('time', { class: 'when', datetime: tm.appliedAt, title: fullDate(tm.appliedAt) }, `applied ${timeAgo(tm.appliedAt)}`)),
    el('p', {}, el('strong', {}, tm.role), ` · ${plural(tm.years, 'year', 'years')}`),
    el('p', { class: 'body-text' }, tm.about),
    renderLinks([tm.proofUrl]),
    el('div', { class: 'decision' },
      noteInput,
      el('button', { type: 'button', class: 'btn btn-primary', onclick: decide('approve') }, 'Approve'),
      el('button', { type: 'button', class: 'btn', onclick: decide('reject') }, 'Reject')),
    errorEl);
}

// ---------- admins: reported content ----------

async function loadReports() {
  const list = $('reports');
  try {
    const reports = await api('/api/admin/reports');
    if (!reports.length) {
      list.replaceChildren(el('div', { class: 'empty' }, el('strong', {}, 'Nothing reported.'), 'The archive is clean.'));
      return;
    }
    list.replaceChildren(...reports.map(reportCard));
  } catch (err) {
    list.replaceChildren(el('p', { class: 'error' }, err.message));
  }
}

function reportCard(report) {
  const errorEl = el('p', { class: 'error', role: 'alert' });
  const act = action => async () => {
    if (action === 'delete' && !confirm(`Delete this ${report.kind}? This can't be undone.`)) return;
    errorEl.textContent = '';
    try {
      await api(`/api/admin/reports/${encodeURIComponent(report.id)}`, { body: { action } });
      loadReports();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  };

  return el('article', { class: 'application' },
    el('div', { class: 'response-head' },
      el('span', { class: 'badge badge-danger' }, `Reported ${report.kind}`),
      report.hidden ? el('span', { class: 'badge badge-muted' }, 'Hidden automatically') : null,
      el('span', { class: 'name' }, authorLink(report.author, report.authorUsername)),
      el('time', { class: 'when', datetime: report.firstReportedAt }, timeAgo(report.firstReportedAt))),
    el('p', {}, 'On ', el('a', { href: `post.html?id=${encodeURIComponent(report.postId)}` }, report.postTitle)),
    el('p', { class: 'body-text quoted' }, report.excerpt),
    el('ul', { class: 'reasons' },
      report.reasons.map(r => el('li', {}, `"${r.reason}" (by @${r.by})`))),
    el('div', { class: 'decision' },
      el('button', { type: 'button', class: 'btn btn-primary', onclick: act('delete') }, `Delete ${report.kind}`),
      el('button', { type: 'button', class: 'btn', onclick: act('dismiss') }, report.hidden ? 'Dismiss and show again' : 'Dismiss')),
    errorEl);
}

// ---------- admins: backups ----------

// Opens a backup encrypted by the daily GitHub Action. It was made with
// `openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt`, so the file is "Salted__" + 8-byte salt +
// ciphertext, and the key and IV come from PBKDF2-SHA256 of the passphrase.
async function decryptBackup(bytes, passphrase) {
  const salt = bytes.slice(8, 16);
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, baseKey, 384));
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-CBC', false, ['decrypt']);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: bits.slice(32, 48) }, key, bytes.slice(16));
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Couldn't decrypt the backup. Check the passphrase.");
  }
}

$('backup-card').addEventListener('submit', async event => {
  event.preventDefault();
  $('restore-result').textContent = '';
  $('restore-error').textContent = '';
  const file = $('restore-file').files[0];
  if (!file) return void ($('restore-error').textContent = 'Choose a backup file first.');
  if ($('restore-confirm').value.trim() !== 'RESTORE') {
    return void ($('restore-error').textContent = 'Type RESTORE in the confirmation box.');
  }

  const button = $('backup-card').querySelector('button[type=submit]');
  button.disabled = true;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const encrypted = new TextDecoder().decode(bytes.slice(0, 8)) === 'Salted__';
    if (encrypted && !$('restore-passphrase').value) throw new Error('This backup is encrypted. Enter its passphrase.');
    const textContent = encrypted
      ? await decryptBackup(bytes, $('restore-passphrase').value)
      : new TextDecoder().decode(bytes);

    let backup;
    try { backup = JSON.parse(textContent); } catch { throw new Error("That file isn't a Compass backup."); }
    const result = await api('/api/admin/restore', { body: { backup, confirm: 'RESTORE' } });
    $('restore-result').textContent = `Restored ${plural(result.posts, 'question', 'questions')} and ${plural(result.users, 'account', 'accounts')}.`;
    $('restore-confirm').value = '';
  } catch (err) {
    $('restore-error').textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

// ---------- admins: reset links ----------

$('reset-link-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('reset-link-error').textContent = '';
  $('reset-link-result').hidden = true;
  try {
    const { url } = await api('/api/admin/reset-link', { body: { username: $('reset-username').value.trim() } });
    $('reset-link-url').value = url;
    $('reset-link-result').hidden = false;
  } catch (err) {
    $('reset-link-error').textContent = err.message;
  }
});

$('copy-reset-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('reset-link-url').value);
    $('copy-reset-link').textContent = 'Copied';
  } catch {
    $('reset-link-url').select(); // clipboard blocked: select it so it can be copied by hand
  }
});

// ---------- start ----------

Promise.all([getMe(), configReady]).then(([me]) => {
  $('loading').hidden = true;
  if (!me) {
    if (!config.emailEnabled) {
      $('forgot-intro').textContent = "Password reset by email isn't set up on this site yet. Ask an admin for a reset link; they can make one for your username.";
    }
    if (new URLSearchParams(location.search).get('tab') === 'register') showForm('register');
    $('signed-out').hidden = false;
    return;
  }
  renderProfile(me);
  renderTM(me);
  fillSettings(me);
  $('signed-in').hidden = false;
  if (me.isAdmin) {
    $('admin-card').hidden = false;
    $('reports-card').hidden = false;
    $('reset-link-form').hidden = false;
    $('backup-card').hidden = false;
    loadApplications();
    loadReports();
  }
});
