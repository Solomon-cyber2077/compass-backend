# The Compass

A Reddit-style career Q&A site. Here, people ask career questions and **Temporary Mentors (TMs)**, people with real first-hand experience, leave notes answering them. The goal is straight answers fast, instead of waiting weeks on LinkedIn.

## What it does

- **Archive (home page):** questions 20 at a time with "Load more", search, category filters, and New / Top / Needs a TM sorting.
- **Ask a question:** title, category, details, up to 4 photos (uploaded or linked), and up to 5 links.
- **Notes:** answers with photos and links. Verified TM notes are highlighted and listed first.
- **Most helpful:** the person who asked can mark one note as most helpful; it moves to the top.
- **Accounts:** username + password, optional email. Settings for display name, email, and email notifications; password change; self-service account deletion.
- **Password reset:** by emailed link (when email is set up), or with a one-time link an admin creates.
- **Notifications:** a bell in the header when someone answers your question, marks your note most helpful, or reviews your TM application. Also emailed when email is set up and the member has an email address.
- **Verified Temporary Mentors:** members apply with role, years, a proof link, and a description; admins approve or reject. Approved TMs get a badge with their role and years on every note.
- **Public profiles:** each member's TM background, notes, and questions.
- **Upvotes:** one per account; clicking again takes it back.
- **Editing:** authors can edit their questions (title, category, details, photos, links) and notes; edited posts show "(edited)".
- **Moderation:** anyone can report a question or note; admins review reports and can delete anything. People can delete their own posts.
- **Guidelines & privacy page**, a "page not found" page, and browser security headers.

## Runs itself

The site is built to keep going with as little admin work as possible:

- **Community moderation:** anything reported by 3 different members is hidden automatically until an admin reviews it (dismissing the reports shows it again).
- **Spam protection:** a hidden trap field on sign-up catches bots; accounts in their first week can post 5 questions and 20 notes a day; requests are rate-limited.
- **Admins are told what needs them:** new TM applications and reports arrive as notifications (and email, when set up), so nobody has to check.
- **Housekeeping:** expired sign-ins, used reset links, and read notifications older than 90 days are cleared every 6 hours.
- **Backups:** a GitHub Action saves an encrypted backup every day (kept 90 days). Admins can also download a backup and restore one from their account page, e.g. to move to a new database.
- **Stays awake:** a GitHub Action pings the site every 10 minutes so Render's free plan doesn't put it to sleep.

## Project layout

| Path | What it is |
| --- | --- |
| `server.js` | Express server: the API and the website files |
| `auth.js` | Password hashing, sign-in sessions (cookies), reset links, admin and TM checks |
| `email.js` | Sends email through Resend (optional) |
| `notify.js` | On-site notifications (plus email) |
| `store.js` | Saves everything to Postgres (if `DATABASE_URL` is set) or to `data/*.json` |
| `data/posts.json` | Starter posts |
| `public/` | The website pages, `common.js` (shared code), and `styles.css` |

## Run it on your computer

Install [Node.js](https://nodejs.org) 18 or newer, then in this folder:

```bash
npm install
npm start
```

Open http://localhost:3001. To make yourself an admin locally, start it with `ADMIN_USERNAMES=yourname npm start` (on Windows PowerShell: `$env:ADMIN_USERNAMES='yourname'; npm start`) and sign up with that username.

## Deploy on Render

1. Create a **Web Service** from this repo. Build command `npm install`, start command `npm start`.
2. Add these **environment variables** to the web service:

| Variable | Required? | What it does |
| --- | --- | --- |
| `DATABASE_URL` | **Yes** | Postgres connection URL. Without it, Render's free plan erases every account and post whenever the service restarts. **Use [Neon](https://neon.tech)'s free plan**: it doesn't expire, while Render's free Postgres is deleted about 30 days after creation (check Render's current terms). |
| `ADMIN_USERNAMES` | **Yes** | Comma-separated usernames that are admins, e.g. `solomon`. Sign up with that exact username right after deploying so nobody else claims it. |
| `RESEND_API_KEY` | Recommended | API key from [resend.com](https://resend.com) (free tier). Turns on password-reset emails and email notifications. |
| `EMAIL_FROM` | With Resend | Sender, e.g. `The Compass <notes@yourdomain.com>`. The domain must be verified in Resend. |
| `SITE_URL` | Optional | Your site's address, e.g. `https://compass.onrender.com`, used in email links. Normally worked out automatically. |
| `BACKUP_TOKEN` | Recommended | A long random string (16+ characters) that lets the daily GitHub backup download your data. Must match the GitHub secret of the same name. |
| `PGSSL` | Optional | `require` or `disable` to override the automatic database SSL choice. |

Without email set up, everything still works: notifications appear under the bell, and admins can make password reset links from their account page.

## GitHub Actions (keep-awake and daily backups)

In the repo on GitHub, open **Settings → Secrets and variables → Actions**:

1. **Variables** tab → add `SITE_URL` = your site's address (e.g. `https://compass.onrender.com`). This turns on the keep-awake ping.
2. **Secrets** tab → add `BACKUP_TOKEN` (the same value as on Render) and `BACKUP_PASSPHRASE` (a password that encrypts the backups; store it somewhere safe, since without it backups can't be opened). This turns on daily backups.

Backups appear under **Actions → Daily backup → (a run) → Artifacts**. To restore: download and unzip it, then on your admin account page choose the `.json.enc` file, enter the passphrase, type RESTORE, and click Restore.

Note: GitHub pauses scheduled Actions in a repo with no activity for 60 days and emails you first; re-enable them with one click in the Actions tab.

## API

All changes must be sent as JSON (`Content-Type: application/json`). Signing in sets an HttpOnly session cookie.

| Method | Path | Who | Body / query |
| --- | --- | --- | --- |
| GET | `/api/health`, `/api/config`, `/api/categories` | anyone | – |
| POST | `/api/auth/register` | anyone | `{ username, displayName, password, email? }` |
| POST | `/api/auth/login` | anyone | `{ username, password }` |
| POST | `/api/auth/logout` | anyone | – |
| POST | `/api/auth/forgot` | anyone | `{ login }` (username or email) |
| POST | `/api/auth/reset` | anyone | `{ token, password }` |
| GET | `/api/me` | anyone | returns `{ user }` or `{ user: null }` |
| PATCH | `/api/me` | signed in | `{ displayName?, email?, emailNotifications? }` |
| DELETE | `/api/me` | signed in | `{ password }` |
| POST | `/api/me/password` | signed in | `{ currentPassword, newPassword }` |
| POST | `/api/me/tm-application` | signed in | `{ role, years, proofUrl, about }` |
| GET | `/api/notifications` | signed in | – |
| POST | `/api/notifications/read` | signed in | – |
| GET | `/api/users/:username` | anyone | public profile |
| GET | `/api/posts` | anyone | `?category=&q=&sort=new\|top\|unanswered&offset=` → `{ posts, hasMore }` |
| GET | `/api/posts/:id` | anyone | – |
| POST | `/api/posts` | signed in | `{ title, category, body, images?, links? }` |
| PATCH | `/api/posts/:id` | author | `{ title, category, body, images?, links? }` |
| DELETE | `/api/posts/:id` | author or admin | – |
| POST | `/api/posts/:id/responses` | signed in | `{ body, images?, links? }` |
| PATCH | `/api/posts/:id/responses/:rid` | author | `{ body, images?, links? }` |
| DELETE | `/api/posts/:id/responses/:rid` | author or admin | – |
| POST | `/api/posts/:id/accept` | asker | `{ responseId }` (or `null` to clear) |
| POST | `/api/posts/:id/vote`, `/api/posts/:id/responses/:rid/vote` | signed in | toggles your vote |
| POST | `/api/posts/:id/report`, `/api/posts/:id/responses/:rid/report` | signed in | `{ reason }` |
| GET | `/api/admin/tm-applications` | admin | – |
| POST | `/api/admin/tm-applications/:userId` | admin | `{ decision: "approve" \| "reject", note? }` |
| GET | `/api/admin/reports` | admin | – |
| POST | `/api/admin/reports/:id` | admin | `{ action: "dismiss" \| "delete" }` |
| POST | `/api/admin/reset-link` | admin | `{ username }` → `{ url }` |
| GET | `/api/admin/backup` | admin, or `Authorization: Bearer BACKUP_TOKEN` | full backup as JSON |
| POST | `/api/admin/restore` | admin | `{ backup, confirm: "RESTORE" }` (up to 100 MB) |

## Possible next steps

- Photos are stored inside the database record. That's fine for a small site; at larger scale, move them to object storage (e.g. Cloudinary or S3).
