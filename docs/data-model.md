# WikiContext contract

Knowledge is partitioned into spaces. Every admitted default `users` identity has one private personal space. SQL, REST, realtime and protected file downloads each enforce space membership independently. Account administration remains operator-only. Sources do not confer permission to execute their contents.

## Spaces and membership

`spaces` records have `kind` (`personal` or `group`), `name`, `created_by`, `revision` and timestamps. `space_members` records have `space`, `account`, `role` (`owner`, `editor`, `reader`), `active`, attribution and `revision`; each space/account pair is unique. A personal space has exactly one active owner membership, its account; a partial unique index allows one personal space per account. Group spaces require at least one active owner.

Personal spaces only at launch; group spaces are a later enablement. The data model, API rules, SQL filters and tests fully support group spaces, but ordinary REST callers cannot create spaces or change memberships (collection create/update rules are superuser-only and deletion is rejected). `pb_hooks/spaces.js` exports the guarded enablement functions `createGroupSpace(app, actorId, name)` and `setMembership(app, actorId, spaceId, accountId, role, active, expectedRevision)`; only an active owner may change group membership, a group cannot lose its last active owner, and changes are revision-checked and audited. No route exposes them yet. Trusted superuser REST writes to `spaces`/`space_members` go through the same validation for test fixtures and operator maintenance.

`ensurePersonalSpace(app, accountId)` is idempotent and transactional: it returns the account's personal space ID, creating the space and its owner membership (audited with actor type `system`) when absent, and throws for missing or disabled accounts. It runs after every successful sign-in (password, OAuth and refresh) and when a user creates a root record without a `space`. Admission flows may call it directly at enrollment.

The spaces migration (`1791500000_spaces.js`) refuses a database that already contains knowledge records; the demo starts empty and never guesses owners for shared historical data.

Every domain record — sources, renditions, passages, ingestion runs, pages, page revisions, citations, page links, publications and audit entries — carries an immutable required `space`. Sources, runs and pages take it from the request (defaulting to the actor's personal space for users; superusers must supply it). The hook verifies the actor is an active owner or editor of that space before any other validation. Renditions, passages, revisions, citations and links inherit their parent's space; a supplied value must match. Every reference — supersedes, run sources, home, revision page and base, citation passage, link target, exact-copy `source_id`, sync revisions and relationship targets — must belong to the same space. Absent records, foreign records and inaccessible spaces return the same HTTP 404, so a rejected request does not reveal whether another space's record exists. Readers receive 403 on writes to a space they can read.

Read rules on every domain collection (list, view, realtime and protected files) require an active membership row of the record's space:
`@collection.space_members.space ?= space && @collection.space_members.account ?= @request.auth.id && @collection.space_members.active ?= true`
(one shared join, so all conditions apply to the same membership row). Update rules use the same predicate and the hook enforces the writer role. Deactivating a membership removes access on the next request, realtime delivery or file download; tokens issued earlier carry no space grant.

Authenticated SQL uses filtered snapshots. Each output table is filtered by `EXISTS (SELECT 1 FROM space_members m WHERE m.space = <table>.space AND m.account = :requester AND m.active = 1)`; `spaces` uses its `id`, and `space_members` shows memberships of spaces where the requester is active. `user_directory` exposes only the requester and active co-members of a shared space, and is not REST-readable. SQL aggregates describe the requester's visible rows only.

## Authority and provenance

Sources store immutable protected original bytes and server-computed SHA-256. Identical bytes deduplicate within a space; the same bytes in another space are a separate source. `supersedes` identifies an earlier source without deleting it. Names and source dates are evidence metadata, not identifiers or proof of freshness. Renditions identify extraction/transcription versions; ordered immutable passages contain bounded text and locators. Adding a new extraction preserves the earlier one. Audio ingestion defaults to storing normalized mono Opus `.ogg` bytes (16 kHz encoder input, 16 kbps) as the immutable source and sends those same bytes to the configured Groq transcription service. The local recording remains intact; `--audio-storage original` instead preserves its input bytes on the server and transcribes a temporary derivative. The normalized Ogg embeds input hash, conversion profile and converter version before transcription succeeds. Private cache metadata and later rendition notes also retain the input filename and conversion settings. Normalization selects the first audio stream and discards video. Private cached normalization supports retries across failures and encoder upgrades; without that cache different encoder builds may produce different source hashes. Ingestion authorizes the configured Groq transcription service. No real sources are processed during implementation tests.

Reviewed image ingestion preserves original static PNG/JPEG/WebP bytes. An `image-review` rendition records its processor and version; JSON notes bind the review to the image SHA-256, format, encoded dimensions and review digest. Optional `related_source` and `sequence` notes identify a supplementary source and ordering, not a server-enforced relationship or recording timestamp. Use these notes to supplement audio without `supersedes`. Passage locators record a transcription, description or caption kind and a pixel region in the original encoded orientation before EXIF rotation. Corrections create a new rendition version; earlier evidence remains immutable. No schema migration or automated OCR service is required.

Pages have immutable stable slugs, unique within their space, and kinds. Each immutable page revision belongs to one staging ingestion run and records its expected previously published revision ID, title, summary, prose, archive flag, flat `properties` and `property_evidence`. Citations connect numbered inline markers to immutable source passages. Page links connect a revision to stable page IDs. Sources and relationships are authoritative in the database; Markdown is generated presentation. Factual synthesis remains agent work; structural validation does not establish factual truth.

## Publication

Runs have caller-supplied idempotency keys, unique within their space, and status staging, published or cancelled. Only staging runs can change. Content revisions, citations and links may be added while staging; mistakes are corrected by cancelling the run and staging a replacement. Closed run content is immutable. A revision is not current merely because it exists.

A revision-checked REST PATCH transitioning a run to published validates all staged revisions and publishes one immutable manifest of the run's space, mapping every page ID to its selected revision ID. Publication sequences increase per space. The hook compares each staged base revision against the latest committed manifest of the same space within the same transaction; publications in other spaces never conflict. Conflicts return 409; the agent must reread and reassess in a new run. Publication, run state, manifest and audit commit together. A page archive remains in the manifest as history but is omitted from rendered pages. Publication rejects broken links, absent citation targets, unmatched citation markers and wholly uncited prose unless marked `[needs verification]`. Claim-level evidentiary support requires semantic review.

Each publication also stores an optional home page ID, outside its unchanged manifest. Staging runs select `home` or `clear_home` (never both), and record `home_base`, the home ID expected when the choice was staged; empty means no selected home. Publication compares that base with the space's latest publication inside the transaction and returns 409 on disagreement. Reassess explicitly after a conflict; never refresh the base automatically. Runs without a home choice carry the prior home forward. Home-only runs are permitted. The resulting home must be present and unarchived in the new manifest, so archiving it requires a replacement or an explicit clear in the same run. Existing publications have empty home values after migration. The reader keeps `#/` as the dynamic home route, resolves historical routes against their selected publication, and opens the built-in welcome index when home is empty. Explicit page links remain stable. Immutable publications retain published home choices; run audit entries also retain staged home, expected base and clear choices.

A run may contain up to 100 source references. Skill ingestion schedules groups of five sources; batches are a workflow boundary, not a 20-request API transaction. The database may stage many separate writes. Publication scans the space's full current link graph, bounded to 10,000 page identities per space; load tests are required before raising this initial budget. The manifest is bounded to 8 MiB; client SQL response limits may become the tighter constraint. Export fails closed on truncated results. No automatic performance claim beyond the tested synthetic corpus is made.

All ordinary updates carry expected_revision. Other domain records are immutable, and ordinary and superuser record deletion are rejected. Server-owned attribution and compact audit entries track changes; full source/page content remains in immutable records rather than being duplicated in audit. Administrative collection/schema maintenance remains trusted.

## Queries and export

Knowledge retrieval uses authenticated /api/context/schema and /api/context/query (filtered snapshots), including exporter reads. Ranked published-page search uses the separate /api/context/search endpoint with an explicit publication scope; the server derives a private index from the requester's visible rows (see [search](fts-adoption.md)). Original file retrieval uses the protected PocketBase file API. SQL columns are explicitly allowlisted; users, credentials and SQLite metadata are excluded. Questions search published pages through the selected space's latest manifest, then source passages; drafts must be selected explicitly and identified as drafts.

To list the requester's spaces with roles: `SELECT s.id, s.kind, s.name, m.role FROM spaces s JOIN space_members m ON m.space = s.id WHERE m.account = :me AND m.active = 1` (the client obtains its own account ID from `auth-refresh`; the personal space is also `SELECT id FROM spaces WHERE kind = 'personal'`, which returns exactly one row). The latest publication per space is `SELECT p.* FROM publications p WHERE p.sequence = (SELECT max(sequence) FROM publications q WHERE q.space = p.space)`.

The exporter pins one immutable publication of the selected space, follows its immutable revisions and evidence, and renders a vault root containing wiki/ and raw/. It does not invoke an LLM. Source names are sanitized for presentation and disambiguated by IDs. The generated ownership manifest identifies files eligible for replacement/removal; local edits, unsafe paths and symlinks must fail before replacement. Obsidian settings and unrelated user files remain outside the exporter’s ownership. An exported original is a local copy; revoking server access cannot revoke that copy.

## Recovery and scope

The browser reader selects the same immutable publications as the exporter.
Realtime events invalidate its view; authenticated SQL supplies content, and all
page, citation and backlink reads remain pinned to one publication. Historical
views stay pinned. Browser rendering never ingests Markdown or changes records.

The production container stores immutable originals in a dedicated private S3 bucket. Litestream recovers SQLite and startup verifies every referenced remote original by its recorded hash before admitting traffic. Local-original archives are historical recovery artifacts and are no longer produced or restored by the container. Recovery requires both services and retained objects. No direct SQLite business writes or migrations ingest knowledge. Tests use isolated synthetic data.

Initial scope: text/Markdown/PDF/audio and reviewed-image ingestion helpers, agent synthesis and question workflows, revisioned publication, citations and links, structural lint, deterministic Obsidian export, auth and recovery preparation. No automatic web crawling, background autonomous LLM service, native vector dependency, two-way Obsidian synchronization, external messaging, cloud provisioning or real-data migration is included in this local implementation.

## Search

The shared all-space FTS5 table, its `search_state` generation record and the
operator rebuild route are removed (the spaces migration drops them). Private search
builds per-requester indexes from visible page revisions; see [search](fts-adoption.md).

## Revision properties and catalogs

Properties belong to immutable revisions, so publication, conflict checks, history
and export select exactly the same values as the page body. Older revisions have
empty properties. No migration classifies or rewrites existing wiki content.
Use `catalog_type` (`resource`, `credential`, `deployment`, `person`, `group`,
`repository_document`, `repository_destination`, or `repository_sync`) on entity pages to
opt into the catalog reader. Other page kinds and uncategorized pages still work.

`properties` is a JSON object of at most 64 lowercase snake_case keys (1–64 ASCII
characters, starting with a letter). Values are null, booleans, finite numbers
within JavaScript's safe-integer magnitude, strings up to 2,048 characters, or
lists of up to 100 unique strings. Nested objects and mixed-type arrays are
rejected. Identity, revision, content and export system names are reserved.
The JSON field is limited to 65,536 bytes. Keep types consistent across pages.
Use null for an unknown value; distinguish absence of evidence from a confirmed
negative with a separate observation property (for example `expiry_observation`).

`deployment_profiles`, `applications`, `resources`, `credentials`, `consumers`,
`replaces` and `replaced_by` are relationship lists of stable page IDs. Publication
validates their targets against the complete resulting manifest, including when
an unchanged page refers to a newly archived page. Each relationship target requires a `page_links` record for that revision,
sharing the validated graph and backlinks with body wiki links.

`members` is a relationship list from a `group` entity to `person` entities.
`accountable_owners` and `backup_owners` are relationship lists to `group` entities.
Targets must have the required catalog type in the resulting publication; changing
or archiving a target must preserve validity for unchanged referring pages too.
Nested groups are not supported. Person memberships and responsibilities through
groups are derived from these links within the selected publication, not stored
as a second membership list. Historical publications retain their own membership
and ownership. Legacy scalar `accountable_owner` and `backup_owner` properties
remain readable; agents adopt the plural relationships in reviewed new revisions.

Person properties may include `role`, `organization` and `crm_url`; group properties
may include `purpose`. CRM links refer to reviewed existing records; there is no
automatic CRM synchronization. People pages are knowledge identities, not auth
accounts. Group membership records accountability only: it grants no permissions,
sends no notifications and changes no application access. The browser views are
read-only; agents manage membership through ordinary revision publication.

`property_evidence` maps existing property names to lists of citation marker
strings, for example `{"provider_status":["1"],"lifecycle_status":["2"]}`.
Each list has at most 32 unique positive numbered markers; the whole field is
limited to 16,384 bytes. Citation records must exist for property markers, and
citations may be used in properties, the body, or both. Evidence is optional;
structural validity never establishes factual support. Keep provider observation
dates, assessments and review dates distinct. Record unknown ownership explicitly.
Never store token values, secret keys or passwords in shared wiki properties;
credential pages hold metadata and protected-storage references only.

The exporter emits one deterministic YAML frontmatter block using safely quoted
JSON-compatible values. Relationships resolve to quoted Obsidian wiki links in
the selected publication; evidence appears in a separate Markdown section using
the same source footnotes as the body. System metadata cannot be overridden.
Properties are queried with authenticated SQL JSON functions and publication
manifest joins. Full-text body search does not index property values.

### Repository documents and copies

Repository files reuse immutable page identities, revisions, citations and atomic
publication. A document is a logical source, not a repository file location. Several
destinations can reference the same document only when they are intentionally
maintained as copies. Coincidentally identical bytes do not merge identities.

`repository_document` requires `document_type` (`readme`, `license`, `copyright`,
`notice`, `contributing`, `other`) and `output_mode` (`exact_copy`, `markdown`).
Exact-copy mode requires `source_id` identifying an existing immutable original in the same space;
the protected original and its server-recorded SHA-256 are authoritative bytes.
Markdown mode exports the revision body. It may place its supporting citations in
`property_evidence` to keep wiki citation markers outside the distributed body.
The exporter rejects unsupported wiki markup. Neither mode injects metadata,
notices or copyright-year changes. Templates and embedded source-code headers are
outside this implementation.

`repository_destination` requires exactly one `documents` page relationship,
`github_repository` as owner/repository, an explicit `github_branch`, and a safe
relative `github_path`. Matching `page_links` records are required. Publication
enforces one active destination per repository/branch/path; repository comparison
is case-insensitive while branch and path remain case-sensitive. Retired
destinations use `lifecycle_status: retired`; archived revisions retain history.

`repository_sync` is a separate observation page with exactly one `destinations`
relationship, `synced_destination_revision`, `synced_document_revision`,
`rendered_sha256`, `checked_at` in UTC, `sync_status`, and `github_commit` when
known. Status is `current`, `behind`, `diverged`, `pending` or `unknown`; pending
and unknown may omit the commit. Both revision references must have appeared in
published history, and the pinned destination must reference the pinned document.
`rendered_sha256` identifies the intended document output, not a divergent GitHub
file; exact-copy observations must match the immutable original's hash.
This permits historical observations to remain valid when today's mapping changes.
An observation is dated evidence, not a live GitHub query or permission to push.
The reader derives freshness against the selected publication's revisions.

Each sync check should create a new observation identity, preserving independent
attempts and partial progress across repositories. Source content does not change
when a sync observation is published. GitHub edits must be compared and reviewed
before replacing a copy; a pending pull request is not a completed rollout.
