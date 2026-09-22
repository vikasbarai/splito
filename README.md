# Splito

Splito is a shared-expense application with a static GitHub Pages frontend, a Cloudflare Worker API, and a Cloudflare D1 database. The browser only calls the Worker; it never connects to D1 directly.

```text
GitHub Pages  →  https://api.squarelab.in  →  Cloudflare Worker  →  D1
```

## Branch and deployment flow

Use `development` for all work. Do not develop directly on `main`.

```text
development branch → pull request → CI checks → merge to main → production deployment
```

The workflows have separate responsibilities:

- Pull requests to `main` run formatting and Worker bundle validation only. They do not change production.
- A merge to `main` deploys the static frontend to GitHub Pages.
- A merge to `main` also applies pending D1 migrations, then deploys the Worker.

### Configure GitHub deployment secrets (one-time)

Before automatic Worker deployment can run, add these **repository secrets** in GitHub: **Settings → Secrets and variables → Actions → New repository secret**.

| Secret                  | Value                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | A scoped Cloudflare API token allowed to deploy this Worker, apply D1 migrations, and edit Worker routes for `squarelab.in` if routing changes are committed. |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID.                                                                                                                                   |

To create the token, open **Cloudflare Dashboard → My Profile → API Tokens → Create Token → Create Custom Token**. Under **Developer Platform**, grant **Workers → Editor** and scope it to the existing `splito-api` Worker when the dashboard offers that choice. Also grant **D1 → Editor** for the `splito` database. If the D1 selector uses the older permission names, select **Account → D1 → Edit** instead. Add **Zone → Workers Routes → Edit** for `squarelab.in` only if you later manage the custom domain in `wrangler.jsonc`. Do not select the legacy **Workers Scripts → Edit** permission. Copy the account ID from the Cloudflare dashboard's account overview and save both values as the GitHub repository secrets above.

When creating the GitHub secrets, paste the values as follows:

```text
Name:   CLOUDFLARE_API_TOKEN
Secret: the full Cloudflare API token
```

```text
Name:   CLOUDFLARE_ACCOUNT_ID
Secret: the Cloudflare account ID
```

These two values are used by GitHub Actions only. Do **not** put either value in `.dev.vars`, `.env`, `wrangler.jsonc`, `api-config.js`, or source code.

### Where each secret belongs

| Value                                         | Store it in                                                             | Do not store it in                          |
| --------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`                        | GitHub repository Actions secret                                        | Any local or committed file                 |
| `CLOUDFLARE_ACCOUNT_ID`                       | GitHub repository Actions secret                                        | Any local or committed file                 |
| Production `JWT_SECRET`                       | Cloudflare Worker secret, set with `npx wrangler secret put JWT_SECRET` | GitHub, frontend files, or `wrangler.jsonc` |
| Local `JWT_SECRET`                            | Your ignored `.dev.vars` file                                           | GitHub or production Cloudflare secrets     |
| Production `RESEND_API_KEY` and `RESEND_FROM` | Cloudflare Worker secrets                                               | GitHub, frontend files, or committed files  |

GitHub Actions requires the two GitHub secrets above. Local development requires only the two values in `.dev.vars`.

### Email delivery setup

Email-verification links, password-reset links, and group invitations are sent through [Resend](https://resend.com/docs) in production, so create a Resend API key and verify the sending domain first (for example, `squarelab.in`). Resend documents that a sending domain must be verified before use. Password-reset links are one-time links that expire after one hour; group invitations remain pending until the recipient accepts them.

Set both production Worker secrets from the repository folder:

```powershell
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM
```

For `RESEND_FROM`, use a verified sender such as `Splito <no-reply@squarelab.in>`. Do not add either value to `wrangler.jsonc` or commit it to Git. Local verification, password-reset, and group-invite flows work without Resend by displaying a local-only link. To send real emails locally, put the same two values in ignored `.dev.vars`.

### Email verification and anti-abuse limits

New accounts receive a one-use verification link that expires after 24 hours. A user must verify the email address before sending a group invitation. The **Your account** dialog shows whether the address is verified and lets an unverified user request a replacement link. Changing the account email address makes it unverified again and sends a link to the new address.

Migration `0008_email-verification-and-abuse-limits.sql` marks accounts created before this feature as verified, so existing users are not unexpectedly locked out. It also enforces these rolling 24-hour limits in D1:

- A user can create at most **3 groups**.
- A user can send at most **10 invitations per group**.
- A recipient email can receive at most **10 invitations**.
- Only one pending invitation is allowed for the same recipient email and group; an existing group member cannot be invited again.

The forgot-password endpoint deliberately gives the same successful response for an existing and unknown email address: `If an account exists for this email, a password-reset link will be sent.` This avoids disclosing which email addresses have accounts. Do not change this to a distinct “user does not exist” response on a public deployment.

## Local development

### Prerequisites

- Node.js 20 or later
- npm

Install dependencies once:

```powershell
npm install
```

### Start the local environment

1. Create your local-only environment file from the template:

   ```powershell
   Copy-Item .dev.vars.example .dev.vars
   ```

2. Open `.dev.vars` and replace the placeholder `JWT_SECRET` with any long random local-only value. Leave `FRONTEND_URL` as `http://localhost:8000`.

   `.dev.vars` is ignored by Git and must never contain the production secret.

3. Create or update the local D1 schema:

   ```powershell
   npm run d1:migrate:local
   ```

   Optionally add sample users, groups, expenses, and a settlement:

   ```powershell
   npm run d1:seed:local
   ```

   This command affects only `.wrangler` local D1 state. It is safe to run again and adds every existing local user to the sample groups. Sign in as `alex.morgan@example.invalid`, `maya.rao@example.invalid`, `arjun.shah@example.invalid`, or `priya.kapoor@example.invalid` with password `DemoPass123!`.

4. In terminal one, start the local Worker:

   ```powershell
   npm run dev:worker
   ```

   The Worker listens at `http://localhost:8787` and uses a local D1 database. It does not access production D1.

   On a corporate network, Wrangler may warn that it cannot fetch `Request.cf` because the proxy certificate is untrusted. Local development still works when it finishes with `Ready on http://127.0.0.1:8787`; resolve the proxy certificate only when you need to deploy or access remote Cloudflare resources.

5. In terminal two, start the static site:

   ```powershell
   npm run dev:site
   ```

6. Open [http://localhost:8000](http://localhost:8000). `api-config.js` automatically uses `http://localhost:8787` on localhost and `https://api.squarelab.in` everywhere else.

You can register accounts and create expenses locally without changing production data. Local D1 state persists under `.wrangler/` between runs.

### Recreate local development on a new machine

Everything needed to rebuild the local environment is committed to Git except the local secret and local test data. If your laptop is replaced, reset, or loses its files:

```powershell
git clone https://github.com/vikasbarai/splito.git
cd splito
git checkout development
npm ci
Copy-Item .dev.vars.example .dev.vars
```

Open `.dev.vars`, set a new long local-only `JWT_SECRET`, then recreate the local D1 schema and start both servers:

```powershell
npm run d1:migrate:local
npm run dev:worker
```

In a second terminal:

```powershell
npm run dev:site
```

Open `http://localhost:8000`.

### What to save separately

Do not commit the following local-only files. They are intentionally ignored by Git:

| File or folder  | Contains                                               | Keep a separate backup?                                                                                                                                  |
| --------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.dev.vars`     | Local JWT secret and localhost configuration           | Optional. Save the secret in a password manager only if you want the same local sign-in tokens after restoring a machine. A new local secret also works. |
| `.wrangler/`    | Local D1 database and test users, groups, and expenses | Optional. Normally disposable. Export only if you need to preserve local test data.                                                                      |
| `node_modules/` | Installed dependencies                                 | No. Run `npm ci` to recreate it.                                                                                                                         |

To preserve local D1 test data, create an export and store it only in private, encrypted storage:

```powershell
npx wrangler d1 export splito --local --output=./local-d1-backup-YYYYMMDD.sql
```

Do not commit the export; it can contain user data and password hashes. Production data is separate: it remains in Cloudflare D1, while the production `JWT_SECRET` remains in Cloudflare and the deployment credentials remain GitHub Actions secrets.

## Backup and restore

### Back up production D1

Create a full schema-and-data backup before substantial database changes and periodically while the application has real data:

```powershell
npx wrangler d1 export splito --remote --output=./splito-production-backup-YYYYMMDD.sql
```

Keep the resulting file in private, encrypted storage. It contains all application data, including email addresses and password hashes. The file is ignored by Git and must never be committed or shared publicly.

### Restore local D1 test data

Only restore a backup into an empty local D1 database. First stop `npm run dev:worker`, then move the `.wrangler` folder out of the project with File Explorer if you want to keep its current local state. Next import the backup:

```powershell
npx wrangler d1 execute splito --local --file=./local-d1-backup-YYYYMMDD.sql
```

Start the Worker again with `npm run dev:worker`. This changes only local test data; it never changes production D1.

### Recover production D1

Do not import a backup directly into the live production database. A production recovery is a controlled operation:

1. Put the site into maintenance mode or otherwise stop users from writing new data.
2. Create a new replacement D1 database in Cloudflare.
3. Temporarily update `wrangler.jsonc` with the replacement database name and ID.
4. Import the backup into the replacement database:

   ```powershell
   npx wrangler d1 execute REPLACEMENT_DATABASE_NAME --remote --file=./splito-production-backup-YYYYMMDD.sql
   ```

5. Check that its tables and important data are present.
6. Deploy the Worker using the updated D1 binding:

   ```powershell
   npm run deploy:worker
   ```

7. Test registration, group creation, and existing-user login before reopening the site to users.

Keep the old D1 database untouched until the replacement has been confirmed. For a production incident, take a fresh backup of the current database before changing its binding whenever possible.

### Local checks

Run these before committing:

```powershell
npm test
npm run check
npx wrangler deploy --dry-run
git diff --check
```

`npm test` builds a fresh, in-memory SQLite database from every migration and exercises the Worker API without using `.wrangler`, local D1 data, Cloudflare, or email delivery. It covers sign-up/sign-in, account updates and password resets, CORS, groups and memberships, friends and invitations, all five expense split methods, receipt-size validation, settlements, owner-only editing/deleting, dashboard pagination, non-friend balances, and quote caching. Use `npm run test:api` to run that API suite explicitly.

The dry run validates the Worker bundle only; it does not deploy or access production D1.

## Database migrations

Create a migration whenever the database schema changes:

```powershell
npx wrangler d1 migrations create splito describe-the-change
```

Test it locally:

```powershell
npm run d1:migrate:local
```

After the pull request is merged, the production Worker workflow applies pending migrations before deploying the Worker. Do not manually run `npm run d1:migrate:remote` for normal changes once GitHub deployment is configured.

## Publish a change

1. Confirm you are working on `development`:

   ```powershell
   git branch --show-current
   ```

2. Make changes and test them locally.

3. Run the local checks above, then commit and push:

   ```powershell
   git add .
   git commit -m "Describe the change"
   git push origin development
   ```

4. Open a pull request from `development` into `main`. Wait for **Validate pull request** to pass and review the changes.

5. Merge the pull request. GitHub automatically runs:

   - **Deploy static site to GitHub Pages**
   - **Deploy Worker and D1 migrations**

6. Verify production:

   - [https://vikasbarai.github.io/splito/](https://vikasbarai.github.io/splito/)
   - [https://api.squarelab.in/api/me](https://api.squarelab.in/api/me) should return `{"error":"Please sign in."}` before login.

## Production configuration

- [wrangler.jsonc](wrangler.jsonc) binds the Worker to the production D1 database and defines the GitHub Pages origin for CORS and invite links.
- [api-config.js](api-config.js) contains public API URLs only. It must never contain a secret.
- `JWT_SECRET` is stored in Cloudflare with `npx wrangler secret put JWT_SECRET`.
- The Worker custom domain is `api.squarelab.in`. It is separate from the GitHub Pages frontend domain.
