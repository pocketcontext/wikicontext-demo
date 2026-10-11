"""Real Linux process/ownership boundaries; run as root in the image gate."""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = Path(os.environ.get('WIKICONTEXT_TEST_CHILD_PRIVILEGES', ROOT/'deploy/demo/child_privileges.py'))
if os.environ.get('WIKICONTEXT_TEST_REQUIRE_PRIVILEGES') == 'true' and os.getuid() != 0:
    raise RuntimeError('root process isolation validation is required')
spec = importlib.util.spec_from_file_location('isolated_runtime', os.environ.get('WIKICONTEXT_TEST_ONCE_RUNTIME', ROOT/'deploy/demo/once_runtime.py'))
runtime = importlib.util.module_from_spec(spec); spec.loader.exec_module(runtime)


@unittest.skipUnless(os.getuid() == 0, 'requires isolated root process/container validation')
class PrivilegeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='wikicontext-privileges-')
        self.root = Path(self.tmp.name)
        for name in ('control','runtime','persistent'):
            (self.root/name).mkdir(mode=0o700)
        (self.root/'runtime/pb_data').mkdir(mode=0o700)
        self.backend = runtime.Backend(self.root, 'https://synthetic.invalid')
        self.backend.privileges = str(HELPER)
        self.backend.prepare_storage('app')
        self.backend.prepare_storage('contacts')

    def tearDown(self):
        self.backend.close()
        self.tmp.cleanup()

    def child(self, identity, code, *args, **kwargs):
        return subprocess.run([sys.executable,'-I',str(HELPER),identity,sys.executable,'-I','-c',code,*map(str,args)],
                              capture_output=True,text=True,timeout=10,**kwargs)

    def test_child_files_processes_capabilities_and_root_fence(self):
        (self.root/'control/runtime.json').write_text('synthetic-root-secret')
        (self.root/'control/runtime.json').chmod(0o600)
        self.backend.app_fence({'phase':'initialized'})
        for identity,uid,own,foreign in [('app',10001,'runtime','persistent'),('contacts',10002,'persistent','runtime')]:
            with self.subTest(identity=identity):
                result=self.child(identity, '''
import json,os,signal,sys
from pathlib import Path
root=Path(sys.argv[1]);own=sys.argv[2];foreign=sys.argv[3];identity=sys.argv[4]
assert os.getuid()==int(sys.argv[5]) and os.getgid()==int(sys.argv[5]) and os.getgroups()==[]
status=Path('/proc/self/status').read_text().splitlines()
values=dict(line.split(':',1) for line in status if ':' in line)
for name in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb'):assert int(values[name],16)==0
assert values['NoNewPrivs'].strip()=='1'
(root/own/'own-file').write_text('synthetic')
for path in (root/foreign/'foreign-file',root/'control/runtime.json'):
 try:path.read_bytes()
 except PermissionError:pass
 else:raise AssertionError('cross-identity read allowed')
 try:Path('/proc/'+str(os.getppid())+'/environ').read_bytes()
 except PermissionError:pass
 else:raise AssertionError('root guardian environment readable')
 try:os.kill(os.getppid(),signal.SIGUSR1)
 except PermissionError:pass
 else:raise AssertionError('root guardian signal allowed')
fence=root/'control/reset-pending.json'
if identity=='app':assert json.loads(fence.read_text())['phase']=='initialized'
for action in (lambda:fence.write_text('changed'),lambda:fence.unlink(),lambda:os.setuid(0)):
 try:action()
 except PermissionError:pass
 else:raise AssertionError('privilege boundary writable')
''',self.root,own,foreign,identity,uid)
                self.assertEqual(result.returncode,0,result.stderr)

    def test_lease_stays_in_guardian_and_graceful_termination(self):
        lease=self.root/'control/writer.lock'
        with lease.open('w') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            self.backend.lease=lock.fileno()
            marker=self.root/'runtime/ready'
            code='''
import os,signal,sys,time
from pathlib import Path
for path in Path('/proc/self/fd').iterdir():
 try:target=os.readlink(path)
 except FileNotFoundError:continue
 assert not target.endswith('/writer.lock')
marker=Path(sys.argv[1]);marker.write_text('ready')
signal.signal(signal.SIGTERM,lambda *_:sys.exit(0))
while True:time.sleep(.1)
'''
            self.backend.launch('app',[sys.executable,'-I','-c',code,str(marker)],{'WIKICONTEXT_DEMO_ONCE_CHILD':'app'})
            for _ in range(100):
                if marker.exists():break
                time.sleep(.02)
            self.assertTrue(marker.exists())
        with lease.open('r') as probe:
            with self.assertRaises(BlockingIOError):fcntl.flock(probe,fcntl.LOCK_EX|fcntl.LOCK_NB)
        self.backend.stop_app()
        with lease.open('r') as probe:fcntl.flock(probe,fcntl.LOCK_EX|fcntl.LOCK_NB)
        self.backend.lease=None

    def test_ingress_does_not_inherit_writer_lease(self):
        lease=self.root/'control/writer.lock';marker=self.root/'gate-ready'
        with lease.open('w') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);self.backend.lease=lock.fileno()
            self.backend.launch('gate',[sys.executable,'-I','-c',
                'from pathlib import Path;import time,sys;Path(sys.argv[1]).touch();time.sleep(30)',str(marker)],{})
            for _ in range(100):
                if marker.exists():break
                time.sleep(.01)
            self.assertTrue(marker.exists())
        with lease.open('r') as probe:fcntl.flock(probe,fcntl.LOCK_EX|fcntl.LOCK_NB)
        self.backend.lease=None

    def test_timeout_drains_child_before_releasing_guardian_lease(self):
        lease=self.root/'control/writer.lock'
        marker=self.root/'runtime/child.json'
        code='''
import json,os,signal,sys,time
from pathlib import Path
marker=Path(sys.argv[1])
def stop(*_):
 time.sleep(.1);marker.write_text(json.dumps({'pid':os.getpid(),'drained':True}));sys.exit(0)
signal.signal(signal.SIGTERM,stop)
marker.write_text(json.dumps({'pid':os.getpid(),'drained':False}))
while True:time.sleep(.05)
'''
        with lease.open('w') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            self.backend.lease=lock.fileno()
            with self.assertRaisesRegex(runtime.RuntimeErrorSafe,'timed out'):
                self.backend.execute([sys.executable,'-I','-c',code,str(marker)],{'WIKICONTEXT_DEMO_ONCE_CHILD':'app'},timeout=.5)
            result=json.loads(marker.read_text())
            self.assertTrue(result['drained'])
            with self.assertRaises(ProcessLookupError):os.kill(result['pid'],0)
            self.assertNotIn('app-operation',self.backend.processes)
        self.backend.lease=None
        with lease.open('r') as probe:fcntl.flock(probe,fcntl.LOCK_EX|fcntl.LOCK_NB)

    def test_guardian_reaps_adopted_descendant_before_releasing_lease(self):
        lease=self.root/'control/writer.lock';marker=self.root/'runtime/orphan'
        code='''
import os,signal,sys,time
from pathlib import Path
marker=Path(sys.argv[1])
if os.fork()==0:
 os.setsid()
 signal.signal(signal.SIGTERM,lambda *_:None)
 marker.write_text(str(os.getpid()))
 time.sleep(1)
 os._exit(0)
while not marker.exists():time.sleep(.01)
'''
        with lease.open('w') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);self.backend.lease=lock.fileno()
            self.backend.launch('app',[sys.executable,'-I','-c',code,str(marker)],{'WIKICONTEXT_DEMO_ONCE_CHILD':'app'})
            for _ in range(100):
                if marker.exists():break
                time.sleep(.01)
            self.assertTrue(marker.exists())
        with lease.open('r') as probe:
            with self.assertRaises(BlockingIOError):fcntl.flock(probe,fcntl.LOCK_EX|fcntl.LOCK_NB)
        self.assertEqual(self.backend.processes['app'].wait(timeout=5),0)
        with self.assertRaises(ProcessLookupError):os.kill(int(marker.read_text()),0)
        with lease.open('r') as probe:fcntl.flock(probe,fcntl.LOCK_EX|fcntl.LOCK_NB)
        self.backend.lease=None

    def test_migration_rejects_links_before_changing_external_ownership(self):
        outside=self.root/'outside';outside.write_text('synthetic')
        for kind in ('symlink','hardlink'):
            with self.subTest(kind=kind):
                alias=self.root/'runtime/alias'
                if kind=='symlink':alias.symlink_to(outside)
                else:os.link(outside,alias)
                try:
                    with self.assertRaises(runtime.RuntimeErrorSafe):self.backend.prepare_storage('app')
                    self.assertEqual(outside.stat().st_uid,0)
                finally:alias.unlink()

    def test_legacy_root_owned_database_migrates_without_changing_bytes(self):
        for identity,folder,uid in [('app','runtime',10001),('contacts','persistent',10002)]:
            path=self.root/folder/'legacy.db';path.write_bytes(b'synthetic legacy bytes')
            self.backend.prepare_storage(identity)
            self.assertEqual(path.stat().st_uid,uid)
            self.assertEqual(path.stat().st_mode&0o777,0o600)
            self.assertEqual(path.read_bytes(),b'synthetic legacy bytes')


if __name__=='__main__':unittest.main()
