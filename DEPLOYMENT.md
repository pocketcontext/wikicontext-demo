# WikiContext Demo deployment record

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
