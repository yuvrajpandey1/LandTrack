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

## API-backed web journey

The Next.js portal uses the API for NRI and agent registration, OTP verification, sign-in, role-aware dashboards, property registration, document uploads, payment history, appointment booking, and administrator agent/property review. It sends API traffic through the same-origin `/api/v1` path; set `API_URL` to the API's server-reachable URL when the web app is deployed. Property documents are uploaded through the authenticated API, checked against their declared type and size, scanned by ClamAV, and only then stored in the private object bucket.

The API provides PostgreSQL/Prisma persistence, rotating refresh tokens and TOTP setup, role/ownership guards, payment records/webhooks, appointment and call workflows, persisted notifications, chat/Socket.IO, admin endpoints, and audit records. The local Compose stack supplies PostgreSQL, Redis, MinIO, MailHog, and ClamAV. Local fake payment/SMS/WhatsApp adapters are development-only.

This is an integration baseline, not a production-ready service. Run the complete journey against the local Compose dependencies before staging. Some portal areas (including chat/calls, notifications, auditor review, and several admin workspaces) still need full UI integration and end-to-end verification. For staging and production, use provider-managed secrets and configure real SMS/WhatsApp, hosted-checkout test/live credentials, object storage, email, Jitsi/TURN/recording, and monitoring; import authoritative Hyderabad location masters; add automated API/E2E and security tests; and complete legal, privacy, retention, operational, backup, and deployment reviews. Do not use fake adapters or real user documents/payment data until the relevant provider flows and controls have been verified.

## Monorepo layout

- `apps/web` — Next.js App Router portal
- `apps/api` — NestJS API
- `packages/shared` — shared TypeScript contracts
- `infra` — local service containers
- `.github/workflows` — build CI
