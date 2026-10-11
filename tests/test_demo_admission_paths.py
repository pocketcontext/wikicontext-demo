"""Future user/demo routes must not inherit the pre-enrollment exemption."""
import shutil
import subprocess
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class AdmissionPaths(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node required for hook runtime test')
    def test_explicit_paths_methods_and_own_identity(self):
        program = r'''
const vm=require('vm'),fs=require('fs'),assert=require('assert');
const context={module:{exports:{}}};vm.createContext(context);
vm.runInContext(fs.readFileSync('pb_hooks/demo.js','utf8')+'\nmodule.exports.exempt=exempt;',context);
const allowed=context.module.exports.exempt;
for(const path of ['/api/demo/status','/api/demo/enrollment','/api/demo/preferences',
 '/api/collections/users/auth-methods','/api/oauth2-redirect','/api/collections/users/records/alice']) {
 assert(allowed(path,'GET','alice'),path);
 assert(!allowed(path,'PATCH','alice'),path);
}
for(const path of ['/api/demo/enroll','/api/demo/unsubscribe','/api/collections/users/auth-refresh',
 '/api/collections/users/auth-with-oauth2']) {
 assert(allowed(path,'POST','alice'),path);
 assert(!allowed(path,'GET','alice'),path);
}
for(const path of ['/api/demo/future','/api/demo/enrollment/extra','/api/collections/users/future',
 '/api/collections/users/records','/api/collections/users/records/bob',
 '/api/collections/users/records/alice/extra','/api/collections/users/request-otp']) {
 for(const method of ['GET','POST','PATCH','DELETE']) assert(!allowed(path,method,'alice'),path);
}
'''
        result = subprocess.run(['node', '-e', program], cwd=ROOT, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
