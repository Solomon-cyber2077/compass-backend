// Reset page: reached from a reset link (reset.html?token=...), sets a new password.

const token = new URLSearchParams(location.search).get('token') || '';
const form = document.getElementById('reset-form');
const errorEl = document.getElementById('reset-error');

// Take the token out of the address bar so it doesn't linger in history or get shared by accident
history.replaceState(null, '', location.pathname);

if (!token) {
  form.replaceChildren(
    el('h2', {}, 'This link is incomplete'),
    el('p', {}, 'Open the whole link from your email, or ', el('a', { href: 'account.html' }, 'ask for a new one'), '.'));
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  errorEl.textContent = '';
  const password = document.getElementById('new-password').value;
  if (password !== document.getElementById('confirm-password').value) {
    errorEl.textContent = "The two passwords don't match.";
    return;
  }
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    await api('/api/auth/reset', { body: { token, password } });
    location.href = 'account.html';
  } catch (err) {
    errorEl.textContent = err.message;
    button.disabled = false;
  }
});
