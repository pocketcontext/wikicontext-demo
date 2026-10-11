# Dedicated demo repository

`pocketcontext/wikicontext-demo` owns the
public disposable WikiContext demo, with `main` as its release branch. It was
forked locally with the full history of `pocketcontext/wikicontext`; the local
upstream remote is named `upstream-local`. The client command and skill remain
`wikicontext`; repository ownership does not rename the user interface.

The demo has independent CI, image publication (`ghcr.io/pocketcontext/wikicontext-demo`)
and deployment controls (GitHub environment `pocketdeploy-v1`, restricted to
`main`; a repository-specific forced-command key triggers standard reconciliation). The skill installs from
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

1. Completed 10 October 2026: created the public repository and pushed `main`;
   local `upstream-local` remains available for upstream reviews.
2. Completed 11 October 2026: standard delivery uses the main-only
   `pocketdeploy-v1` environment, with publication and CD enabled and unpaused
   after native CI and first-install checks.
3. Completed 11 October 2026: separate OAuth configuration, DNS, three private EU
   buckets and scoped credentials are provisioned. WikiContext catalog references
   are maintained separately from this public source record.
4. Standard PocketDeploy delivery uses a repository-specific restricted key.
5. The fresh application was explicitly initialized and deployed; public
   attestation passed. Real Google sign-in, midnight observation and provider-backed
   populated recovery remain outstanding; see [deployment evidence](../DEPLOYMENT.md).

## Release review: standard delivery, 11 October 2026

Core WikiContext reviewed through `7cf5d4548fd22a7cb250adbd4034f1060c9bd53e`,
which is also this fork's upstream merge base: no later local upstream changes
were pending. Remote `main` was checked with `git ls-remote` on 11 October 2026
and matched both reviewed revisions. Production deployment remains excluded.

VaultContext Demo reviewed through `194f72490fd27558fadacb20e58d93a981ebc76c`.
Adopt application-owned standard supervision from `153a3a7` and verified proxy
header handling from `194f724`, preserving WikiContext's independent schema,
three-database lifecycle and original-file checks. Browser popup cancellation,
timeout and late-session handling affect shared authentication and should be
reviewed independently for core WikiContext adoption; demo enrollment and reset
behavior remain fork-only. Passing demo validation does not validate core.

## Cache adoption review — 11 October 2026

Reviewed core WikiContext through `be8e301` and adopted the applicable server-pin,
schema-reference and ingestion-concurrency changes from `c923e21`. The demo adds
personal-space cache isolation coverage and an explicit predecessor compatibility
declaration. PocketContext is pinned to `4b03d2905a34d9a606cb313e118d6874e74f0548`
(the exact authoritative value is in `POCKETCONTEXT_VERSION`).

Production Company-space policy, populated production migrations, ONCE checkpoint
tools, production workflows and retention rules are excluded. Demo enrollment,
personal-space defaults, quotas, audio restrictions, UTC reset and separately
retained contacts remain unchanged. No portable-client behavior changed, so its
existing published launcher pin remains; both copied-launcher modes are validated.
