// Storage for everything the site saves: posts, users, sign-in sessions, password-reset
// links, notifications, and content reports.
//
// - If the DATABASE_URL environment variable is set, data is kept in Postgres
//   (e.g. a free Render Postgres or Supabase database) and survives restarts/redeploys.
// - Otherwise it is kept in data/<name>.json. That is fine for running locally,
//   but on Render's free plan those files are reset every time the server restarts.
//
// Each collection is a list held in memory; every change is written through to storage.
// Changes run one at a time so two requests can never overwrite each other.

const fs = require('fs');
const path = require('path');

const COLLECTIONS = ['posts', 'users', 'sessions', 'resets', 'notifications', 'reports'];

let pool = null;
const data = {};
let queue = Promise.resolve();

function sslOption(url) {
  if (process.env.PGSSL === 'disable') return false;
  if (process.env.PGSSL === 'require') return { rejectUnauthorized: false };
  // Render's internal database hostnames have no dots (e.g. "dpg-abc123-a") and
  // don't need SSL; hosted databases reached over the internet do.
  const host = new URL(url).hostname;
  if (host === 'localhost' || host === '127.0.0.1' || !host.includes('.')) return false;
  return { rejectUnauthorized: false };
}

function fileFor(name) {
  return path.join(__dirname, 'data', `${name}.json`);
}

function readFile(name) {
  const file = fileFor(name);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeFile(name, list) {
  const file = fileFor(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, file); // rename is atomic, so a crash never leaves half a file
}

async function persist(name, list) {
  if (pool) {
    await pool.query(
      `INSERT INTO compass_store (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [name, JSON.stringify(list)]
    );
  } else {
    writeFile(name, list);
  }
}

// normalizers: { posts: fn, users: fn } applied to every stored item on startup
// (upgrades data saved by older versions of the site)
async function init(normalizers = {}) {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslOption(process.env.DATABASE_URL)
    });
    await pool.query('CREATE TABLE IF NOT EXISTS compass_store (key TEXT PRIMARY KEY, value JSONB NOT NULL)');
    const { rows } = await pool.query('SELECT key, value FROM compass_store WHERE key = ANY($1)', [COLLECTIONS]);
    const saved = Object.fromEntries(rows.map(r => [r.key, r.value]));
    // First run against an empty database: start from the files in data/ (the starter posts)
    for (const name of COLLECTIONS) data[name] = saved[name] || readFile(name);
    console.log('Storage: Postgres');
  } else {
    for (const name of COLLECTIONS) data[name] = readFile(name);
    console.log('Storage: data/*.json (set DATABASE_URL to keep data across restarts)');
  }
  for (const name of COLLECTIONS) {
    if (normalizers[name]) data[name] = data[name].map(normalizers[name]);
    await persist(name, data[name]);
  }
}

// Read-only view of a collection. Never modify what this returns; use update().
function all(name) {
  return data[name];
}

// Runs fn on a copy of the collection, saves the copy, and only then makes it live.
// Whatever fn returns is passed back to the caller.
function update(name, fn) {
  const run = queue.then(async () => {
    const draft = structuredClone(data[name]);
    const result = fn(draft);
    await persist(name, draft);
    data[name] = draft;
    return result;
  });
  queue = run.catch(() => {}); // one failed change must not block the ones after it
  return run;
}

module.exports = { init, all, update };
