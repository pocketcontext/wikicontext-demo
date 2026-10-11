# Application-owned standard supervisor

The ONCE image keeps application-specific lifecycle code in this repository.
`supervisor/cmd/demo-supervisor` builds a Go executable alongside the normal
PocketContext binary from `POCKETCONTEXT_VERSION`. It does not embed PocketContext
internals or call Docker, ONCE, PocketDeploy or GitHub.

With `WIKICONTEXT_DEMO_ONCE=true`, tini starts the entrypoint, which execs Go.
Go starts the Python storage worker and owns signal forwarding, its process group,
the readiness listener and an 850-second total shutdown deadline. Configure the
host's stop timeout to at least 900 seconds. Worker subprocess output is suppressed;
failures report fixed diagnostics rather than credentials or child output.

The worker in `deploy/demo/once_runtime.py` retains database, contact, replication
and UTC-reset mechanics. It holds the exclusive volume lock for its lifetime;
the directly managed application and contact supervisors inherit that lock. Three databases and existing volume layout stay
unchanged: disposable `runtime/pb_data/data.db` and `auxiliary.db`, retained
`persistent/contacts.db`, and private durable `control/` state. The Go wrapper does
not replace Litestream or the tested Python storage helpers.

## Startup and upgrades

Startup closes ingress before examining private configuration and operation
markers. Existing `control/runtime.json` remains authoritative. A complete set of
environment bindings can establish configuration for a genuinely fresh volume,
or confirm an identical existing binding. Partial or conflicting bindings fail;
ordinary deployment cannot silently change storage or OAuth configuration.

`deploy/demo/compatibility.json` declares a server/migration/contact-schema fingerprint and
explicitly accepted predecessor fingerprints. Build-time verification compares
the declaration with `POCKETCONTEXT_VERSION`, migration filenames/content and
`deploy/demo/retention.py`, which owns the retained contact schema.
Changing those inputs requires a reviewed compatibility declaration. This fresh
demo accepts no legacy revisions without a fingerprint; incompatible predecessors
remain fenced rather than receiving an implicit migration.

An upgrade records a private, fsynced `control/upgrade-pending.json` before starting
writers. It includes source/target identities, schema identity, phase and a logical
baseline of all three databases. The worker starts the candidate while ingress
is closed, verifies replication, current generation and preserved records, then
commits durable state before opening traffic. A changed image revision alone
does not authorize arbitrary migration. Unsupported predecessors stay fenced.

The `prepared` and `validated` journal phases have explicit restart paths.
`starting` is intentionally ambiguous: migrations may have committed, so startup
stays fenced for operator recovery. There is no automatic rollback, journal
deletion to force retries, or restart of old code over a changed database.

If a compatible startup encounters an expired UTC generation, reset removes
disposable databases/originals/replicas and retains contacts under their separate
policy. The reset's own durable marker fences interruption. Expired or interrupted
operations never receive another day of public access merely because deployment
crossed midnight.

Fresh initialization, missing-state recovery and existing-volume migration remain
distinct. An unconfigured volume exposes private control only; readiness fails.
Explicit initialization uses the private control `initialize` operation on an empty
installation with no prior durable state; it requires empty primary object storage
and no unfinished uploads, and does not purge remote storage. Application and
contact initialization refuse populated replicas. Missing/corrupt state, partial
databases, pending legacy releases or incomplete resets require recovery
review. Do not initialize or restore over an existing deployment to bypass them.

## Readiness and shutdown

The public nginx gate proxies `/up` to Go's loopback readiness endpoint. Success
requires the worker to report ready in today's UTC generation; the JSON response
contains `ready: true` and the baked application `revision`. Unconfigured, fenced,
stopping and stale-generation states are not ready. Other public routes remain
closed until the worker has completed verification. A process merely being alive
is insufficient for deployment success.

On termination, Go stops reporting ready and asks the worker to drain. The worker
closes public ingress and gracefully stops application and contact processes,
including their replication supervisors, before releasing the volume. A deadline
or failed drain produces a failed exit, which stop-first delivery must reject.

## Standard delivery

The private `pocketdeploy-v1` repository declares this application with stop-first
delivery, 900-second stop/readiness budgets and independent DNS. This is a fresh
installation: start normal convergence, then explicitly initialize the new
application through its private control before readiness times out, as described
in [deployment procedures](deployment.md). No legacy host dispatcher or adoption is required.

A repository-specific restricted GitHub key triggers host reconciliation. The
host selects its configured image at pull time; CI verifies the actual running
revision's generated assets, legal pages and installation contract. The old
prepare/validate/commit controls are unavailable in standard mode; historical
helpers remain only for legacy test and recovery context.

## Validation

Run Go tests from `supervisor/` and the README's complete application validation.
Additional synthetic runtime checks:

```sh
python3 deploy/demo/verify_compatibility.py deploy/demo/compatibility.json
python3 -m unittest discover -s tests -p test_demo_standard_runtime.py
WIKICONTEXT_TEST_BINARY=/path/to/pinned/pocketcontext \
WIKICONTEXT_TEST_LITESTREAM=/path/to/pinned/litestream \
  python3 -m unittest discover -s tests -p test_demo_standard_runtime.py
```

Container config, smoke, exclusive-volume startup, standard replacement and
populated recovery remain release gates. Mocked state tests alone do not establish
real storage or provider recovery.
