# WikiContext Demo deployment record

## Release preparation — 11 October 2026

Target: `https://wiki-demo.pocketcontext.com` on the existing `pocketdeploy-v1`
OCI host alongside Vault Demo. Host reachability and initial capacity checks
passed; the existing Vault Demo remained healthy. The operator confirmed the
operator/contact details and quotas. Dedicated Google OAuth values are saved
privately; real sign-in remains unverified.

This release uses an application-owned standard supervisor and ordinary
PocketDeploy stop-first delivery. No custom host dispatcher is required.
The repository's publication switch is enabled for gated native builds; automatic
deployment remains disabled and paused until first-install verification.
Three independently scoped EU buckets are planned:
`pocketdeploy-v1-wikicontext-demo-files`,
`pocketdeploy-v1-wikicontext-demo-replica`, and
`pocketdeploy-v1-wikicontext-demo-contacts-replica`.
Provisioning and live activation are not yet recorded as complete.

See [validation evidence](docs/demo-validation.md),
[standard supervisor](docs/standard-supervisor.md) and
[deployment procedure](docs/deployment.md).

Core WikiContext production remains independent. Its source, images, OAuth,
storage and release controls must not be used for this disposable demo.

Record the published source revision, image digest, native CI, initialized named
volume, generation, public checks and remaining limitations after activation.
