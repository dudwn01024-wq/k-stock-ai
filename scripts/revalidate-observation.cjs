'use strict';
// Offline only: an already-saved sanitized observation, never a provider or credential loader.
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {reviewObservationFreshness}=require('../services/observationFreshness');
const {POLICY,createEodInputs,evaluateEod}=require('../services/observationEod');
const {calculateDailyInputs}=require('../services/observationDaily');
const {cleanInput}=require('../services/strategyObservation');
const root=path.resolve(__dirname,'../.local/strategy-observations');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function revalidate(id,{directory=root,clock=()=>new Date().toISOString()}={}) {
  if(!/^[a-f0-9-]{36}$/.test(id))throw Error('INVALID_RECORD_ID');
  const originalPath=path.join(directory,'live-once',`${id}.json`);
  const bytes=await fs.readFile(originalPath),original=JSON.parse(bytes);
  if(original.id!==id||original.symbol!=='005930'||original.testData!==false)throw Error('ORIGINAL_RECORD_MISMATCH');
  // Collection records have no strategy inputs/policy; never promote them into strategy reviews.
  if(original.scope==='kis-daily-only')throw Error('DAILY_COLLECTION_IS_NOT_STRATEGY_OBSERVATION');
  if(original.scope==='kis-investor-daily-only')throw Error('INVESTOR_COLLECTION_IS_NOT_STRATEGY_OBSERVATION');
  if(original.scope==='naver-news-only')throw Error('NEWS_COLLECTION_IS_NOT_STRATEGY_OBSERVATION');
  const revalidatedAt=clock();
  const freshnessReview=reviewObservationFreshness(original,{executedAt:revalidatedAt});
  // Historical calculations and numerical inputs stay unchanged; no strategy recalculation.
  const record={...original,id:randomUUID(),status:'HELD',label:'판단 보류',freshnessReview,
    originalRecord:{id,sha256:digest(bytes),path:originalPath},riskReady:false,ledgerInputReady:false};
  record.schemaVersion='OBSERVATION_V2';record.policy=original.policy??POLICY;
  record.eodInputs=original.eodInputs??createEodInputs(original);
  if(original.dailySelection) {
    const selection=original.dailySelection,derived=calculateDailyInputs(selection);
    const same=JSON.stringify(cleanInput({chartAnalysis:derived.chartAnalysis}).chartAnalysis)===JSON.stringify(original.inputs.derived.chartAnalysis)&&
      derived.averageVolume20===original.inputs.derived.averageVolume20&&derived.volume===original.inputs.observed.volume&&
      selection.targetBusinessDate===original.eodInputs.targetBusinessDate;
    if(!same)throw Error('STORED_DAILY_INPUT_MISMATCH');
    record.dailyReplay={sameTargetAndInputs:true,targetBusinessDate:selection.targetBusinessDate,calculationCount:selection.calculationCount};
  }
  record.eodReview=evaluateEod(record);record.revalidatedAt=revalidatedAt;
  record.reasonCodes=[...new Set([...(original.dailySelection?.issueCodes??[]),...record.eodReview.reasonCodes])];
  const folder=path.join(directory,'revalidation');
  await fs.mkdir(folder,{recursive:true});
  const outputPath=path.join(folder,`${record.id}.json`);
  await fs.writeFile(outputPath,JSON.stringify(record,null,2),{flag:'wx',mode:0o600});
  if(digest(await fs.readFile(originalPath))!==digest(bytes))throw Error('ORIGINAL_CHANGED');
  return {saved:true,record,outputPath};
}

// Render the same observation result component into a standalone, script-free local file.
async function renderReport(result) {
  const {createRequire}=require('node:module'),vm=require('node:vm');
  const frontendRequire=createRequire(path.resolve(__dirname,'../frontend/package.json'));
  const {transformSync}=createRequire(frontendRequire.resolve('vite/package.json'))('esbuild'),React=frontendRequire('react');
  const {renderToStaticMarkup}=frontendRequire('react-dom/server');
  const code=transformSync(await fs.readFile(path.resolve(__dirname,'../frontend/src/ObservationPanel.jsx'),'utf8'),{loader:'jsx',format:'cjs'}).code;
  const module={exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(name!=='react')throw Error('UNEXPECTED_DEPENDENCY');return React;}});
  const body=renderToStaticMarkup(React.createElement(module.exports.ObservationResult,{result}));
  const html='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>저장된 실제 관찰 기록 재검증</title><style>body{background:#0f172a;color:#e2e8f0;font:16px/1.6 sans-serif;max-width:1000px;margin:24px auto;padding:16px;overflow-wrap:anywhere}section,details,article>div>div{border:1px solid #475569;border-radius:8px;padding:16px;margin:12px 0}li{margin:6px 0}dt{color:#94a3b8}dd{margin-left:0}summary{cursor:pointer}h3{font-size:22px}</style><body>'+body+'</body></html>';
  const htmlPath=result.outputPath.replace(/\.json$/,'.html');
  await fs.writeFile(htmlPath,html,{flag:'wx',mode:0o600});
  return htmlPath;
}
if(require.main===module) {
  if(process.argv.length!==3){console.error('USAGE: node scripts/revalidate-observation.cjs <original-record-id>');process.exitCode=1;}
  else revalidate(process.argv[2]).then(async result=>{
    const htmlPath=await renderReport(result);
    console.log(JSON.stringify({status:result.record.status,originalRecordId:result.record.originalRecord.id,
      evaluationAsOf:result.record.freshnessReview.evaluationAsOf,revalidatedAt:result.record.freshnessReview.revalidatedAt,
      policyVersion:result.record.policy,outputPath:result.outputPath,htmlPath,externalRequests:0}));
  }).catch(()=>{console.error('OFFLINE_REVALIDATION_FAILED');process.exitCode=1;});
}
module.exports={revalidate,renderReport};
