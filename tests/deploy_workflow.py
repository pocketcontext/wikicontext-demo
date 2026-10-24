#!/usr/bin/env python3
"""Validate deployment gating and exercise SSH/health scripts with synthetic tools."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = (ROOT / '.github/workflows/image.yml').read_text()
APP = 'wikicontext'  # Repository identity must not depend on a worktree directory name.
PUBLICATION = WORKFLOW
DEMO, DEMO_DEPLOY = WORKFLOW.split('  demo_manifest:\n', 1)[1].split('  demo_deploy:\n', 1)


def demo_script(step, source=DEMO):
    section = source.split('      - name: ' + step + '\n', 1)[1].split('      - ', 1)[0]
    body = section.split('        run: |\n', 1)[1]
    return '\n'.join(line[10:] for line in body.splitlines() if line.startswith('          '))


class DeploymentTests(unittest.TestCase):
    def test_demo_cd_has_independent_gates_and_no_production_path(self):
        self.assertEqual(DEMO_DEPLOY.splitlines()[0].strip(), "if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request' && vars.WIKICONTEXT_DEMO_DEPLOY_ENABLED == 'true' && vars.WIKICONTEXT_DEMO_DEPLOY_PAUSED != 'true'")
        self.assertIn('    needs:\n      - demo_manifest\n', DEMO_DEPLOY)
        self.assertIn('    environment:\n      name: pocketdeploy-v2\n', DEMO_DEPLOY)
        self.assertIn('      group: deploy-wikicontext-demo\n      cancel-in-progress: false', DEMO_DEPLOY)
        self.assertNotIn('DEMO_DIGEST', DEMO_DEPLOY)
        self.assertNotIn('always()', DEMO_DEPLOY)
        self.assertNotIn(':latest', DEMO_DEPLOY)
        self.assertNotIn('COLORS_PROFILE', DEMO_DEPLOY)
        self.assertLess(DEMO_DEPLOY.index('Require current demo deployment revision'), DEMO_DEPLOY.index('Reconcile configured demo'))
        self.assertNotIn('\n  deploy:', WORKFLOW)
        self.assertNotIn('\n  manifest:', WORKFLOW)
        self.assertNotIn('vars.WIKICONTEXT_PUBLISH', WORKFLOW)
        self.assertNotIn('vars.COLORS_PROFILE', WORKFLOW)
        self.assertIn('IMAGE: ghcr.io/pocketcontext/wikicontext-demo\n', WORKFLOW)
        # No production WikiContext publication, environment, secret, host or image.
        for forbidden in ('once-v2', 'COLORS_PROFILE', 'CONTEXT_DEPLOY_PAUSED', 'wiki.pocketcontext.com',
                          'image-release', 'gh release', 'contents: write'):
            self.assertNotIn(forbidden, WORKFLOW)
        import re
        self.assertEqual(set(re.findall(r'ghcr\.io/pocketcontext/[a-z-]+', WORKFLOW)), {'ghcr.io/pocketcontext/wikicontext-demo'})
        self.assertEqual(re.findall(r'environment:\n\s+name: (\S+)', WORKFLOW), ['pocketdeploy-v2'])
        self.assertEqual(set(re.findall(r'secrets\.([A-Z_]+)', WORKFLOW)), {'GITHUB_TOKEN', 'SSH_PRIVATE_KEY'})

    def test_demo_ssh_trigger_only_receipt_and_failures(self):
        for mode in ('success', 'hostkey', 'host', 'user', 'ssh', 'receipt'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for name in ('ssh-agent', 'ssh-add', 'ssh'):
                    path = root/name
                    path.write_text('#!' + sys.executable + '\n'
                        'import json,os,sys\nfrom pathlib import Path\n'
                        'name=Path(sys.argv[0]).name\n'
                        'if name=="ssh-add": sys.stdin.read()\n'
                        'if name=="ssh":\n'
                        ' request=sys.stdin.read()\n'
                        ' Path(os.environ["TEST_CALL"]).write_text(json.dumps({"args":sys.argv[1:],"request":request}))\n'
                        ' if os.environ["TEST_MODE"]=="ssh":sys.exit(17)\n'
                        ' print(json.dumps({"ok":os.environ["TEST_MODE"]!="receipt"}))\n')
                    path.chmod(0o700)
                env = dict(os.environ, HOME=str(root), PATH=str(root)+':'+os.environ['PATH'],
                           RUNNER_TEMP=str(root), SERVER_USER='-bad' if mode=='user' else 'ubuntu',
                           SERVER_IP='bad host' if mode=='host' else '192.0.2.1', SSH_PRIVATE_KEY='synthetic-secret',
                           SSH_KNOWN_HOSTS='' if mode=='hostkey' else 'synthetic-host-key',
                           GITHUB_SHA='c'*40, TEST_CALL=str(root/'call'), TEST_MODE=mode)
                result = subprocess.run(['bash','-c',demo_script('Reconcile configured demo over restricted SSH', DEMO_DEPLOY)], env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode==0, mode=='success', result.stderr)
                self.assertNotIn('synthetic-secret',result.stdout+result.stderr)
                if mode in ('hostkey','host','user'):
                    self.assertFalse((root/'call').exists())
                else:
                    call=json.loads((root/'call').read_text())
                    self.assertEqual(call['args'],['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15','ubuntu@192.0.2.1'])
                    self.assertEqual(call['request'], '')

    def test_public_attestation_rejects_stale_assets_contracts_and_open_sql(self):
        import hashlib
        import io
        from unittest.mock import patch
        from datetime import datetime, timezone
        from urllib.error import HTTPError
        program=demo_script('Verify running demo revision, assets and installation',DEMO_DEPLOY).split("python3 - <<'PY'\n",1)[1].rsplit('\nPY',1)[0]
        origin='https://wiki-demo.pocketcontext.com'
        pin='c'*40
        launcher='wikicontext-client = { git = "https://github.com/pocketcontext/wikicontext-demo.git", rev = "'+pin+'" }\n'
        for mode in ('success','generation','legal','asset','pin','foreign','unready','sql','root','revision','changed','redirect','image_revision','pull','exact','older','diverged','off_main','main_lookup','compare_lookup','bad_head','bad_trigger','main_tip','bad_compare'):
            with self.subTest(mode=mode):
                revision='a'*40 if mode=='exact' else 'd'*40  # A verified main descendant may supersede this checkout.
                source='https://raw.githubusercontent.com/pocketcontext/wikicontext-demo/'+revision
                installation={'method':'skills','skill':'wikicontext',
                    'source':'https://github.com/pocketcontext/wikicontext-demo/tree/main/skills/wikicontext',
                    'clientRevision':pin}
                if mode=='foreign':installation['source']='https://foreign.example/skill'
                if mode=='pin':installation['clientRevision']='0'*40
                assets={'index.html':b'<!doctype html><script src="/assets/reader.js"></script>', 'assets/reader.js':b'const reader = true'}
                responses={'/terms/':(ROOT/'legal/terms.html').read_bytes(),'/privacy/':(ROOT/'legal/privacy.html').read_bytes(),
                           '/legal/legal.css':(ROOT/'legal/legal.css').read_bytes(),'/':assets['index.html'], '/assets/reader.js':assets['assets/reader.js']}
                source_responses={'/skills/wikicontext/wikicontext':launcher.encode()}
                for path,name in (('/terms/','terms.html'),('/privacy/','privacy.html'),('/legal/legal.css','legal.css')):
                    source_responses['/legal/'+name]=responses[path]
                if mode=='legal':responses['/privacy/']=b'stale'
                if mode=='asset':responses['/assets/reader.js']=b'stale'
                if mode=='sql':responses['/api/context/schema']=b'{}'
                if mode=='root':del responses['/']
                responses['/up']=json.dumps({'ready':mode!='unready','revision':'invalid' if mode=='revision' else revision}).encode()
                status={'enabled':True,'clientReady':True,'generation':'2000-01-01' if mode=='generation' else datetime.now(timezone.utc).date().isoformat(),'installation':installation}
                responses['/api/demo/status']=json.dumps(status).encode()
                runtime_reads=0
                docker_calls=[]
                def fetch(request,timeout):
                    nonlocal runtime_reads
                    self.assertEqual(request.get_header('User-agent'),'WikiContext-Demo-Release-Check/1.0')
                    url=request.full_url
                    base=source if url.startswith(source+'/') else origin
                    self.assertTrue(url.startswith(base+'/'))
                    path=url.removeprefix(base)
                    mapping=source_responses if base==source else responses
                    if path=='/api/context/schema' and path not in mapping:raise HTTPError(url,401,'Unauthorized',{},None)
                    if path not in mapping:raise HTTPError(url,404,'Not found',{},None)
                    body=mapping[path]
                    if path=='/up':
                        runtime_reads+=1
                        if mode=='changed' and runtime_reads%2==0:body=json.dumps({'ready':True,'revision':'e'*40}).encode()
                    data=io.BytesIO(body);data.status=200;data.geturl=lambda:'https://foreign.example/' if mode=='redirect' else url
                    return data
                def docker(args,**kwargs):
                    if args[0]=='gh':
                        self.assertEqual(args[:2],['gh','api'])
                        endpoint=args[2]
                        self.assertTrue(endpoint.startswith('repos/pocketcontext/wikicontext-demo/'))
                        if endpoint.endswith('/git/ref/heads/main'):
                            if mode=='main_lookup':raise subprocess.CalledProcessError(1,args)
                            output='invalid' if mode=='bad_head' else revision if mode=='main_tip' else 'f'*40
                        elif endpoint.endswith('/compare/'+'a'*40+'...'+revision):
                            if mode=='compare_lookup':raise subprocess.CalledProcessError(1,args)
                            output={'older':'behind','diverged':'diverged','bad_compare':'unexpected'}.get(mode,'ahead')
                        elif endpoint.endswith('/compare/'+revision+'...'+(revision if mode=='main_tip' else 'f'*40)):
                            output='diverged' if mode=='off_main' else 'identical' if mode=='main_tip' else 'ahead'
                        else:raise AssertionError(args)
                        return subprocess.CompletedProcess(args,0,output,'')
                    self.assertEqual(args[0],'docker');docker_calls.append(args[1:])
                    output=''
                    if args[1]=='pull':
                        self.assertEqual(args[2],'ghcr.io/pocketcontext/wikicontext-demo:sha-'+revision)
                        if mode=='pull':raise subprocess.CalledProcessError(1,args)
                    elif args[1:3]==['image','inspect']:
                        output='sha256:'+'f'*64 if args[-1]=='{{.Id}}' else ('e'*40 if mode=='image_revision' else revision)
                    elif args[1]=='create':output='synthetic-container'
                    elif args[1]=='cp':
                        self.assertEqual(args[2],'synthetic-container:/app/ui/dist/.')
                        for name,body in assets.items():
                            path=Path(args[3])/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(body)
                    elif args[1]!='rm':raise AssertionError(args)
                    return subprocess.CompletedProcess(args,0,output,'')
                with patch('urllib.request.urlopen',side_effect=fetch),patch('subprocess.run',side_effect=docker),patch('time.sleep'),patch('builtins.print'),patch.dict(os.environ,{'GITHUB_SHA':'invalid' if mode=='bad_trigger' else 'a'*40}):
                    if mode in ('success','exact','main_tip'):exec(program,{})
                    else:
                        with self.assertRaises(SystemExit):exec(program,{})
                if mode in ('success','asset','sql','root','changed'):
                    self.assertIn(['rm','synthetic-container'],docker_calls)

    def test_demo_publication_requires_main_and_successful_validation(self):
        build = PUBLICATION.split('  build:\n', 1)[1].split('  demo_manifest:\n', 1)[0]
        self.assertIn("if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main' && vars.WIKICONTEXT_DEMO_PUBLISH == 'true'", build)
        self.assertEqual(DEMO.splitlines()[0].strip(), "if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request' && vars.WIKICONTEXT_DEMO_PUBLISH == 'true'")
        self.assertIn('    needs:\n      - build\n', DEMO)
        self.assertNotIn('DEPLOY_PAUSED', build)
        self.assertLess(DEMO.index('Require current demo revision'), DEMO.index('Create and push'))
        self.assertIn('digest: ${{ steps.publish.outputs.digest }}', DEMO)
        self.assertNotIn('continue-on-error', DEMO + DEMO_DEPLOY)
        self.assertIn("cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}", WORKFLOW)

    def test_demo_guard_rejects_stale_or_failed_lookup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gh = root / 'gh'
            gh.write_text('#!/bin/sh\n[ "$2" = "repos/example/app/git/ref/heads/main" ] || exit 12\nprintf "%s\\n" "$SYNTHETIC_HEAD"\nexit "$SYNTHETIC_EXIT"\n')
            gh.chmod(0o700)
            for head, status, success in [('a'*40, '0', True), ('b'*40, '0', False), ('', '0', False), ('bad', '0', False), ('a'*40, '1', False)]:
                with self.subTest(head=head, status=status):
                    env = dict(os.environ, PATH=str(root)+':'+os.environ['PATH'], GITHUB_SHA='a'*40,
                               GITHUB_REPOSITORY='example/app', SYNTHETIC_HEAD=head, SYNTHETIC_EXIT=status)
                    for step, source in [('Require current demo revision', DEMO), ('Require current demo deployment revision', DEMO_DEPLOY)]:
                        result = subprocess.run(['bash', '-c', demo_script(step, source)], env=env, capture_output=True, text=True)
                        self.assertEqual(result.returncode == 0, success, result.stderr)

    def test_demo_tags_and_digest_output_and_invalid_inputs(self):
        for files, success in [(['a'*64, 'b'*64], True), (['a'*64], False), (['a'*64, 'invalid'], False), (['a'*64, 'b'*64, 'c'*64], False)]:
            with self.subTest(files=files), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                inputs = root / 'digests'
                inputs.mkdir()
                for name in files:
                    (inputs / name).touch()
                docker = root / 'docker'
                docker.write_text('#!' + sys.executable + '\n'
                    'import json, os, sys\nfrom pathlib import Path\n'
                    'Path(os.environ["SYNTHETIC_CALLS"]).write_text(json.dumps(sys.argv[1:]))\n'
                    'Path(sys.argv[sys.argv.index("--metadata-file")+1]).write_text(json.dumps({"containerimage.descriptor":{"digest":"sha256:"+"c"*64}}))\n')
                docker.chmod(0o700)
                env = dict(os.environ, PATH=str(root)+':'+os.environ['PATH'], IMAGE='ghcr.io/example/wikicontext',
                           GITHUB_SHA='d'*40, RUNNER_TEMP=str(root), GITHUB_OUTPUT=str(root/'output'),
                           GITHUB_STEP_SUMMARY=str(root/'summary'), SYNTHETIC_CALLS=str(root/'calls'))
                result = subprocess.run(['bash', '-c', demo_script('Create and push the demo manifest')], cwd=inputs, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode == 0, success, result.stderr)
                if not success:
                    self.assertFalse((root/'calls').exists())
                    continue
                args = json.loads((root/'calls').read_text())
                self.assertEqual([args[i+1] for i, arg in enumerate(args) if arg == '--tag'],
                                 [env['IMAGE']+':latest', env['IMAGE']+':sha-'+env['GITHUB_SHA']])
                self.assertEqual(args[-2:], [env['IMAGE']+'@sha256:'+name for name in files])
                self.assertEqual((root/'output').read_text(), 'digest=sha256:'+'c'*64+'\n')
                self.assertIn(env['IMAGE']+'@sha256:'+'c'*64, (root/'summary').read_text())

    def test_retired_commands_fail_closed_with_guidance(self):
        for filename in ('install.py', f'deploy-{APP}.py'):
            for extra in ([], ['unexpected-target']):
                with self.subTest(filename=filename, extra=extra):
                    result = subprocess.run([sys.executable, '-I', str(ROOT / 'deploy' / filename), *extra],
                                            env={'PATH': '/nonexistent'}, capture_output=True, text=True)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('once-pocketcontext-v2', result.stderr)
                    self.assertIn('retired', result.stderr)
                    self.assertEqual(result.stdout, '')


    def test_application_and_container_checks_cover_both_architectures(self):
        application = (ROOT / '.github/workflows/test.yml').read_text()
        triggers = application.split('permissions:', 1)[0]
        self.assertIn('  workflow_call:', triggers)
        self.assertNotIn('  push:', triggers)
        self.assertNotIn('  pull_request:', triggers)
        self.assertIn('ubuntu-24.04-arm', application)
        self.assertIn('python3 wikicontext/tests/spaces.py --binary pocketcontext/bin/pocketcontext', application)
        self.assertIn('python3 wikicontext/tests/demo_website.py --binary pocketcontext/bin/pocketcontext', application)
        self.assertIn('cp wikicontext/skills/wikicontext/wikicontext "$RUNNER_TEMP/wikicontext-released"', application)
        self.assertIn('--client "$RUNNER_TEMP/wikicontext-released" --trace', application)
        self.assertIn('export UV_CACHE_DIR="$RUNNER_TEMP/wikicontext-released-cache"', application)
        check = PUBLICATION.split('  check:', 1)[1].split('  tests:', 1)[0]
        self.assertIn('runner: ubuntu-24.04-arm', check)
        self.assertIn('runner: ubuntu-24.04', check)
        self.assertIn('python3 docker/once_smoke.py --image wikicontext:ci', check)
        self.assertIn("-p 'test_demo_*.py'", check)
        self.assertIn('python3 docker/standard_demo_smoke.py --image wikicontext:ci', check)
        self.assertIn('WIKICONTEXT_TEST_REQUIRE_NGINX=true', check)
        self.assertIn('wikicontext:ci /tmp/test_demo_proxy_headers.py', check)
        self.assertIn('WIKICONTEXT_TEST_REQUIRE_PRIVILEGES=true', check)
        self.assertIn('wikicontext:ci /tmp/test_demo_privileges.py', check)
        self.assertIn('WIKICONTEXT_TEST_LITESTREAM="$RUNNER_TEMP/wikicontext-litestream"', check)
        for mode in (' config --image ', ' smoke --image '):
            self.assertIn(mode, check)
        self.assertTrue(' restore --image ' in check or 'docker/object_storage_smoke.py' in check)
        tests = PUBLICATION.split('  tests:', 1)[1].split('  build:', 1)[0]
        self.assertNotIn('    if:', tests)
        build = PUBLICATION.split('  build:', 1)[1].split('  demo_manifest:', 1)[0]
        self.assertIn('      - check', build)
        self.assertIn('      - tests', build)



if __name__ == '__main__':
    unittest.main()
