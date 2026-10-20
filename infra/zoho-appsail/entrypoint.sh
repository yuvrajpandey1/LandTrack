#!/bin/sh
# Demo-only all-in-one runtime for Zoho Catalyst AppSail: embedded Postgres + Redis, API on 4000, web on the public port.
set -e
export HOME=/tmp

PORT_PUBLIC="${X_ZOHO_CATALYST_LISTEN_PORT:-9000}"
# AppSail kills the instance unless the public port is bound within ~10s, so the web starts first.
cd /workspace
node apps/web/node_modules/next/dist/bin/next start apps/web -p "$PORT_PUBLIC" -H 0.0.0.0 &
WEB_PID=$!

backend() {
set -e
PGBIN="$(ls -d /usr/lib/postgresql/*/bin | head -n1)"
PGDATA=/tmp/pgdata
mkdir -p "$PGDATA"
AS_PG=""
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  $AS_PG "$PGBIN/initdb" -D "$PGDATA" -U postgres -A trust >/dev/null
fi
$AS_PG "$PGBIN/pg_ctl" -D "$PGDATA" -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" -w start >/dev/null
$AS_PG "$PGBIN/psql" -h 127.0.0.1 -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='landtrack'" | grep -q 1 \
  || $AS_PG "$PGBIN/createdb" -h 127.0.0.1 -U postgres landtrack
redis-server --daemonize yes --save "" --bind 127.0.0.1 >/dev/null

printf 'DatabaseDirectory /opt/clamdb\nTCPSocket 3310\nTCPAddr 127.0.0.1\nPidFile /tmp/clamd.pid\nTemporaryDirectory /tmp\nForeground yes\nMaxFileSize 100M\nStreamMaxLength 100M\nSelfCheck 0\n' > /tmp/clamd.conf
clamd --config-file=/tmp/clamd.conf &

export NODE_ENV=development
export DATABASE_URL=postgresql://postgres@127.0.0.1:5432/landtrack
export REDIS_URL=redis://127.0.0.1:6379
export APP_URL="${APP_URL:-http://localhost:${PORT_PUBLIC}}"
export API_URL="http://127.0.0.1:4000"
export PORT=4000
export S3_ENDPOINT=http://127.0.0.1:9100 S3_REGION=ap-south-1 S3_BUCKET=landtrack S3_ACCESS_KEY=demo S3_SECRET_KEY=demo-secret
export SMTP_URL="${SMTP_URL:-smtp://127.0.0.1:1025}"
export MAIL_FROM="${MAIL_FROM:-no-reply@landtrack.example}"
export CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=3310
export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-11111111111111111111111111111111}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-22222222222222222222222222222222}"
export OTP_HASH_SECRET="${OTP_HASH_SECRET:-33333333333333333333333333333333}"
export SMS_PROVIDER=fake WHATSAPP_PROVIDER=fake PAYMENT_PROVIDER=fake WHATSAPP_VERIFY_TOKEN=demo
export JITSI_DOMAIN=localhost:8443 JITSI_APP_ID=landtrack JITSI_WEBHOOK_SECRET=demo
export ADMIN_EMAIL="${ADMIN_EMAIL:-admin@landtrack.example}"
export ADMIN_NAME="${ADMIN_NAME:-NRI Land Tracking System Administrator}"
export ADMIN_MOBILE="${ADMIN_MOBILE:-+919876543210}"
export ADMIN_INITIAL_PASSWORD="${ADMIN_INITIAL_PASSWORD:-PodmanAdmin123!}"
export ADMIN_NOTIFY_EMAIL="$ADMIN_EMAIL" ADMIN_SETUP_EMAIL="$ADMIN_EMAIL" GOOGLE_CALENDAR_ADMIN_EMAIL="$ADMIN_EMAIL"

cd /workspace
node infra/zoho-appsail/s3-stub.mjs &
(cd apps/api && node_modules/.bin/prisma migrate deploy)
(cd apps/api && node_modules/.bin/tsx prisma/seed.ts) || true
while true; do node apps/api/dist/main.js; echo "api exited, restarting"; sleep 2; done
}

backend 1>&2 &
wait $WEB_PID
