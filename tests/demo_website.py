#!/usr/bin/env python3
"""Real Chromium demo checks with synthetic OAuth, contacts and isolated databases."""
import argparse
from contextlib import contextmanager
import importlib.util
from pathlib import Path
import socket
import time
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


@contextmanager
def ingress(backend_url):
    """Use the actual generated ingress routes, with loopback fixture ports."""
    nginx = shutil.which('nginx') or '/usr/sbin/nginx'
    if not Path(nginx).is_file():
        raise RuntimeError('nginx is required for demo OAuth browser validation')
    spec = importlib.util.spec_from_file_location('browser_runtime', fx.ROOT / 'deploy/demo/once_runtime.py')
    runtime = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runtime)
    with tempfile.TemporaryDirectory(prefix='wiki-browser-ingress-') as directory:
        root = Path(directory)
        (root / 'control').mkdir()
        backend = runtime.Backend(root, 'https://synthetic.invalid')
        backend.stop = lambda *_: None
        backend.execute = lambda *_: None
        backend.launch = lambda *_: None
        backend.gate(True)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        path = root / 'control/nginx.conf'
        config = path.read_text().replace('listen 80;', f'listen 127.0.0.1:{port};')
        config = config.replace('http://127.0.0.1:8081', backend_url)
        path.write_text(config)
        subprocess.run([nginx, '-t', '-p', str(root), '-c', str(path)], check=True, capture_output=True)
        process = subprocess.Popen([nginx, '-p', str(root), '-c', str(path), '-g', 'daemon off;'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                if process.poll() is not None:
                    raise RuntimeError('synthetic browser ingress exited')
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=.1):
                        break
                except OSError:
                    time.sleep(.02)
            else:
                raise RuntimeError('synthetic browser ingress did not start')
            yield f'http://127.0.0.1:{port}'
        finally:
            process.terminate()
            process.wait(timeout=10)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True)
    args = parser.parse_args()
    day = datetime.now(timezone.utc).date().isoformat()
    with fx.contacts() as (contact_url, contact_token, _), google_fixture() as (provider_url, codes), fx.app_tree(launcher=fx.demo_launcher()) as app:
        shutil.copytree(fx.ROOT / 'ui/dist', app / 'ui/dist')
        with fx.server(args.binary, app, environment(contact_url, contact_token, day)) as request:
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
            with ingress(request.base_url) as public_url, controller(control) as control_url, tempfile.TemporaryDirectory(prefix='wikicontext-demo-ui-') as output:
                oauth_integration.REDIRECT = public_url + '/api/oauth2-redirect'
                env = dict(os.environ, WIKICONTEXT_TEST_URL=public_url, WIKICONTEXT_TEST_CONTROL=control_url, WIKICONTEXT_TEST_OUTPUT=output)
                subprocess.run(['pnpm', 'exec', 'playwright', 'test', 'demo.spec.ts', '--config', 'e2e/playwright.config.ts'], cwd=fx.ROOT / 'ui', env=env, check=True)
    print('PASS: Google popup/recovery, persistent and memory sessions, demo consent, private reader, reset and mobile browser checks')


if __name__ == '__main__':
    main()
