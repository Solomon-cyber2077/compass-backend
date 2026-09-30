// Ask page: post a new question (signed-in users only).

const form = document.getElementById('ask-form');
const gateEl = document.getElementById('signin-gate');
const titleEl = document.getElementById('title');
const categoryEl = document.getElementById('category');
const bodyEl = document.getElementById('body');
const linksEl = document.getElementById('links');
const errorEl = document.getElementById('error');
const submitEl = document.getElementById('submit');

const showError = message => { errorEl.textContent = message; };
const photos = imagePicker(document.getElementById('images'), showError);

attachCounter(titleEl, document.getElementById('title-count'), 200);
attachCounter(bodyEl, document.getElementById('body-count'), 10000);

getMe().then(me => {
  if (!me) {
    document.getElementById('signin-link').href = signInHref();
    gateEl.hidden = false;
    return;
  }
  document.getElementById('posting-as').textContent = `Posting as ${me.displayName} (@${me.username})`;
  form.hidden = false;
});

loadCategories().then(categories => {
  // Arriving from a filtered feed (?category=Finance) pre-selects that category
  const preset = new URLSearchParams(location.search).get('category');
  categoryEl.append(...categories.map(c => el('option', { value: c, selected: c === preset }, c)));
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  showError('');

  const title = titleEl.value.trim();
  const category = categoryEl.value;
  const body = bodyEl.value.trim();

  const fail = (message, field) => { showError(message); field.focus(); };
  if (!title) return fail('Write your question in the first box.', titleEl);
  if (!category) return fail('Pick a category.', categoryEl);
  if (!body) return fail('Add some details so a TM can give a useful answer.', bodyEl);

  const parsed = parseLinks(linksEl.value);
  if (parsed.error) return fail(parsed.error, linksEl);

  submitEl.disabled = true;
  submitEl.textContent = 'Posting…';
  try {
    const post = await api('/api/posts', {
      body: { title, category, body, images: photos.get(), links: parsed.links }
    });
    location.href = `post.html?id=${encodeURIComponent(post.id)}`;
  } catch (err) {
    showError(err.message);
    submitEl.disabled = false;
    submitEl.textContent = 'Post question';
  }
});
