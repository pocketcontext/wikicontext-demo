#!/usr/bin/env python3
"""Public WikiContext demo boundary checks against the pinned server.

Synthetic Google provider, private synthetic contact store and isolated databases
only. Covers admission, alternative-auth rejection, explicit consent, enrollment
gating, private directory SQL, audio/transcription refusal, group-space refusal,
transactional quotas, the account cap and the fail-closed daily generation.
"""
import argparse
import concurrent.futures
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import sqlite3
import sys
import tempfile
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))
import demo_fixture as fx  # noqa: E402
from oauth_integration import google_fixture, REDIRECT  # noqa: E402

ADMIN = {'identity': 'admin@example.com', 'password': 'SyntheticAdminPassword123!'}
RECORDS = lambda table: '/api/collections/' + table + '/records'


def environment(contact_url, contact_token, day):
    return {'WIKICONTEXT_DEMO_MODE': 'true', 'WIKICONTEXT_DEMO_GENERATION': day,
            'WIKICONTEXT_DEMO_CONTACT_URL': contact_url, 'WIKICONTEXT_DEMO_CONTACT_TOKEN': contact_token}


def expect_failure(binary, app, env, message, data_dir=None, extra_args=()):
    try:
        with fx.server(binary, app, env, data_dir=data_dir, extra_args=extra_args):
            pass
    except fx.ServerFailed as error:
        assert message in str(error), (message, str(error)[-2000:])
        return
    raise AssertionError('unsafe startup accepted: ' + message)


def multipart(fields, filename, content, media='text/plain'):
    boundary = 'synthetic-demo-' + secrets.token_hex(8)
    body = ''.join(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'
                   for key, value in fields.items()).encode()
    body += (f'--{boundary}\r\nContent-Disposition: form-data; name="original"; filename="{filename}"\r\n'
             f'Content-Type: {media}\r\n\r\n').encode() + content + f'\r\n--{boundary}--\r\n'.encode()
    return body, {'Content-Type': 'multipart/form-data; boundary=' + boundary}


def check_installation(binary, day):
    with fx.contacts() as (url, token, _):
        env = environment(url, token, day)
        with fx.app_tree(launcher=fx.demo_launcher()) as app, fx.server(binary, app, env) as request:
            status = request('GET', '/api/demo/status')
            assert status['clientReady'] is True and status['installation'] == {
                'method': 'skills', 'skill': 'wikicontext', 'clientRevision': 'a' * 40,
                'source': 'https://github.com/pocketcontext/wikicontext-demo/tree/main/skills/wikicontext'}, status
            for path in ('/terms/', '/privacy/'):
                status_code, body = request('GET', path, raw=True)
                assert status_code == 200 and b'info@pocketcontext.com' in body and b'00:00 UTC' in body
        # An upstream or malformed pin is never advertised as the tested demo client.
        for launcher in ((fx.ROOT / 'skills/wikicontext/wikicontext').read_text().replace('wikicontext-demo.git', 'wikicontext.git'),
                         'invalid unpinned launcher'):
            with fx.app_tree(launcher=launcher) as app, fx.server(binary, app, env) as request:
                status = request('GET', '/api/demo/status')
                assert status['clientReady'] is False and status['installation'] is None, status


def check_health_probe_logs(binary, day):
    probe_token = secrets.token_urlsafe(32)
    with tempfile.TemporaryDirectory(prefix='wiki-demo-probe-logs-') as temporary, fx.contacts() as (url, token, _), fx.app_tree() as app:
        data_dir = Path(temporary) / 'pb_data'
        env = environment(url, token, day)
        env['WIKICONTEXT_DEMO_HEALTH_TOKEN'] = probe_token
        (app / 'pb_hooks/probe_failure.pb.js').write_text("""
routerUse(new Middleware((e) => {
 if (e.request.url.path === '/api/demo/status' && e.request.url.query().get('syntheticFailure') === '1')
  throw new ApiError(503, 'Synthetic health failure', {});
 return e.next();
}, 1));
""")
        cases = [('internal', {'X-WikiContext-Health-Token': probe_token}, 200),
                 ('external', {}, 200),
                 ('forwarded', {'X-Forwarded-For': '127.0.0.1'}, 200),
                 ('wrong-token', {'X-WikiContext-Health-Token': 'synthetic-wrong-token'}, 200),
                 ('failure', {'X-WikiContext-Health-Token': probe_token}, 503)]
        with fx.server(binary, app, env, data_dir=data_dir) as request:
            for name, headers, expected in cases:
                path = '/api/demo/status?probeCase=' + name
                if name == 'failure':
                    path += '&syntheticFailure=1'
                request('GET', path, headers=headers, expected=expected)
        # Graceful shutdown flushes logs. This database contains synthetic data only.
        with sqlite3.connect('file:' + str(data_dir / 'auxiliary.db') + '?mode=ro', uri=True) as database:
            logs = [json.loads(row[0]) for row in database.execute('SELECT data FROM _logs')]
        urls = [entry.get('url', '') for entry in logs]
        for name, _, _ in cases:
            matching = [url for url in urls if 'probeCase=' + name in url]
            assert len(matching) == (0 if name == 'internal' else 1), (name, matching, urls)
        assert probe_token not in json.dumps(logs), 'Probe token leaked into logs'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True)
    args = parser.parse_args()
    day = datetime.now(timezone.utc).date().isoformat()
    config, derived = fx.demo_config()
    if derived:
        print('NOTE: repository pocketcontext.json lacks the demo filtered-snapshot policy; using a test-only derivative')
    if not fx.HAS_SPACES:
        print('NOTE: pb_hooks/spaces.js absent; enrollment uses a test stub and REST cross-visitor isolation is skipped')
    check_health_probe_logs(args.binary, day)
    check_installation(args.binary, day)

    with fx.contacts() as (contact_url, contact_token, store), google_fixture() as (provider_url, codes), \
            fx.app_tree(launcher=fx.demo_launcher()) as app:
        # Inject a server-side enrollment failure only for this synthetic identity.
        # The real contact service commits first, exposing the cross-service boundary.
        (app / 'pb_hooks/synthetic_enrollment_failure.pb.js').write_text('''
onRecordCreate((e) => {
 const account = e.app.findRecordById('users', e.record.getString('account'));
 if (account.getString('email') === 'partial@example.test')
  throw new ApiError(503, 'Synthetic enrollment failure', {});
 return e.next();
}, 'demo_enrollments');
''')
        env = {**environment(contact_url, contact_token, day), 'WIKICONTEXT_GOOGLE_WORKSPACE_DOMAIN': 'company.example'}
        with fx.server(args.binary, app, env) as request:
            admin_auth = request('POST', '/api/collections/_superusers/auth-with-password', ADMIN)
            # Public nginx denies the system collection by name and this pinned ID.
            # Fail when an adopted server changes it so the gate cannot silently drift.
            assert admin_auth['record']['collectionId'] == 'pbc_3142635823'
            admin = admin_auth['token']
            provider = {'name': 'google', 'clientId': 'synthetic-client', 'clientSecret': 'synthetic-secret',
                        'authURL': provider_url + '/authorize', 'tokenURL': provider_url + '/token',
                        'userInfoURL': provider_url + '/userinfo'}
            request('PATCH', '/api/collections/users', {'oauth2': {'enabled': True, 'providers': [provider]}}, admin)
            status = request('GET', '/api/demo/status')
            assert status['enabled'] and status['generation'] == day and status['restrictions']['groupSpaces'] is False
            limits = status['limits']

            def exchange(email, verified=True, subject=None, expected=200):
                meta = request('GET', '/api/collections/users/auth-methods')['oauth2']['providers'][0]
                code = secrets.token_urlsafe(24)
                codes[code] = {'challenge': meta['codeChallenge'], 'user': {
                    'sub': subject or 'sub-' + email, 'email': email, 'email_verified': verified, 'name': 'Synthetic Google user'}}
                return request('POST', '/api/collections/users/auth-with-oauth2', {
                    'provider': 'google', 'code': code, 'redirectURL': REDIRECT, 'codeVerifier': meta['codeVerifier'],
                    'createData': {'disabled': True, 'verified': False, 'name': 'forged'}}, expected=expected)

            # Any verified Google account; the Workspace domain is ignored in demo mode.
            exchange('unverified@gmail.com', verified=False, expected=(400, 403))
            alice = exchange('alice@gmail.com')
            bob = exchange('Bob@Outside.example')
            assert not alice['record']['disabled'] and alice['record']['name'] == 'Synthetic Google user'
            bt = bob['token']
            # Case-insensitive email matching resolves the existing identity, and subject binding holds.
            assert exchange('bob@outside.example', subject='sub-Bob@Outside.example')['record']['id'] == bob['record']['id']
            exchange('alice@gmail.com', subject='another-subject', expected=(400, 403))
            tokens = request('POST', '/api/synthetic/demo-tokens', {'account': alice['record']['id']}, admin)
            at = tokens['auth']
            # Valid tokens reach the mutation hooks; rejection is the demo policy, not malformed input.
            request('POST', '/api/collections/users/confirm-password-reset', {'token': tokens['reset'], 'password': 'SyntheticReplacement123!', 'passwordConfirm': 'SyntheticReplacement123!'}, expected=(403, 429))
            request('POST', '/api/collections/users/confirm-email-change', {'token': tokens['email'], 'password': 'SyntheticFixturePassword123!'}, expected=(403, 429))
            request('POST', '/api/collections/users/auth-with-password', {'identity': 'alice@gmail.com', 'password': 'SyntheticFixturePassword123!'}, expected=(400, 403, 429))
            for endpoint in ('request-password-reset', 'request-email-change', 'request-otp', 'request-verification'):
                request('POST', '/api/collections/users/' + endpoint, {'email': 'alice@gmail.com', 'newEmail': 'other@example.com'}, at, expected=(400, 403, 429))

            # Nothing beyond sign-in and demo routes is reachable before today's enrollment.
            request('POST', '/api/context/query', {'sql': 'SELECT 1'}, at, 403)
            request('GET', '/api/context/schema', token=at, expected=403)
            request('GET', RECORDS('pages'), token=at, expected=403)
            request('POST', RECORDS('pages'), {'slug': 'early', 'kind': 'concept'}, at, 403)
            request('POST', '/api/batch', {'requests': []}, at, 403)
            request('POST', '/api/realtime', {'clientId': 'synthetic', 'subscriptions': ['pages']}, at, 403)
            request('GET', '/api/files/token', token=at, expected=(403, 405))
            assert request('GET', '/api/demo/enrollment', token=at) == {
                'enrolled': False, 'generation': day, 'termsVersion': status['termsVersion'], 'space': None, 'usage': None}
            request('GET', '/api/demo/enrollment', expected=401)
            request('GET', RECORDS('users') + '/' + alice['record']['id'], token=at)
            request('GET', RECORDS('users') + '/' + bob['record']['id'], token=at, expected=403)
            request('GET', RECORDS('users'), token=at, expected=403)
            request('PATCH', RECORDS('users') + '/' + alice['record']['id'], {'name': 'No'}, at, 403)
            request('POST', '/api/collections/users/auth-refresh', {}, at)


            enroll = {'generation': day, 'termsVersion': status['termsVersion'], 'acceptTerms': True,
                      'salesConsent': False, 'newsletterConsent': False, 'expectedRevision': 0}
            for bad in ({'acceptTerms': False}, {'generation': '2000-01-01'}, {'termsVersion': 'old'},
                        {'salesConsent': None}, {'expectedRevision': -1}):
                request('POST', '/api/demo/enroll', {**enroll, **bad}, at, 400)
            partial = exchange('partial@example.test')
            pt = partial['token']
            request('POST', '/api/demo/enroll', {**enroll, 'salesConsent': True}, pt, 503)
            assert request('GET', '/api/demo/enrollment', token=pt)['enrolled'] is False
            prefs = request('GET', '/api/demo/preferences', token=pt)
            assert prefs['revision'] == 1 and prefs['salesContact'] is True and prefs['newsletter'] is False, prefs
            request('POST', '/api/context/query', {'sql': 'SELECT 1'}, pt, 403)
            # An old revision cannot overwrite the already recorded explicit choice.
            request('POST', '/api/demo/enroll', enroll, pt, 409)
            # A fresh explicit withdrawal commits even though wiki enrollment still fails.
            request('POST', '/api/demo/enroll', {**enroll, 'expectedRevision': prefs['revision']}, pt, 503)
            prefs = request('GET', '/api/demo/preferences', token=pt)
            assert prefs['revision'] == 2 and prefs['salesContact'] is False and prefs['newsletter'] is False, prefs
            assert request('GET', '/api/demo/enrollment', token=pt)['enrolled'] is False
            spaces = {}
            for token, user in ((at, alice), (bt, bob)):
                assert request('GET', '/api/demo/preferences', token=token)['revision'] == 0
                result = request('POST', '/api/demo/enroll', enroll, token)
                assert result['enrolled'] and len(result['space']) == 15, result
                spaces[user['record']['id']] = result['space']
                state = request('GET', '/api/demo/enrollment', token=token)
                assert state['enrolled'] and state['space'] == result['space'] and state['usage'] == {}, state
            assert len(set(spaces.values())) == 2
            # A stale revision is never blindly reapplied; the person must decide again.
            request('POST', '/api/demo/enroll', enroll, at, 409)
            again = request('POST', '/api/demo/enroll', {**enroll, 'expectedRevision': request('GET', '/api/demo/preferences', token=at)['revision']}, at)
            assert again['space'] == spaces[alice['record']['id']], 'personal space must be idempotent'

            def query(token, sql):
                return request('POST', '/api/context/query', {'sql': sql}, token)['rows']
            for token, user in ((at, alice), (bt, bob)):
                assert query(token, 'SELECT id FROM user_directory') == [[user['record']['id']]]
                for table in ('demo_policy', 'demo_enrollments', 'users'):
                    request('POST', '/api/context/query', {'sql': 'SELECT * FROM ' + table}, token, expected=(400, 403))
            for table in ('spaces', 'space_members', 'space_memberships'):
                request('POST', RECORDS(table), {'name': 'Shared', 'kind': 'group'}, at, expected=(403, 404))

            def create(token, table, body, expected=200):
                return request('POST', RECORDS(table), body, token, expected)
            page = create(at, 'pages', {'slug': 'synthetic-alpha', 'kind': 'concept'})
            assert query(bt, "SELECT id FROM pages WHERE slug = 'synthetic-alpha'") == []
            if fx.HAS_SPACES:
                request('GET', RECORDS('pages') + '/' + page['id'], token=bt, expected=(403, 404))
                listed = request('GET', RECORDS('pages'), token=bt)
                assert all(item['id'] != page['id'] for item in listed['items']), 'cross-visitor REST listing'

            # Audio and transcription are refused at the server, whatever the client declares.
            for name, media in (('note.mp3', 'text/plain'), ('note.txt', 'audio/mpeg'), ('clip.mp4', 'video/mp4'), ('NOTE.WAV', 'text/plain')):
                body, headers = multipart({'title': 'Synthetic', 'original_name': name, 'media_type': media}, name, b'synthetic')
                request('POST', RECORDS('sources'), body, at, 400, headers=headers)
            body, headers = multipart({'title': 'Synthetic', 'original_name': 'safe.txt', 'media_type': 'text/plain'}, 'disguised.m4a', b'synthetic')
            request('POST', RECORDS('sources'), body, at, 400, headers=headers)
            body, headers = multipart({'title': 'Synthetic text', 'original_name': 'alpha.txt', 'media_type': 'text/plain'}, 'alpha.txt', b'synthetic alpha')
            source = request('POST', RECORDS('sources'), body, at, headers=headers)
            for kind, processor in (('transcript', 'synthetic'), ('text', 'groq whisper-large-v3-turbo'), ('text', 'Synthetic transcription')):
                create(at, 'renditions', {'source': source['id'], 'kind': kind, 'processor': processor, 'version_label': 'v1'}, 400)
            rendition = create(at, 'renditions', {'source': source['id'], 'kind': 'text', 'processor': 'synthetic', 'version_label': 'v1'})
            passage = create(at, 'passages', {'rendition': rendition['id'], 'ordinal': 1, 'locator': 'line 1', 'body': 'Synthetic passage é'})

            enrollments = request('GET', RECORDS('demo_enrollments'), token=admin)['items']
            row = next(item for item in enrollments if item['account'] == alice['record']['id'])
            usage_path = RECORDS('demo_enrollments') + '/' + row['id']
            usage = row['usage']
            assert usage == {'writes': 4, 'pages': 1, 'sources': 1, 'originalBytes': len(b'synthetic alpha'), 'renditions': 1,
                             'passages': 1, 'textBytes': len(('synthetic-alphaSynthetic textalpha.txttext/plaintextsyntheticv1line 1Synthetic passage é').encode())}, usage

            def set_usage(**changes):
                request('PATCH', usage_path, {'usage': {**usage, **changes}}, admin)

            def stored():
                return request('GET', usage_path, token=admin)['usage']
            # Near-limit fixtures exercise every guard without large synthetic workloads.
            set_usage(pages=limits['pages'] - 1)
            create(at, 'pages', {'slug': 'synthetic-last', 'kind': 'concept'})
            before = stored()
            create(at, 'pages', {'slug': 'synthetic-over', 'kind': 'concept'}, 429)
            assert stored() == before, 'failed write must roll back counters'
            assert query(at, "SELECT count(*) FROM pages WHERE slug = 'synthetic-over'") == [[0]]
            # Concurrent creates cannot exceed the transactional quota.
            set_usage(pages=limits['pages'] - 3)

            def concurrent_page(n):
                try:
                    create(at, 'pages', {'slug': f'synthetic-race-{n}', 'kind': 'entity'})
                    return True
                except AssertionError as error:
                    assert ', 429,' in str(error), error
                    return False
            with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
                assert sum(pool.map(concurrent_page, range(6))) == 3
            assert stored()['pages'] == limits['pages']
            set_usage(originalBytes=limits['originalBytes'] - 10)
            body, headers = multipart({'title': 'Over', 'original_name': 'over.txt', 'media_type': 'text/plain'}, 'over.txt', b'x' * 11)
            request('POST', RECORDS('sources'), body, at, 429, headers=headers)
            body, headers = multipart({'title': 'Fits', 'original_name': 'fits.txt', 'media_type': 'text/plain'}, 'fits.txt', b'y' * 10)
            request('POST', RECORDS('sources'), body, at, headers=headers)
            set_usage(originalBytes=0)
            body, headers = multipart({'title': 'Large', 'original_name': 'large.txt', 'media_type': 'text/plain'}, 'large.txt', b'z' * (limits['sourceBytes'] + 1))
            request('POST', RECORDS('sources'), body, at, expected=(400, 413), headers=headers)
            set_usage(textBytes=limits['textBytes'] - 5)
            create(at, 'passages', {'rendition': rendition['id'], 'ordinal': 2, 'locator': 'l2', 'body': 'too long'}, 429)
            # Metadata participates in the same quota, including UTF-8 and run updates.
            create(at, 'ingestion_runs', {'key': 'metadata-over', 'status': 'staging', 'description': '界界'}, 429)
            set_usage(textBytes=0)
            editable = create(at, 'ingestion_runs', {'key': 'editable', 'status': 'staging', 'description': 'x'})
            set_usage(textBytes=limits['textBytes'] - 5)
            before = stored()
            request('PATCH', RECORDS('ingestion_runs') + '/' + editable['id'],
                    {'expected_revision': 1, 'issue': '界界'}, at, 429)
            assert stored() == before, 'failed metadata growth must roll back counters'
            request('PATCH', RECORDS('ingestion_runs') + '/' + editable['id'],
                    {'expected_revision': 1, 'issue': 'é'}, at)
            assert stored()['textBytes'] == before['textBytes'] + 2
            request('PATCH', RECORDS('ingestion_runs') + '/' + editable['id'],
                    {'expected_revision': 2, 'issue': ''}, at)
            assert stored()['textBytes'] == before['textBytes'] + 2, 'shrinking metadata must not refund usage'
            set_usage(textBytes=0, publications=limits['publications'])
            run = create(at, 'ingestion_runs', {'key': 'synthetic-run', 'status': 'staging', 'description': 'Synthetic'})
            revision = create(at, 'page_revisions', {'run': run['id'], 'page': page['id'], 'title': 'Alpha', 'summary': 'Synthetic', 'body': 'Synthetic claim [needs verification].'})
            set_usage(textBytes=limits['textBytes'] - 5, publications=limits['publications'])
            before = stored()
            create(at, 'citations', {'page_revision': revision['id'], 'passage': passage['id'], 'marker': '1', 'note': '界界'}, 429)
            assert stored() == before, 'citation-note quota refusal must roll back counters'
            set_usage(textBytes=0, publications=limits['publications'])
            request('PATCH', RECORDS('ingestion_runs') + '/' + run['id'], {'expected_revision': 1, 'status': 'published'}, at, 429)
            assert query(at, "SELECT status FROM ingestion_runs WHERE key = 'synthetic-run'") == [['staging']]
            set_usage(publications=0, textBytes=0, writes=0)
            published = request('PATCH', RECORDS('ingestion_runs') + '/' + run['id'], {'expected_revision': 1, 'status': 'published'}, at)
            assert published['status'] == 'published' and stored()['publications'] == 1
            set_usage(writes=limits['writes'])
            create(at, 'pages', {'slug': 'synthetic-writes', 'kind': 'concept'}, 429)
            # Bob's quotas are independent of Alice's.
            create(bt, 'pages', {'slug': 'synthetic-bob', 'kind': 'concept'})

            # The account cap is transactional and applies before provisioning.
            existing = len(request('GET', RECORDS('users') + '?perPage=500', token=admin)['items'])
            for n in range(limits['accounts'] - existing):
                request('POST', RECORDS('users'), {'email': f'synthetic{n}@example.test', 'name': 'Synthetic', 'password': 'SyntheticPassword123!', 'passwordConfirm': 'SyntheticPassword123!'}, admin)
            exchange('late@gmail.com', expected=(429,))

            # Withdrawal remains possible across the reset fence.
            prefs = request('GET', '/api/demo/preferences', token=at)
            consent = request('POST', '/api/demo/enroll', {**enroll, 'salesConsent': True, 'expectedRevision': prefs['revision']}, at)
            withdrawal = consent['contact']['unsubscribeToken']
            assert store.preferences('sub-alice@gmail.com')['salesContact'] is True
            # A persisted stale generation fences every API; no test-only clock hook.
            request('PATCH', RECORDS('demo_policy') + '/demopolicy00001', {'generation': '2000-01-01'}, admin)
            for method, path, body, token in [('GET', '/api/demo/status', None, None), ('POST', '/api/context/query', {'sql': 'SELECT 1'}, at),
                                              ('POST', '/api/collections/users/auth-refresh', None, at), ('GET', '/up', None, None)]:
                request(method, path, body, token, 503)
            request('POST', '/api/demo/unsubscribe', {'token': withdrawal})
            assert store.preferences('sub-alice@gmail.com')['salesContact'] is False

    # Restarts cannot reuse yesterday's state, switch modes or weaken storage/SQL policy.
    with fx.contacts() as (contact_url, contact_token, _), tempfile.TemporaryDirectory(prefix='wikicontext-demo-restart-') as tmp:
        state = Path(tmp) / 'pb_data'
        env = environment(contact_url, contact_token, day)
        with fx.app_tree() as app:
            with fx.server(args.binary, app, env, data_dir=state):
                pass
            for changes, message in [({'WIKICONTEXT_DEMO_MODE': 'false'}, 'cannot run in production'),
                                     ({'WIKICONTEXT_DEMO_GENERATION': '2000-01-01'}, 'demo is resetting'),
                                     ({'WIKICONTEXT_DEMO_GENERATION': 'tomorrow'}, 'valid demo UTC generation'),
                                     ({'WIKICONTEXT_DEMO_MODE': 'yes'}, 'Invalid WIKICONTEXT_DEMO_MODE'),
                                     ({'WIKICONTEXT_DEMO_CONTACT_TOKEN': 'short'}, 'contact service configuration')]:
                expect_failure(args.binary, app, {**env, **changes}, message, data_dir=state)
            expect_failure(args.binary, app, {**env, 'LITESTREAM_BUCKET': 'wikicontext-replica'}, 'dedicated primary and replica storage')
            storage = {'WIKICONTEXT_S3_BUCKET': 'wikicontext-files', 'WIKICONTEXT_S3_ENDPOINT': 'http://127.0.0.1:9',
                       'WIKICONTEXT_S3_REGION': 'auto', 'WIKICONTEXT_S3_ACCESS_KEY_ID': 'synthetic-a',
                       'WIKICONTEXT_S3_SECRET_ACCESS_KEY': 'synthetic-secret', 'LITESTREAM_BUCKET': 'pocketdeploy-v1-wikicontext-demo-replica',
                       'LITESTREAM_ENDPOINT': 'http://127.0.0.1:9', 'LITESTREAM_REGION': 'auto', 'LITESTREAM_ACCESS_KEY_ID': 'synthetic-b'}
            expect_failure(args.binary, app, {**env, **storage}, 'dedicated wikicontext-demo buckets')
        # A production database is never converted into a demo.
        production = Path(tmp) / 'production'
        with fx.app_tree() as app:
            with fx.server(args.binary, app, {}, data_dir=production) as request:
                admin = request('POST', '/api/collections/_superusers/auth-with-password', ADMIN)['token']
                request('POST', RECORDS('users'), {'email': 'existing@example.test', 'name': 'Existing', 'password': 'SyntheticPassword123!', 'passwordConfirm': 'SyntheticPassword123!'}, admin)
            expect_failure(args.binary, app, env, 'fresh isolated database', data_dir=production)
        # Shared-workspace SQL or a public directory is refused in demo mode.
        unsafe = []
        base, _ = fx.demo_config()
        shared = json.loads(json.dumps(base)); shared.pop('snapshot')
        unsafe.append(shared)
        public = json.loads(json.dumps(base)); public['snapshot']['filters']['user_directory'] = '1 = 1'
        unsafe.append(public)
        exposed = json.loads(json.dumps(base)); exposed['tables']['demo_enrollments'] = ['id', 'account']
        exposed['snapshot']['filters']['demo_enrollments'] = 'account = :requester'
        unsafe.append(exposed)
        for config in unsafe:
            with fx.app_tree(config=config) as app:
                expect_failure(args.binary, app, env, 'private filtered-snapshot SQL policy')
        # An explicit --contextConfig is the file that is checked.
        with fx.app_tree() as app:
            (app / 'unsafe.json').write_text(json.dumps(public))
            expect_failure(args.binary, app, env, 'private filtered-snapshot SQL policy', extra_args=('--contextConfig', str(app / 'unsafe.json')))
    print('PASS: demo Google admission, consent, enrollment gate, private directory, audio refusal, quotas and generation fence')


if __name__ == '__main__':
    main()
