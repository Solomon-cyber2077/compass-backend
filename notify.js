// Notifications: shown on the site (the bell in the header) and, when the user has an email
// address, has email notifications on, and email is set up, also sent by email.

const crypto = require('crypto');
const store = require('./store');
const { sendEmail } = require('./email');

const MAX_PER_USER = 100; // older notifications are dropped

// notify(userId, { text, link, email: { subject, body } })
// `link` is a site-relative page like "post.html?id=1"; `email` is optional.
// Never throws: a failed notification must not break the action that caused it.
async function notify(userId, { text, link, email }) {
  if (!userId) return;
  try {
    await store.update('notifications', list => {
      list.unshift({
        id: crypto.randomUUID(),
        userId,
        text,
        link,
        read: false,
        createdAt: new Date().toISOString()
      });
      const mine = list.filter(n => n.userId === userId);
      if (mine.length > MAX_PER_USER) {
        const drop = new Set(mine.slice(MAX_PER_USER));
        const kept = list.filter(n => !drop.has(n));
        list.splice(0, list.length, ...kept);
      }
    });

    const user = store.all('users').find(u => u.id === userId);
    if (email && user && user.email && user.emailNotifications !== false) {
      await sendEmail({ to: user.email, subject: email.subject, text: email.body });
    }
  } catch (err) {
    console.error('Notification failed:', err);
  }
}

module.exports = { notify };
