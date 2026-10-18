# Deploy NRI Land Tracking System API on Railway

The Next.js site can stay on Netlify. Deploy this repository's NestJS API separately on Railway, then point the Netlify site's `API_URL` at the Railway public API domain.

## Create Railway services

Create one Railway project/environment and add these services:

1. **PostgreSQL** using Railway's PostgreSQL service/template.
2. **Redis** using Railway's Redis service/template.
3. **ClamAV** from this GitHub repository, with the repository root as the build context and `infra/railway/clamav.Dockerfile` as its Dockerfile. Do not assign it a public domain. The API connects to it over Railway private networking at `clamav.railway.internal:3310`.
4. **NRI Land Tracking System API** from this GitHub repository. Leave the root directory at the repository root and set `RAILWAY_DOCKERFILE_PATH=/Dockerfile`. Add a public domain for the API.

The API image runs `prisma migrate deploy` before starting NestJS. Do not run the local seed against production: it adds clearly labeled demo location masters. Import verified, authoritative location data before accepting property registrations.

## API environment variables

Set variables in the Railway API service only. Use Railway's variable-reference picker for the database and Redis URLs; do not copy credentials into Git or this guide.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_URL` | Exact public Netlify site origin, e.g. `https://your-site.netlify.app` |
| `API_URL` | Exact public Railway API origin, e.g. `https://your-api.up.railway.app` |
| `DATABASE_URL` | Reference Railway PostgreSQL's `DATABASE_URL` |
| `REDIS_URL` | Reference Railway Redis's `REDIS_URL` |
| `JWT_ACCESS_SECRET` | Independently generated random secret, at least 32 characters |
| `JWT_REFRESH_SECRET` | Different independently generated random secret, at least 32 characters |
| `OTP_HASH_SECRET` | Independently generated random secret, at least 32 characters |
| `S3_ENDPOINT` | Private S3-compatible object-storage endpoint; Cloudflare R2 is one option |
| `S3_REGION` | Provider's region (`auto` for Cloudflare R2) |
| `S3_BUCKET` | Private bucket name |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Bucket-scoped credentials with only the required object permissions |
| `SMTP_URL`, `MAIL_FROM`, `ADMIN_NOTIFY_EMAIL` | Production SMTP connection and verified sender/notification addresses |
| `SMS_PROVIDER` | `twilio_verify` when configuring Twilio Verify |
| `TWILIO_VERIFY_SERVICE_SID` | A Verify Service SID (`VA...`), not the Account SID |
| `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` | Restricted Twilio API key pair; preferred over account credentials |
| `WHATSAPP_PROVIDER` | `cloud` |
| `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Values from the configured Meta WhatsApp Cloud app |
| `PAYMENT_PROVIDER` | `razorpay` |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay credentials; use test-mode credentials until verified |
| `JITSI_DOMAIN`, `JITSI_APP_ID`, `JITSI_APP_SECRET`, `JITSI_WEBHOOK_SECRET` | Production call-provider configuration and webhook secret |
| `CLAMAV_HOST` | `clamav.railway.internal` |
| `CLAMAV_PORT` | `3310` |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_NOTIFY_EMAIL` | Initial administrator and notification addresses |
| `ADMIN_SIGNUP_CODE` | Private random value, at least 32 characters; set only on the API service |

To generate independent secret values locally, run `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` once per secret. Do not reuse a value across secret variables. Never paste production credentials into chat or commit them.

For the initial administrator, either set `ADMIN_SIGNUP_CODE` and visit `https://your-site.netlify.app/admin/register`, or set `ADMIN_INITIAL_PASSWORD` (at least 12 characters) and `ADMIN_MOBILE` and create the administrator with the seed command. The setup-code route is one-time; after the initial administrator exists it refuses further administrator bootstrap. Keep the code private and remove it from the service environment after setup.

## Connect Netlify

In the Netlify site's environment variables, set `API_URL` to the Railway API origin without a trailing slash, then trigger a new web build/deploy. The Next.js rewrite proxies browser API requests through Netlify to the API. Set the same Netlify origin in the Railway API's `APP_URL` so credentialed CORS requests and Socket.IO connections are allowed.

Check `https://your-api-site/api/v1/health` returns `200` after deployment. Verify signup, password sign-in, password changes, private document uploads and scans, email, payment webhooks, and appointment flows using non-sensitive test accounts before inviting users.

## Production readiness

This deployment configuration does not provision provider accounts or credentials. The API deliberately rejects fake SMS, WhatsApp, and payment providers in production. Obtain and configure real provider credentials, lock down the Railway project, enable database backups, and verify monitoring and recovery before use. Current password-only login has no OTP or mandatory MFA, and user phone numbers are not verified; do not use this setup for sensitive property documents or payment data until authentication is hardened and an independent privacy/security review is complete.
