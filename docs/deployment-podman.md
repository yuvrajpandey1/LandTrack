# Deploy NRI Land Tracking System with Podman

This repository can run the complete application stack with Podman: PostgreSQL, Redis, RustFS object storage, MailHog, ClamAV, the NestJS API, and the Next.js web app.

## Requirements

- Podman 5+ or Podman Desktop with a running machine
- A Compose provider for Podman: either `podman compose` backed by `podman-compose` or the Podman Desktop Compose extension
- 8 GB RAM available to the Podman machine is recommended for first-time image builds

If `podman compose version` reports that no provider is installed, install one locally:

```powershell
python -m pip install --user podman-compose
```

Then restart your terminal so `podman compose` can discover it, or run `podman-compose` directly.

## Prepare the environment

1. Copy [podman.env.example](../infra/podman.env.example) to `infra/podman.env`.
2. Replace `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `OTP_HASH_SECRET` with distinct values of at least 32 characters.
3. Fill any optional provider credentials you need for local end-to-end testing. The defaults keep SMS, WhatsApp, and payments in their local fake/demo modes. Leave optional URL variables such as `SMS_API_URL` unset unless you are actively using that provider.
4. If you want an initial admin account during the seed, set `ADMIN_EMAIL`, `ADMIN_MOBILE`, and `ADMIN_INITIAL_PASSWORD`.

## Build and run the stack

From the repository root:

```powershell
podman compose --in-pod=false --podman-run-args=--cgroups=disabled -f infra/podman-compose.yml --env-file infra/podman.env up --build -d
```

If your provider is only available as `podman-compose`, use:

```powershell
podman-compose --in-pod=false --podman-run-args=--cgroups=disabled -f infra/podman-compose.yml --env-file infra/podman.env up --build -d
```

On a fresh database, seed the initial data and location masters:

```powershell
podman compose --in-pod=false --podman-run-args=--cgroups=disabled -f infra/podman-compose.yml --env-file infra/podman.env --profile setup run --rm seed
```

The main endpoints are:

- Web app: `http://localhost:3001/login`
- API health: `http://localhost:4001/api/v1/health`
- MailHog: `http://localhost:8025`
- RustFS console: `http://localhost:9001`

## Operational notes

- The web container proxies `/api/v1/*` to the API container over the internal Podman network, so browser traffic stays same-origin at `http://localhost:3001`.
- The API container runs in `development` mode so the local fake SMS, WhatsApp, and payment providers remain available. Seeding remains a separate one-off task so repeated restarts do not duplicate seed work.
- The Podman stack uses RustFS for local S3-compatible storage and MailHog for local email capture.
- If Podman on WSL reports pod cgroup errors while starting the stack, include `--in-pod=false --podman-run-args=--cgroups=disabled` in the compose command. If Windows cannot reach the published ports through `localhost`, inspect the Podman machine IP with `podman machine ssh <machine-name> ip -4 addr show` and use that reachable address from the browser.
- To reach the stack on `localhost` without administrator rights, run `$env:PODMAN_HOST='<machine-ip>'; node infra/podman-localhost-proxy.mjs`. It forwards `localhost:3001` and `localhost:4001` to the Podman machine.
- For cleanup, stop and remove the stack with `podman compose -f infra/podman-compose.yml down`. Add `-v` to remove the persistent PostgreSQL and RustFS volumes.



