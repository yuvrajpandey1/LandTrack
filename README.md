# NRI Land Tracking System

NRI Land Tracking System is a pnpm monorepo for the Hyderabad, Telangana property-registration MVP described in [skill.md](./skill.md). It contains a responsive Next.js interface and a NestJS API backed by PostgreSQL, Redis, and S3-compatible object storage.

## Requirements

- Node.js 20
- pnpm 9.12.3 (available through Corepack)
- Docker Desktop or Podman Desktop, for local PostgreSQL, Redis, RustFS, MailHog, and ClamAV services

## Run locally

1. Install packages with `corepack pnpm install`.
2. Copy `.env.example` to `apps/api/.env`; set unique values of at least 32 characters for the JWT and OTP secrets. To seed an initial administrator, provide an E.164 `ADMIN_MOBILE`, `ADMIN_EMAIL`, and `ADMIN_INITIAL_PASSWORD` (at least 12 characters). Alternatively, leave `ADMIN_INITIAL_PASSWORD` empty, configure outbound email in `SMTP_URL` and `MAIL_FROM`, set `ADMIN_SETUP_EMAIL=adminlandtrack@gmail.com`, seed the database, and request an emailed one-time setup code from the administrator signup page. The code expires in 15 minutes, is stored only as a hash, and can be used once with up to five verification attempts. Requests are limited to one per minute and five per hour. Additional administrator accounts require a fresh code sent to that mailbox and must use `adminlandtrack@gmail.com` as their login email. Never put secrets in `.env.example`, the web environment, or source control.
3. Start local dependencies with `docker compose -f infra/docker-compose.yml up -d`.
4. Create the database schema and initial administrator/settings/slots using `corepack pnpm --dir apps/api db:migrate`, then `corepack pnpm --dir apps/api db:seed`.
5. Start the web and API apps with `corepack pnpm dev`.
6. Visit `http://localhost:3000`. The API health endpoint is `http://localhost:4000/api/v1/health`; non-production OpenAPI docs are at `http://localhost:4000/api/docs`.

## Run the full stack in Podman

For a fully containerized local stack, including the web and API services, follow [the Podman deployment guide](./docs/deployment-podman.md). It adds dedicated Podman `Containerfile`s for [apps/api/Containerfile](./apps/api/Containerfile), [apps/web/Containerfile](./apps/web/Containerfile), a full-stack Compose file at [infra/podman-compose.yml](./infra/podman-compose.yml), and a container runtime environment template at [infra/podman.env.example](./infra/podman.env.example).
The object-storage service in the local Compose stack is RustFS, an S3-compatible alternative to MinIO. Keep these local development credentials private and do not use them for a public deployment.

The local seed includes Hyderabad, Ranga Reddy, Medchal-Malkajgiri, Sangareddy, Yadadri Bhuvanagiri, Medak, and Siddipet district masters. Hyderabad's 16 mandals and villages come from the [Hyderabad District Administration mandal directory](https://hyderabad.telangana.gov.in/tehsil/) (last updated 30 July 2024); the other six district hierarchies are a snapshot of the [Telangana Bhu Bharati land-record selector](https://bhubharati.telangana.gov.in/knowLandStatus), whose records were reported updated 17 October 2026. These are published administrative/land-record options, not a guarantee of cadastral boundaries; verify survey jurisdiction against current land records before entering real property records.

## API-backed web journey

The Next.js portal uses the API for NRI, agent, and setup-code-protected administrator signup; password sign-in and changes; role-aware dashboards; property registration; document uploads; payment history; appointment booking; and administrator agent/property review. Admin and Auditor sign-ins require Speakeasy-based TOTP authenticator verification; first sign-in enrolls an authenticator before issuing a full session. NRI signup currently does not require SMS OTP and mobile numbers remain unverified. Agent accounts can sign in immediately, but agent approval remains pending until an administrator reviews the profile. An administrator setup code is consumed atomically once and cannot be replayed. It sends API traffic through the same-origin `/api/v1` path; set `API_URL` to the API's server-reachable URL when the web app is deployed. Property documents are uploaded through the authenticated API, checked against their declared type and size, scanned by ClamAV, and only then stored in the private object bucket.

Property registration requires at least one clean, scanned document and a JPG/PNG plot photo. With `PAYMENT_PROVIDER=razorpay`, the API creates a Razorpay Standard Checkout order and the web app opens Razorpay's secure modal. The authenticated API verifies the checkout HMAC signature, confirms the payment against Razorpay (capturing an authorized payment if needed), and submits the property for review only after confirmation. If a customer closes the checkout after paying (for example, after scanning a UPI QR code), the app checks the Razorpay order for a captured payment before showing the receipt and registered plot details/photo; an unpaid dismissal never displays success. Configure `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in the private API environment; the key ID is returned to the browser for checkout, while the secret remains server-side. A webhook secret is optional for the local checkout callback flow. For production webhook reconciliation, configure a distinct `RAZORPAY_WEBHOOK_SECRET`, register `https://<api-host>/api/v1/webhooks/payments`, and subscribe to `payment.captured` and `order.paid`. The legacy Payment Link callback remains supported for payments created before this Standard Checkout integration. For local demos, `PAYMENT_PROVIDER=fake` opens an in-app demo checkout: selecting its close button and confirming "Yes, exit" records a clearly labelled sample payment and completes registration without contacting Razorpay or collecting money. This demo-only endpoint is authenticated, owner-scoped, and disabled in production.

The API provides PostgreSQL/Prisma persistence, rotating refresh tokens, optional TOTP endpoints, role/ownership guards, payment records/webhooks for future payment integration, appointment and call workflows, persisted notifications, chat/Socket.IO, admin endpoints, and audit records. The local Compose stack supplies PostgreSQL, Redis, RustFS, MailHog, and ClamAV. Local fake payment/SMS/WhatsApp adapters are development-only. OTP delivery is disabled in the signup journey until SMS is integrated again. For later real international OTP delivery, set `SMS_PROVIDER=twilio_verify` and configure `TWILIO_VERIFY_SERVICE_SID` plus either `TWILIO_API_KEY_SID`/`TWILIO_API_KEY_SECRET` (recommended) or `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` in the private API environment. Use a restricted Twilio API key and do not commit or share credentials. Twilio Verify generates and validates the code, so it is not logged or stored as a locally verifiable OTP.

Appointment booking writes Google Calendar events to the calendar owned by the admin Google account and sends invites to the booking customer. Video appointments request a Google Meet conference; the returned link is shown in the booking confirmation. Set `GOOGLE_CALENDAR_ADMIN_EMAIL=adminlandtrack@gmail.com`, `GOOGLE_CALENDAR_ID=primary`, and the OAuth client ID, client secret, and refresh token in the private API environment. Enable the Google Calendar API in Google Cloud, create an OAuth client, and obtain a refresh token by granting `openid`, `email`, and `https://www.googleapis.com/auth/calendar.events` while signed in as `adminlandtrack@gmail.com`. The API verifies the Google account before creating calendar events. Keep all OAuth credentials server-side and never commit the refresh token. If credentials are missing, the wrong Google account is authorized, or Google rejects the request, the booking is not reported as successful.

For Gmail delivery, configure the API SMTP URL with a Gmail App Password and use `MAIL_FROM=adminlandtrack@gmail.com`, or configure another trusted SMTP relay. With Gmail SMTP, use an app password (not the account password) and keep it in the ignored `apps/api/.env`; the local default SMTP URL sends mail only to the development MailHog inbox.

For a Netlify deployment of both the web app and stateless API function, including the required managed service configuration and function limitations, follow [the Netlify deployment guide](./docs/deployment-netlify.md). For a fully containerized Podman stack, follow [the Podman deployment guide](./docs/deployment-podman.md). A persistent Railway API deployment remains documented in [the Railway deployment guide](./docs/deployment-railway.md).

This is an integration baseline, not a production-ready service. Run the complete journey against the local Compose dependencies before staging. Some portal areas (including chat/calls, notifications, auditor review, and several admin workspaces) still need full UI integration and end-to-end verification. For staging and production, use provider-managed secrets and configure real SMS/WhatsApp, hosted-checkout test/live credentials, object storage, email, Jitsi/TURN/recording, and monitoring; import authoritative Hyderabad location masters; add automated API/E2E and security tests; and complete legal, privacy, retention, operational, backup, and deployment reviews. Do not use fake adapters or real user documents/payment data until the relevant provider flows and controls have been verified.

## Monorepo layout

- `apps/web` - Next.js App Router portal
- `apps/api` - NestJS API
- `packages/shared` - shared TypeScript contracts
- `infra` - local service containers
- `.github/workflows` - build CI
