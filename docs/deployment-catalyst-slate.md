# Deploy the web app on Zoho Catalyst Slate

Slate's default install step runs `npm install`. npm cannot resolve the `workspace:*` dependency (`@landtrack/shared`) used by this pnpm monorepo, so the default fails with `EUNSUPPORTEDPROTOCOL Unsupported URL Type "workspace:"`. Override the install and build commands in the Slate app instead of changing the repository (Netlify, Podman, and local flows are unaffected).

## Slate build settings

In the Catalyst console, open **Slate > your app > Settings > Build & Deploy** and set:

| Setting | Value |
| --- | --- |
| Framework | `Next.js` |
| Branch | `main` |
| Node version | `22` |
| Root path | `apps/web` |
| Build path | `.next` |
| Install command | `sh infra/zoho-slate-install.sh \|\| sh ../../infra/zoho-slate-install.sh` |
| Build command | `npm run build 1>&2` |

[infra/zoho-slate-install.sh](../infra/zoho-slate-install.sh) runs only inside Slate's temporary clone: it drops `apps/api`, rewrites `workspace:*` to a `file:` path and runs `npm install`, because Slate's Next.js adapter step uses plain npm. The `1>&2` makes build output visible in Slate logs. Status: build and deploy succeed, but the site URL returned `503` when last tested, so this is not yet verified working.
Environment variables:

- `API_URL` - public HTTPS URL of the LandTrack API (for example a Catalyst AppSail deployment of `apps/api`). The web app rewrites `/api/v1/*` to this host. Without a reachable API the app shows "The NRI Land Tracking System API is unavailable".

## Notes

- Slate hosts only the frontend. Deploy the API separately (Catalyst AppSail with `apps/api/Containerfile`, or any host) with PostgreSQL, Redis, S3-compatible storage, and SMTP configured.
- If your Slate plan does not expose an install command field, deploy from the CLI instead: run `corepack pnpm install --frozen-lockfile && corepack pnpm --dir apps/web build` locally, then `catalyst deploy slate <name> -ni`.
