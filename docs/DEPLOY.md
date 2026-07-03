# Deploying helm to Railway

helm needs three things running: the Next.js app, a Postgres database, and the
persistent simulator worker.

## 1. Provision

1. Create a Railway project and add a **PostgreSQL** plugin.
2. Add a **service from the GitHub repo** (`richardhealy/helm`) for the web app.
3. Add a **second service from the same repo** for the simulator worker.

## 2. Environment variables (both services)

| Var | Value |
| --- | --- |
| `DATABASE_URL` | from the Railway Postgres plugin |
| `MAPBOX_TOKEN` | your Mapbox token |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | same token |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | your Google OAuth app |
| `NEXT_PUBLIC_APP_URL` | the web service's public URL |

## 3. Start commands

- Web service: `npm run build` then `npm run start`
- Worker service: `npx tsx scripts/simulator.ts`

## 4. Migrate + seed

From a Railway shell (or one-off command) against the production database:

```bash
npx prisma migrate deploy
npm run db:seed
```

## 5. Verify

Open the web URL, sign in, and add deliveries — the simulator service will move
the vehicles. Check Railway logs for `simulator running`.
