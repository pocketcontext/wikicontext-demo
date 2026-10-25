# Demo validation status — 10 October 2026

**Live bootstrap verified on 11 October 2026; operational acceptance is partial.**
The checks below retain their original synthetic scope. Current live evidence is
recorded in [DEPLOYMENT.md](../DEPLOYMENT.md). The initial package commit is
`ca78b763de03f25c0f9b8bb8fb232cb3657b0020`; the portable launcher uses that
dedicated repository and full revision. Publication and restricted CD are now
enabled through the main-only `pocketdeploy-v2` environment (`pocketdeploy-v1`
until that host was retired on 24 October 2026).

## Earlier local checks

The earlier baseline checks used server
`976ddf71a4734530adefe4a56633658a0894b449` before private-search configuration
was enabled. That server cannot reproduce the current application checks.
The handoff reports a later full backend run against an uncommitted
private-search build; those historical results are distinct from the reruns below.

The continuation reruns use
`/scratch/ubuntu/tools/bin/pocketcontext-private-search-reviewed` (CGO and declared
SQLite tags; SHA-256
`9473226014546ab78975517732ffb9f0907102d248551b83f03f9a18b13c2a8f`),
built from the reviewed PocketContext changes published as
`dc1dc6b0e88bbc46f36fa8441c8f6959bada4732` (the demo server pin),
and Litestream 0.5.17 Linux
ARM64 at `/tmp/vaultcontext-demo-tools/litestream`. The handoff records its release
archive SHA-256 verification against the Dockerfile. PocketContext
`make test` (including race checks) and `make build` passed before that server
commit was pushed. These checks do not claim a published demo image or deployment. All data is synthetic and isolated.

Commands run through `uv run --locked python` from the application repository:

- `python3 -m unittest discover -s tests -p 'test_demo_*.py'` with
  `WIKICONTEXT_TEST_BINARY`, `WIKICONTEXT_DEMO_TEST_BINARY` and
  `WIKICONTEXT_TEST_LITESTREAM`: 96 tests, 95 passed, 1 skipped (the shipped
  launcher still pins upstream, so `clientReady` is false). Covers fenced reset
  and the real reviewed-server local lifecycle, contact service and retention,
  real contact/paired replica recovery and handoff, Docker lifecycle command
  construction, ONCE runtime state transitions plus a real three-database
  release with local replicas, storage role names, the entrypoint demo fence
  and the installation contract.
- `python3 tests/demo_backend.py --binary …`: verified-Google admission with
  the Workspace domain ignored, subject binding and case-insensitive matching,
  forged create data, password/OTP/reset/email-change/verification rejection,
  enrollment gate on SQL, schema, domain REST, batch, realtime and files,
  explicit consent and stale-revision conflict, idempotent personal space via
  `ensurePersonalSpace`, private directory SQL, cross-visitor SQL and REST
  isolation, group-space refusal, audio/video and transcript refusal, every
  quota including concurrent creates and rollback, the account cap, the stale
  generation fence (including `/up`), withdrawal across the fence, and refusal
  of production databases, stale/invalid generations, weak contact tokens,
  production or swapped storage names and unsafe SQL configuration.
- With the reviewed binary: `integration.py`, `spaces.py`, `tracing.py`,
  `publication_review.py`, `home.py`, `properties.py`, `auth.py`,
  `realtime_access.py`, `realtime_publication.py`, `oauth_integration.py`,
  `skill.py`, `skill.py --trace`, `knowledge_integration.py`,
  `search_integration.py`, `ingest_integration.py` and `export_integration.py`
  passed.
- `tests/launcher.py`, `oauth.py`, `client.py`, `knowledge.py`, `ingest.py`,
  `exporter.py`, `repository_files.py` and `migrate_files.py` passed.
- `tests/entrypoint.py` (38), `tests/bootstrap.py`, `tests/deploy_workflow.py`
  (8, including the no-production-path and required spaces gate assertions),
  and with the reviewed server `tests/deploy.py` and `maintenance.py` passed in non-demo mode
  with the demo hooks present.
- The release workflow now requires `tests/spaces.py` on both architectures.
  actionlint was not available locally.

## Browser checks

The initial reader typecheck, build and 80 unit tests passed. The isolated actual-server
browser suites passed 11 reader scenarios and two demo scenarios, including
mobile layout, keyboard navigation, enrollment, live private search, account
isolation, conflict/reset UI and the unready-client state.

The demo browser fixture advertises a synthetic launcher pin to exercise setup,
not to establish shipped-client readiness. It exchanges OAuth against a synthetic
provider and injects the returned session in those initial scenarios; popup-flow
coverage added later is recorded below.
Conflict and reset UI responses are mocked, while `demo_backend.py` tests those
server boundaries directly. CI requires both browser suites on both architectures.

## Corrected during continuation

The first demo-backend rerun exposed a quota bypass: integrity auditing could
clear the transient actor marker before the separately registered demo execute
hook saw it. Hook registration order therefore determined whether usage was
counted. Quota accounting now runs directly inside integrity auditing before
its marker is cleared, in the same write transaction. The complete demo-backend
suite passed after this change, including exact usage totals, concurrent limits
and rollback. Internal source checksum saves remain uncounted.

## Not run

- The earlier checks predated Docker installation. Native Docker validation
  is recorded separately below; the local host is ARM64.
- Real Google sign-in, R2 whole-bucket purge behaviour, provider snapshot/version
  expiry, ONCE adoption, the host dispatcher, DNS/TLS and forwarded-header trust
  chain, and a real 00:00 UTC rollover remain unverified.

## Publication and container continuation

On 10 October 2026, the public repository was created and the prepared package
was pushed. Its deployment environment permits the `main` branch only.
The launcher now pins the published demo package instead of upstream;
the installation-contract test requires a dedicated full revision rather than
skipping an upstream pin. The portable skill explicitly requires browser
enrollment and forbids demo audio/transcription workflows.

Docker 29.9.0 was installed and its daemon verified with an unprivileged
`ubuntu` hello-world container.

All 28 README backend/client commands passed again against the reviewed server.
An unchanged copy of the published launcher, run from an unrelated temporary
directory with a fresh uv cache, passed help and the complete portable skill
suite with and without tracing. The tests put the real uv executable on PATH:
the asdf shim cannot operate after the fixture isolates HOME. CI now repeats
both copied-launcher integration runs. The two installation-contract tests pass;
a launcher pointing back to upstream is now a failure rather than a skip.

The naming review confirmed the proposed `pocketdeploy-v1` profile/role names.
Three naming tests passed, including ONCE runtime bindings; validators retain
role separation and reject production names. The host/profile choice remains
open, and names alone do not establish bucket-scoped credentials.

Local native ARM64 Docker gates passed:

- Image build, including reader typecheck, 80 unit tests and production assets.
- Image-extracted server maintenance, demo backend and all 96 demo lifecycle
  tests, using the packaged Litestream 0.5.17; no launcher skip remains.
- `docker/once_smoke.py`, configuration smoke and standard application smoke.
- `docker/object_storage_smoke.py`, including protected original access,
  separate bucket-scoped credentials, strict database comparison before source
  volume destruction, empty-volume recovery and missing/corrupt original refusal.

The local image `wikicontext-demo:local` has image ID
`sha256:e01cb0698f22f3615bb24dba7f95fcb70d71144cd26ca48c17f6227bfb85e463`.
It was built from `ca78b76` plus the released-launcher update before the
continuation commit; it is a validation image, not a published release artifact.
The image contains the pinned server `dc1dc6b` and Litestream 0.5.17.
Test containers, volumes and networks were removed after verification.

Container checks exposed two inherited fixture defects: originals and replicas
shared one credential, which the entrypoint correctly refused, and the recovery
comparator mounted tests at a path without the application configuration.
Fixtures now create separate bucket-scoped users, check cross-bucket denial,
and mount recovery tests under `/app/tests`. No runtime protection was relaxed.
Native AMD64 results and exact committed-source image results remain CI gates.

## Browser login hardening

The subsequent browser-auth changes passed Node.js 24 typecheck, production
build and 94 unit tests. Both isolated browser suites passed: 11 reader scenarios
and eight demo scenarios. The demo suite now clicks the Google button and
exercises the SDK's real realtime callback and PKCE exchange against a synthetic
provider. It checks persistent login, cross-tab storage clearing, memory-only
login when storage is blocked, blocked-popup guidance, cancellation, the
three-minute timeout and a delayed successful exchange after cancellation.
Unit tests also cover unsafe provider URLs and another tab logging out while
an anonymous popup is pending. No real Google account or consent screen was used.

All 28 README backend/client validation commands and `tests/demo_backend.py`
passed again with the pinned reviewed server after `uv sync --locked`.
These changes have local validation; the previously recorded container image
predates them and must be rebuilt through the release gates before deployment.

## Standard PocketDeploy release preparation — 11 October 2026

The preserved browser-auth changes passed Node.js 24 typecheck, 94 unit tests,
production build, all eight demo browser scenarios and all eleven reader scenarios.
All 28 README backend/client commands and demo_backend.py passed again against
the pinned reviewed server after locked dependency synchronization. These use
synthetic isolated data and do not prove live Google sign-in.

The application-owned standard supervisor replaces external release orchestration.
Its compatibility fingerprint includes the pinned server, migrations and durable
contact schema owner. Fresh environment binding, exact persisted-binding equality,
truthful readiness, explicit initialization, stop-first upgrade and fail-closed
interruption recovery are covered. Native ARM64 Docker validation includes
bootstrap/exclusive volume, missing-configuration refusal, graceful shutdown,
protected originals and strict replica recovery, plus populated standard
replacement preserving publications, originals and withdrawn contact preferences.
Real nginx tests cover the trusted Cloudflare/ONCE header chain assumptions.
Both architectures must pass the new committed-source CI before live rollout.
Workflow tests and actionlint passed for standard restricted GitHub delivery.

The operator confirmed the existing operator/contact details and demo quotas.
The existing OCI host was reachable with refreshed credentials; safe metrics
showed about 5 GiB available RAM and 43 GiB free disk before adding Wiki Demo.
Vault Demo remained healthy with no pending operations. Live Wiki Demo resource
creation, OAuth sign-in, midnight observation and provider recovery are separate
release evidence and must not be inferred from these local checks.

## Live bootstrap verification — 11 October 2026

Source `219c8804de668a179ddc0ec270136e1467867847` passed native CI in
[run 38126921270](https://github.com/pocketcontext/wikicontext-demo/actions/runs/38126921270)
and was deployed using the exact image and isolated storage listed in
[the deployment record](../DEPLOYMENT.md). Independent public workflow attestation
passed for the current generation, stable ready revision, released React assets,
legal pages, installation, HTTPS/no redirects and anonymous SQL rejection. Google
OAuth is advertised and enabled; password authentication is disabled. Vault Demo
remained healthy. Standard profile reconciliation to `latest` completed without
replacement; enabled CD will process the next source push.

No real Google sign-in, live midnight reset observation or provider-backed
populated recovery drill has yet been completed. These remain explicit acceptance
checks rather than inferred successes from local or native CI tests.
