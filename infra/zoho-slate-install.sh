#!/bin/sh
# Zoho Catalyst Slate only. Not used by Netlify, Podman, Railway, or local runs.
# Slate's Next.js adapter step runs plain npm, which cannot resolve pnpm's `workspace:*`
# and cannot reuse a pnpm node_modules. This only edits the ephemeral Slate clone.
set -e
[ -d infra ] || cd ../..
rm -rf apps/api
sed -i 's#"workspace:\*"#"file:../../packages/shared"#' apps/web/package.json
npm install --no-audit --no-fund 1>&2
