#!/bin/sh
# Zoho Catalyst Slate only. Not used by Netlify, Podman, Railway, or local runs.
set -e
npx -y pnpm@9.12.3 install --frozen-lockfile --filter "@landtrack/web..." 1>&2
# Slate's Next.js adapter step runs plain npm, which cannot resolve `workspace:*`.
# This only edits the ephemeral Slate clone, never the repository.
sed -i 's#"workspace:\*"#"file:../../packages/shared"#' apps/web/package.json apps/api/package.json
