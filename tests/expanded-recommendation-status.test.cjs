'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
const frontendRequire=createRequire(require.resolve('../frontend/package.json'));
const {transformSync}=createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
const React=frontendRequire('react'),{renderToStaticMarkup}=frontendRequire('react-dom/server');
const numbers={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync(require.resolve('../frontend/src/utils/numbers.js'),'utf8'),{format:'cjs'}).code,{module:numbers,exports:numbers.exports});
const source=fs.readFileSync(path.resolve(__dirname,'../frontend/src/ExpandedRecommendation.jsx'),'utf8');
const code=transformSync(source,{loader:'jsx',format:'cjs'}).code;
function renderStatus(status,stats){
  // UI fixture only: no market values, persistence or provider calls.
  const run={runId:'TEST-ONLY-STATUS',testOnly:true,status,stats,recommendations:[],aiStatus:'DISABLED'};
  let count=0,calls=0;
  const stub={...React,useState:()=>[count++===0?run:null,()=>{}],useEffect:()=>{},useRef:()=>({current:0}),useCallback:fn=>fn};
  const component={exports:{}};
  vm.runInNewContext(code,{module:component,exports:component.exports,require:name=>{
    if(name==='react')return stub;
    if(name==='./PublicInformation.jsx')return {InvestmentNotice:()=>null};
    if(name==='./expanded-recommendation.css')return {};
    if(name==='./ExpandedCandidateCard.jsx'){
      const card={exports:{}};
      vm.runInNewContext(transformSync(fs.readFileSync(require.resolve('../frontend/src/ExpandedCandidateCard.jsx'),'utf8'),{loader:'jsx',format:'cjs'}).code,
        {module:card,exports:card.exports,URL,require:name=>{
          if(name==='react')return React;if(name==='./expanded-recommendation.css')return {};
          if(name==='./recommendationDataDates.js'){
            const helper={exports:{}};
            vm.runInNewContext(transformSync(fs.readFileSync(require.resolve('../frontend/src/recommendationDataDates.js'),'utf8'),{format:'cjs'}).code,
              {module:helper,exports:helper.exports,Intl,Date});return helper.exports;
          }
          if(name==='./utils/numbers.js')return numbers.exports;
          if(name==='./utils/strategyExplanation.js'){
            const language={exports:{}};
            vm.runInNewContext(transformSync(fs.readFileSync(require.resolve('../frontend/src/utils/strategyExplanation.js'),'utf8'),{format:'cjs'}).code,
              {module:language,exports:language.exports,require:name=>{assert.equal(name,'./numbers.js');return numbers.exports;}});return language.exports;
          }
          throw Error('TEST_ONLY_UNEXPECTED_IMPORT');
        }});
      return card.exports;
    }
    throw Error('TEST_ONLY_UNEXPECTED_IMPORT');
  },Intl,Date,Set,Number});
  const service=new Proxy({},{get:()=>()=>{calls++;throw Error('TEST_ONLY_PROVIDER_FORBIDDEN');}});
  const html=renderToStaticMarkup(React.createElement(component.exports.default,{service}));
  const label=component.exports.expandedRunStatusLabel(run);
  assert.equal(calls,0);assert.match(html,/주식 투자는 원금 손실 위험이 있습니다/);assert.match(html,/500종목 분석 요청/);
  assert.doesNotMatch(html,/사이트 접속·새로고침·이력 조회|최근 10분/);
  assert.equal(new RegExp('<strong>실행 상태: ([^<]*)</strong>').exec(html)?.[1],label);
  return {html,label};
}
for(const [name,stats,expected] of [
  ['insufficient only',{fastInsufficient:7,fastFailed:0,deepFailed:0},'일부 자료 부족'],
  ['insufficient and lookup failure',{fastInsufficient:7,fastFailed:1,deepFailed:0},'일부 자료 부족·조회 실패'],
  ['deep lookup failure only',{fastInsufficient:0,fastFailed:0,deepFailed:2},'일부 조회 실패'],
  ['fast lookup failure only',{fastInsufficient:0,fastFailed:1,deepFailed:0},'일부 조회 실패'],
  ['zero counts',{fastInsufficient:0,fastFailed:0,deepFailed:0},'일부 결과 미완료'],
  ['absent stats',undefined,'일부 결과 미완료'],
  ['null stats',null,'일부 결과 미완료'],
  ['empty stats',{},'일부 결과 미완료']
])test('TEST_ONLY rendered PARTIAL: '+name,()=>{
  const {label,html}=renderStatus('PARTIAL',stats);assert.equal(label,expected);
  if(name==='insufficient only')assert.doesNotMatch(label,/실패/);
  assert.doesNotMatch(html,/일부 자료 부족·실패/);
});

test('TEST_ONLY incomplete or UNKNOWN counters are never coerced to zero',()=>{
  const known={fastInsufficient:7,fastFailed:0,deepFailed:0};
  for(const field of Object.keys(known)){
    const missing={...known};delete missing[field];assert.equal(renderStatus('PARTIAL',missing).label,'일부 결과 미완료');
    for(const value of [null,undefined,'UNKNOWN','0',NaN,Infinity,-1,0.5]){
      assert.equal(renderStatus('PARTIAL',{...known,[field]:value}).label,'일부 결과 미완료');
    }
  }
  assert.equal(renderStatus('PARTIAL',{fastInsufficient:0,fastFailed:Number.MAX_SAFE_INTEGER,deepFailed:1}).label,'일부 결과 미완료');
});

test('TEST_ONLY all non-PARTIAL status labels retain their existing meaning',()=>{
  for(const [status,expected] of Object.entries({QUEUED:'대기',FAST_SCREENING:'1단계 빠른 분석',DEEP_REVIEWING:'2단계 정밀 분석',AI_EXPLAINING:'Gemini 설명 중',COMPLETED:'완료',FAILED:'실패',INTERRUPTED_UNKNOWN:'중단 여부 미확인'})){
    assert.equal(renderStatus(status).label,expected);
  }
  assert.equal(renderStatus('TEST_ONLY_UNKNOWN_STATUS').label,'TEST_ONLY_UNKNOWN_STATUS');
});
