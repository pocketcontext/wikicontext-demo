# Audit follow-up — 11 October 2026

This records local remediation of the workspace audit at `66cc1a6`. No live
service, provider storage or production data was accessed by these checks.
Local test success does not establish complete security or deployed behavior.

## Lifecycle, withdrawal and delivery

- **H1 / L5:** health probes are spaced two seconds apart; successful probes
  clear the consecutive-failure count. The scheduler rechecks UTC generation
  after a probe, so a midnight crossing takes the reset path. Three consecutive
  same-day failures drain writers and exit with failure instead of leaving a
  live blocked scheduler. Restart uses existing durable fences; it cannot bypass
  an interrupted release, adoption or reset. Container-manager restart behavior
  remains an operational prerequisite. No monthly failure frequency is inferred
  from the synthetic reproduction.
- **M1:** enrollment offers a saveable private fragment link. Opening it removes
  the capability from the active history entry and requires explicit anonymous
  POST confirmation. It does not withdraw merely by opening a URL. The page
  works independently of login and the daily generation when service is
  available; reloading the scrubbed URL explains how to reopen the saved link.
  Privacy wording describes this behavior and does not promise email delivery.
  Operator details, processors, transfers and other outstanding legal review
  remain owner decisions; this change supplies no legal approval.
- **M2:** attestation requires the triggering revision or a GitHub-verified
  descendant that is also an ancestor of current main. Older, divergent,
  off-main and unverifiable revisions fail. Running-image, assets and installation
  checks remain in place.
- **L4:** the nginx gate denies the admin UI and superuser collection routes by
  both name and the pinned server's collection ID. Ordinary users' authentication
  routes remain available. Real-nginx tests cover normalized encoded paths too.

## Process identity separation

- **M3:** ONCE application and retained-contact processes now run as separate
  unprivileged UID/GID 10001 and 10002, with private runtime/persistent directories,
  no supplementary groups or capabilities, and `no_new_privs`. Root controller
  configuration and the control socket remain inaccessible to both identities.
  The application can read the root-owned reset marker through group traversal
  but cannot modify or replace it. Its Litestream configuration and socket live
  in its private runtime directory. Ingress temporary files and PID live under
  root-controlled storage rather than shared predictable `/tmp` names.
  Root guardians retain writer leases, forward signals and reap adopted children;
  application/contact children and ingress never inherit the lease descriptor.
  Timed-out commands drain their child instead of killing only the guardian.
  Stopped-volume ownership migration uses descriptor-relative operations and
  refuses links/unsafe file types while preserving file bytes. Mandatory image
  tests exercise these boundaries. This is process/filesystem separation within
  one container, not kernel isolation; application access to its authorized
  contact-service API and root controller privileges remain intentional.

## Backend hardening

- **L2:** `textBytes` now includes source metadata, run keys/descriptions/issues,
  citation notes, page slugs and rendition metadata, in addition to existing
  passage/revision fields. Mutable run fields charge positive UTF-8 byte growth;
  shrinking fields does not refund previous usage. Status-only publication does
  not charge unchanged text again. Accounting remains in the write transaction.
  The operations guide distinguishes counted text/original limits from complete
  storage capacity: generated manifests, audit, indexes, WAL and replicas remain
  additional capacity requirements. Existing generations retain their prior
  counters; the next daily reset starts complete accounting from zero.
- **L6:** pre-enrollment exemptions specify HTTP method and exact route, including
  only the authenticated caller's own account record. Future user/demo routes do
  not inherit a broad exemption. Collection authorization still applies.
- **L1 remains a distributed-operation limitation:** explicit contact preferences
  commit before the wiki enrollment transaction. If enrollment fails, consent
  may already be saved and the revision may have advanced. The historical
  `enrollment` security event records an attempt, not proof of successful access;
  code comments and operations documentation now say so. Read enrollment and
  preferences before asking the visitor to retry; never blindly replay opt-ins.
  Reordering these commits would merely reverse the partial failure. An
  idempotent reconciliation/outbox protocol requires separate implementation.
- **L3 remains:** filename/MIME declarations reject advertised audio/video but do
  not identify disguised contents. The server never transcribes and uploaded
  bytes remain bounded by the original-file quota. Comprehensive format
  validation needs a defined accepted-format policy and compatibility tests;
  no incomplete signature detector was added.
- **M4 remains:** the daily 200-account cap limits resource consumption, not fair
  access. A distributed set of verified identities can exhaust it. Hourly
  reservations or queues also deny legitimate visitors; their admission policy
  and operator alert destination need an explicit decision. No new arbitrary
  hourly cap or outbound alert was introduced.

## Validation

The backend fixture uses synthetic Google identities, a local synthetic contact
service and isolated temporary databases. The server binary was built from a
`git archive` of exact pinned server revision
`dc1dc6b0e88bbc46f36fa8441c8f6959bada4732` rather than inferred from timestamps.

- `python3 -m unittest discover -s tests -p test_demo_admission_paths.py`: passed.
- `python3 tests/demo_backend.py --binary PINNED_BINARY`: passed, including
  existing consent/admission, space isolation, generation fences and quota tests,
  plus new own-account admission checks, multibyte metadata/citation limits,
  mutable-run growth/shrink semantics and rollback after quota refusal. A
  fixture-only enrollment failure proves contact consent/revisions can persist
  while wiki access remains closed, stale retries conflict, and a fresh explicit
  withdrawal still records correctly. The fixture also asserts the pinned
  superuser collection ID used by the public gate to catch alias drift.
- All 17 README server integration suites passed: integration, spaces, auth,
  OAuth, realtime access/publication, publication review, search, home,
  properties, deploy, maintenance, skill, tracing, knowledge, ingest and export.
  The copied skill additionally passed with `--trace`.
- Launcher, entrypoint, OAuth client, client, knowledge, ingest, exporter,
  repository files, bootstrap, deployment workflow and migration-tool checks
  passed after installing the local client package.
- Go supervisor tests passed with Go 1.27.1. Demo lifecycle discovery passed
  129 tests with eight host skips (seven require root, one requires nginx), using
  the pinned server and Litestream 0.5.17. The seven root privilege checks and
  nine real-nginx checks passed separately in isolated local containers.
- The complete source Dockerfile built successfully on native ARM64, including
  the reader checks and compatibility validation. The final local image
  `wikicontext-demo:audit-full` passed the seven installed privilege tests,
  native ONCE bootstrap, exclusive volume and graceful shutdown checks, and
  populated standard lifecycle tests: fresh initialization, stop-first upgrade,
  same-revision restart, recovery, protected originals, retained withdrawn
  contacts and overlap rejection. A derived image was used during development;
  these final results use the full source build. Inherited configuration, smoke
  and complete object-storage recovery checks also passed, including strict
  replica comparison, source-volume destruction, missing/corrupt-original
  refusal and frozen maintenance restart. Test containers and volumes were
  removed. The local image has a synthetic build label and is not a release.
- Deployment workflow tests and actionlint 1.7.7 passed for both workflows.
- Node 24.21.0 / pnpm 10.33.2: UI typecheck, 97 unit tests and production build
  passed. Demo browser tests passed 8/8 and reader browser tests 11/11, including
  anonymous withdrawal, explicit confirmation, history scrubbing, reload,
  keyboard navigation and a 375px viewport.

Live Google admission, an observed UTC reset and provider-backed populated
recovery remain operational release evidence to obtain separately.
