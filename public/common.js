// Shared helpers for every page of The Compass.

const FALLBACK_CATEGORIES = [
  'Finance', 'Sales', 'Tech', 'Marketing', 'Consulting', 'Law', 'Healthcare',
  'Engineering', 'Design', 'Career Change', 'Interviews', 'Other'
];

// api('/api/posts') reads; api(path, { body }) posts JSON; api(path, { method: 'DELETE' }) etc.
// Every change is sent as JSON (the server rejects anything else).
async function api(path, options = {}) {
  const method = options.method || (options.body !== undefined ? 'POST' : 'GET');
  const init = { method, credentials: 'same-origin' };
  if (method !== 'GET') {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(options.body === undefined ? {} : options.body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status}).`);
  return data;
}

// ---------- the signed-in user ----------

let mePromise = null;

// Resolves to the signed-in user, or null. Fetched once per page.
function getMe() {
  if (!mePromise) {
    mePromise = api('/api/me').then(r => r.user).catch(() => null);
  }
  return mePromise;
}

// Link to the sign-in page that comes back to the current page afterwards
function signInHref() {
  return `account.html?next=${encodeURIComponent(location.pathname + location.search)}`;
}

const ICON_BELL = 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0';

// Fills <span id="account-slot"> in the header with "Sign in", or the notification bell and the user's name
async function renderAccountSlot() {
  const slot = document.getElementById('account-slot');
  if (!slot) return;
  const me = await getMe();
  if (!me) {
    slot.replaceChildren(el('a', { href: signInHref() }, 'Sign in'));
    return;
  }
  const bell = el('a', { href: 'notifications.html', class: 'bell', 'aria-label': 'Notifications', title: 'Notifications' },
    svgIcon(ICON_BELL));
  slot.replaceChildren(
    bell,
    el('a', { href: 'account.html', class: 'account-link', title: 'Your account' },
      me.displayName,
      me.tm.status === 'approved' ? el('span', { class: 'badge badge-tm' }, 'TM') : null,
      me.isAdmin ? el('span', { class: 'badge badge-muted' }, 'Admin') : null));

  try {
    const { unread } = await api('/api/notifications');
    if (unread > 0) {
      bell.append(el('span', { class: 'bell-count' }, unread > 99 ? '99+' : String(unread)));
      bell.setAttribute('aria-label', `Notifications (${unread} unread)`);
    }
  } catch { /* the bell still works without a count */ }
}

document.addEventListener('DOMContentLoaded', renderAccountSlot);

async function loadCategories() {
  try {
    const list = await api('/api/categories');
    return Array.isArray(list) && list.length ? list : FALLBACK_CATEGORIES;
  } catch {
    return FALLBACK_CATEGORIES;
  }
}

// ---------- DOM ----------

// el('a', { href: '/x', class: 'y', onclick: fn }, 'text', childNode)
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

function svgIcon(pathData, viewBox = '0 0 24 24') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', pathData);
  svg.append(path);
  return svg;
}

const ICON_UP = 'M12 19V5M5 12l7-7 7 7';

// ---------- URLs ----------

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSafeImage(value) {
  return typeof value === 'string' &&
    (isHttpUrl(value) || /^data:image\/(png|jpeg|gif|webp);base64,/.test(value));
}

function hostOf(value) {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return value; }
}

// Turns plain text into text + clickable links. Never interprets HTML.
function linkify(text) {
  const frag = document.createDocumentFragment();
  const parts = String(text).split(/(https?:\/\/[^\s<>"]+)/g);
  parts.forEach((part, i) => {
    if (i % 2 === 0) {
      if (part) frag.append(part);
      return;
    }
    // Leave sentence punctuation after a link outside of it: "see https://x.com."
    const match = part.match(/^(.*?)([.,!?;:)\]]*)$/);
    const url = match[1];
    const trailing = match[2];
    if (isHttpUrl(url)) {
      frag.append(el('a', { href: url, target: '_blank', rel: 'noopener noreferrer nofollow ugc' }, url));
    } else {
      frag.append(url);
    }
    if (trailing) frag.append(trailing);
  });
  return frag;
}

// ---------- text ----------

function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return 'just now';
  const units = [['y', 31536000], ['mo', 2592000], ['w', 604800], ['d', 86400], ['h', 3600], ['m', 60]];
  for (const [label, size] of units) {
    if (s >= size) return `${Math.floor(s / size)}${label} ago`;
  }
  return 'just now';
}

function fullDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------- votes ----------

// Upvote button for a post, or for a response when responseId is given.
// One vote per account; clicking again takes it back. Signed-out visitors are sent to sign in.
function voteControl({ postId, responseId, votes, voted, inline }) {
  const path = responseId
    ? `/api/posts/${encodeURIComponent(postId)}/responses/${encodeURIComponent(responseId)}/vote`
    : `/api/posts/${encodeURIComponent(postId)}/vote`;

  let count = votes || 0;
  let on = Boolean(voted);
  let busy = false;
  const countEl = el('span', { class: 'vote-count' }, String(count));
  const button = el('button', {
    type: 'button',
    'aria-label': responseId ? 'Mark this note useful' : 'Upvote this question',
    'aria-pressed': String(on)
  }, svgIcon(ICON_UP));

  const show = () => {
    countEl.textContent = String(count);
    button.setAttribute('aria-pressed', String(on));
  };

  button.addEventListener('click', async event => {
    event.stopPropagation(); // don't open the post when voting from the feed
    if (busy) return;
    if (!(await getMe())) {
      location.href = signInHref();
      return;
    }
    busy = true;
    const before = { count, on };
    // update right away, then confirm with the server
    count = Math.max(0, count + (on ? -1 : 1));
    on = !on;
    show();
    try {
      const result = await api(path, { method: 'POST' });
      count = result.votes;
      on = result.voted;
    } catch (err) {
      ({ count, on } = before);
      alert(err.message);
    } finally {
      show();
      busy = false;
    }
  });

  return el('div', { class: inline ? 'vote inline' : 'vote' }, button, countEl);
}

// A question in a list (home page, profiles). The whole card opens the question.
function postCard(post) {
  const href = `post.html?id=${encodeURIComponent(post.id)}`;

  const foot = [
    el('span', {}, plural(post.responseCount, 'note', 'notes')),
    post.tmResponseCount > 0
      ? el('span', { class: 'badge badge-tm' }, `✓ Answered by ${plural(post.tmResponseCount, 'TM', 'TMs')}`)
      : el('span', { class: 'badge badge-open' }, 'Needs a TM'),
    post.solved ? el('span', { class: 'badge badge-solved' }, '★ Most helpful chosen') : null,
    post.imageCount > 1 ? el('span', {}, `${post.imageCount} photos`) : null,
    post.linkCount > 0 ? el('span', {}, plural(post.linkCount, 'link', 'links')) : null,
    post.factChecked ? el('span', { class: 'badge badge-muted' }, 'Fact-checked') : null
  ];

  const card = el('article', { class: 'card post-card' },
    voteControl({ postId: post.id, votes: post.votes, voted: post.voted }),
    el('div', { class: 'card-main' },
      el('div', { class: 'meta' },
        el('span', { class: 'tag' }, post.category),
        el('span', {}, 'asked by ', authorLink(post.author, post.authorUsername)),
        el('span', { class: 'dot' }),
        el('time', { datetime: post.createdAt, title: fullDate(post.createdAt) }, timeAgo(post.createdAt))),
      el('h2', {}, el('a', { href }, post.title)),
      post.excerpt ? el('p', { class: 'excerpt' }, post.excerpt) : null,
      isSafeImage(post.thumbnail)
        ? el('img', {
            class: 'thumb', src: post.thumbnail, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer',
            onerror: event => event.target.remove() // a dead image link shouldn't leave an empty box
          })
        : null,
      el('div', { class: 'card-foot' }, foot)));

  // The whole card opens the post, except clicks on real links and buttons inside it
  card.addEventListener('click', event => {
    if (event.target.closest('a, button')) return;
    if (window.getSelection().toString()) return; // let people select text
    location.href = href;
  });
  return card;
}

// "· edited" after the time, when something was changed after posting
function editedMarker(item) {
  return item.editedAt
    ? el('span', { class: 'edited', title: `Edited ${fullDate(item.editedAt)}` }, '(edited)')
    : null;
}

// Shown to the author (and admins) on something hidden after several reports
function hiddenBanner(kind) {
  return el('p', { class: 'hidden-banner' },
    `This ${kind} is hidden from others while an admin reviews reports about it.`);
}

// An author's name, linked to their profile when they have an account
function authorLink(name, username) {
  const strong = el('strong', {}, name);
  return username
    ? el('a', { href: `profile.html?u=${encodeURIComponent(username)}`, class: 'author-link' }, strong)
    : strong;
}

// "Report" button: asks why, then files a report for the admins
function reportButton(path) {
  return el('button', {
    type: 'button',
    class: 'btn btn-quiet btn-danger',
    onclick: async event => {
      event.stopPropagation();
      if (!(await getMe())) {
        location.href = signInHref();
        return;
      }
      const reason = prompt('What is wrong with this? (e.g. spam, harassment, false TM claim)');
      if (reason === null) return;
      try {
        const result = await api(path, { body: { reason } });
        alert(result.message);
      } catch (err) {
        alert(err.message);
      }
    }
  }, 'Report');
}

// "Delete" button for the author (or an admin). onDone runs after the server confirms.
function deleteButton(label, path, onDone) {
  return el('button', {
    type: 'button',
    class: 'btn btn-quiet btn-danger',
    onclick: async event => {
      event.stopPropagation();
      if (!confirm(`Delete this ${label}? This can't be undone.`)) return;
      try {
        await api(path, { method: 'DELETE' });
        onDone();
      } catch (err) {
        alert(err.message);
      }
    }
  }, 'Delete');
}

// ---------- media display ----------

function renderGallery(images) {
  const safe = (images || []).filter(isSafeImage);
  if (!safe.length) return null;
  return el('div', { class: safe.length === 1 ? 'gallery single' : 'gallery' },
    safe.map((src, i) => {
      const img = el('img', { src, alt: `Attached photo ${i + 1}`, loading: 'lazy', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => { img.closest('a').hidden = true; }); // dead image link
      // data: URLs can't be opened in a new tab by most browsers, so open those in a blank page instead
      const link = el('a', { href: isHttpUrl(src) ? src : '#', target: '_blank', rel: 'noopener noreferrer' }, img);
      if (!isHttpUrl(src)) {
        link.addEventListener('click', event => {
          event.preventDefault();
          const w = window.open('', '_blank');
          if (!w) return;
          w.document.title = 'Photo';
          w.document.body.style.cssText = 'margin:0;background:#111;display:grid;place-items:center;min-height:100vh';
          const big = w.document.createElement('img');
          big.src = src;
          big.style.cssText = 'max-width:100%;max-height:100vh';
          w.document.body.append(big);
        });
      }
      return link;
    }));
}

function renderLinks(links) {
  const safe = (links || []).filter(isHttpUrl);
  if (!safe.length) return null;
  return el('ul', { class: 'link-list' },
    safe.map(url => el('li', {},
      el('a', { href: url, target: '_blank', rel: 'noopener noreferrer nofollow ugc' },
        el('span', { class: 'host' }, hostOf(url)),
        el('span', { class: 'full' }, url)))));
}

// ---------- media input (photos + links) ----------

const MAX_IMAGES = 4;
const MAX_LINKS = 5;

// Shrinks a photo so uploads stay small: longest side 1280px, JPEG quality 0.82.
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(`${file.name} is not an image this browser can open.`));
      img.onload = () => {
        const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; // transparent PNGs would otherwise turn black as JPEG
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Builds the "add photos" control inside `container`, starting with `initial` photos (when editing).
// Returns { get, clear }.
function imagePicker(container, onError, initial = []) {
  let images = [...initial].filter(isSafeImage).slice(0, MAX_IMAGES);
  const idSuffix = Math.random().toString(36).slice(2, 8);

  const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr-only', id: `file-${idSuffix}` });
  const uploadBtn = el('label', { class: 'btn', for: `file-${idSuffix}` }, 'Upload photos');
  const urlInput = el('input', { type: 'url', class: 'input', placeholder: 'or paste an image link (https://…)', 'aria-label': 'Image link' });
  const addUrlBtn = el('button', { type: 'button', class: 'btn' }, 'Add');
  const previews = el('div', { class: 'previews' });

  function render() {
    previews.replaceChildren(...images.map((src, i) =>
      el('div', { class: 'preview' },
        el('img', { src, alt: `Photo ${i + 1}`, referrerpolicy: 'no-referrer' }),
        el('button', {
          type: 'button',
          'aria-label': `Remove photo ${i + 1}`,
          onclick: () => { images.splice(i, 1); render(); }
        }, '×'))));
    const full = images.length >= MAX_IMAGES;
    fileInput.disabled = full;
    uploadBtn.toggleAttribute('aria-disabled', full);
    uploadBtn.style.opacity = full ? '0.55' : '';
    addUrlBtn.disabled = full;
  }

  fileInput.addEventListener('change', async () => {
    onError('');
    const files = [...fileInput.files].slice(0, MAX_IMAGES - images.length);
    fileInput.value = '';
    for (const file of files) {
      try {
        images.push(await compressImage(file));
        render();
      } catch (err) {
        onError(err.message);
      }
    }
  });

  function addUrl() {
    const value = urlInput.value.trim();
    if (!value) return;
    if (!isHttpUrl(value)) {
      onError('Image links must start with http:// or https://');
      return;
    }
    if (images.length >= MAX_IMAGES) return;
    onError('');
    images.push(value);
    urlInput.value = '';
    render();
  }
  addUrlBtn.addEventListener('click', addUrl);
  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addUrl(); }
  });

  container.append(
    el('div', { class: 'picker' },
      el('div', { class: 'picker-row' }, uploadBtn, fileInput, urlInput, addUrlBtn),
      previews));
  render();

  return {
    get: () => [...images],
    clear: () => { images = []; render(); }
  };
}

// Reads a "one link per line" textarea. Returns { links } or { error }.
function parseLinks(value) {
  const lines = value.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > MAX_LINKS) return { error: `You can add up to ${MAX_LINKS} links.` };
  const withScheme = lines.map(l => (/^[a-z][a-z0-9+.-]*:/i.test(l) ? l : `https://${l}`));
  const bad = withScheme.find(l => !isHttpUrl(l));
  if (bad) return { error: `"${bad}" doesn't look like a web link.` };
  return { links: withScheme };
}

// Live "12 / 200" counter under a text field
function attachCounter(input, counter, max) {
  const update = () => { counter.textContent = `${input.value.length} / ${max}`; };
  input.addEventListener('input', update);
  update();
}

// Only follow ?next= links that stay on this site
function safeNext(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
    ? value
    : './';
}
