#!/usr/bin/env python3
"""Synthetic read-after-write checks for reused filtered SQL snapshots in demo mode.

The pinned server retains each visitor's private snapshot while the source
database is unchanged; X-Context-Snapshot-At stays the same on a cache hit.
Onboarding, page writes, publication, private search, another visitor's writes,
disablement, a stale UTC generation, restarts and a reset (fresh database) must
each be reflected on the very next read, and no visitor ever sees another
visitor's personal space. Data is synthetic and isolated.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import secrets
import sys
import tempfile
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))
import demo_fixture as fx  # noqa: E402
from demo_backend import ADMIN, RECORDS, environment  # noqa: E402
from oauth_integration import google_fixture, REDIRECT  # noqa: E402

TABLES = ('user_directory', 'spaces', 'space_members', 'pages', 'page_revisions', 'ingestion_runs', 'publications', 'audit_log')
COUNTS = ' UNION ALL '.join(f"SELECT '{table}', count(*) FROM {table}" for table in TABLES)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True)
    args = parser.parse_args()
    day = datetime.now(timezone.utc).date().isoformat()
    tokens, ids, spaces, stamps = {}, {}, {}, {}
    with fx.contacts() as (contact_url, contact_token, _), google_fixture() as (provider_url, codes), \
            fx.app_tree(launcher=fx.demo_launcher()) as app, tempfile.TemporaryDirectory(prefix='wikicontext-demo-freshness-') as tmp:
        env = environment(contact_url, contact_token, day)
        state = Path(tmp) / 'pb_data'

        def sql(request, name, query=COUNTS, expected=200):
            req = urllib.request.Request(request.base_url + '/api/context/query', data=json.dumps({'sql': query}).encode(),
                                         method='POST', headers={'Content-Type': 'application/json', 'Authorization': tokens[name]})
            try:
                with urllib.request.urlopen(req, timeout=30) as response:
                    status, raw, headers = response.status, response.read(), response.headers
            except urllib.error.HTTPError as error:
                status, raw, headers = error.code, error.read(), error.headers
            assert status in (expected if isinstance(expected, tuple) else (expected,)), (name, status, raw.decode()[:500])
            if status != 200:
                return None, None
            assert headers['X-Context-Scope'] == 'authorized-snapshot'
            result = json.loads(raw)
            assert not result['truncated']
            return result['rows'], headers['X-Context-Snapshot-At']

        def view(request, name):
            rows, at = sql(request, name)
            return {table: count for table, count in rows if count}, at

        def warm(request, name):
            first, at = view(request, name)
            again, at2 = view(request, name)
            assert first == again and at == at2, ('expected a reused snapshot for an unchanged source', name)
            stamps[name] = at
            return first

        def fresh(request, name):
            result, at = view(request, name)
            assert at != stamps[name], ('a committed write must invalidate the reused snapshot', name)
            stamps[name] = at
            return result

        def visible_spaces(request, name):
            return sorted({row[0] for row in sql(request, name, 'SELECT space FROM pages UNION SELECT id FROM spaces')[0]})

        def visitor(request, name, status):
            meta = request('GET', '/api/collections/users/auth-methods')['oauth2']['providers'][0]
            code, email = secrets.token_urlsafe(24), name + '@example.test'
            codes[code] = {'challenge': meta['codeChallenge'], 'user': {'sub': 'sub-' + email, 'email': email, 'email_verified': True,
                                                                        'name': 'Synthetic visitor'}}
            auth = request('POST', '/api/collections/users/auth-with-oauth2', {'provider': 'google', 'code': code, 'redirectURL': REDIRECT,
                                                                                'codeVerifier': meta['codeVerifier']})
            tokens[name], ids[name] = auth['token'], auth['record']['id']
            # Onboarding: no SQL before enrollment, then only the visitor's own personal space.
            sql(request, name, expected=403)
            result = request('POST', '/api/demo/enroll', {'generation': day, 'termsVersion': status['termsVersion'], 'acceptTerms': True,
                                                          'salesConsent': False, 'newsletterConsent': False, 'expectedRevision': 0}, tokens[name])
            spaces[name] = result['space']
            assert visible_spaces(request, name) == [spaces[name]]

        def create(request, name, table, body):
            return request('POST', RECORDS(table), body, tokens[name])

        def search(request, name, scope, expected=200):
            return request('POST', '/api/context/search', {'index': 'pages', 'scope': scope, 'query': 'orchid'}, tokens[name], expected)

        own = {'user_directory': 1, 'spaces': 1, 'space_members': 1}
        with fx.server(args.binary, app, env, data_dir=state) as request:
            admin = request('POST', '/api/collections/_superusers/auth-with-password', ADMIN)['token']
            request('PATCH', '/api/collections/users', {'oauth2': {'enabled': True, 'providers': [{
                'name': 'google', 'clientId': 'synthetic-client', 'clientSecret': 'synthetic-secret',
                'authURL': provider_url + '/authorize', 'tokenURL': provider_url + '/token', 'userInfoURL': provider_url + '/userinfo'}]}}, admin)
            status = request('GET', '/api/demo/status')
            visitor(request, 'alice', status)
            visitor(request, 'bob', status)
            schema = request('GET', '/api/context/schema', token=tokens['alice'])
            assert schema['permissionModel'] == 'filtered-snapshot' and 'snapshot' not in schema, 'background snapshots must stay disabled'
            assert schema['snapshotLimits']['maxConcurrentPerRequester'] == 0, 'per-requester admission must stay disabled'
            base = {name: warm(request, name) for name in ('alice', 'bob')}
            assert all(own.items() <= counts.items() for counts in base.values()), base

            # A later visitor's onboarding invalidates retained copies without leaking rows.
            visitor(request, 'carol', status)
            assert fresh(request, 'alice') == base['alice'] and fresh(request, 'bob') == base['bob']
            warm(request, 'carol')

            # A page write and publication reach the author's next read, SQL and search, and nobody else's.
            page = create(request, 'alice', 'pages', {'slug': 'synthetic-orchid', 'kind': 'concept'})
            assert fresh(request, 'alice')['pages'] == 1 and 'pages' not in fresh(request, 'bob')
            run = create(request, 'alice', 'ingestion_runs', {'key': 'synthetic-run', 'status': 'staging', 'description': 'Synthetic'})
            revision = create(request, 'alice', 'page_revisions', {'run': run['id'], 'page': page['id'], 'title': 'Orchid guide',
                                                                   'summary': 'Synthetic', 'body': 'Orchid claim [needs verification].'})
            warm(request, 'alice')
            request('PATCH', RECORDS('ingestion_runs') + '/' + run['id'], {'expected_revision': run['revision'], 'status': 'published'},
                    tokens['alice'])
            alice = fresh(request, 'alice')
            assert alice['publications'] == 1 and alice['page_revisions'] == 1, alice
            publication = sql(request, 'alice', 'SELECT id FROM publications')[0][0][0]
            assert [hit['id'] for hit in search(request, 'alice', publication)['hits']] == [revision['id']]
            search(request, 'bob', publication, expected=(400, 403, 404))
            assert fresh(request, 'bob') == base['bob'] and visible_spaces(request, 'bob') == [spaces['bob']]

            # Another visitor's write invalidates the author's copy; each still sees only their own space.
            warm(request, 'alice')
            create(request, 'bob', 'pages', {'slug': 'synthetic-orchid', 'kind': 'concept'})
            assert fresh(request, 'alice') == alice
            assert visible_spaces(request, 'alice') == [spaces['alice']] and visible_spaces(request, 'bob') == [spaces['bob']]
            assert sql(request, 'carol', 'SELECT id FROM pages')[0] == []

            # Disablement is enforced before any retained copy is served.
            warm(request, 'carol')
            request('PATCH', RECORDS('users') + '/' + ids['carol'], {'disabled': True}, admin)
            sql(request, 'carol', expected=(401, 403))
            warm(request, 'alice')

        # A restart never reuses a copy built by the previous process.
        before = stamps['alice']
        with fx.server(args.binary, app, env, data_dir=state) as request:
            rows, at = view(request, 'alice')
            assert rows == alice and at != before, 'restart must rebuild the snapshot'
            stamps['alice'] = at
            warm(request, 'alice')
            # A stale persisted UTC generation fences SQL and search even while a warm copy exists.
            admin = request('POST', '/api/collections/_superusers/auth-with-password', ADMIN)['token']
            request('PATCH', RECORDS('demo_policy') + '/demopolicy00001', {'generation': '2000-01-01'}, admin)
            sql(request, 'alice', expected=503)
            search(request, 'alice', publication, expected=503)

        # After a reset (fresh database), pre-reset sessions cannot read any snapshot.
        with fx.server(args.binary, app, env, data_dir=Path(tmp) / 'reset' / 'pb_data') as request:
            for name in ('alice', 'bob'):
                sql(request, name, expected=(401, 403))
    print('PASS: demo snapshot reuse across onboarding, read-after-write, publication/search, visitor isolation, '
          'disablement, stale generation, restart and reset')


if __name__ == '__main__':
    main()
