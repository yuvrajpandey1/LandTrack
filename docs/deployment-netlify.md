# Deploy NRI Land Tracking System on Netlify

Netlify can deploy this repository's Next.js site and serve its NestJS HTTP API through a Netlify Function. The deployment is stateless: PostgreSQL and private object storage must be hosted outside Netlify, and document scanning requires a reachable ClamAV service.

## Connect the repository

Connect `yuvrajpandey1/LandTrack` to Netlify and deploy the `main` branch. The root-level `netlify.toml` configures the API and web builds, the Next.js adapter, and the `/api/v1/*` function rewrite. Netlify's build-time `NETLIFY=true` variable disables the local-only Next.js proxy rewrite.

## Configure production environment variables

Set these in the Netlify site's environment variable settings. Keep secrets out of Git and chat.

| Variable | Configuration |
| --- | --- |
| `NODE_ENV` | `production` |
| `LANDTRACK_NETLIFY_FUNCTIONS` | `true`, available to Functions at runtime. This disables WebSockets and Redis/BullMQ worker startup in the serverless API. |
| `APP_URL` | `https://tracklan.netlify.app` |
| `API_URL` | `https://tracklan.netlify.app` |
| `DATABASE_URL` | A managed PostgreSQL connection string available to Functions at runtime. Prefer the provider's pooled/serverless URL for function workloads. The committed `netlify.toml` uses a non-secret placeholder only for Prisma client generation during builds. |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OTP_HASH_SECRET` | Three independent random secrets, each at least 32 characters. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Private S3-compatible object storage, such as Cloudflare R2. |
| `SMTP_URL`, `MAIL_FROM`, `ADMIN_NOTIFY_EMAIL`, `ADMIN_SETUP_EMAIL` | Working SMTP service and verified sender/notification mailboxes. |
| `SMS_PROVIDER`, `TWILIO_VERIFY_SERVICE_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` | Configure Twilio Verify. Production cannot use the fake SMS provider. |
| `WHATSAPP_PROVIDER`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Configure a verified Meta WhatsApp Cloud app. Production cannot use the fake WhatsApp provider. |
| `PAYMENT_PROVIDER`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Configure Razorpay test credentials and a webhook before enabling production payments. Production cannot use the fake payment provider. |
| `JITSI_DOMAIN`, `JITSI_APP_ID`, `JITSI_APP_SECRET`, `JITSI_WEBHOOK_SECRET` | Configure the call provider. |
| `CLAMAV_HOST`, `CLAMAV_PORT` | A ClamAV service reachable over TCP from Netlify Functions (usually port `3310`). |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_MOBILE` | Initial administrator identity. |
| `GOOGLE_CALENDAR_ADMIN_EMAIL`, `GOOGLE_CALENDAR_ID`, `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REFRESH_TOKEN` | Optional; set all three Google OAuth credentials together to enable Calendar/Meet integration. |

Generate independent secrets locally, for example with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Never reuse a secret across variables.

## Database migrations

Before the first API request, run Prisma migrations against the configured production database:

```powershell
$env:DATABASE_URL = "<managed PostgreSQL URL>"
pnpm --dir apps/api exec prisma migrate deploy
```

Do not run the demo seed against production. Import verified location masters before accepting property registrations.

## Netlify Function behavior and limitations

- API requests are handled by a stateless function with a 60-second synchronous execution limit and a 6 MB buffered request/response limit. The web app uploads documents directly to S3 using signed URLs.
- Live Socket.IO chat and online presence are disabled in this deployment. The chat REST endpoints remain available; use a separate persistent service if live messaging is required.
- Notification delivery runs synchronously in the request instead of using the Redis/BullMQ worker. Redis is not required by the Netlify Function configuration, but failures are returned to the caller and do not receive BullMQ retries.
- PostgreSQL connections should use a managed provider's serverless/pooler endpoint. External S3 and ClamAV connectivity must be tested from a deployed function before accepting documents.
- Configure the API's required production provider credentials before using signup, messaging, payments, appointments, or document upload. A successful Netlify build alone does not verify those external services.

After deployment, verify `https://tracklan.netlify.app/api/v1/health` returns `200`, then verify the district master endpoint and a test signup before using the site.
