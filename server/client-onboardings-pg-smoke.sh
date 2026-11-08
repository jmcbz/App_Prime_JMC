#!/bin/sh
set -eu
[ "$(readlink /proc/self/ns/net)" != "$(readlink /proc/1/ns/net)" ] || { echo 'network namespace required' >&2; exit 1; }
[ "$(readlink /proc/self/ns/mnt)" != "$(readlink /proc/1/ns/mnt)" ] || { echo 'mount namespace required' >&2; exit 1; }
[ "$(ip -j route)" = '[]' ] || exit 1
[ "$(ip -j -6 route)" = '[]' ] || exit 1
mount -t tmpfs tmpfs /var/lib/postgresql
mkdir -m 700 /var/lib/postgresql/prime-onboardings
chown postgres:postgres /var/lib/postgresql/prime-onboardings
PG=/usr/lib/postgresql/16/bin
runuser -u postgres -- "$PG/initdb" -D /var/lib/postgresql/prime-onboardings/data -U prime_test --auth=trust >/dev/null
runuser -u postgres -- "$PG/pg_ctl" -D /var/lib/postgresql/prime-onboardings/data -o '-c listen_addresses= -k /var/lib/postgresql/prime-onboardings -p 5489' -l /var/lib/postgresql/prime-onboardings/log start >/dev/null
trap 'runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/prime-onboardings/data stop -m immediate >/dev/null 2>&1 || true' EXIT
runuser -u postgres -- "$PG/createdb" -h /var/lib/postgresql/prime-onboardings -p 5489 -U prime_test prime_test
ip link set lo up
env -i PATH=/usr/bin:/bin HOME=/root TMPDIR=/root/.hermes/cache/scratch DATABASE_URL='postgresql://prime_test@/prime_test?host=/var/lib/postgresql/prime-onboardings&port=5489&sslmode=disable' PGSSL=disable APP_PRIME_ALLOW_NEW_DATABASE=1 APP_PRIME_ISOLATED_TEST=1 APP_PRIME_TEST_SOCKET=/var/lib/postgresql/prime-onboardings JWT_SECRET=isolated-dummy-secret SEED_ADMIN_EMAIL=isolated@example.test SEED_ADMIN_PASSWORD=isolated-only NODE_ENV=test node --test server/client-onboardings-pg.test.js
