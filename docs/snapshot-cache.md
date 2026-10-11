# Demo SQL snapshot caching

The server reuses isolated requester snapshots until a committed database change
invalidates them. Authentication and demo admission remain per request. Membership
revocation and ingestion read-after-write use current data on the next request;
active readers finish on their consistent snapshot. Search keeps its independent
private index and authorization checks. No refresh API or client session is added.

The existing `maxConcurrent: 4` also bounds retained snapshots. A fifth alternating
visitor can evict a cached snapshot, and a write by any visitor invalidates all
retained snapshots. Cold reads still copy requester-visible history. Keep limits
unchanged until measured concurrency justifies tuning; production latency results
are not a demo performance guarantee. Reset stops the server, discarding its
process-owned caches before the next generation starts.

The pin changes the supervisor fingerprint even though application migrations and
contact schema are unchanged. The compatibility declaration explicitly accepts
the previous fingerprint. Release validation includes a populated predecessor
image-to-candidate replacement, all three databases, protected originals and
retained contact preferences, plus existing reset and recovery gates.

Deployment uses the demo's existing standard PocketDeploy supervisor and separate
resources. Production checkpoint scripts and indefinite production retention are
not adopted into this disposable demo.

## Local validation

All 31 backend/client/tool commands passed, including demo admission and quotas,
spaces and revocation, search, publication, ingestion/export and tracing. Lifecycle
discovery passed 143 tests with seven root-only checks skipped locally; native
container CI runs the required privilege checks. The added ingestion concurrency
test passed, including same-byte sources in separate personal spaces and lost
committed responses.

The real predecessor server-to-candidate process upgrade passed with Litestream
and all three logical database baselines preserved. Reader typecheck, 100 unit
tests, build, 11 reader browser scenarios and 12 public-demo browser scenarios
passed. Copied published launcher suites passed normally and with tracing from
unrelated working directories. Native image upgrade/recovery gates remain required
before release; these local checks do not establish live Google login or an
observed midnight reset.
