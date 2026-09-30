// Public profile: who someone is, their TM background, and what they've asked and answered.

const username = new URLSearchParams(location.search).get('u') || '';
const root = document.getElementById('profile');

function noteItem(n) {
  return el('a', { class: 'card note-item', href: `post.html?id=${encodeURIComponent(n.postId)}#note-${encodeURIComponent(n.responseId)}` },
    el('span', { class: 'meta' },
      'On ', el('strong', {}, n.postTitle),
      el('span', { class: 'dot' }),
      el('time', { datetime: n.createdAt, title: fullDate(n.createdAt) }, timeAgo(n.createdAt)),
      n.accepted ? el('span', { class: 'badge badge-solved' }, '★ Most helpful') : null),
    el('span', { class: 'excerpt' }, n.excerpt),
    el('span', { class: 'note-votes' }, plural(n.votes, 'upvote', 'upvotes')));
}

async function load() {
  if (!username) {
    root.replaceChildren(el('div', { class: 'empty' }, el('strong', {}, 'No profile selected.'), el('a', { href: './' }, 'Browse the archive')));
    return;
  }
  try {
    const p = await api(`/api/users/${encodeURIComponent(username)}`);
    document.title = `${p.displayName} · The Compass`;
    const since = new Date(p.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    root.replaceChildren(
      el('div', { class: p.isTM ? 'card form-card profile-hero tm' : 'card form-card profile-hero' },
        el('h1', {}, p.displayName, p.isTM ? el('span', { class: 'badge badge-tm' }, 'Verified TM') : null),
        el('p', { class: 'meta' }, `@${p.username} · joined ${since} · ${plural(p.questionCount, 'question', 'questions')} · ${plural(p.noteCount, 'note', 'notes')}`),
        p.isTM ? el('p', { class: 'tm-line' }, p.tmLabel) : null,
        p.tmAbout ? el('p', { class: 'body-text' }, p.tmAbout) : null),

      el('div', { class: 'section-title' }, el('h2', {}, 'Notes left behind'), el('span', {}, p.noteCount > 20 ? 'latest 20' : '')),
      p.notes.length
        ? el('div', { class: 'responses' }, p.notes.map(noteItem))
        : el('div', { class: 'empty' }, 'No notes yet.'),

      el('div', { class: 'section-title' }, el('h2', {}, 'Questions asked'), el('span', {}, p.questionCount > 20 ? 'latest 20' : '')),
      p.questions.length
        ? el('div', { class: 'feed' }, p.questions.map(postCard))
        : el('div', { class: 'empty' }, 'No questions yet.'));
  } catch (err) {
    root.replaceChildren(el('div', { class: 'empty' }, el('strong', {}, 'This profile could not be loaded.'), err.message));
  }
}

load();
