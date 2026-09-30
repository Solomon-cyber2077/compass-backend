// Notifications page: newest first; opening it marks everything as read.

const listEl = document.getElementById('list');

async function load() {
  if (!(await getMe())) {
    location.href = signInHref();
    return;
  }
  try {
    const { items, unread } = await api('/api/notifications');
    if (!items.length) {
      listEl.replaceChildren(el('div', { class: 'empty' },
        el('strong', {}, 'Nothing yet.'),
        "You'll see a notice here when someone leaves a note on your question."));
      return;
    }
    listEl.replaceChildren(...items.map(n =>
      el('a', { class: n.read ? 'card notification' : 'card notification unread', href: n.link || './' },
        el('span', { class: 'notification-text' }, n.text),
        el('time', { class: 'when', datetime: n.createdAt, title: fullDate(n.createdAt) }, timeAgo(n.createdAt)))));
    if (unread > 0) {
      await api('/api/notifications/read', { method: 'POST' });
      renderAccountSlot(); // clear the count on the bell
    }
  } catch (err) {
    listEl.replaceChildren(el('div', { class: 'empty' }, el('strong', {}, 'Could not load notifications.'), err.message));
  }
}

load();
