'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createKisRecommendationStore,MAX_BYTES}=require('../services/kisRecommendationStore');
const {createAutonomousKisRecommendations}=require('../services/kisAutonomousRecommendations');
function fixture(t){const base=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'kstock-kis-store-'));
  if(path.relative(base,root).startsWith('..')||path.isAbsolute(path.relative(base,root)))throw Error('TEST_ONLY_INVALID_TEMP');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,directory:path.join(root,'state'),create:options=>createKisRecommendationStore({directory:path.join(root,'state'),verifyStorage:()=>true,fsyncDirectory:false,...options})};}
test('TEST_ONLY new storage cannot initialize while already ON, and corruption is not silently overwritten',t=>{
  const f=fixture(t),s=f.create();assert.equal(s.initialize().ready,false);
  const initial=f.create();assert.equal(initial.initialize({allowCreate:true}).ready,true);
  const file=path.join(f.directory,'state.json'),content=fs.readFileSync(file,'utf8');fs.writeFileSync(file,content.replace('KIS_AUTONOMOUS_RECOMMENDATIONS_V1','CORRUPTED'));
  const reopened=f.create();assert.equal(reopened.initialize({allowCreate:true}).ready,false);assert.match(reopened.status().reason,/STATE_INVALID/);
  assert.throws(()=>reopened.get());assert.ok(fs.readFileSync(file,'utf8').includes('CORRUPTED'));
});
test('TEST_ONLY uncertain write or fsync fails closed and leaves previous atomic file readable',t=>{
  for(const key of ['writeFileSync','fsyncSync','renameSync']){
    const f=fixture(t),s=f.create();s.initialize({allowCreate:true});const before=fs.readFileSync(path.join(f.directory,'state.json'),'utf8');
    const io={...fs,[key]:()=>{throw Error('TEST_ONLY_IO_FAILURE');}},failing=f.create({io});assert.equal(failing.initialize().ready,true);
    assert.throws(()=>failing.save(failing.get()));assert.equal(failing.status().ready,false);assert.equal(fs.readFileSync(path.join(f.directory,'state.json'),'utf8'),before);
    assert.equal(f.create().initialize().ready,true);
  }
});
test('TEST_ONLY unverified disk, symlink storage and over-limit data are rejected before use',t=>{
  const f=fixture(t),unverified=f.create({verifyStorage:()=>false});assert.equal(unverified.initialize({allowCreate:true}).ready,false);
  assert.equal(fs.existsSync(f.directory),false);const s=f.create();s.initialize({allowCreate:true});
  const linked=f.create({io:{...fs,lstatSync:file=>Object.assign(fs.lstatSync(file),{isSymbolicLink:()=>true})}});
  assert.equal(linked.initialize().ready,false);
  const value=s.get();value.base={provenance:'KIS_AUTONOMOUS_RECOMMENDATIONS_V1',id:'TEST-ONLY-CAPACITY',mode:'expanded500',
    scanStartedAt:'2026-10-15T00:00:00Z',scanCompletedAt:'2026-10-15T00:01:00Z',reviewSymbols:['005930'],
    items:[{symbol:'005930',strategy:{dataMetadata:{supply:{source:'KIS_INTRADAY_ESTIMATE'}}},news:[{summary:'X'.repeat(MAX_BYTES)}]}]};
  assert.throws(()=>s.save(value),{code:'KIS_RECOMMENDATION_CAPACITY'});
  assert.equal(s.status().ready,false);
});
test('TEST_ONLY older NAVER history cannot masquerade as an autonomous base',t=>{
  const f=fixture(t),s=f.create();s.initialize({allowCreate:true});const value=s.get();
  value.base={id:'TEST-ONLY-NAVER',mode:'expanded500',provenance:'RECOMMENDATION_HISTORY_V2',items:[],reviewSymbols:['005930'],
    scanStartedAt:'2026-10-15T00:00:00Z',scanCompletedAt:'2026-10-15T00:01:00Z'};
  assert.throws(()=>s.save(value),{code:'KIS_RECOMMENDATION_STATE_INVALID'});
});
test('TEST_ONLY unavailable storage cannot start an unattended runtime or return scored results',t=>{
  const f=fixture(t),s=f.create();s.initialize();let attempts=0;
  const service=createAutonomousKisRecommendations({env:{KIS_AUTONOMOUS_RECOMMENDATIONS_ENABLED:'true',KIS_SCHEDULED_SUPPLY_ENABLED:'true',KIS_SCHEDULED_SUPPLY_SCORE_ENABLED:'true'},store:s,
    projectRecommendations:()=>{throw Error('TEST_ONLY_NOT_REACHED');},runtimeFactory:()=>({scheduled:{status:()=>({enabled:false}),resolve:()=>null,view:()=>({}),stop(){attempts++;}},adapter:{}})});
  assert.equal(service.start(),false);assert.equal(service.latest().status,'PENDING');assert.deepEqual(service.latest().recommendations,[]);assert.equal(attempts,0);
});
