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
and the inherited configuration, smoke and MinIO object-storage recovery gates.
Application validation includes space roles and revocation, the reader browser
suite, and public-demo onboarding with a synthetic Google provider and real
enrollment APIs. The browser receives a synthetic session; this does not verify
the external Google popup. Tests use isolated synthetic data only. All external actions are pinned to full commits.

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
`true`. It uses the fixed GitHub environment `wikicontext-demo`, which must be
restricted to `main` and hold variables `SERVER_IP`, `SERVER_USER=deploy`,
`SSH_KNOWN_HOSTS` and secret `SSH_PRIVATE_KEY` for a dedicated forced-command
key. No production or VaultContext demo key is reused. Workflow and deployment
concurrency never cancel an active release.

Immediately before SSH the workflow rechecks current `main`. The key accepts no
remote command; standard input is one bounded JSON object `{"image":"ghcr.io/pocketcontext/wikicontext-demo@sha256:<64 hex>","revision":"<40 hex>"}`
taken from `demo_manifest`, never a mutable tag. No registry credentials, shell
scripts, archives or application secrets are sent. The host dispatcher (not in
this repository; to be modelled on `scripts/vaultcontext_demo_dispatch.py`) uses
the ONCE CLI for the fixed `wiki-demo.pocketcontext.com` application: control
`status` and `prepare-release` through `once exec … python3 /usr/local/bin/wikicontext-demo-once.py control`,
`once stop`, `once update --image <digest> --auto-update=false --auto-backup=false`,
then `validate-release` and `commit-release`, attempting `abort-release` on
failure. It must return exactly `{"image":…,"revision":…,"ready":true}`; any
other receipt fails the workflow. Whole-volume ONCE backups stay disabled
because they would retain disposable wiki data alongside durable contacts.

The final public check requires today's UTC generation, `clientReady`, the exact
installation contract from the packaged launcher, byte-equal legal pages
(`/terms/`, `/privacy/`, `/legal/legal.css`), a reader root, and rejection of
anonymous `/api/context/schema`. It does not perform Google sign-in or prove
backup durability. No automatic rollback occurs; investigate the host's durable
state before retrying. Main-revision checks reject stale reruns but do not lock
Git refs; host-local locks are not distributed fencing; Litestream is asynchronous.

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
