# Deploy the API on Zoho Catalyst AppSail

## Demo: all-in-one AppSail (web + API in one container)

[infra/zoho-appsail/](../infra/zoho-appsail) builds one image with the web app (public port), the API, embedded PostgreSQL, Redis and an in-memory S3 stand-in. It is a **demo**: all data is lost on restart, and uploads, email and virus scanning do not work. It is Zoho-only; no other deployment uses these files.

```powershell
podman build -f infra/zoho-appsail/Containerfile -t landtrack-zoho:demo .
podman save --format oci-archive -o landtrack-zoho.tar localhost/landtrack-zoho:demo   # OCI format is required
# from a folder created with: catalyst init --org <orgId> -p <projectId> -ni
catalyst deploy appsail --name landtrack --source docker-archive://<abs path>/landtrack-zoho.tar --port 9000 -ni
```

AppSail facts learned: the public port must be bound within ~10s (the entrypoint starts Next.js first), the root filesystem is not writable (data lives in `/tmp`), and the container must not rely on root. Allow ~1-2 minutes after deploy for `/api/v1/health` to return `ok`. Logs: Console > DevOps > Logs (Application, resource `landtrack`), indexed after ~5 minutes.

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
