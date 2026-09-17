# Splito

Splito is a shared-expense application deployed as a static GitHub Pages site with a Cloudflare Worker API and Cloudflare D1 database. The browser never connects to D1 directly: it calls the Worker over HTTPS, and the Worker enforces authentication and group membership.

## Architecture

```
GitHub Pages (index.html, app.js)  --HTTPS-->  Cloudflare Worker (worker.js)  -->  D1 (SQLite)
```

## One-time setup

Prerequisites: a GitHub account, a Cloudflare account, and Node.js 20 or newer.

1. Install dependencies and authenticate Wrangler:

   ```bash
   npm install
   npx wrangler login
   ```

2. Create the production D1 database:

   ```bash
   npx wrangler d1 create splito-db
   ```

   Copy the `database_id` printed by that command into `wrangler.jsonc`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

3. Set your public GitHub Pages URL in `wrangler.jsonc` as `FRONTEND_URL`. For a project site it is normally `https://YOUR_GITHUB_USERNAME.github.io/splito`. This is used for CORS and invite links.

4. Apply the schema to D1 and store a signing secret. Generate a unique, long value for the secret; do not commit it.

   ```bash
   npm run d1:migrate:remote
   npx wrangler secret put JWT_SECRET
   ```

5. Deploy the API:

   ```bash
   npm run deploy:worker
   ```

   Wrangler prints a URL such as `https://splito-api.<account>.workers.dev`. Put that exact URL (without a trailing slash) in `api-config.js` as `window.SPLITO_API_URL`.

6. Commit and push the repository to GitHub. In the repository, open **Settings → Pages → Build and deployment**, choose **GitHub Actions**, then push to `main`. The included workflow publishes the static site.

   ```bash
   git add .
   git commit -m "Deploy Splito with Pages, Workers, and D1"
   git push origin main
   ```

Open the URL shown by the GitHub Pages workflow. Register an account, create a group, and invite another user by email.

## Local API development

Create and migrate a local D1 database, then start the Worker:

```bash
npm run d1:migrate:local
npx wrangler secret put JWT_SECRET --local
npm run dev:worker
```

For local testing, temporarily set `window.SPLITO_API_URL = "http://localhost:8787"` in `api-config.js`. Do not deploy that value.

## Operational notes

- `JWT_SECRET` is a Worker secret, not a Pages or GitHub secret.
- D1 migrations live in `migrations/`; run `npm run d1:migrate:remote` whenever a new migration is added.
- `api-config.js` is public configuration, so it must contain only the Worker URL—never credentials.
- The legacy Express server is retained only for local backwards compatibility. GitHub Pages does not run it; production uses `worker.js`.
