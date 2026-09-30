// Sending email through Resend (https://resend.com, free tier is plenty for a small site).
//
// Set RESEND_API_KEY and EMAIL_FROM (e.g. "The Compass <notes@yourdomain.com>") to turn it on.
// Without them the site still works: password resets go through an admin instead,
// and notifications only appear on the site.

function emailEnabled() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

// Returns true if the email was accepted for delivery. Never throws.
async function sendEmail({ to, subject, text }) {
  if (!emailEnabled() || !to) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text })
    });
    if (!res.ok) {
      console.error(`Email to ${to} failed: ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Email to ${to} failed:`, err.message);
    return false;
  }
}

module.exports = { emailEnabled, sendEmail };
