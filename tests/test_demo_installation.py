"""The installation contract derives from the packaged public launcher, fail closed."""
import json
import shutil
import subprocess
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
DEMO_SOURCE = 'wikicontext-client = { git = "https://github.com/pocketcontext/wikicontext-demo.git", rev = "' + 'b' * 40 + '" }'


class PublicInstallation(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node required for hook runtime test')
    def test_launcher_pin_contract_and_invalid_sources(self):
        launcher = (ROOT / 'skills/wikicontext/wikicontext').read_text()
        import re
        demo = re.sub(r'wikicontext-client = \{ git = "[^"]+", rev = "[a-f0-9]{40}" \}', DEMO_SOURCE, launcher)
        self.assertIn(DEMO_SOURCE, demo)
        program = r'''
const vm=require('vm'),fs=require('fs'),assert=require('assert');
const launcher=process.argv[1];
const demo=fs.readFileSync('pb_hooks/demo.js','utf8')+'\nmodule.exports.publicInstallation=publicInstallation;';
for(const mode of ['valid','missing','oversized','unpinned','wrong-repository','upstream','ambiguous']) {
 const context={module:{exports:{}},require,toString:value=>String(value),$os:{readFile:path=>{
  assert.equal(path,'skills/wikicontext/wikicontext');
  if(mode==='missing')throw Error('missing');
  if(mode==='oversized')return 'x'.repeat(4097);
  if(mode==='unpinned')return launcher.replace(/rev = "[a-f0-9]{40}"/, 'rev = "main"');
  if(mode==='wrong-repository')return launcher.replace('github.com/pocketcontext/wikicontext-demo.git','github.com/other/client.git');
  if(mode==='upstream')return launcher.replace('wikicontext-demo.git','wikicontext.git');
  if(mode==='ambiguous')return launcher+'\n# '+launcher.split('\n').find(line=>line.includes('wikicontext-client = {'));
  return launcher;
 }}};
 vm.createContext(context);vm.runInContext(demo,context);
 const result=context.module.exports.publicInstallation();
 assert.equal(!!result,mode==='valid',mode);
 if(result){
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{method:'skills',skill:'wikicontext',
   source:'https://github.com/pocketcontext/wikicontext-demo/tree/main/skills/wikicontext',clientRevision:'b'.repeat(40)});
 }
}
'''
        result = subprocess.run(['node', '-e', program, demo], cwd=ROOT, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_shipped_launcher_state_is_reported_not_assumed(self):
        # The demo advertises installation only after the launcher pins the dedicated repository.
        text = (ROOT / 'skills/wikicontext/wikicontext').read_text()
        self.assertRegex(text, r'wikicontext-client = \{ git = "https://github\.com/pocketcontext/wikicontext-demo\.git", rev = "[a-f0-9]{40}" \}')
        self.assertEqual(text.count('wikicontext-client = {'), 1)


if __name__ == '__main__':
    unittest.main()
