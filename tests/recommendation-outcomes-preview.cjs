'use strict';
// TEST_ONLY browser fixture, loopback only. No provider imports or calls.
require('./helpers/local-only.cjs');
const express=require('express'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createRecommendationHistory,registerHistoryRoutes,hash}=require('../services/recommendationHistory');
const {createRecommendationOutcomes,registerOutcomeRoutes,sourceCandidates,calculateOutcomes}=require('../services/recommendationOutcomes');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'outcomes-preview-test-only-'));
const history=createRecommendationHistory({root,testOnly:true,storageKind:'LOCAL_FILE'});
const stocks=[0,1].map(i=>({symbol:String(i+1).padStart(6,'0'),name:'TEST_ONLY 합성 후보 '+(i+1),market:'KOSPI',marketValue:10-i}));
history.saveExpanded({scanId:'TEST-ONLY-OUTCOMES',scanStartedAt:'2026-10-02T00:00:00Z',scanCompletedAt:'2026-10-02T00:01:00Z',scanStatus:'PARTIAL',
  universeSnapshot:{stocks,fingerprint:hash(stocks),provider:'TEST_ONLY',testOnly:true},
  fastResults:stocks.map(x=>({symbol:x.symbol,status:'READY',fastStatus:'READY',deepReviewSelected:true,testData:true})),
  deepResults:stocks.map((x,i)=>({symbol:x.symbol,stockName:x.name,currentPrice:i===0?100:null,score:2,grade:'WATCH_CANDIDATE',testData:true,
    dataMetadata:{price:{source:'TEST_ONLY',sourceBusinessDate:'2026-10-02'}}})),deepFailures:[],codeVersion:'TEST_ONLY',aiEnabled:false});
const outcomes=createRecommendationOutcomes({history,root:path.join(root,'outcomes'),testOnly:true,storageKind:'LOCAL_FILE'});
const first=sourceCandidates(history.detail('TEST-ONLY-OUTCOMES'))[0];
outcomes.save(calculateOutcomes(first,[{localTradedAt:'2026-10-02',closePrice:'100'},{localTradedAt:'2026-10-06',closePrice:'100'}],
  {collectedAt:'2026-10-07T00:00:00Z'})[0]);
const app=express();let postAttempts=0,unexpected=0;
app.use((req,res,next)=>{
  res.set('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
  if(req.method!=='GET'){postAttempts++;return res.status(403).json({error:'TEST_ONLY_MUTATION_BLOCKED'});}next();
});
app.get('/__qa',(req,res)=>res.json({testOnly:true,postAttempts,unexpected,externalProviderCalls:0}));
app.get('/api/runtime-config',(req,res)=>res.json({mode:'public',paperEnabled:false}));
app.get('/api/stock/recommendation-mode',(req,res)=>res.json({universeMode:'expanded500',expandedEnabled:true,settings:{aiEnabled:false},reuseTtlMs:600000}));
registerHistoryRoutes(app,history);registerOutcomeRoutes(app,outcomes);
app.use('/api',(req,res)=>{unexpected++;res.status(403).json({error:'TEST_ONLY_UNEXPECTED_API'});});
const dist=path.resolve(__dirname,'../frontend/dist');
app.use(express.static(dist));app.get('/',(req,res)=>res.sendFile(path.join(dist,'index.html')));
const server=app.listen(5196,'127.0.0.1',()=>console.log('TEST_ONLY outcome preview http://127.0.0.1:5196/'));
const clean=()=>{server.close(()=>{fs.rmSync(root,{recursive:true,force:true});process.exit(0);});};
process.on('SIGINT',clean);process.on('SIGTERM',clean);
