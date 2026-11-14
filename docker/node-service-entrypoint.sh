#!/bin/sh
# Apply pending Prisma migrations for this service's own database, then start it.
# Services without a prisma/ folder (api-gateway) start straight away.
set -e
if [ -f prisma/schema.prisma ] && [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "entrypoint: prisma migrate deploy"
  ./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma
fi
exec "$@"
