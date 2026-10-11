# Demo validation and deployment contract

This repository publishes and deploys only the disposable public WikiContext
demo. It has no WikiContext production publication or deployment path: no
`once-v2`/`COLORS_PROFILE` environment, no production SSH secret, no
`wiki.pocketcontext.com` health check, no `ghcr.io/pocketcontext/wikicontext`
image and no release archives. Production remains in `pocketcontext/wikicontext`.
`tests/deploy_workflow.py` fails if any of those references return.

`image.yml` owns push, pull-request and manual validation and calls `test.yml`
once per run. Application tests and container checks run on native AMD64 and
ARM64 Linux. Container checks are: entrypoint unit tests; image build; the demo
lifecycle unit suite, backend demo suite and maintenance freeze using the
image's own PocketContext and Litestream binaries; `docker/once_smoke.py` (control-only
bootstrap, closed public gate, invalid bindings, exclusive volume, clean stop);
the required in-image nginx test for Cloudflare IP handling and direct-origin spoof resistance;
root process isolation tests for child identities, capabilities, private files,
immutable reset fencing, writer leases, timeout drains and adopted descendants;
`docker/standard_demo_smoke.py` (standard replacement, populated recovery and fresh initialization);
and the inherited configuration, smoke and MinIO object-storage recovery gates.
Application validation includes space roles and revocation, the reader browser
suite, and public-demo onboarding with a synthetic Google provider and real
enrollment APIs. The demo browser fixture runs through the generated nginx gate,
using synthetic sessions and a synthetic Google provider to exercise both OAuth
completion redirects. This does not verify real Google admission. Tests use
isolated synthetic data only. All external actions are pinned to full commits.

## Publication

Publication requires `main`, every check above and repository variable
`WIKICONTEXT_DEMO_PUBLISH=true`. Each architecture is built on its native runner
and pushed by digest; `demo_manifest` verifies the workflow revision is current
`main`, then publishes `ghcr.io/pocketcontext/wikicontext-demo:latest` and
`sha-<full commit>` from exactly those two digests. It records the immutable
index digest in the job output, summary and `demo-image-metadata` artifact.
Pull requests and other branches validate but cannot publish or deploy.

## Restricted demo CD

`demo_deploy` runs after `demo_manifest` only when
`WIKICONTEXT_DEMO_DEPLOY_ENABLED=true` and `WIKICONTEXT_DEMO_DEPLOY_PAUSED` is not
`true`. It uses the GitHub environment `pocketdeploy-v1`, restricted to `main`,
with `SERVER_IP`, the configured operator `SERVER_USER`, verified
`SSH_KNOWN_HOSTS` and repository-specific restricted `SSH_PRIVATE_KEY`.
Workflow and deployment concurrency never cancel an active release.

Immediately before SSH the workflow rechecks current `main`. The forced-command
key accepts no remote command and empty standard input: it triggers standard
PocketDeploy reconciliation of the host's configured application. No image request,
registry credentials, shell scripts, archives or application secrets are sent.
The host resolves its configured `latest` image to a digest at pull time and
returns exactly `{"ok":true}`. This receipt confirms reconciliation, not a specific
workflow revision; a newer validated image may have superseded the trigger.
There is no application-specific host dispatcher or external prepare/commit flow.
ONCE automatic updates and whole-volume backups stay disabled; PocketDeploy owns
stop-first delivery, and the application supervisor owns upgrades and daily reset.

Public attestation reads the ready runtime revision from `/up` and requires the
triggering revision or a descendant verified through GitHub's compare API. A newer
revision must also be an ancestor of, or equal to, the current `main` commit;
lookup failures fail attestation. It validates today's UTC generation and installation contract against that revision's published launcher,
and compares legal pages against that revision's source. It pulls the release's
`sha-<revision>` image, validates its OCI revision, extracts generated React assets
without running the image, and compares every served asset byte for byte. It also
requires rejection of anonymous `/api/context/schema`, no redirect to another
origin, and unchanged runtime identity after verification. It does not perform
Google sign-in or prove backup durability. `/up` alone is not release attestation.

No automatic rollback occurs; investigate durable state before retrying a failed
upgrade. Main-revision checks reject stale reruns but do not lock Git refs;
host-local locks are not distributed fencing; Litestream is asynchronous.

Old `deploy/install.py`, `deploy/deploy-wikicontext.py` and
`deploy/bootstrap-wikicontext.py` fail closed. New provisioning, storage, OAuth,
DNS and GitHub environment creation require separate explicit authorization.

Validate after workflow changes:

```sh
python3 tests/deploy_workflow.py
actionlint .github/workflows/image.yml .github/workflows/test.yml
```

Base images are pulled from Docker Hub by digest, as upstream does. The
VaultContext demo additionally mirrors its bases into its own GHCR namespace;
adopting that here is optional and would need its own `mirror-bases.yml`.


The application gate also copies the released demo launcher outside the checkout
and exercises its published package with a fresh uv cache, both normally and
with tracing. Source-package checks do not substitute for this release check.
