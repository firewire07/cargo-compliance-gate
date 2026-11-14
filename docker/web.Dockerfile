# syntax=docker/dockerfile:1
# Angular production build, served by nginx. nginx also proxies /api to the
# gateway, so the browser sees one origin (no CORS, cookies just work).

FROM node:22-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS builder
ENV NX_DAEMON=false \
    NX_NO_CLOUD=true \
    NX_SKIP_NX_CACHE=true
COPY . .
RUN npx nx build web --configuration=production --skip-nx-cache

FROM nginx:alpine AS runtime
COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/dist/apps/web/browser /usr/share/nginx/html
EXPOSE 80
