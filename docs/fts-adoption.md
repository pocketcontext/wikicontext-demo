# Private published-page search

WikiContext demo data is partitioned into spaces, and authenticated SQL uses
filtered snapshots. The former shared FTS5 index (`published_pages_fts`), its
`search_state` generation record and `POST /api/wiki/search/rebuild` indexed every
space together, so the spaces migration drops them and no hook maintains them.
Immutable revisions, publication manifests and evidence remain authoritative.

## Server requirement

Search with filtered snapshots requires a PocketContext build that supports
`"isolation": "private"` indexes. Such an index is built per request from the rows
the requester's snapshot filters authorize, so one account can never rank, count
or excerpt another space's text. The baseline pin (`976ddf7`) rejects a `search`
section together with `snapshot`; until the server pin is advanced, the demo's
`pocketcontext.json` omits `search`. The endpoint then returns 404, the portable
client's `search` command fails with HTTP 404, and tests skip search assertions.

After adopting a server with private search, add (verify the exact schema in the
server's `docs/search.md`):

```json
"search": {
  "indexes": {
    "pages": {
      "isolation": "private",
      "collection": "page_revisions",
      "columns": ["title", "summary", "body"],
      "snippetColumn": "body",
      "weights": [8, 3, 1],
      "scope": {"collection": "publications", "field": "manifest"},
      "members": "all",
      "where": "archived = 0"
    }
  }
}
```

`members: "all"` fails closed if any manifest member is not visible to the
requester; with space filters every member of a readable publication is visible.
`where` (a row predicate on the indexed collection, present in the in-progress
server branch) keeps archive revisions out of the index, as the former shared index
did; without it the client rejects archived hits as invalid results.

## Contract

```json
{"index": "pages", "query": "deployment safety", "scope": "PUBLICATION_ID", "limit": 20, "offset": 0}
```

`scope` is a publication ID of a space the requester can read; another space's
publication behaves exactly like an absent one. Results contain `scope`,
`generation`, `hits`, `hasMore` and `truncated`; hits contain revision `id`, BM25
`score` and a plain-text `excerpt`. Clients hydrate page identity, slug, kind, title
and summary through the same manifest and fail if a hit is absent or archived.
Continuation sends the returned generation with the same scope and query; HTTP 409
means the visible data changed — discard accumulated pages and restart at zero.
The portable client exits with code 4 in that case.

Every term is a literal token phrase joined with AND: no raw FTS expressions,
prefixes, substring, typo or semantic matching. Excerpts are untrusted plain text
and navigation aids, not passage citations. Source passages are not indexed.

## Costs

A private index is derived from the requester's visible rows for each request (the
server may cache it). Cost grows with the requester's visible revision text, not
with other spaces. Measure with realistic per-space limits before raising demo
quotas. Search failures never fall back to another retrieval model.

`tests/search_integration.py` checks that the shared index is gone and, when
`search` is configured, private scoping, history, draft/archive exclusion,
pagination and cross-space isolation. `tests/search_benchmark.py` and
`docs/search-benchmark.md` describe the former shared index and are historical.
