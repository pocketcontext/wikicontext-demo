# Dedicated demo repository

`pocketcontext/wikicontext-demo` (planned; not yet created on GitHub) owns the
public disposable WikiContext demo, with `main` as its release branch. It was
forked locally with the full history of `pocketcontext/wikicontext`; the local
upstream remote is named `upstream-local`. The client command and skill remain
`wikicontext`; repository ownership does not rename the user interface.

The demo has independent CI, image publication (`ghcr.io/pocketcontext/wikicontext-demo`)
and deployment controls (GitHub environment `wikicontext-demo`, restricted to
`main`, with its own forced-command key). The skill installs from
`https://github.com/pocketcontext/wikicontext-demo/tree/main/skills/wikicontext`.
Core WikiContext production remains independently owned by `pocketcontext/wikicontext`
and its `once-v2` deployment; this repository contains no path to it.

Demo-only additions: `pb_hooks/demo*.js`, `pb_migrations/1791600000_demo.js`,
`deploy/demo/`, `docker/once_smoke.py`, the demo entrypoint modes, `legal/`, and
`tests/demo_*.py`/`tests/test_demo_*.py`. The personal/group spaces data model
(`pb_hooks/spaces.js`, migration `1791500000`) and requester-filtered SQL are
fork changes that upstream may or may not adopt.

## Upstream maintenance policy

Core WikiContext remains the upstream for shared ingestion, publication,
citation, authentication, client, entrypoint and storage fixes. Before each demo
release, review upstream changes since the last reviewed commit, cherry-pick
applicable fixes with their original reference (`git cherry-pick -x`), and record
excluded changes and compatibility rationale in the release review. Never merge
upstream production deployment configuration (workflows, `once-v2`
environment, `wiki.pocketcontext.com`, production buckets or image names), and
never relax demo enrollment, daily reset, quota, audio or group-space restrictions
as an incidental fix. `tests/deploy_workflow.py` rejects production references.

Review demo changes to shared code for upstream adoption in the same release
review, especially security fixes (for example the entrypoint's primary/replica
separation and remote-original length check, and the case-insensitive subject-bound
Google admission). Do not merge demo enrollment, daily deletion, contact retention
or personal-space-only policy into core as incidental fixes. Validate both
applications independently with their pinned servers and synthetic data; a
passing demo suite does not establish core compatibility. Each repository
publishes and verifies its own client pin; publish package changes before
advancing the portable launcher pin, and verify the copied launcher from an
unrelated directory.

Shared lifecycle code (`deploy/demo/`, demo entrypoint modes) is ported from
`pocketcontext/vaultcontext-demo`. Review its security fixes for adoption here
and vice versa, recording the source commit.

## Initial publication checklist (requires explicit authorization)

1. Create the public repository and push `main`; keep the `upstream` remote for reviews.
2. Configure the `wikicontext-demo` environment restricted to `main`; keep
   `WIKICONTEXT_DEMO_PUBLISH` and `WIKICONTEXT_DEMO_DEPLOY_ENABLED` unset until
   native CI passes.
3. Provision the OAuth client, DNS record, three buckets and three credentials;
   register each as WikiContext resource/credential entity pages.
4. Write, review and install the WikiContext demo dispatcher and key on the host.
5. Configure and `initialize` the ONCE volume, then enable publication and CD.
