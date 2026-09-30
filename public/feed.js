// Home page: the list of questions, 20 at a time.

const feedEl = document.getElementById('feed');
const moreEl = document.getElementById('load-more');
const chipsEl = document.getElementById('categories');
const searchEl = document.getElementById('search');
const tabEls = [...document.querySelectorAll('.tab')];

// Filters live in the address bar so a filtered view can be shared or bookmarked
const params = new URLSearchParams(location.search);
const state = {
  category: params.get('category') || '',
  q: params.get('q') || '',
  sort: ['new', 'top', 'unanswered'].includes(params.get('sort')) ? params.get('sort') : 'new'
};

let requestNumber = 0;
let loaded = 0; // how many questions are on screen

function syncUrl() {
  const p = new URLSearchParams();
  if (state.category) p.set('category', state.category);
  if (state.q) p.set('q', state.q);
  if (state.sort !== 'new') p.set('sort', state.sort);
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

function emptyState() {
  if (state.q || state.category || state.sort === 'unanswered') {
    const msg = state.sort === 'unanswered' && !state.q && !state.category
      ? 'Every question has a TM answer. Nice.'
      : 'No questions match these filters.';
    return el('div', { class: 'empty' }, el('strong', {}, msg), 'Try a different search or category.');
  }
  return el('div', { class: 'empty' },
    el('strong', {}, 'No questions yet.'),
    'Be the first to ', el('a', { href: 'ask.html' }, 'ask one'), '.');
}

// append = false starts over (new filter/search); true adds the next page
async function loadFeed(append = false) {
  const mine = ++requestNumber;
  const p = new URLSearchParams({ sort: state.sort, offset: String(append ? loaded : 0) });
  if (state.category) p.set('category', state.category);
  if (state.q) p.set('q', state.q);
  moreEl.disabled = true;

  try {
    const { posts, hasMore } = await api(`/api/posts?${p}`);
    if (mine !== requestNumber) return; // a newer search already started
    if (append) {
      feedEl.append(...posts.map(postCard));
      loaded += posts.length;
    } else {
      feedEl.replaceChildren(...(posts.length ? posts.map(postCard) : [emptyState()]));
      loaded = posts.length;
    }
    moreEl.hidden = !hasMore;
  } catch (err) {
    if (mine !== requestNumber) return;
    if (append) {
      alert(err.message);
    } else {
      feedEl.replaceChildren(el('div', { class: 'empty' },
        el('strong', {}, 'The archive could not be loaded.'), err.message));
      moreEl.hidden = true;
    }
  } finally {
    if (mine === requestNumber) moreEl.disabled = false;
  }
}

moreEl.addEventListener('click', () => loadFeed(true));

function renderChips(categories) {
  const all = ['', ...categories];
  chipsEl.replaceChildren(...all.map(cat =>
    el('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': String(state.category === cat),
      onclick: () => {
        state.category = cat;
        renderChips(categories);
        syncUrl();
        loadFeed();
      }
    }, cat || 'All')));
}

function renderTabs() {
  tabEls.forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.sort === state.sort)));
}

tabEls.forEach(tab => tab.addEventListener('click', () => {
  state.sort = tab.dataset.sort;
  renderTabs();
  syncUrl();
  loadFeed();
}));

let searchTimer;
searchEl.value = state.q;
searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = searchEl.value.trim();
    syncUrl();
    loadFeed();
  }, 250);
});

renderTabs();
loadCategories().then(renderChips);
loadFeed();
