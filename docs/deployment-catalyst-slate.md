# Deploy the web app on Zoho Catalyst Slate

Slate's default install step runs `npm install`. npm cannot resolve the `workspace:*` dependency (`@landtrack/shared`) used by this pnpm monorepo, so the default fails with `EUNSUPPORTEDPROTOCOL Unsupported URL Type "workspace:"`. Override the install and build commands in the Slate app instead of changing the repository (Netlify, Podman, and local flows are unaffected).

## Slate build settings

In the Catalyst console, open **Slate > your app > Settings > Build & Deploy** and set:

| Setting | Value |
| --- | --- |
| Branch | `main` |
| Root directory | `.` (repository root) |
| Node version | `22` |
| Install command | `corepack enable && corepack prepare pnpm@9.12.3 --activate && pnpm install --frozen-lockfile` |
| Build command | `pnpm --dir apps/web build` |
| Output / start | the Next.js output from `apps/web` (`.next`; start with `pnpm --dir apps/web start`) |

Environment variables:

- `API_URL` - public HTTPS URL of the LandTrack API (for example a Catalyst AppSail deployment of `apps/api`). The web app rewrites `/api/v1/*` to this host. Without a reachable API the app shows "The NRI Land Tracking System API is unavailable".

## Notes

- Slate hosts only the frontend. Deploy the API separately (Catalyst AppSail with `apps/api/Containerfile`, or any host) with PostgreSQL, Redis, S3-compatible storage, and SMTP configured.
- If your Slate plan does not expose an install command field, deploy from the CLI instead: run `corepack pnpm install --frozen-lockfile && corepack pnpm --dir apps/web build` locally, then `catalyst deploy slate <name> -ni`.
