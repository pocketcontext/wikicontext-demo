# WikiContext Demo deployment record

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
