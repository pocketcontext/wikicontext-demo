#!/usr/bin/env python3
"""Real Chromium demo checks with synthetic OAuth, contacts and isolated databases."""
import argparse
from datetime import datetime, timezone
import os
import secrets
import shutil
import subprocess
import tempfile
import urllib.parse
import oauth_integration

import demo_fixture as fx
from demo_backend import ADMIN, environment
from oauth_integration import google_fixture
from ui_browser import controller, check_static


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True)
    args = parser.parse_args()
    day = datetime.now(timezone.utc).date().isoformat()
    with fx.contacts() as (contact_url, contact_token, _), google_fixture() as (provider_url, codes), fx.app_tree(launcher=fx.demo_launcher()) as app:
        shutil.copytree(fx.ROOT / 'ui/dist', app / 'ui/dist')
        with fx.server(args.binary, app, environment(contact_url, contact_token, day)) as request:
            oauth_integration.REDIRECT = request.base_url + '/api/oauth2-redirect'
            admin = request('POST', '/api/collections/_superusers/auth-with-password', ADMIN)['token']
            request('PATCH', '/api/settings', {'rateLimits': {'enabled': False}}, admin)
            provider = {'name': 'google', 'clientId': 'synthetic-client', 'clientSecret': 'synthetic-secret',
                        'authURL': 'https://accounts.google.com/o/oauth2/v2/auth', 'tokenURL': provider_url + '/token', 'userInfoURL': provider_url + '/userinfo'}
            request('PATCH', '/api/collections/users', {'oauth2': {'enabled': True, 'providers': [provider]}}, admin)
            sessions = {}

            def control(action):
                if action.startswith('/oauth-code?'):
                    params = urllib.parse.parse_qs(urllib.parse.urlsplit(action).query)
                    name = params['name'][0]
                    code = secrets.token_urlsafe(24)
                    codes[code] = {'challenge': params['challenge'][0], 'user': {'sub': name, 'email': name + '@example.test', 'email_verified': True, 'name': 'Synthetic ' + name}}
                    return {'code': code}
                if action.startswith('/session/'):
                    name = action.rsplit('/', 1)[-1]
                    email = name + '@example.test'
                    meta = request('GET', '/api/collections/users/auth-methods')['oauth2']['providers'][0]
                    code = secrets.token_urlsafe(24)
                    codes[code] = {'challenge': meta['codeChallenge'], 'user': {'sub': name, 'email': email, 'email_verified': True, 'name': 'Synthetic ' + name}}
                    session = request('POST', '/api/collections/users/auth-with-oauth2', {'provider': 'google', 'code': code, 'redirectURL': oauth_integration.REDIRECT, 'codeVerifier': meta['codeVerifier']})
                    sessions[name] = session
                    return session
                if action == '/publish':
                    token = sessions['reader']['token']
                    def create(table, body):
                        return request('POST', '/api/collections/' + table + '/records', body, token)
                    run = create('ingestion_runs', {'key': 'browser-demo', 'status': 'staging', 'description': 'Synthetic browser fixture'})
                    page = create('pages', {'slug': 'private-observatory', 'kind': 'concept'})
                    create('page_revisions', {'run': run['id'], 'page': page['id'], 'title': 'Private observatory', 'summary': 'Synthetic personal knowledge', 'body': 'Private starlight observation. [needs verification]'})
                    request('PATCH', '/api/collections/ingestion_runs/records/' + run['id'], {'expected_revision': run['revision'], 'status': 'published'}, token)
                    return {'ok': True}
                raise AssertionError('Unknown browser fixture action')

            check_static(request.base_url)
            with controller(control) as control_url, tempfile.TemporaryDirectory(prefix='wikicontext-demo-ui-') as output:
                env = dict(os.environ, WIKICONTEXT_TEST_URL=request.base_url, WIKICONTEXT_TEST_CONTROL=control_url, WIKICONTEXT_TEST_OUTPUT=output)
                subprocess.run(['pnpm', 'exec', 'playwright', 'test', 'demo.spec.ts', '--config', 'e2e/playwright.config.ts'], cwd=fx.ROOT / 'ui', env=env, check=True)
    print('PASS: Google popup/recovery, persistent and memory sessions, demo consent, private reader, reset and mobile browser checks')


if __name__ == '__main__':
    main()
