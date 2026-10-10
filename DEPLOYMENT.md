# WikiContext Demo deployment record

**No deployment has been made from this repository.** The planned public demo
origin `https://wiki-demo.pocketcontext.com`, its Google OAuth client, DNS
record, buckets (`pocketdeploy-v1-wikicontext-demo-files`,
`pocketdeploy-v1-wikicontext-demo-replica`,
`pocketdeploy-v1-wikicontext-demo-contacts-replica`), credentials, GitHub
repository/environment `pocketcontext/wikicontext-demo` / `wikicontext-demo`,
and host dispatcher are not provisioned. The host choice and capacity assessment
remain open; these bucket names assume the proposed `pocketdeploy-v1` profile.
Local validation evidence is in [docs/demo-validation.md](docs/demo-validation.md).

This repository was forked with full history from `pocketcontext/wikicontext`.
That repository's production release records (`wiki.pocketcontext.com`, image
`ghcr.io/pocketcontext/wikicontext`, the `once-v2` environment) describe core
WikiContext, not this demo; read them in upstream history (`git log -- DEPLOYMENT.md`).
Do not use any production procedure, bucket, key or environment for the demo.

Record each future demo release here: source revision, image digest, CI run,
host receipt, generation and public checks, and what remained unverified.
