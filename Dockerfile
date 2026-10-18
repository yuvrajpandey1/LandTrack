FROM node:22-bookworm-slim

WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
    && corepack prepare pnpm@9.12.3 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps apps
COPY packages packages

RUN pnpm install --frozen-lockfile \
    && DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build pnpm --dir apps/api build

ENV NODE_ENV=production
EXPOSE 4000

CMD ["sh", "-c", "pnpm --dir apps/api exec prisma migrate deploy && node apps/api/dist/main.js"]
