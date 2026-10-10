# Contributing to The Compass

Thanks for helping. The Compass is a small, open-source career Q&A site, and contributions of any size are welcome: bug reports, fixes, features, docs, and design.

## Ways to help

- **Report a bug:** open an issue with what you did, what you expected, what happened, and your browser.
- **Suggest a feature:** open an issue describing the problem it solves before writing code, so we can agree on the approach.
- **Send a fix or feature:** fork the repo, make your change on a branch, and open a pull request against `main`.
- **Security problems:** please don't post them publicly. Open an issue asking for a private contact, or use GitHub's private vulnerability reporting if enabled.

## Running it locally

Install [Node.js](https://nodejs.org) 18 or newer, then:

```bash
npm install
npm start
```

Open http://localhost:3001. Without `DATABASE_URL` the site saves to `data/*.json`, so you don't need a database. See the README for admin setup and the full API.

## Code guidelines

- **Layout:** `server.js` has all routes, `auth.js` handles passwords and sessions, `store.js` handles storage, `notify.js`/`email.js` handle notifications. The frontend in `public/` is plain HTML and JavaScript with no build step; shared code lives in `public/common.js`.
- **No inline styles or scripts.** The site's Content Security Policy blocks them. Add classes to `public/styles.css` and code to `.js` files.
- **Keep dependencies minimal.** Ask in an issue before adding a new package.
- **Match the existing style:** small functions, clear names, comments only where the reason isn't obvious.
- **Never commit secrets** (`.env`, API keys, database URLs) or local data files.
- **Update the README** when you change features, environment variables, or the API.

## Pull requests

1. Keep each pull request focused on one change.
2. Describe what changed and why, and how you tested it (pages you clicked through, API calls you tried).
3. Make sure the site still starts with `npm start` and the pages you touched work.
4. Be patient and kind in reviews; this is maintained by volunteers.

## Code of conduct

Be respectful. Harassment, discrimination, and personal attacks aren't tolerated in issues, pull requests, or on the site.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
