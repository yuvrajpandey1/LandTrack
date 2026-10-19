# Deploy the API on Zoho Catalyst AppSail

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
