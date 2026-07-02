# Project

Scaffolded with `blueprint` / `setup-project`. See [`spec.md`](./spec.md) for the
full design.

## Getting started

```bash
cp .env.example .env.local        # then fill in secrets
docker compose up -d              # local Postgres (if the db module is enabled)
npx prisma migrate dev            # create the schema
npm run dev                       # http://localhost:3000
```

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Typecheck |
| `npx prisma generate` | Regenerate the Prisma client |
| `npx prisma migrate dev` | Apply migrations locally |

## Layout

- `src/app` — App Router routes
- `src/lib` — shared server/client utilities (`db`, `env`, `providers`, …)
- `prisma` — schema and migrations
