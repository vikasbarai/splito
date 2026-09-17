# Splito — shared expense splitting

Splito is a full-stack expense-sharing application: accounts, shared groups, member-only access, expense history, equal splits (down to the cent), live group balances, recorded settlements, and shareable invite links.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`. Create an account, create a group, then invite a friend using their email address. The app copies an invite link; the friend registers with that same email and opens the link to join.

The SQLite database is created automatically in `data/splito.db`. Never commit this file.

## Configuration

Set a strong signing secret before deployment:

```bash
JWT_SECRET=replace-with-a-long-random-value
```

## Free deployment

Because this is a real backend, use a host that supports Node processes (not GitHub Pages or static Netlify Drop).

### Render

1. Push this folder to a private GitHub repository.
2. In [Render](https://render.com/), create a **Web Service** from the repository.
3. Choose Node, use build command `npm install`, and start command `npm start`.
4. Add the `JWT_SECRET` environment variable.
5. For persistent data, attach a Render disk at `/app/data` (availability depends on the selected plan), or migrate the SQLite layer to a managed Postgres database for a production-ready free-tier setup.

The included `Dockerfile` also works on Railway, Fly.io, or any Docker-capable host. If using an ephemeral host without a persistent disk, deploy the API with a managed Postgres database instead of SQLite to retain data across restarts.

## API overview

- `POST /api/auth/register`, `POST /api/auth/login`
- `GET /api/dashboard`, `GET /api/groups/:groupId`
- `POST /api/groups`, `POST /api/groups/:groupId/expenses`
- `POST /api/groups/:groupId/invites`, `POST /api/invites/:token/accept`
- `POST /api/groups/:groupId/settlements`

All group endpoints enforce authenticated group membership.
