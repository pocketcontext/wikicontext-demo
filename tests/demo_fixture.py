"""Isolated demo-mode server fixtures: temporary app tree, synthetic data only.

The demo requires requester-filtered SQL. Until the repository configuration
carries that policy, tests derive a temporary configuration; the shipped
pocketcontext.json is never modified. When pb_hooks/spaces.js is absent, a
clearly labelled test stub supplies ensurePersonalSpace so the admission
boundary can still be exercised; cross-visitor isolation checks then skip.
"""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY_FILTER = 'id = :requester OR NOT EXISTS (SELECT 1 FROM demo_policy WHERE enabled = 1)'
CO_MEMBER_FILTER = ('user_directory.id = :requester OR EXISTS (SELECT 1 FROM space_members mine JOIN space_members other '
                    'ON other.space = mine.space WHERE mine.account = :requester AND mine.active = 1 '
                    'AND other.account = user_directory.id AND other.active = 1)')
HAS_SPACES = (ROOT / 'pb_hooks/spaces.js').is_file()
STUB_SPACES = """// TEST STUB ONLY: stands in for the spaces data model's personal-space helper.
function ensurePersonalSpace(app, accountId) {
  if (!/^[a-z0-9]{15}$/.test(accountId)) throw new Error('invalid account');
  return 'p' + accountId.slice(1);
}
module.exports = {ensurePersonalSpace};
"""
TOKENS = """
routerAdd('POST','/api/synthetic/demo-tokens',(e)=>{
 if(!e.auth || e.auth.collection().name!=='_superusers')throw new ForbiddenError('Test operator required');
 const user=e.app.findRecordById('users',e.requestInfo().body.account);
 user.setPassword('SyntheticFixturePassword123!');e.app.save(user);
 return e.json(200,{auth:user.newAuthToken(),reset:user.newPasswordResetToken(),email:user.newEmailChangeToken('changed@example.test')});
});
"""


def demo_policy_ok(config):
    """Python mirror of demo.js checkConfig."""
    filters = (config.get('snapshot') or {}).get('filters') or {}
    tables = config.get('tables') or {}
    return (filters.get('user_directory') in (DIRECTORY_FILTER, CO_MEMBER_FILTER) and 'user_directory' in tables
            and not any(name in tables for name in ('users', 'demo_policy', 'demo_enrollments'))
            and all(':requester' in str(filters.get(name, '')) for name in tables))


def demo_config():
    """Repository config if it already satisfies the demo policy, else a test-only derivative."""
    config = json.loads((ROOT / 'pocketcontext.json').read_text())
    if demo_policy_ok(config):
        return config, False
    config.pop('search', None)  # Shared FTS search cannot be combined with filtered snapshots.
    filters = {}
    for table, columns in config['tables'].items():
        if table == 'user_directory':
            filters[table] = DIRECTORY_FILTER
        elif 'created_by' in columns:
            filters[table] = 'created_by = :requester'
        elif table == 'audit_log':
            filters[table] = 'actor = :requester'
        elif table == 'spaces':
            filters[table] = 'created_by = :requester'
        elif 'account' in columns:
            filters[table] = 'account = :requester'
        else:
            filters[table] = "id = '' AND :requester = ''"  # Hidden in this test-only derivative.
    config['snapshot'] = {'filters': filters, 'timeoutMs': 5000, 'maxRows': 100000, 'maxBytes': 33554432,
                          'maxConcurrent': 2, 'policyTables': {'demo_policy': ['enabled']}}
    return config, True


@contextlib.contextmanager
def app_tree(config=None, launcher=None):
    with tempfile.TemporaryDirectory(prefix='wikicontext-demo-app-') as tmp:
        root = Path(tmp)
        shutil.copytree(ROOT / 'pb_hooks', root / 'pb_hooks')
        shutil.copytree(ROOT / 'pb_migrations', root / 'pb_migrations')
        shutil.copytree(ROOT / 'legal', root / 'legal')
        if not HAS_SPACES:
            (root / 'pb_hooks/spaces.js').write_text(STUB_SPACES)
        (root / 'pb_hooks/demo_tokens.pb.js').write_text(TOKENS)
        (root / 'pocketcontext.json').write_text(json.dumps(config if config is not None else demo_config()[0]))
        target = root / 'skills/wikicontext/wikicontext'
        target.parent.mkdir(parents=True)
        target.write_text(launcher if launcher is not None else (ROOT / 'skills/wikicontext/wikicontext').read_text())
        yield root


def demo_launcher():
    """A launcher pinned to the dedicated demo repository (the shipped one may still pin upstream)."""
    text = (ROOT / 'skills/wikicontext/wikicontext').read_text()
    import re
    return re.sub(r'wikicontext-client = \{ git = "[^"]+", rev = "[a-f0-9]{40}" \}',
                  'wikicontext-client = { git = "https://github.com/pocketcontext/wikicontext-demo.git", rev = "' + 'a' * 40 + '" }', text)


class ServerFailed(AssertionError):
    pass


@contextlib.contextmanager
def server(binary, app, env, data_dir=None, extra_args=()):
    with tempfile.TemporaryDirectory(prefix='wikicontext-demo-data-') as tmp:
        data = Path(data_dir) if data_dir else Path(tmp) / 'pb_data'
        common = [str(Path(binary).resolve()), '--dir', str(data), '--migrationsDir', str(app / 'pb_migrations'),
                  '--hooksDir', str(app / 'pb_hooks'), *extra_args]
        clean = {k: v for k, v in os.environ.items() if not k.startswith(('WIKICONTEXT_', 'LITESTREAM_', 'AWS_'))}
        clean.update(env)
        result = subprocess.run(common + ['superuser', 'upsert', 'admin@example.com', 'SyntheticAdminPassword123!'],
                                cwd=app, env=clean, capture_output=True, text=True)
        if result.returncode:
            raise ServerFailed(result.stdout + result.stderr)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
        with open(Path(tmp) / 'server.log', 'w+') as log:
            proc = subprocess.Popen(common + ['serve', '--http', f'127.0.0.1:{port}'], cwd=app, env=clean, stdout=log, stderr=log)

            def request(method, path, body=None, token=None, expected=200, raw=False, headers=None):
                sent = {'Content-Type': 'application/json', **(headers or {})}
                data_bytes = None
                if isinstance(body, bytes):
                    data_bytes = body
                elif body is not None:
                    data_bytes = json.dumps(body).encode()
                if token:
                    sent['Authorization'] = token
                req = urllib.request.Request(f'http://127.0.0.1:{port}' + path, data=data_bytes, headers=sent, method=method)
                try:
                    with urllib.request.urlopen(req, timeout=30) as response:
                        status, content = response.status, response.read()
                except urllib.error.HTTPError as error:
                    status, content = error.code, error.read()
                allowed = expected if isinstance(expected, tuple) else (expected,)
                assert status in allowed, (method, path, status, content.decode(errors='replace')[:500])
                if raw:
                    return status, content
                return json.loads(content) if content else None
            try:
                for _ in range(200):
                    try:
                        request('GET', '/api/health')
                        break
                    except (OSError, AssertionError):
                        if proc.poll() is not None:
                            log.seek(0)
                            raise ServerFailed(log.read())
                        time.sleep(.1)
                else:
                    raise ServerFailed('server startup timed out')
                request.base_url = f'http://127.0.0.1:{port}'
                request.data_dir = data
                request.log = lambda: Path(log.name).read_text()
                yield request
            finally:
                proc.terminate()
                proc.wait(timeout=20)


@contextlib.contextmanager
def contacts():
    spec = importlib.util.spec_from_file_location('demo_retention', ROOT / 'deploy/demo/retention.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with tempfile.TemporaryDirectory(prefix='wikicontext-demo-contacts-') as tmp:
        store = module.Store(Path(tmp) / 'contacts.db')
        token = secrets.token_urlsafe(32)
        http = ThreadingHTTPServer(('127.0.0.1', 0), module.handler(store, token))
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        try:
            yield f'http://127.0.0.1:{http.server_port}', token, store
        finally:
            http.shutdown(); http.server_close(); thread.join()
