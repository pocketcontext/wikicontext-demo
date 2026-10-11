# WikiContext Demo deployment record

## SQL snapshot cache — 11 October 2026

- Source: `d7414674c5b9c4bcaa684596e4fe41da5bf35649`.
- Running image: `ghcr.io/pocketcontext/wikicontext-demo@sha256:32c6c2627a0b0568952f20041cf744de1ae05670b3fe2e979b7d848fb7019fed`.
- Native AMD64/ARM64 application, browser, container, populated predecessor
  upgrade and recovery gates passed in
  [run 38168226113](https://github.com/pocketcontext/wikicontext-demo/actions/runs/38168226113).
  Publication passed on attempt 1; restricted deployment and public asset
  attestation passed on attempt 2 after clearing the temporary delivery pause.

The server transparently reuses bounded requester snapshots and invalidates them
after committed changes. Personal-space authorization and separate private search
remain intact. Temporary snapshots live under disposable `runtime/run`, so daily
reset removes crash-orphaned files as well as normal runtime data. Native upgrade
tests verified actual warm-cache files use that directory.

Independent read-only host checks confirmed the exact image and source, active
readiness for UTC generation `2026-10-11`, all three databases, no pending lifecycle
journals, and matching baked/durable compatibility fingerprint
`e26037f163c57a83f75a10ade2f12accbae60e38defef9e2d980cf7a0ea55df7`.
The original volume `once-app-wikicontext-demo.8bbe30` remains attached to exactly
one running container with one application writer and restart policy `always`.
Delivery is enabled and `WIKICONTEXT_DEMO_DEPLOY_PAUSED` is restored to `false`.
No new infrastructure, storage or OAuth resources were created.

See [cache behavior and local validation](docs/snapshot-cache.md). No authenticated
live-demo latency benchmark, real Google sign-in, observed midnight reset or
provider-backed populated recovery is claimed by this release.

## OAuth callback fix — 11 October 2026

- Source: `9527f958673908767b86f010a35fd5facb386da8`.
- Published image: `ghcr.io/pocketcontext/wikicontext-demo@sha256:a655639f3ecfb3273c8a1c87b89d7fc48a6dbb9048456c4dd22315b2622ff161`.
- Native AMD64/ARM64 application and container checks, publication, deployment
  and public asset attestation passed in
  [run 38138806535](https://github.com/pocketcontext/wikicontext-demo/actions/runs/38138806535).

The ingress now rewrites only PocketBase's two OAuth completion redirects to
reader-owned completion pages, preserving the administration block. Completion
pages do not initialize authentication storage and attempt popup self-close.
The original tab independently completes the SDK authentication exchange.

Local validation passed 100 UI unit tests, typecheck/build, 12 demo browser tests
through generated nginx ingress, 11 reader browser tests, 10 proxy regressions,
8 deployment-workflow checks and 139 lifecycle tests (7 root-only checks skipped
locally). CI passed its complete architecture-specific release gates.

Independent public checks confirmed the exact ready revision, current UTC
generation, Google enabled and password authentication disabled. Administration
and superuser routes remained 404. An invalid-state OAuth callback redirected to
`/#/auth/oauth2-redirect-failure` instead of the blocked admin shell. Live Chromium
checks rendered both completion outcomes with HTTP 200, preserved synthetic
browser-local authentication storage, made zero API requests and reported no
page errors. No live application records were changed. Real Google sign-in still
requires an interactive user retry; synthetic OAuth coverage is not that proof.

## Audit remediation release — 11 October 2026

- Source: `9f237178a9f8187df4336962b1348b1135776b88`.
- Running image: `ghcr.io/pocketcontext/wikicontext-demo@sha256:21104253442e529f0d0e0242e43c21c32b86a5ef91927638caf81ac12d6435ea`.
- Native AMD64/ARM64 application and container checks, image publication,
  restricted deployment and public asset attestation all passed in
  [run 38137380243](https://github.com/pocketcontext/wikicontext-demo/actions/runs/38137380243).

Independent read-only checks confirmed the exact source revision, ready state,
UTC generation `2026-10-11`, Google OAuth enabled and password login disabled.
Anonymous SQL returned 401. The admin UI and superuser routes by both collection
name and ID returned 404. Privacy, terms and legal CSS matched source bytes;
CI additionally compared generated frontend assets with the released image.

Allowlisted host inspection confirmed restart policy `always`, application
process UID/GID 10001 and contact process UID/GID 10002. The existing named
volume and application identity were retained. No infrastructure, storage or
OAuth resources were created by this release.

See [audit follow-up](docs/audit-2026-10-11-followup.md) for fixes, test evidence
and remaining consent/admission/upload-policy limitations. External Google
sign-in, an observed midnight reset and provider-backed populated recovery
remain unverified; these release checks do not claim that evidence.

## Initial live deployment — 11 October 2026

`https://wiki-demo.pocketcontext.com` is live on the existing `pocketdeploy-v1`
OCI host alongside Vault Demo, using the application-owned supervisor and
standard PocketDeploy stop-first delivery. No custom host dispatcher is installed.

- Source: `219c8804de668a179ddc0ec270136e1467867847`.
- Image: `ghcr.io/pocketcontext/wikicontext-demo@sha256:68bab77b5e3f29f710e41291a1ef5ecca09ae3f99dcd1a58717bef177fc2bef6`.
- Native application/container CI: [successful run 38126921270](https://github.com/pocketcontext/wikicontext-demo/actions/runs/38126921270).
- Dedicated initialized volume: `once-app-wikicontext-demo.8bbe30`.
- Three private EU buckets with independent scoped credentials:
  `pocketdeploy-v1-wikicontext-demo-files`,
  `pocketdeploy-v1-wikicontext-demo-replica`, and
  `pocketdeploy-v1-wikicontext-demo-contacts-replica`.

Public attestation passed: ready revision, current UTC generation, stable runtime
identity, HTTPS without redirects, byte-equal released React assets and legal
pages, expected agent installation, and anonymous SQL rejection. Public auth
metadata confirms Google OAuth is enabled and password authentication disabled.
The released image digest matches the tested image. These are public read checks,
not proof of a completed Google sign-in.

The operator confirmed the operator/contact details and quotas. Vault Demo remained
healthy on its existing revision. Publication and CD are enabled and deployment is
unpaused through the repository-specific `pocketdeploy-v1` GitHub environment.
The profile reconciled to configured `latest` without replacing the running image;
the next source push exercises the complete publication and restricted CD path.

Real Google sign-in, an observed midnight reset and a provider-backed populated
recovery drill remain unverified. Synthetic recovery, reset and browser tests do
not substitute for those operational checks.

See [validation evidence](docs/demo-validation.md),
[standard supervisor](docs/standard-supervisor.md) and
[deployment procedure](docs/deployment.md). Core WikiContext production remains
independent; its source, images, OAuth, storage and release controls must not be
used for this disposable demo.
