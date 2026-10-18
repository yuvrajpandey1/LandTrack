# NRI Land Tracking System

NRI Land Tracking System is a pnpm monorepo for the Hyderabad, Telangana property-registration MVP described in [skill.md](./skill.md). It contains a responsive Next.js interface and a NestJS API backed by PostgreSQL, Redis, and S3-compatible object storage.

## Requirements

- Node.js 20
- pnpm 9.12.3 (available through Corepack)
- Docker Desktop, for local PostgreSQL, Redis, MinIO, MailHog, and ClamAV services

## Run locally

1. Install packages with `corepack pnpm install`.
2. Copy `.env.example` to `apps/api/.env`; set unique values of at least 32 characters for the JWT and OTP secrets, and provide an E.164 `ADMIN_MOBILE`, `ADMIN_EMAIL`, and `ADMIN_INITIAL_PASSWORD` (at least 12 characters) for the initial administrator. To allow one-time administrator self-registration instead, generate a private code with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and set it as `ADMIN_SIGNUP_CODE` in the API environment only. Never put it in the web environment or source control.
3. Start local dependencies with `docker compose -f infra/docker-compose.yml up -d`. The same Compose file can run with Podman Desktop; use its Compose provider or install `podman-compose`. For a WSL-backed Podman machine, the provider command may need `--in-pod=false --podman-run-args='--cgroups=disabled'`.
4. Create the database schema and initial administrator/settings/slots using `corepack pnpm --dir apps/api db:migrate`, then `corepack pnpm --dir apps/api db:seed`.
5. Start the web and API apps with `corepack pnpm dev`.
6. Visit `http://localhost:3000`. The API health endpoint is `http://localhost:4000/api/v1/health`; non-production OpenAPI docs are at `http://localhost:4000/api/docs`.

The object-storage service in the local Compose stack is RustFS, an S3-compatible alternative to MinIO. With Podman on WSL, if Windows cannot reach published services at `localhost`, set the API service host values in `apps/api/.env` to the Podman machine's reachable IP (`podman machine ssh landtrack-machine-default 'ip -4 addr show eth0'`). Keep these local development credentials private and do not use them for a public deployment.

The local seed includes Hyderabad, Ranga Reddy, Medchal-Malkajgiri, Sangareddy, Yadadri Bhuvanagiri, Medak, and Siddipet district masters. Hyderabad's 16 mandals and villages come from the [Hyderabad District Administration mandal directory](https://hyderabad.telangana.gov.in/tehsil/) (last updated 30 July 2024); the other six district hierarchies are a snapshot of the [Telangana Bhu Bharati land-record selector](https://bhubharati.telangana.gov.in/knowLandStatus), whose records were reported updated 17 October 2026. These are published administrative/land-record options, not a guarantee of cadastral boundaries; verify survey jurisdiction against current land records before entering real property records.

## API-backed web journey

The Next.js portal uses the API for NRI, agent, and setup-code-protected administrator signup; password sign-in and changes; role-aware dashboards; property registration; document uploads; payment history; appointment booking; and administrator agent/property review. Signup and sign-in currently do not require SMS OTP or authenticator MFA; mobile numbers remain unverified and those factors are deferred. Agent accounts can sign in immediately, but agent approval remains pending until an administrator reviews the profile. An administrator setup code is consumed atomically once and cannot be replayed. Existing OTP and authenticator APIs remain available for later integration. It sends API traffic through the same-origin `/api/v1` path; set `API_URL` to the API's server-reachable URL when the web app is deployed. Property documents are uploaded through the authenticated API, checked against their declared type and size, scanned by ClamAV, and only then stored in the private object bucket.

The API provides PostgreSQL/Prisma persistence, rotating refresh tokens, optional TOTP endpoints, role/ownership guards, payment records/webhooks, appointment and call workflows, persisted notifications, chat/Socket.IO, admin endpoints, and audit records. The local Compose stack supplies PostgreSQL, Redis, RustFS, MailHog, and ClamAV. Local fake payment/SMS/WhatsApp adapters are development-only. OTP delivery is disabled in the signup journey until SMS is integrated again. For later real international OTP delivery, set `SMS_PROVIDER=twilio_verify` and configure `TWILIO_VERIFY_SERVICE_SID` plus either `TWILIO_API_KEY_SID`/`TWILIO_API_KEY_SECRET` (recommended) or `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` in the private API environment. Use a restricted Twilio API key and do not commit or share credentials. Twilio Verify generates and validates the code, so it is not logged or stored as a locally verifiable OTP.

For a Railway API deployment with managed PostgreSQL/Redis, ClamAV, object storage, and Netlify connection steps, follow [the Railway deployment guide](./docs/deployment-railway.md).

This is an integration baseline, not a production-ready service. Run the complete journey against the local Compose dependencies before staging. Some portal areas (including chat/calls, notifications, auditor review, and several admin workspaces) still need full UI integration and end-to-end verification. For staging and production, use provider-managed secrets and configure real SMS/WhatsApp, hosted-checkout test/live credentials, object storage, email, Jitsi/TURN/recording, and monitoring; import authoritative Hyderabad location masters; add automated API/E2E and security tests; and complete legal, privacy, retention, operational, backup, and deployment reviews. Do not use fake adapters or real user documents/payment data until the relevant provider flows and controls have been verified.

## Monorepo layout

- `apps/web` — Next.js App Router portal
- `apps/api` — NestJS API
- `packages/shared` — shared TypeScript contracts
- `infra` — local service containers
- `.github/workflows` — build CI
