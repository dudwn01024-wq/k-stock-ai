'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {selectDailyRows}=require('../services/observationDaily');
const {createPersonalAnalysisReader}=require('../services/personalAnalysisDashboard');
const {createPersonalAnalysisApp}=require('../services/personalAnalysisHttp');

const date='2026-09-28';
async function root(){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'personal-dashboard-'));
  for(const name of ['live-once','eod-analysis','news-evidence-bundles','news-collection-evidence'])
    await fs.mkdir(path.join(directory,name));
  return directory;
}
async function put(root,kind,id,value){
  await fs.writeFile(path.join(root,kind,`${id}.json`),JSON.stringify(value));
}
function daily(symbol='000660',targetDate=date,zeroScore=false){
  const count=130,end=Date.parse(`${targetDate}T00:00:00Z`);
  const rows=Array.from({length:count},(_,index)=>{
    const day=new Date(end-(count-index-1)*86400000).toISOString().slice(0,10).replaceAll('-','');
    const close=zeroScore?200-index:100+index;
    return {date:day,open:close,high:close+2,low:close-2,close,
      volume:zeroScore?(index===count-1?0:100):1000+index};
  });
  const target=rows.at(-1),selection=selectDailyRows([{
    startDate:rows[0].date,endDate:target.date,rows}],targetDate);
  const fields=Object.entries({stck_bsop_date:target.date,stck_oprc:String(target.open),
    stck_hgpr:String(target.high),stck_lwpr:String(target.low),
    stck_clpr:String(target.close),acml_vol:String(target.volume)});
  return {schemaVersion:'OBSERVATION_V2',recordType:'DAILY_COLLECTION',id:randomUUID(),
    approvalId:randomUUID(),symbol,scope:'kis-daily-only',source:'KIS_OPEN_API',
    targetBusinessDate:targetDate,testData:true,status:'COLLECTED',dailySelection:selection,
    targetOHLCV:{...target},receivedAt:'2026-09-28T07:00:00.000Z',
    evidence:{schemaVersion:'OBSERVATION_EVIDENCE_V1',exchanges:[{
      kind:'kisDaily',request:{params:{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:symbol,
        FID_INPUT_DATE_1:rows[0].date,FID_INPUT_DATE_2:target.date}},
      response:{status:'CAPTURED',fields:fields.map(([key,value])=>({
        path:`output2[0].${key}`,value,status:'PRESENT'}))}}]}};
}
async function withRoot(fn){const directory=await root();try{await fn(directory);}finally{await fs.rm(directory,{recursive:true,force:true});}}
const reader=root=>createPersonalAnalysisReader({roots:[root],allowTestData:true});

test('stored dates, ranked candidates, detail and valid zero score remain distinct from missing',async()=>withRoot(async directory=>{
  const a=daily('000660'),b=daily('005380',date,true),old=daily('035420','2026-09-23');
  for(const item of [a,b,old])await put(directory,'live-once',item.id,item);
  const before=await fs.readFile(path.join(directory,'live-once',a.id+'.json'));
  const r=reader(directory),dates=await r.dates();
  assert.deepEqual(dates.dates,[date,'2026-09-23']);
  const batch=await r.batch(date);
  assert.deepEqual(batch.candidates.map(item=>item.symbol),['000660','005380']);
  assert.equal(batch.candidates[1].analysisPriorityScore,0);
  assert.equal(batch.candidates[1].deepReviewSelected,false);
  const detail=await r.detail(date,'000660');
  assert.equal(detail.daily.evidenceRef,a.id);
  assert.equal(detail.investor,null);
  assert.equal(detail.news,null);
  assert.equal(detail.analysis,null);
  assert.equal(detail.riskReady,false);
  assert.deepEqual(await fs.readFile(path.join(directory,'live-once',a.id+'.json')),before);
}));

test('wrong symbol/date investor and EOD records cannot be mixed into detail',async()=>withRoot(async directory=>{
  const item=daily();await put(directory,'live-once',item.id,item);
  const investor={id:randomUUID(),recordType:'INVESTOR_COLLECTION',scope:'kis-investor-daily-only',
    source:'KIS_OPEN_API',testData:true,status:'COLLECTED',symbol:'005930',
    targetBusinessDate:date,investorSelection:{targetDate:date}};
  await put(directory,'live-once',investor.id,investor);
  const analysis={analysisRunId:randomUUID(),recordType:'EOD_DESCRIPTIVE_ANALYSIS',
    testData:true,symbol:item.symbol,targetDate:'2026-09-23',dailyEvidenceRef:item.id,
    createdAtKst:'2026-09-29T10:00:00+09:00'};
  await put(directory,'eod-analysis',analysis.analysisRunId,analysis);
  const detail=await reader(directory).detail(date,item.symbol);
  assert.equal(detail.investor,null);assert.equal(detail.analysis,null);
}));

test('corrupt records and conflicting IDs are held and disclosed',async()=>withRoot(async directory=>{
  const second=await root();try{
    const a=daily(),b=daily('005930');b.id=a.id;
    await put(directory,'live-once',a.id,a);await put(second,'live-once',b.id,b);
    await fs.writeFile(path.join(directory,'live-once',randomUUID()+'.json'),'{bad');
    const r=createPersonalAnalysisReader({roots:[directory,second],allowTestData:true});
    const dates=await r.dates();
    assert.ok(dates.issues.includes('DUPLICATE_RECORD_ID_CONFLICT'));
    assert.ok(dates.issues.includes('STORED_RECORD_INVALID'));
    assert.deepEqual(dates.dates,[]);
  }finally{await fs.rm(second,{recursive:true,force:true});}
}));

test('public API including OPTIONS is JSON 404, personal API accepts GET only',async()=>withRoot(async directory=>{
  const item=daily();await put(directory,'live-once',item.id,item);
  for(const mode of ['public','personal-local']){
    const app=createPersonalAnalysisApp({mode,roots:[directory],allowTestData:true});
    const server=app.listen(0,'127.0.0.1');
    try{
      await new Promise(resolve=>server.once('listening',resolve));
      const url=`http://127.0.0.1:${server.address().port}/api/personal-analysis/dates`;
      const options=await fetch(url,{method:'OPTIONS'});
      assert.equal(options.status,404);assert.equal((await options.json()).error,'NOT_FOUND');
      const response=await fetch(url);
      assert.equal(response.status,mode==='public'?404:200);
      if(mode==='personal-local')assert.equal((await response.json()).defaultTargetDate,date);
    }finally{await new Promise(resolve=>server.close(resolve));}
  }
}));

test('path selection is server-owned and no browser-supplied root is followed',async()=>withRoot(async directory=>{
  const item=daily();await put(directory,'live-once',item.id,item);
  const app=createPersonalAnalysisApp({roots:[directory],allowTestData:true});
  const server=app.listen(0,'127.0.0.1');
  try{
    await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}/api/personal-analysis`;
    const response=await fetch(`${base}/candidates?targetDate=${date}&recordRoot=C:%5Csecret`);
    assert.equal(response.status,200);
    assert.equal((await response.json()).candidates[0].dailyEvidenceRef,item.id);
    const invalid=await fetch(`${base}/detail/${date}/..%2Fsecret`);
    assert.equal(invalid.status,422);
  }finally{await new Promise(resolve=>server.close(resolve));}
}));
