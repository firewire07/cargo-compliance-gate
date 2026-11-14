# syntax=docker/dockerfile:1
# One parameterised multi-stage image for every NestJS service.
#   docker build -f docker/node-service.Dockerfile --build-arg APP=shipment-svc .
# Builder and runtime share the same Debian base, so the Prisma engine that
# `prisma generate` downloads in the builder matches the runtime platform.

ARG NODE_IMAGE=node:22-slim

FROM ${NODE_IMAGE} AS base
# Prisma needs openssl to pick the right engine (debian-openssl-3.0.x).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ---- deps: full workspace install (cached until package-lock.json changes)
FROM base AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- builder: Prisma generate + Nx build for one app
FROM deps AS builder
ARG APP
ENV NX_DAEMON=false \
    NX_NO_CLOUD=true \
    NX_SKIP_NX_CACHE=true
COPY . .
RUN test -n "$APP" || (echo "Pass --build-arg APP=<nx project>" && exit 1)
RUN if [ -f "apps/$APP/prisma/schema.prisma" ]; then \
      npx prisma generate --schema "apps/$APP/prisma/schema.prisma"; \
    fi
RUN npx nx build "$APP" --skip-nx-cache
# Ship migrations with the app so it can `prisma migrate deploy` on startup, and
# put the Linux query engine next to main.js, where the bundled client looks first.
RUN if [ -d "apps/$APP/prisma" ]; then \
      rm -rf "dist/apps/$APP/prisma" && cp -r "apps/$APP/prisma" "dist/apps/$APP/prisma" \
      && cp apps/$APP/generated/prisma/libquery_engine-* "dist/apps/$APP/"; \
    fi

# ---- prod-deps: only the runtime dependencies Nx computed for this app
FROM base AS prod-deps
WORKDIR /app
ARG APP
COPY --from=builder /repo/dist/apps/${APP}/ ./
RUN npm ci --omit=dev --no-audit --no-fund
# Services with migrations also need the Prisma CLI (same version as the build).
COPY --from=builder /repo/node_modules/prisma/package.json /tmp/prisma-package.json
RUN if [ -d prisma ]; then \
      npm install --no-save --no-audit --no-fund "prisma@$(node -p "require('/tmp/prisma-package.json').version")"; \
    fi \
  && npm cache clean --force

# ---- runtime: small, non-root
FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app ./
COPY --chmod=755 docker/node-service-entrypoint.sh /usr/local/bin/entrypoint.sh
USER node
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "main.js"]
