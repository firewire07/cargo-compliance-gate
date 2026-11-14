# CargoComplianceGate

<a alt="Nx logo" href="https://nx.dev" target="_blank" rel="noreferrer"><img src="https://raw.githubusercontent.com/nrwl/nx/master/images/nx-logo.png" width="45"></a>

✨ Your new, shiny [Nx workspace](https://nx.dev) is ready ✨.

[Learn more about this workspace setup and its capabilities](https://nx.dev/getting-started/intro#learn-nx?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) or run `npx nx graph` to visually explore what was created. Now, let's get you up to speed!


## Local infra

Postgres 16 and a single-node Apache Kafka broker run in Docker Compose. Kafka uses KRaft mode, so there is no ZooKeeper. A one-shot `topic-init` service creates `shipment.events`, `screening.events` and `hold.events` with 3 partitions each so AWB keying can show ordering per partition. Topic creation is idempotent (`--if-not-exists`), which makes setup repeatable.

```sh
cp .env.example .env
docker compose up -d
docker compose ps
```

List topics and confirm each has 3 partitions (run these against the in-container listener):

```sh
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --describe
```

Ports (all bound to 127.0.0.1):

- Postgres: `127.0.0.1:5433` (container port 5432)
- Kafka, for apps on the Mac: `127.0.0.1:9094`
- Kafka, for other containers: `kafka:9092`

Stop the stack (keeps the Postgres volume):

```sh
docker compose down
```



The Compose Postgres image also mounts `docker/postgres/init`, which creates the
`cargo_compliance_screening` database on a **fresh** volume. That init directory
is not run again on an existing volume, so this project does not wipe
`postgres_data`. The screening database already exists here from T3. Never use
`docker compose down -v` if you want to keep local data.

## shipment-svc

NestJS service on `127.0.0.1:3101` that stores a shipment, publishes `shipment.submitted` through an outbox relay, and decides CLEARED or HELD in the hold module.

- **Outbox:** the shipment row and the outbox event are written in one database transaction, so we never publish an event that was not committed (no dual-write). Decision events go to `hold.events` the same way.
- **Kafka key = AWB:** all events for one shipment go to the same partition, so they stay in order.
- **Fail closed:** a shipment starts as `CHECKING` with a pending-check row (expected DG, EMBARGO, SANCTIONS). Results for an older `shipmentVersion` are ignored. If any result is a HIT, or if a result is still missing when the deadline passes (`HOLD_TIMEOUT_SECONDS`, default 30), the shipment is `HELD` with a `Hold` row. FILING is not in the expected set yet — the filing mock is later, and including it now would hold every shipment on timeout.

Requires local infra (`docker compose up -d`) and `DATABASE_URL` in `.env` (see `.env.example`).

```sh
npx prisma migrate dev --schema apps/shipment-svc/prisma/schema.prisma --name shipment-init
npx nx test shipment-svc
npx nx serve shipment-svc
```

```sh
curl -sS -X POST http://127.0.0.1:3101/shipments \
  -H 'Content-Type: application/json' \
  -H 'x-correlation-id: demo-1' \
  -d '{
    "awb": "020-12345675",
    "origin": "KUL",
    "destination": "AMS",
    "pieces": 2,
    "weight": 15.5,
    "goodsDescription": "Electronic parts",
    "hsCode": "8542.31",
    "routing": "KUL-AMS",
    "shipper": {"name": "Acme Forwarding", "country": "MY"},
    "consignee": {"name": "Rotterdam Imports", "country": "NL"}
  }'

curl -sS http://127.0.0.1:3101/shipments/020-12345675

curl -sS http://127.0.0.1:3101/shipments
curl -sS http://127.0.0.1:3101/holds

docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic shipment.events \
  --from-beginning \
  --property print.key=true \
  --max-messages 1
```


## screening-svc

NestJS service on `127.0.0.1:3102` that consumes `shipment.events`, runs DG, embargo and name-only sanctions checks, and publishes `screening.checked` (one event per check) through an outbox relay.

- **Idempotency:** the consumer writes `processed_events` in the same database transaction as the results and outbox rows, so a replayed event is skipped (effectively-once processing).
- **Offsets after commit:** the Kafka offset is committed only after that transaction succeeds. If the process crashes mid-way, the event is redelivered and the duplicate event id is ignored.

Requires local infra, `SCREENING_DATABASE_URL` in `.env` (see `.env.example`; a separate Postgres database so Prisma migrations are not shared with shipment-svc), and shipment-svc if you want to POST a shipment end-to-end. Create the database once with `docker compose exec postgres psql -U cargo -d postgres -c 'CREATE DATABASE cargo_compliance_screening;'`.

```sh
npx prisma migrate dev --schema apps/screening-svc/prisma/schema.prisma --name screening-init
npx nx test screening-svc
npx nx serve screening-svc
```

```sh
# after both services are up, POST a shipment to shipment-svc, then:
curl -sS http://127.0.0.1:3102/screenings/020-76543210

docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic screening.events \
  --from-beginning \
  --property print.key=true \
  --max-messages 3
```


## web

Angular app on `127.0.0.1:4300` (4200 is left free for cargo-dashboard) with real gateway login, a shipment submit form, a live shipments list, a hold queue and a shipment detail page with audit.

- **Login:** `POST /api/auth/login` against the api-gateway. The access token is kept in `sessionStorage` and sent as `Authorization: Bearer`. The gateway also sets an HttpOnly cookie; the live list does not rely on it, because EventSource cannot send an Authorization header.
- **Dev proxy:** `/api` is forwarded to the api-gateway at `127.0.0.1:3100` (the `/api` prefix is stripped).
- **Idempotency-Key:** the form sends a UUID per submission and reuses it if that attempt is retried. shipment-svc stores the key, a hash of the body and the original response: the same key and body returns that response, the same key with a different body returns 409.
- **Live list:** `GET /api/shipments` loads the table, then `POST /api/auth/stream-token` plus `GET /api/stream?token=...` (SSE) updates status (CHECKING → CLEARED or HELD) without a manual refresh. On disconnect the page reloads the list and fetches a new stream token. The subscription is closed when you leave the page.

Seeded demo users: `operator` / `operator-demo`, `analyst-a` / `analyst-a-demo`, `analyst-b` / `analyst-b-demo`.

```sh
npx nx test web
npx nx build web
npx nx serve shipment-svc
npx nx serve screening-svc
npx nx serve api-gateway
npx nx serve web
```

Open `http://127.0.0.1:4300`, sign in as `operator` / `operator-demo`, submit a shipment, and watch the list status change. Click an AWB to open its detail page.

**Hold queue and maker-checker (T9):** operators do not see the Hold queue link or analyst actions. To release a held shipment in the UI:

1. As `operator`, submit a shipment whose consignee is on the sanctions list (for example `Viktor Petrov Trading` in `apps/screening-svc/data/sanctions-list.v1.json`). Wait until the list shows HELD, then log out.
2. Sign in as `analyst-a` / `analyst-a-demo`. Open **Hold queue**, then the AWB. Complete and save the due-diligence checklist, and click **Request release**. The page will say that another analyst must approve it; Approve stays hidden.
3. Log out and sign in as `analyst-b` / `analyst-b-demo`. Open the same AWB from the hold queue and click **Approve release**. The status becomes RELEASED and the audit timeline plus the chain-verified badge update.

The UI hides actions a role cannot perform, but the shipment service is still the source of truth: a 403 (including self-approval) is shown on the page.

```sh
# login and submit through the web proxy (same paths the UI uses)
TOKEN=$(curl -sS -X POST http://127.0.0.1:4300/api/auth/login   -H 'Content-Type: application/json'   -d '{"username":"operator","password":"operator-demo"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")

curl -sS -X POST http://127.0.0.1:4300/api/shipments   -H "Authorization: Bearer $TOKEN"   -H 'Content-Type: application/json'   -H 'Idempotency-Key: demo-web-1'   -d '{
    "awb": "020-60000001",
    "origin": "KUL",
    "destination": "AMS",
    "pieces": 2,
    "weight": 15.5,
    "goodsDescription": "Electronic parts",
    "hsCode": "8542.31",
    "routing": "KUL-AMS",
    "shipper": {"name": "Acme Forwarding", "country": "MY"},
    "consignee": {"name": "Rotterdam Imports", "country": "NL"}
  }'
```


## Analyst actions and audit (T6)

Maker-checker release lives in the shipment-svc hold module. Identity comes from `x-user-id` and `x-roles` (the T7 gateway will set these). Only the `ANALYST` role can act. The requester cannot approve their own release (403). Each action writes state plus an outbox event with the actor, in one transaction. An append-only `audit_entries` table records every shipment-svc domain event in that same transaction, with `hash = sha256(prevHash + canonical payload)`. Appends take a Postgres advisory lock so the chain stays ordered. The chain is service-wide (not per AWB); `GET /audit/:awb` filters it.

```sh
# after a sanctioned shipment is HELD (see screening-svc):
curl -sS http://127.0.0.1:3101/holds/020-40000001

curl -sS -X PATCH http://127.0.0.1:3101/holds/020-40000001/checklist \
  -H 'Content-Type: application/json' \
  -H 'x-user-id: analyst-a' \
  -H 'x-roles: ANALYST' \
  -d '{"items":[
    {"id":"identity-verified","done":true},
    {"id":"documents-complete","done":true},
    {"id":"sanctions-rationale","done":true,"note":"False-positive review documented"},
    {"id":"goods-consistent","done":true}
  ]}'

curl -sS -X POST http://127.0.0.1:3101/holds/020-40000001/release-requests \
  -H 'x-user-id: analyst-a' \
  -H 'x-roles: ANALYST'

# same analyst cannot approve (403)
curl -sS -o /dev/stderr -w '%{http_code}\n' -X POST http://127.0.0.1:3101/holds/020-40000001/release-approvals \
  -H 'x-user-id: analyst-a' \
  -H 'x-roles: ANALYST'

curl -sS -X POST http://127.0.0.1:3101/holds/020-40000001/release-approvals \
  -H 'x-user-id: analyst-b' \
  -H 'x-roles: ANALYST'

curl -sS http://127.0.0.1:3101/shipments/020-40000001
curl -sS http://127.0.0.1:3101/audit/020-40000001
curl -sS http://127.0.0.1:3101/audit/verify
```

To show tamper detection (demo only; restore the row afterwards):

```sh
# peek at one row, change payload, verify, then restore
docker compose exec -T postgres psql -U cargo -d cargo_compliance \
  -c "SET search_path TO shipment; SELECT seq, type, hash FROM audit_entries ORDER BY seq;"
```

Optional reject: `POST /holds/:awb/release-rejections` with `{ "reason": "..." }` and the same analyst headers.


## api-gateway

NestJS BFF on `127.0.0.1:3100`. It issues a short-lived JWT, strips any client-supplied `x-user-id` / `x-roles`, sets those headers from the token, and proxies to shipment-svc (`3101`) and screening-svc (`3102`). `Idempotency-Key` and `x-correlation-id` are forwarded (a correlation id is generated if missing). Live status events are pushed over `GET /stream` (SSE) from `hold.events` and `shipment.events`. EventSource cannot send an `Authorization` header, so authenticate the stream with a 60-second single-use token from `POST /auth/stream-token` (query parameter) or the HttpOnly `ccg_token` cookie set at login.

Seeded demo users (placeholders only): `operator` / `operator-demo` (OPERATOR), `analyst-a` / `analyst-a-demo` (ANALYST), `analyst-b` / `analyst-b-demo` (ANALYST). Set `JWT_SECRET` in the gitignored `.env` (see `.env.example`).

```sh
npx nx serve shipment-svc
npx nx serve screening-svc
npx nx serve api-gateway
```

```sh
# login
TOKEN=$(curl -sS -X POST http://127.0.0.1:3100/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"operator","password":"operator-demo"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")

# submit a shipment through the gateway
curl -sS -X POST http://127.0.0.1:3100/shipments \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-key-1' \
  -d '{
    "awb": "020-50000001",
    "origin": "KUL",
    "destination": "AMS",
    "pieces": 2,
    "weight": 15.5,
    "goodsDescription": "Electronic parts",
    "hsCode": "8542.31",
    "routing": "KUL-AMS",
    "shipper": {"name": "Acme Forwarding", "country": "MY"},
    "consignee": {"name": "Rotterdam Imports", "country": "NL"}
  }'

# a spoofed ANALYST role header is ignored; operator still cannot request release
curl -sS -o /dev/stderr -w "%{http_code}\n" -X POST http://127.0.0.1:3100/holds/020-50000002/release-requests \
  -H "Authorization: Bearer $TOKEN" \
  -H 'x-roles: ANALYST'

# maker-checker via the gateway (use a sanctioned AWB that is already HELD)
A_TOKEN=$(curl -sS -X POST http://127.0.0.1:3100/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"analyst-a","password":"analyst-a-demo"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")
B_TOKEN=$(curl -sS -X POST http://127.0.0.1:3100/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"analyst-b","password":"analyst-b-demo"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")

curl -sS -X POST http://127.0.0.1:3100/holds/020-50000002/release-requests \
  -H "Authorization: Bearer $A_TOKEN"
curl -sS -o /dev/stderr -w "%{http_code}\n" -X POST http://127.0.0.1:3100/holds/020-50000002/release-approvals \
  -H "Authorization: Bearer $A_TOKEN"
curl -sS -X POST http://127.0.0.1:3100/holds/020-50000002/release-approvals \
  -H "Authorization: Bearer $B_TOKEN"

# live stream (token is single-use and lasts 60 seconds)
STREAM=$(curl -sS -X POST http://127.0.0.1:3100/auth/stream-token \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
curl -N "http://127.0.0.1:3100/stream?token=$STREAM"
```

## End-to-end test (T8)

One Jest command talks only to the api-gateway at `127.0.0.1:3100` and checks the thin path: a clean shipment is CLEARED, a sanctioned consignee is HELD, maker-checker release (operator 403, analyst A cannot approve their own request, analyst B can), the audit chain verifies, an `Idempotency-Key` replay does not create a duplicate, and the SSE stream receives the status events. Each run uses unique AWBs. The test polls for status changes with a timeout; it does not use fixed sleeps.

Start the stack first, then run the test:

```sh
docker compose up -d
npx nx serve shipment-svc
npx nx serve screening-svc
npx nx serve api-gateway
npm run e2e
```

Override the gateway URL with `GATEWAY_URL` if needed (`http://127.0.0.1:3100` is the default). The Angular app on port 4300 is not required.

A fail-closed timeout (screening-svc stopped, shipment becomes HELD with `CHECK_TIMEOUT`) is still a manual check, because stopping screening-svc would break the rest of this test. To try it: stop screening-svc, submit a shipment, and after `HOLD_TIMEOUT_SECONDS` (default 30) the shipment should be HELD with reasons `CHECK_TIMEOUT:DG`, `CHECK_TIMEOUT:EMBARGO` and `CHECK_TIMEOUT:SANCTIONS`.

## Run tasks

To run tasks with Nx use:

```sh
npx nx <target> <project-name>
```

For example:

```sh
npx nx build myproject
```

These targets are either [inferred automatically](https://nx.dev/concepts/inferred-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) or defined in the `project.json` or `package.json` files.

[More about running tasks in the docs &raquo;](https://nx.dev/features/run-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Add new projects

While you could add new projects to your workspace manually, you might want to leverage [Nx plugins](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) and their [code generation](https://nx.dev/features/generate-code?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) feature.

To install a new plugin you can use the `nx add` command. Here's an example of adding the React plugin:

```sh
npx nx add @nx/react
```

Use the plugin's generator to create new projects. For example, to create a new React app or library:

```sh
# Generate an app
npx nx g @nx/react:app demo

# Generate a library
npx nx g @nx/react:lib some-lib
```

You can use `npx nx list` to get a list of installed plugins. Then, run `npx nx list <plugin-name>` to learn about more specific capabilities of a particular plugin. Alternatively, [install Nx Console](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) to browse plugins and generators in your IDE.

[Learn more about Nx plugins &raquo;](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) | [Browse the plugin registry &raquo;](https://nx.dev/plugin-registry?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Set up CI!

### Step 1

To connect to Nx Cloud, run the following command:

```sh
npx nx connect
```

Connecting to Nx Cloud ensures a [fast and scalable CI](https://nx.dev/ci/intro/why-nx-cloud?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) pipeline. It includes features such as:

- [Remote caching](https://nx.dev/ci/features/remote-cache?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task distribution across multiple machines](https://nx.dev/ci/features/distribute-task-execution?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Automated e2e test splitting](https://nx.dev/ci/features/split-e2e-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task flakiness detection and rerunning](https://nx.dev/ci/features/flaky-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

### Step 2

Use the following command to configure a CI workflow for your workspace:

```sh
npx nx g ci-workflow
```

[Learn more about Nx on CI](https://nx.dev/ci/intro/ci-with-nx#ready-get-started-with-your-provider?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Install Nx Console

Nx Console is an editor extension that enriches your developer experience. It lets you run tasks, generate code, and improves code autocompletion in your IDE. It is available for VSCode and IntelliJ.

[Install Nx Console &raquo;](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Useful links

Learn more:

- [Learn more about this workspace setup](https://nx.dev/getting-started/intro#learn-nx?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Learn about Nx on CI](https://nx.dev/ci/intro/ci-with-nx?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Releasing Packages with Nx release](https://nx.dev/features/manage-releases?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [What are Nx plugins?](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

And join the Nx community:

- [Discord](https://go.nx.dev/community)
- [Follow us on X](https://twitter.com/nxdevtools) or [LinkedIn](https://www.linkedin.com/company/nrwl)
- [Our Youtube channel](https://www.youtube.com/@nxdevtools)
- [Our blog](https://nx.dev/blog?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
