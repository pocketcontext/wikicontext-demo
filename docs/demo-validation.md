# Demo validation status — 10 October 2026

**Not deployed, not provider-verified.** This records local synthetic validation
of the `wikicontext-demo` worktree captured by the commit containing this record. No GitHub repository or
environment, image, OAuth client, DNS record, bucket, credential, host
dispatcher or timer exists for this demo, and no live service was contacted.

## Local checks run

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

Reader typecheck, build and 80 unit tests passed. The isolated actual-server
browser suites passed 11 reader scenarios and two demo scenarios, including
mobile layout, keyboard navigation, enrollment, live private search, account
isolation, conflict/reset UI and the unready-client state.

The demo browser fixture advertises a synthetic launcher pin to exercise setup,
not to establish shipped-client readiness. It exchanges OAuth against a synthetic
provider and injects the returned session; the external popup is excluded.
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

- No Docker daemon is available on this host: the image build, `once_smoke.py`,
  container config/smoke and MinIO recovery gates, and the AMD64 platform run
  only in native CI.
- Real Google sign-in, R2 whole-bucket purge behaviour, provider snapshot/version
  expiry, ONCE adoption, the host dispatcher, DNS/TLS and forwarded-header trust
  chain, and a real 00:00 UTC rollover remain unverified.
