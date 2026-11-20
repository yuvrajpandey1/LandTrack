# Deploy the API on Zoho Catalyst AppSail

## All-in-one AppSail (web + API in one container) with Neon for permanent data

[infra/zoho-appsail/](../infra/zoho-appsail) builds one image with the web app (public port), the API, Redis and ClamAV (`clamd` on 127.0.0.1:3310, signatures baked in at build time, about 1 GB RAM). It is Zoho-only; no other deployment uses these files.

Zoho Catalyst has no hosted PostgreSQL and AppSail has no persistent disk, so permanent data lives in **Neon** (project `LandTrack`, region `aws-ap-southeast-1`, Singapore, the closest Neon region to Zoho's India data centre). [neon.ts](../neon.ts) declares the services: Postgres plus a private `assets` object-storage bucket.

| Neon branch | Used by | Notes |
|---|---|---|
| `production` (default) | Zoho AppSail | Live data and uploaded documents. |
| `dev` | Local development (`apps/api/.env`) | Permanent copy of production for local work; exempt from the 7-day TTL in `neon.ts`. Refresh it with `neon branches reset dev --parent`. |

The entrypoint reads the git-ignored `infra/zoho-appsail/runtime.env`, which is baked into the image:

- `EXTERNAL_DATABASE_URL`: the Neon **direct** (unpooled) connection string. Prisma migrations need a direct connection.
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION` (from `neon env pull`) and `S3_BUCKET=assets`. The entrypoint maps these onto the API's `S3_*` settings.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OTP_HASH_SECRET`: three distinct random values of 32 or more characters.
- Optionally `SMTP_URL`, `MAIL_FROM` and `ADMIN_EMAIL`.

The file is sourced by `sh`, so **single-quote values that contain `&`** (Neon URLs do). With `EXTERNAL_DATABASE_URL` set, startup skips the embedded PostgreSQL and the slow location seed (force the seed with `SEED_ON_START=true`), then runs `prisma migrate deploy` against Neon. Without these values the image falls back to the original demo mode: embedded PostgreSQL (optionally restored from a git-ignored `seed.sql` dump) and an in-memory S3 stand-in, where all data is lost on restart.

Neon CLI quick reference (`npm i -g neon`): `neon link`, `neon deploy` (provisions `neon.ts` services), `neon checkout <branch>` and `neon env pull` (writes the git-ignored `.env.local`).

```powershell
podman build -f infra/zoho-appsail/Containerfile -t landtrack-zoho:latest .
podman save --format oci-archive -o landtrack-zoho.tar localhost/landtrack-zoho:latest   # OCI format is required
# from a folder created with: catalyst init --org <orgId> -p <projectId> -ni
catalyst deploy appsail --name landtrack --source docker-archive://<abs path>/landtrack-zoho.tar --port 9000 -ni
```

AppSail facts learned: the public port must be bound within ~10s (the entrypoint starts Next.js first), the root filesystem is not writable (data lives in `/tmp`), and the container must not rely on root. Allow ~1-2 minutes after deploy for `/api/v1/health` to return `ok`. While AppSail swaps versions it can briefly serve the old version or return 500s. Large image uploads occasionally fail with `ECONNRESET`; rerun the deploy command. Logs: Console > DevOps > Logs (Application, resource `landtrack`), indexed after ~5 minutes.

Seeded admin (override via AppSail env vars `ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD`): `admin@landtrack.example` / `PodmanAdmin123!`.

## Production: API only with managed services

This guide is Zoho-only. It reuses the existing [apps/api/Containerfile](../apps/api/Containerfile) unchanged, so Netlify, Podman, Railway, and local flows are not affected.

## Prerequisites

- Catalyst CLI (`npm install -g zcatalyst-cli`) and `catalyst login`
- A Catalyst project selected in the repo root (`catalyst init`/`catalyst use`)
- Podman (or Docker) to build the image
- Managed services reachable from AppSail, because Catalyst does not host them:
  - PostgreSQL (`DATABASE_URL`)
  - Redis (`REDIS_URL`)
  - S3-compatible storage (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`)
  - SMTP (`SMTP_URL`, `MAIL_FROM`)
  - ClamAV (`CLAMAV_HOST`, `CLAMAV_PORT`)

## Build and export the image

```powershell
podman build -f apps/api/Containerfile -t landtrack-api:catalyst .
podman save --format docker-archive -o landtrack-api.tar localhost/landtrack-api:catalyst
```

## Deploy

The API listens on `PORT` (default 4000), so tell AppSail which port to check:

```powershell
catalyst deploy appsail --name landtrack-api --source docker-archive://./landtrack-api.tar --port 4000 -ni
```

Then, in the Catalyst console (AppSail > landtrack-api > Environment Variables), set the private values. Do not commit them:

- `NODE_ENV=production`, `PORT=4000`
- `APP_URL` - the Slate web URL (CORS origin)
- `API_URL` - the AppSail URL
- `DATABASE_URL`, `REDIS_URL`, the `S3_*` values, `SMTP_URL`, `MAIL_FROM`, `CLAMAV_HOST`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OTP_HASH_SECRET` (distinct, 32+ characters)
- Real `SMS_PROVIDER`, `WHATSAPP_PROVIDER`, `PAYMENT_PROVIDER` values; production rejects the fake providers.

The container runs `prisma migrate deploy` on start. Seed once against the production database with `pnpm --dir apps/api db:seed` from a trusted machine.

## Connect the Slate frontend

Set the Slate app's `API_URL` to the AppSail URL (see [deployment-catalyst-slate.md](./deployment-catalyst-slate.md)). Check `https://<appsail-url>/api/v1/health` returns `{"status":"ok"}` first.
