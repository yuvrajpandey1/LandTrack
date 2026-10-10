# LandTrack MVP 1

LandTrack is a pnpm monorepo for the Hyderabad, Telangana property-registration MVP described in [skill.md](./skill.md). It contains a responsive Next.js interface and a NestJS API backed by PostgreSQL, Redis, and S3-compatible object storage.

## Requirements

- Node.js 20
- pnpm 9.12.3 (available through Corepack)
- Docker Desktop, for local PostgreSQL, Redis, MinIO, MailHog, and ClamAV services

## Run locally

1. Install packages with `corepack pnpm install`.
2. Copy `.env.example` to `apps/api/.env`; set unique values of at least 32 characters for the JWT and OTP secrets, and provide an E.164 `ADMIN_MOBILE`, `ADMIN_EMAIL`, and `ADMIN_INITIAL_PASSWORD` (at least 12 characters) for the initial administrator.
3. Start local dependencies with `docker compose -f infra/docker-compose.yml up -d`.
4. Create the database schema and initial administrator/settings/slots using `corepack pnpm --dir apps/api db:migrate`, then `corepack pnpm --dir apps/api db:seed`.
5. Start the web and API apps with `corepack pnpm dev`.
6. Visit `http://localhost:3000`. The API health endpoint is `http://localhost:4000/api/v1/health`; non-production OpenAPI docs are at `http://localhost:4000/api/docs`.

## Web preview

The web application currently remains a local-storage UI preview with illustrative sample data. It is not yet wired to the API and must not be used as the live user portal.

The API includes PostgreSQL/Prisma persistence, OTP/password authentication with rotating refresh tokens and TOTP setup, role/ownership guards, property and document APIs with S3-compatible uploads and ClamAV scanning, payment records/webhook handling, appointment and call workflows, persisted notifications, chat/Socket.IO, admin endpoints, audit views, and audit records. The local Compose stack supplies PostgreSQL, Redis, MinIO, MailHog, and ClamAV. Local fake payment/SMS/WhatsApp adapters are development-only.

This is an integration baseline, not a production-ready service. Before real users, documents, calls, or payments are handled, connect and exercise the web app against the API; configure and verify production SMS, WhatsApp, hosted-checkout, Jitsi/TURN/recording, object storage, email, and monitoring providers; import authoritative Hyderabad location masters; add automated security and API/E2E tests; and complete legal, privacy, retention, operational, and deployment reviews. Production startup rejects fake communication/payment providers, but that check does not substitute for the integration and operational work.

## Monorepo layout

- `apps/web` — Next.js App Router UI preview (API integration pending)
- `apps/api` — NestJS API
- `packages/shared` — shared TypeScript contracts
- `infra` — local service containers
- `.github/workflows` — build CI
