// Post page: one question and the notes (responses) left on it.

const postId = new URLSearchParams(location.search).get('id');
const postPath = `/api/posts/${encodeURIComponent(postId)}`;

const postEl = document.getElementById('post');
const sectionEl = document.getElementById('responses-section');
const responsesEl = document.getElementById('responses');
const countEl = document.getElementById('response-count');

const replyForm = document.getElementById('reply-form');
const replyGateEl = document.getElementById('reply-gate');
const postingAsEl = document.getElementById('posting-as');
const replyBodyEl = document.getElementById('reply-body');
const replyLinksEl = document.getElementById('reply-links');
const replyErrorEl = document.getElementById('reply-error');
const replySubmitEl = document.getElementById('reply-submit');

const showReplyError = message => { replyErrorEl.textContent = message; };
const replyPhotos = imagePicker(document.getElementById('reply-images'), showReplyError);

attachCounter(replyBodyEl, document.getElementById('reply-count'), 10000);

function setUpReplyForm(me) {
  if (!me) {
    document.getElementById('reply-signin').href = signInHref();
    replyGateEl.hidden = false;
    return;
  }
  if (me.tm.status === 'approved') {
    postingAsEl.replaceChildren(
      `Posting as ${me.displayName} `,
      el('span', { class: 'badge badge-tm' }, 'TM'),
      ` ${me.tmLabel}`);
  } else {
    postingAsEl.replaceChildren(
      `Posting as ${me.displayName}. `,
      me.tm.status === 'pending'
        ? 'Your TM application is under review.'
        : el('a', { href: 'account.html' }, 'Apply to be a verified TM'));
  }
  replyForm.hidden = false;
}

function renderQuestion(post) {
  document.title = `${post.title} · The Compass`;

  const provenance = [];
  if (post.factChecked) provenance.push('Fact-checked');
  if (post.aiAssisted) provenance.push('Written with AI assistance');
  if (post.sources) provenance.push(`Sources: ${post.sources}`);

  postEl.replaceChildren(el('article', { class: 'card question' },
    voteControl({ postId: post.id, votes: post.votes, voted: post.voted }),
    el('div', { class: 'card-main' },
      el('div', { class: 'meta' },
        el('a', { class: 'tag', href: `./?category=${encodeURIComponent(post.category)}` }, post.category),
        el('span', {}, 'asked by ', authorLink(post.author, post.authorUsername)),
        el('span', { class: 'dot' }),
        el('time', { datetime: post.createdAt, title: fullDate(post.createdAt) }, timeAgo(post.createdAt)),
        editedMarker(post)),
      post.hidden ? hiddenBanner('question') : null,
      el('h1', {}, post.title),
      el('p', { class: 'body-text' }, linkify(post.body)),
      renderGallery(post.images),
      renderLinks(post.links),
      provenance.length ? el('p', { class: 'provenance' }, provenance.join(' · ')) : null,
      el('div', { class: 'item-actions' },
        post.canEdit
          ? el('button', { type: 'button', class: 'btn btn-quiet', onclick: () => editQuestion(post) }, 'Edit')
          : null,
        post.canDelete
          ? deleteButton('question', postPath, () => { location.href = './'; })
          : reportButton(`${postPath}/report`)))));
}

// ---------- editing ----------

// A form for changing a question (withQuestionFields) or a note. onSave gets the new values.
async function editForm(item, withQuestionFields, onSave) {
  const errorEl = el('p', { class: 'error', role: 'alert' });
  const showError = message => { errorEl.textContent = message; };

  let titleInput = null;
  let categorySelect = null;
  if (withQuestionFields) {
    titleInput = el('input', { class: 'input', maxlength: '200', value: item.title, id: 'edit-title' });
    const categories = await loadCategories();
    categorySelect = el('select', { class: 'select', id: 'edit-category' },
      categories.map(c => el('option', { value: c, selected: c === item.category }, c)));
  }
  const bodyInput = el('textarea', { class: 'textarea', maxlength: '10000', id: `edit-body-${item.id}` });
  bodyInput.value = item.body;
  const photosSlot = el('div');
  const photos = imagePicker(photosSlot, showError, item.images || []);
  const linksInput = el('textarea', { class: 'textarea short', id: `edit-links-${item.id}` });
  linksInput.value = (item.links || []).join('\n');
  const saveButton = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save changes');

  const field = (label, input) => el('div', { class: 'field' }, el('label', { for: input.id }, label), input);
  const form = el('form', { class: 'edit-form', novalidate: true },
    titleInput ? field('Question', titleInput) : null,
    categorySelect ? field('Category', categorySelect) : null,
    field(withQuestionFields ? 'Details' : 'Your note', bodyInput),
    el('div', { class: 'field' }, el('span', { class: 'label' }, 'Photos'), photosSlot),
    field('Links (one per line)', linksInput),
    el('div', { class: 'form-actions' },
      saveButton,
      el('button', { type: 'button', class: 'btn btn-quiet', onclick: loadPost }, 'Cancel'),
      errorEl));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    showError('');
    const parsed = parseLinks(linksInput.value);
    if (parsed.error) return showError(parsed.error);
    if (!bodyInput.value.trim()) return showError('This can’t be empty.');
    if (titleInput && !titleInput.value.trim()) return showError('The question can’t be empty.');

    saveButton.disabled = true;
    try {
      await onSave({
        ...(withQuestionFields ? { title: titleInput.value.trim(), category: categorySelect.value } : {}),
        body: bodyInput.value.trim(),
        images: photos.get(),
        links: parsed.links
      });
      await loadPost();
    } catch (err) {
      showError(err.message);
      saveButton.disabled = false;
    }
  });
  return form;
}

async function editQuestion(post) {
  const form = await editForm(post, true, values => api(postPath, { method: 'PATCH', body: values }));
  postEl.replaceChildren(el('article', { class: 'card form-card' }, el('h2', {}, 'Edit your question'), form));
  postEl.scrollIntoView({ block: 'start' });
}

async function editNote(r) {
  const form = await editForm(r, false, values =>
    api(`${postPath}/responses/${encodeURIComponent(r.id)}`, { method: 'PATCH', body: values }));
  document.getElementById(`note-${r.id}`)
    .replaceWith(el('article', { class: 'card form-card', id: `note-${r.id}` }, el('h2', {}, 'Edit your note'), form));
}

// The asker can mark one note as the most helpful (or un-mark it)
function acceptButton(post, r) {
  return el('button', {
    type: 'button',
    class: r.accepted ? 'btn btn-quiet accept on' : 'btn btn-quiet accept',
    onclick: async () => {
      try {
        await api(`${postPath}/accept`, { body: { responseId: r.accepted ? null : r.id } });
        loadPost();
      } catch (err) {
        alert(err.message);
      }
    }
  }, r.accepted ? '★ Unmark most helpful' : '☆ Mark most helpful');
}

function renderResponse(post, r) {
  const classes = ['card', 'response', r.isTM && 'tm', r.accepted && 'accepted'].filter(Boolean).join(' ');
  return el('article', { class: classes, id: `note-${r.id}` },
    r.accepted ? el('p', { class: 'accepted-label' }, '★ Marked most helpful by the asker') : null,
    r.isTM ? el('p', { class: 'tm-label' }, 'A note from someone who came before') : null,
    el('div', { class: 'response-head' },
      el('span', { class: 'name' }, authorLink(r.author, r.authorUsername)),
      r.isTM ? el('span', { class: 'badge badge-tm', title: 'Verified Temporary Mentor' }, 'TM') : null,
      r.isTM && r.tmRole ? el('span', { class: 'role' }, r.tmRole) : null,
      el('time', { class: 'when', datetime: r.createdAt, title: fullDate(r.createdAt) }, timeAgo(r.createdAt)),
      editedMarker(r)),
    r.hidden ? hiddenBanner('note') : null,
    el('p', { class: 'body-text' }, linkify(r.body)),
    renderGallery(r.images),
    renderLinks(r.links),
    el('div', { class: 'response-foot' },
      post.canAccept ? acceptButton(post, r) : null,
      r.canEdit ? el('button', { type: 'button', class: 'btn btn-quiet', onclick: () => editNote(r) }, 'Edit') : null,
      r.canDelete
        ? deleteButton('note', `${postPath}/responses/${encodeURIComponent(r.id)}`, loadPost)
        : reportButton(`${postPath}/responses/${encodeURIComponent(r.id)}/report`),
      voteControl({ postId: post.id, responseId: r.id, votes: r.votes, voted: r.voted, inline: true })));
}

function renderResponses(post) {
  // The asker's pick first, then verified TM notes, then the most useful,
  // then oldest first so conversations read in order
  const sorted = [...post.responses].sort((a, b) =>
    (b.accepted - a.accepted) || (b.isTM - a.isTM) || (b.votes - a.votes) ||
    a.createdAt.localeCompare(b.createdAt));

  const tmCount = post.responses.filter(r => r.isTM).length;
  countEl.textContent = post.responses.length
    ? `${plural(post.responses.length, 'note', 'notes')}${tmCount ? ` · ${tmCount === 1 ? '1 from a TM' : `${tmCount} from TMs`}` : ''}`
    : '';

  responsesEl.replaceChildren(...(sorted.length
    ? sorted.map(r => renderResponse(post, r))
    : [el('div', { class: 'empty' },
        el('strong', {}, 'No notes yet.'),
        'If you have walked this path, be the first to leave one.')]));
  sectionEl.hidden = false;
}

async function loadPost() {
  if (!postId) {
    postEl.replaceChildren(el('div', { class: 'empty' },
      el('strong', {}, 'No question selected.'), el('a', { href: './' }, 'Browse the archive')));
    return;
  }
  try {
    const post = await api(postPath);
    renderQuestion(post);
    renderResponses(post);
  } catch (err) {
    postEl.replaceChildren(el('div', { class: 'empty' },
      el('strong', {}, 'This question could not be loaded.'), err.message));
  }
}

replyForm.addEventListener('submit', async event => {
  event.preventDefault();
  showReplyError('');

  const body = replyBodyEl.value.trim();
  const fail = (message, field) => { showReplyError(message); field.focus(); };
  if (!body) return fail('Write your note first.', replyBodyEl);

  const parsed = parseLinks(replyLinksEl.value);
  if (parsed.error) return fail(parsed.error, replyLinksEl);

  replySubmitEl.disabled = true;
  replySubmitEl.textContent = 'Posting…';
  try {
    const created = await api(`${postPath}/responses`, {
      body: { body, images: replyPhotos.get(), links: parsed.links }
    });
    replyBodyEl.value = '';
    replyLinksEl.value = '';
    replyBodyEl.dispatchEvent(new Event('input')); // reset the character counter
    replyPhotos.clear();
    await loadPost();
    document.getElementById(`note-${created.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    showReplyError(err.message);
  } finally {
    replySubmitEl.disabled = false;
    replySubmitEl.textContent = 'Post note';
  }
});

loadPost().then(() => {
  // Only offer the note form when the question actually loaded
  if (!sectionEl.hidden) getMe().then(setUpReplyForm);
  // Links from notifications point at a specific note (post.html?id=1#note-2)
  if (location.hash.startsWith('#note-')) {
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' });
  }
});
