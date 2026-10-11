# Demo deployment procedures

**Live since 11 October 2026.** This repository builds `ghcr.io/pocketcontext/wikicontext-demo`
for `https://wiki-demo.pocketcontext.com` on the
`pocketdeploy-v1` host. Production WikiContext (`wiki.pocketcontext.com`,
`ghcr.io/pocketcontext/wikicontext`) is deployed only from `pocketcontext/wikicontext`;
never point this image, its buckets or its workflows at production. Release
controls are in [CI and deployment](ci-and-deployment.md); the demo lifecycle,
API contract, quotas and contact retention are in [demo operations](demo-operations.md).

The container exposes HTTP port 80 and `/up`; mount persistent `/storage`. The root
serves the bundled reader; `/terms/` and `/privacy/` serve `legal/` drafts in demo
mode. It builds the commit in `POCKETCONTEXT_VERSION` with CGO, with pinned
base images and Litestream checksums. Container gates:

```sh
python3 docker/once_smoke.py --image wikicontext:ci
python3 docker/standard_demo_smoke.py --image wikicontext:ci
python3 docker/smoke.py config --image wikicontext:ci
python3 docker/smoke.py smoke --image wikicontext:ci
python3 docker/object_storage_smoke.py --image wikicontext:ci --minio-image wikicontext-minio-fixture:9e49d5e-7394ce0
```

## Demo configuration

The PocketDeploy application sets `BASE_URL` and `WIKICONTEXT_DEMO_ONCE=true`,
with complete private parameter bindings. The supervisor refuses any origin other
than an HTTPS `wiki-demo.*`, `demo-wiki.*` or `wikicontext-demo.*` host. Complete
bindings establish private mode-0600 `control/runtime.json` on a fresh volume;
existing bindings must match exactly. Partial or conflicting bindings fail closed.
Private values may occur in container/ONCE metadata: inspect only explicitly
allowlisted safe fields and never print environment variables or complete labels.
The required set is:

- `WIKICONTEXT_S3_{BUCKET,ENDPOINT,REGION,ACCESS_KEY_ID,SECRET_ACCESS_KEY}` for
  `pocketdeploy-v1-wikicontext-demo-files`;
- `LITESTREAM_{BUCKET,ENDPOINT,REGION,PATH,ACCESS_KEY_ID,SECRET_ACCESS_KEY}` for
  `pocketdeploy-v1-wikicontext-demo-replica`;
- `CONTACTS_LITESTREAM_{BUCKET,ENDPOINT,REGION,PATH,ACCESS_KEY_ID,SECRET_ACCESS_KEY}`
  for `pocketdeploy-v1-wikicontext-demo-contacts-replica`;
- `WIKICONTEXT_GOOGLE_CLIENT_ID`/`WIKICONTEXT_GOOGLE_CLIENT_SECRET` for a
  dedicated External Google Web client (any verified Google account) with redirects
  `https://wiki-demo.pocketcontext.com/api/oauth2-redirect` and
  `http://127.0.0.1:8765/callback`;
- `WIKICONTEXT_DEMO_CONTACT_TOKEN` (at least 32 random characters).

Optional: `WIKICONTEXT_S3_FORCE_PATH_STYLE`, `LITESTREAM_SYNC_INTERVAL`,
`CONTACTS_LITESTREAM_RETENTION_HOURS` (at most 672), `CONTACTS_LITESTREAM_SYNC_INTERVAL`.
The three buckets and the three access keys must all differ; the daily reset
deletes the whole files and replica buckets and never receives contact
credentials. Keep source values in the operator's private `.envrc.private` under
app-specific names (for example `COLORS_PAR_APP_WIKICONTEXT_DEMO_*`); never
reuse production `COLORS_PAR_APP_WIKICONTEXT_*` values. The supervisor sets
`WIKICONTEXT_DEMO_MODE`, `WIKICONTEXT_DEMO_GENERATION`, the reset fence,
`WIKICONTEXT_DEMO_CONTACT_URL=http://127.0.0.1:8781` and
`WIKICONTEXT_TRUSTED_PROXY_HEADER=X-Forwarded-For` for its children.

For a genuinely fresh installation, start ordinary PocketDeploy convergence and
observe it while ONCE creates the application's named volume and container. The
complete private environment establishes bindings; the new application remains
fenced and `/up` returns 503 while awaiting explicit initialization. Through a
separate operator SSH session, identify the exact Wiki Demo container using only
allowlisted name/image/revision/state metadata. Confirm private control reports
awaiting initialization, then execute inside that container:

```sh
python3 /usr/local/bin/wikicontext-demo-once.py control initialize
python3 /usr/local/bin/wikicontext-demo-once.py control status
```

Require ready status, all three databases and successful PocketDeploy completion
within the configured readiness budget. Do not run a second initialization
container or guess ONCE's named volume. Initialization requires empty primary
storage, no unfinished uploads and absent replicas; it does not purge populated
storage. Never initialize an existing volume or replica to bypass failed recovery.

See [application-owned supervisor](standard-supervisor.md) for compatibility,
upgrade journaling, initialization, readiness and shutdown. Configure stop-first
delivery and at least 900-second stop and readiness budgets. Fresh initialization
is an operator action; ordinary reconciliation cannot initialize missing state.

The inherited single-application container mode (without `WIKICONTEXT_DEMO_ONCE`)
remains available for the container gates below and isolated development.

## Startup and complete recovery

One Python entrypoint owns configuration validation, maintenance checks, database
recovery, source verification and process handoff. Normal `start` preserves an
existing database; when it is absent, a successful Litestream restore is required.
A missing replica fails startup instead of creating an empty application. Restore
uses a temporary location and validates SQLite before installing `data.db`.
Startup streams each referenced original from S3 and checks its SHA-256 before
HTTP starts. Missing, corrupt or unavailable evidence blocks startup.

Python then replaces itself with Litestream. Its internal `serve` child requires
successful initial `sync -wait` over the private IPC socket before replacing itself
with PocketContext. Litestream supervises the server and attempts final replication
after graceful shutdown. Keep exactly one application writer and replica publisher
per replica path. A clean exit alone does not establish complete replication.

For first installation only, run one-shot `init` with the same private environment
and empty volume that normal startup will use. It refuses an existing database or
replica, creates and verifies the initial database, then exits. For example, after
creating a dedicated local volume and private mode-0600 environment file:

```sh
docker run --rm --env-file /private/wikicontext.env \
  --mount source=wikicontext-data,target=/storage wikicontext:tested init
docker run --name wikicontext --env-file /private/wikicontext.env \
  --mount source=wikicontext-data,target=/storage -p 127.0.0.1:8090:80 wikicontext:tested
```

Do not run `init` during recovery. The ordinary `start` that follows establishes
replication before serving. An interrupted or failed initialization leaves a private
`initialization.pending` marker, and normal startup refuses that directory. Preserve
the failed volume for inspection and initialize a fresh volume; do not remove the
marker to bypass validation. The marker is removed only after successful database
creation, evidence verification and requested provisioning.

`verify` checks the existing database and remote
originals without starting a writer:

```sh
docker run --rm --env-file /private/wikicontext.env \
  --mount source=wikicontext-recovery,target=/storage wikicontext:tested verify
```

For host replacement, stop and fence the source and its deployment automation.
Restore into isolated storage, compare the recovered committed database with the
stopped source before activating the destination, and verify original bytes and
protected authenticated downloads. Keep the source volume until verification
passes. An abrupt host loss can lose unreplicated SQLite commits. Original object
retention must cover the entire database recovery history; do not delete objects
because a restored database does not reference them. A generated Obsidian vault
is not an application backup. SQLite, `maintenance.json`, and `auxiliary.db` have
different recovery needs; see the freeze procedure below.

Local tests use the pinned disposable MinIO fixture, separate synthetic original
and replica buckets, and isolated volumes. Run:

```sh
python3 tests/entrypoint.py
python3 tests/bootstrap.py
python3 tests/deploy_workflow.py
python3 docker/object_storage_smoke.py --image wikicontext:ci --minio-image wikicontext-minio-fixture:9e49d5e-7394ce0
```

## Updates

Releases use standard PocketDeploy trigger-only reconciliation described in
[CI and deployment](ci-and-deployment.md); ONCE automatic updates and backups stay
disabled. `deploy/install.py`, `deploy/deploy-wikicontext.py` and
`deploy/bootstrap-wikicontext.py` are retired and refuse execution. Container
`init` initializes application storage only; it never provisions cloud resources.

## Runtime migration freeze

The application pins PocketContext `976ddf71a4734530adefe4a56633658a0894b449`,
which retains the runtime maintenance API and fixes writable PocketBase backup
creation under the SQLite guard. Verify API support before attempting a live
freeze; images predating the maintenance feature do not expose it.

An operator with an existing valid superuser token reads
`GET /api/context/maintenance`, then sends `PUT /api/context/maintenance` with
`{"readOnly":true,"expectedGeneration":N}`, using the returned generation.
Wait for `state: "read_only"` before taking the final migration snapshot. A draining
or failed transition is not a completed freeze. Ordinary users cannot change this
state, and superusers do not bypass the content freeze. Keep the operator token
private and available for the explicit unfreeze operation.

Existing authenticated sessions retain SQL queries, searches and protected file
reads. Token refresh and protected file-token requests remain available. Password
login, OAuth login/linking, signup, uploads, publication, batch writes and other
mutations are unavailable while frozen. Complete interactive login before the
freeze. This is a migration maintenance window, not permanent public read-only
hosting.

The server owns `pb_data/maintenance.json`; retain it with the active volume. On a
frozen restart, the container requires the existing database and skips
replica restore and superuser upsert. The bootstrap hook preserves stored
settings and OAuth configuration instead of applying changed environment values.
Invalid maintenance state stops startup. Do not remove or edit the marker to
unfreeze the process: send the same PUT with `readOnly:false` and the latest
generation after confirming this host remains the authorized writer.

This flag freezes application database and HTTP mutations, not the independent
Litestream process. The publisher keeps running until explicitly fenced.
Before promoting a recovered host, stop the old replica publisher and deployment
automation, and independently verify the final database and originals. Never
restart a stale source after destination writes have begun. The marker is separate
from `data.db` and is not transferred by database-only Litestream recovery; enforce
destination maintenance before making the recovered application reachable.

A cold Litestream restore supplies only `data.db`. Frozen startup also requires
PocketBase's compatible `auxiliary.db`; it cannot initialize a missing auxiliary
database while frozen. Copy that database consistently from the stopped source,
or complete a controlled bootstrap on an isolated destination before installing
the freeze. Do not expose that destination or attach a competing replica publisher
during preparation. A same-volume frozen container restart already retains both
databases and is a different operation from cold replica recovery.

Validate with synthetic isolated data:

```sh
python3 tests/entrypoint.py
python3 tests/maintenance.py --binary /absolute/path/to/maintenance-capable/pocketcontext
```

## Attribution

Demo admission, consent, reset, contact and ONCE lifecycle code is ported from
`pocketcontext/vaultcontext-demo`.

Container, Litestream, immutable-file backup, smoke/MinIO fixture, bootstrap and
single-writer deployment patterns were adapted from sibling AccountContext.
WikiContext changes the protected attachment collection to `sources`, tests shared
user visibility, and restricts operational deployment to its approved fixed target.
