#!/usr/bin/env python3
"""Synthetic HTTP tests: shared FTS is gone; private per-requester search isolates spaces."""
import argparse
import contextlib
import json
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

from integration import ROOT, SEARCH, credentials


@contextlib.contextmanager
def running(binary, work, *, data=None):
    """Start an isolated copied app with synthetic failure fixtures."""
    work=Path(work);work.mkdir(exist_ok=True,parents=True)
    hooks=work/'pb_hooks'; migrations=work/'pb_migrations'
    shutil.copytree(ROOT/'pb_hooks',hooks,dirs_exist_ok=True)
    shutil.copytree(ROOT/'pb_migrations',migrations,dirs_exist_ok=True)
    cfg=json.loads((ROOT/'pocketcontext.json').read_text())
    (work/'pocketcontext.json').write_text(json.dumps(cfg))
    (hooks/'search_failure_fixture.pb.js').write_text('''
onRecordCreateExecute(e=>{
 if(e.record.getString('record')==='pubfailure00001'&&e.record.getString('action')==='update')throw new Error('Synthetic audit failure');
 e.next();
},'audit_log');
''')
    data=Path(data or work/'pb_data')
    common=[str(Path(binary).resolve()),'--dir',str(data),'--migrationsDir',str(migrations),'--hooksDir',str(hooks)]
    setup=subprocess.run(common+['superuser','upsert','admin@example.com','SyntheticAdminPassword123!'],cwd=work,capture_output=True,text=True)
    assert setup.returncode==0,setup.stdout+setup.stderr
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    with (work/'server.log').open('w+') as log:
        proc=subprocess.Popen(common+['serve','--http',f'127.0.0.1:{port}'],cwd=work,stdout=log,stderr=log)
        def request(method,path,body=None,token=None,expected=200):
            headers={'Content-Type':'application/json'}
            if token:headers['Authorization']=token
            req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method)
            try:
                with urllib.request.urlopen(req,timeout=60) as response:status,raw=response.status,response.read()
            except urllib.error.HTTPError as e:status,raw=e.code,e.read()
            assert status in (expected if isinstance(expected,tuple) else (expected,)),(method,path,status,raw.decode())
            return json.loads(raw) if raw else None
        request.data_dir=data
        try:
            for _ in range(150):
                try:request('GET','/api/health');break
                except (OSError,AssertionError):
                    if proc.poll() is not None:log.seek(0);raise AssertionError(log.read())
                    time.sleep(.1)
            else:raise AssertionError('startup timeout')
            yield request
        finally:proc.terminate();proc.wait(timeout=15)


class Fixture:
    def __init__(self,request,token):self.request=request;self.token=token
    def create(self,table,body):return self.request('POST','/api/collections/'+table+'/records',body,self.token)
    def query(self,sql):
        data=self.request('POST','/api/context/query',{'sql':sql},self.token)
        assert not data['truncated'];return [dict(zip(data['columns'],row)) for row in data['rows']]
    def run(self,key,**kwargs):return self.create('ingestion_runs',dict(key=key,status='staging',description='Synthetic search '+key,**kwargs))
    def page(self,slug):return self.create('pages',dict(slug=slug,kind='concept'))
    def revision(self,run,page,base='',**kwargs):
        return self.create('page_revisions',dict(dict(run=run['id'],page=page['id'],base_revision=base,title='Orchid guide',summary='Synthetic botanical research',body='Orchid evidence [needs verification].'),**kwargs))
    def publish(self,run,expected=200):
        result=self.request('PATCH','/api/collections/ingestion_runs/records/'+run['id'],{'status':'published','expected_revision':run['revision']},self.token,expected)
        if result.get('status')=='published':return self.query('SELECT id,sequence FROM publications ORDER BY sequence DESC LIMIT 1')[0]
        return result
    def search(self,pub,query='orchid',**kwargs):
        return self.request('POST','/api/context/search',dict(index='pages',scope=pub['id'],query=query,**kwargs),self.token)
    def generation(self):
        # Private search derives per-requester indexes; there is no shared generation record.
        return None


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--binary',required=True);args=parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='wikicontext-search-') as tmp, running(args.binary,Path(tmp)/'app') as request:
        admin,user,token=credentials(request);f=Fixture(request,token)
        # The shared all-space FTS index and its generation record no longer exist.
        assert 'search_state' not in {t['name'] for t in request('GET','/api/context/schema',token=token)['tables']}
        for table in ('published_pages_fts','published_pages_fts_content','search_state'):
            request('POST','/api/context/query',{'sql':'SELECT * FROM '+table},token,400)
        request('POST','/api/wiki/search/rebuild',{},admin,404)
        request('GET','/api/collections/search_state/records',token=admin,expected=404)
        p=f.page('orchid-one');q=f.page('orchid-two');first=f.run('first')
        r1=f.revision(first,p);r2=f.revision(first,q);pub1=f.publish(first)
        second=f.run('second');r3=f.revision(second,p,r1['id']);pub2=f.publish(second)
        archive=f.run('archive');f.revision(archive,q,r2['id'],archived=True);pub3=f.publish(archive)
        draft=f.run('draft');f.revision(draft,p,r3['id'],body='Orchid draftonly [needs verification].')
        if not SEARCH:
            request('POST','/api/context/search',dict(index='pages',scope=pub1['id'],query='orchid'),token,(400,404))
            print('PASS: shared FTS removed; private search not configured on this server')
            return
        # Private search: historical scopes, draft/archive exclusion and pagination.
        assert {x['id'] for x in f.search(pub1)['hits']}=={r1['id'],r2['id']}
        assert {x['id'] for x in f.search(pub2)['hits']}=={r3['id'],r2['id']}
        assert {x['id'] for x in f.search(pub3)['hits']}=={r3['id']}
        assert f.search(pub3,query='draftonly')['hits']==[]
        page1=f.search(pub2,limit=1)
        assert page1['hasMore'] and len(page1['hits'])==1
        page2=f.search(pub2,limit=1,offset=1,expectedGeneration=page1['generation'])
        assert not page2['hasMore'] and page1['hits'][0]['id']!=page2['hits'][0]['id']
        # Another account's space is invisible: its scope behaves like an absent publication.
        request('POST','/api/collections/users/records',{'email':'other@example.com','name':'Other','password':'SyntheticUserPassword123!','passwordConfirm':'SyntheticUserPassword123!'},admin)
        other=request('POST','/api/collections/users/auth-with-password',{'identity':'other@example.com','password':'SyntheticUserPassword123!'})['token']
        g=Fixture(request,other)
        op=g.page('orchid-one');orun=g.run('first');orev=g.revision(orun,op,body='Orchid private other [needs verification].');opub=g.publish(orun)
        foreign=request('POST','/api/context/search',dict(index='pages',scope=pub1['id'],query='orchid'),other,(400,403,404))
        absent=request('POST','/api/context/search',dict(index='pages',scope='missing00000000',query='orchid'),other,(400,403,404))
        assert foreign==absent,(foreign,absent)
        request('POST','/api/context/search',dict(index='pages',scope=opub['id'],query='orchid'),token,(400,403,404))
        assert [x['id'] for x in g.search(opub)['hits']]==[orev['id']]
        assert f.search(pub3,query='other')['hits']==[]
        # A new publication changes the generation of an existing continuation.
        old=f.search(pub1,limit=1);final=f.run('final');f.revision(final,p,r3['id']);f.publish(final)
        request('POST','/api/context/search',dict(index='pages',scope=pub1['id'],query='orchid',limit=1,offset=1,expectedGeneration=old['generation']),token,(200,409))
    print('PASS: shared FTS removed; private per-space search, history, draft/archive exclusion, pagination and cross-space isolation')


if __name__=='__main__':main()
