'use strict';
// Approved observation policy, not an entry gate. No network/auth/account dependencies.
const {evaluateMarketContext}=require('./tradingStrategy');
const {evidenceFacts,sanitizeEvidence}=require('./observationEvidence');
const POLICY=Object.freeze({id:'KRX_EOD_OBSERVATION',version:'1.0.0',name:'KRX 장마감 관찰',timezone:'Asia/Seoul'});
const labels={USABLE:'해당 용도에 사용 가능',STALE:'기준보다 오래됨',UNKNOWN:'확인 불가'};
const finite=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const numeric=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(String(v).replaceAll(',','')))?Number(String(v).replaceAll(',','')):null;
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const time=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const kst=v=>new Date(Date.parse(v)+9*3600000).toISOString().slice(0,10);
const dayAfter=v=>new Date(Date.parse(v)+86400000).toISOString().slice(0,10);
const safeTime=v=>time(v)?v:null;
const safeDate=v=>date(v)?v:null;
const market=v=>['KRX','NXT','CONSOLIDATED'].includes(v)?v:null;

// No official date-specific equity sessions/completion/finality contract has yet
// been verified in this project. Only server-owned synthetic tests can supply proofs.
function createEodInputs(record,{targetBusinessDate=null,testEvidence=null}={}) {
  if(testEvidence&&record.testData!==true)throw Error('TEST_EOD_EVIDENCE_FORBIDDEN');
  const evidence=sanitizeEvidence(record.evidence),facts=evidenceFacts(evidence,record.symbol);
  const target=safeDate(targetBusinessDate)??safeDate(record.metadata?.daily?.sourceBusinessDate);
  const rows=(evidence?.exchanges??[]).filter(e=>e.kind==='kisDaily').flatMap(e=>{
    const dates=e.response.fields.filter(f=>/^output2\[\d+\]\.stck_bsop_date$/.test(f.path)&&f.status==='PRESENT');
    return dates.map(f=>{
      const prefix=f.path.slice(0,f.path.lastIndexOf('.')+1),get=key=>e.response.fields.find(v=>v.path===prefix+key&&v.status==='PRESENT')?.value;
      return {date:String(f.value).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),close:numeric(get('stck_clpr')),volume:numeric(get('acml_vol')),
        receivedAt:e.response.receivedAt,requestId:e.requestId};
    });
  });
  const selection=record.dailySelection;
  const selected=selection?.calculationRows?.find(r=>r.date===target?.replaceAll('-',''));
  const raw=rows.find(r=>r.date===target);
  const row=selection?(selected?{...selected,date:target,receivedAt:selected.dataMetadata?.receivedAt,requestId:raw?.requestId}:null):raw;
  let inputs={schemaVersion:'EOD_INPUTS_V1',basis:'STORED_EVIDENCE',targetBusinessDate:target,calendar:null,
    daily:{date:row?.date??(selection?null:record.metadata?.daily?.sourceBusinessDate??null),close:row?.close??null,
      volume:row?.volume??(selection?null:record.inputs?.observed?.volume??null),averageVolume20:record.metadata?.daily?.sourceBusinessDate===target?record.inputs?.derived?.averageVolume20??null:null,
      market:facts?.market.daily??null,priceBasis:facts?.daily.priceAdjustment?.find(p=>p.requestId===row?.requestId)?.interpreted??null,unit:'KRW/SHARES',complete:false,completionEvidence:null,
      receivedAt:row?.receivedAt??record.metadata?.daily?.receivedAt??null,requestId:row?.requestId??null,reference:'output2[].stck_clpr / acml_vol; KIS request market documentation'},
    supply:{date:record.metadata?.supply?.sourceBusinessDate??null,market:null,unit:record.metadata?.supply?.unit??null,unitVerified:false,finality:'UNKNOWN',finalityEvidence:null,
      foreignerNet:record.inputs?.observed?.foreignerNet??null,institutionNet:record.inputs?.observed?.institutionNet??null,receivedAt:record.metadata?.supply?.receivedAt??null},
    news:{coverage:null,articles:(facts?.news.timestamps??[]).map((t,i)=>({id:String(i),originalTime:t.value,publishedAt:null,meaning:'UNKNOWN',hasCautionSignal:null,
      receivedAt:record.metadata?.news?.receivedAt??null,path:t.path}))},conflicts:[...(facts?.conflicts??[]),...(selection?.conflictDates?.length?['DAILY_DUPLICATE_CONFLICT']:[])]};
  if(testEvidence) {
    const t=testEvidence,c=t.calendar,d=t.daily??{},s=t.supply??{},n=t.news??{};
    const days=Object.fromEntries(Object.entries(c?.days??{}).filter(([key])=>date(key)).slice(0,370).map(([key,v])=>[key,{status:v.status==='OPEN'?'OPEN':v.status==='CLOSED'?'CLOSED':'UNKNOWN',close:safeTime(v.close)}]));
    inputs={schemaVersion:'EOD_INPUTS_V1',basis:'SYNTHETIC_TEST',targetBusinessDate:target,conflicts:[],
      calendar:c?{market:market(c.market),session:c.session==='REGULAR'?'REGULAR':null,from:safeDate(c.from),through:safeDate(c.through),days,evidence:'TEST_FIXTURE_ONLY'}:null,
      daily:{date:safeDate(d.date),close:finite(d.close),volume:finite(d.volume),averageVolume20:finite(d.averageVolume20),market:market(d.market),priceBasis:['ADJUSTED','UNADJUSTED'].includes(d.priceBasis)?d.priceBasis:null,unit:d.unit==='KRW/SHARES'?d.unit:null,
        complete:d.complete===true,completionEvidence:d.completionEvidence==='TEST_FIXTURE_ONLY'?d.completionEvidence:null,receivedAt:safeTime(d.receivedAt),reference:'TEST_FIXTURE_ONLY'},
      supply:{date:safeDate(s.date),market:market(s.market),unit:s.unit==='SHARES'?s.unit:null,unitVerified:s.unitVerified===true,finality:['FINAL','PROVISIONAL'].includes(s.finality)?s.finality:'UNKNOWN',
        finalityEvidence:s.finalityEvidence==='TEST_FIXTURE_ONLY'?s.finalityEvidence:null,foreignerNet:finite(s.foreignerNet),institutionNet:finite(s.institutionNet),receivedAt:safeTime(s.receivedAt)},
      news:{coverage:n.coverage?{from:safeTime(n.coverage.from),through:safeTime(n.coverage.through),complete:n.coverage.complete===true,evidence:n.coverage.evidence==='TEST_FIXTURE_ONLY'?n.coverage.evidence:null}:null,
        articles:(Array.isArray(n.articles)?n.articles:[]).slice(0,100).map((a,i)=>({id:String(i),originalTime:safeTime(a.publishedAt),publishedAt:safeTime(a.publishedAt),
          meaning:a.meaning==='PUBLICATION_TIME'?'PUBLICATION_TIME':'UNKNOWN',hasCautionSignal:typeof a.hasCautionSignal==='boolean'?a.hasCautionSignal:null,receivedAt:safeTime(a.receivedAt)}))}};
  }
  return inputs;
}
function sessionWindow(inputs) {
  const c=inputs.calendar,target=inputs.targetBusinessDate;
  if(!c||c.market!=='KRX'||c.session!=='REGULAR'||!date(target)||!date(c.from)||!date(c.through)||target<c.from||target>c.through)return null;
  let previous=null;
  for(let d=c.from;d<=target;d=dayAfter(d)) {
    const row=c.days[d];if(!row||!['OPEN','CLOSED'].includes(row.status))return null;
    if(row.status==='OPEN'&&(!time(row.close)||kst(row.close)!==d))return null;
    if(d===target)return row.status==='OPEN'&&previous?{previousBusinessDate:previous.date,start:previous.close,end:row.close}:null;
    if(row.status==='OPEN')previous={date:d,close:row.close};
  }
  return null;
}
function evaluateEod(record) {
  if(record.policy?.id!==POLICY.id||record.policy?.version!==POLICY.version)throw Error('EOD_POLICY_VERSION_UNSUPPORTED');
  const i=record.eodInputs;
  if(i?.schemaVersion!=='EOD_INPUTS_V1'||!time(record.receivedAt))throw Error('INVALID_EOD_RECORD');
  if(i.basis==='SYNTHETIC_TEST'&&record.testData!==true)throw Error('TEST_EOD_EVIDENCE_FORBIDDEN');
  const proofAllowed=record.testData===true&&i.basis==='SYNTHETIC_TEST';
  const window=proofAllowed?sessionWindow(i):null,asOf=record.receivedAt;
  const assessments={},codes=[],reasons=[];
  const assess=(group,problems,stale=false)=>{
    const status=problems.length?(stale?'STALE':'UNKNOWN'):'USABLE';
    assessments[group]={status,label:labels[status],reasons:problems.length?problems:['승인된 장마감 관찰 용도의 근거가 확인됐습니다. 거래 허가는 아닙니다.']};
    if(status!=='USABLE'){codes.push(group.toUpperCase()+'_EOD_UNVERIFIED');reasons.push(...problems);}
  };
  const daily=[],supply=[],news=[];
  const base=!window?['공식 근거가 있는 이전 거래일·대상 거래일의 KRX 정규장 마감 시각을 확인할 수 없습니다.']:[];
  if(i.conflicts.length)base.push('저장된 종목·시장 근거가 불일치하여 개별 조건도 평가하지 않습니다.');
  if(window&&Date.parse(asOf)<Date.parse(window.end))base.push('평가 실행 시점에 대상 세션이 아직 종료되지 않았습니다.');
  if(record.dailySelection){
    const s=record.dailySelection;
    if(!s.targetPresent)daily.push('선택한 대상일의 유효 일봉이 없습니다. 다른 날짜로 대체하지 않았습니다.');
  }
  daily.push(...base);supply.push(...base);news.push(...base);
  const d=i.daily,s=i.supply;
  if(d.market!=='KRX')daily.push('일봉 시장이 KRX로 확인되지 않았습니다. NXT·통합 자료를 혼합하지 않습니다.');
  if(!['ADJUSTED','UNADJUSTED'].includes(d.priceBasis))daily.push('종가의 수정·원주가 구분이 확인되지 않았습니다.');
  if(d.date!==i.targetBusinessDate)daily.push('일봉 거래일이 분석 대상 거래일과 다릅니다.');
  if(!proofAllowed||!d.complete||!d.completionEvidence)daily.push('일봉 완성 근거가 없습니다. 날짜 경과·수신 시각만으로 완성을 추정하지 않습니다.');
  if(!time(d.receivedAt)||Date.parse(d.receivedAt)>Date.parse(asOf)||window&&Date.parse(d.receivedAt)<Date.parse(window.end))daily.push('완성 자료의 수신 시점 근거를 확인할 수 없습니다.');
  if(d.unit!=='KRW/SHARES'||finite(d.close)===null||d.close<=0||finite(d.volume)===null||d.volume<0)daily.push('분석 기준 종가 또는 일봉 거래량·단위가 없습니다.');
  assess('daily',daily,!!window&&date(d.date)&&d.date<i.targetBusinessDate);
  assess('volume',[...daily,...(finite(d.averageVolume20)===null||d.averageVolume20<=0?['대상 일봉에 대응하는 기존 20일 평균 거래량이 없습니다.']:[])],!!window&&date(d.date)&&d.date<i.targetBusinessDate);
  if(s.date!==i.targetBusinessDate)supply.push('수급 집계일이 대상 거래일과 다릅니다.');
  if(s.market!=='KRX'||s.unit!=='SHARES'||!s.unitVerified)supply.push('수급의 KRX 범위·주 단위 근거를 확인할 수 없습니다.');
  if(!proofAllowed||s.finality!=='FINAL'||!s.finalityEvidence)supply.push('수급은 잠정 또는 확정 여부 미확인입니다. 참고만 가능하며 필수 조건은 보류합니다.');
  if(finite(s.foreignerNet)===null||finite(s.institutionNet)===null)supply.push('외국인·기관 수급이 누락됐습니다. 누락을 0으로 바꾸지 않습니다.');
  if(!time(s.receivedAt)||Date.parse(s.receivedAt)>Date.parse(asOf)||window&&Date.parse(s.receivedAt)<Date.parse(window.end))supply.push('확정 수급 수신 시각이 미확인·장마감 이전 또는 평가 이후입니다.');
  assess('supply',supply,!!window&&date(s.date)&&s.date<i.targetBusinessDate);
  const selected=[],reference=[],unknown=[];
  for(const a of i.news.articles) {
    if(!window||a.meaning!=='PUBLICATION_TIME'||!time(a.publishedAt)){unknown.push(a);continue;}
    const t=Date.parse(a.publishedAt);
    if(t>Date.parse(window.start)&&t<=Date.parse(window.end))selected.push(a);
    else reference.push({...a,exclusion:t<=Date.parse(window.start)?'AT_OR_BEFORE_START':'AFTER_TARGET_CLOSE'});
  }
  const coverage=i.news.coverage;
  if(!proofAllowed||!window||!coverage?.complete||!coverage.evidence||!time(coverage.from)||!time(coverage.through)||Date.parse(coverage.from)>Date.parse(window.start)||Date.parse(coverage.through)<Date.parse(window.end))news.push('뉴스 유효 구간 전체의 수집 범위 근거가 없습니다. 뉴스 없음·악재 없음으로 처리하지 않습니다.');
  if(unknown.length)news.push('기사별 발행 시각 또는 시각의 의미가 미확인입니다. 수신·갱신 시각으로 대체하지 않습니다.');
  if(selected.some(a=>typeof a.hasCautionSignal!=='boolean'||!time(a.receivedAt)||Date.parse(a.receivedAt)>Date.parse(asOf)||Date.parse(a.receivedAt)<Date.parse(a.publishedAt)))news.push('유효 구간 기사의 기존 키워드 평가 또는 수신 근거가 없습니다.');
  if(!selected.length)news.push('유효 구간에 평가 가능한 기사가 없습니다. 기존 뉴스 필수 조건을 통과시키지 않습니다.');
  assess('news',news);
  const usable=g=>assessments[g].status==='USABLE';
  const marketResult=evaluateMarketContext({volume:usable('volume')?d.volume:null,averageVolume20:usable('volume')?d.averageVolume20:null,
    foreignerNet:usable('supply')?s.foreignerNet:null,institutionNet:usable('supply')?s.institutionNet:null,
    newsAssessment:{hasCautionSignal:usable('news')?selected.some(a=>a.hasCautionSignal):null}});
  const partial=Object.fromEntries(Object.entries(marketResult.conditions).map(([k,v])=>[k,{...v,
    label:v.status==='UNAVAILABLE'?'판단 보류':v.status==='CAUTION'?'조건 미충족':'분석 조건 충족'}]));
  const conflicts=[{code:'CURRENT_PRICE_ENTRY_CONDITIONS_NOT_APPLICABLE',reason:'evaluateExecutionPosition의 현재가 대비 진입 구간·추격 조건에는 종가를 대입하지 않았습니다.'},
    {code:'CURRENT_PRICE_TECHNICAL_CONDITIONS_NOT_APPLICABLE',reason:'evaluateTechnicalConditions와 전체 ENTRY_GATE는 현재가 입력을 요구합니다. 장마감용 의미를 임의로 변경하지 않았습니다.'}];
  codes.push(...i.conflicts,...conflicts.map(c=>c.code));reasons.push(...conflicts.map(c=>c.reason));
  if(i.conflicts.length)reasons.push('저장된 요청·응답 종목/시장 근거가 불일치합니다.');
  return {policy:POLICY,targetBusinessDate:i.targetBusinessDate,newsWindow:window,timezone:'Asia/Seoul',
    dataReferenceAt:window?.end??null,evaluatedAt:asOf,postCloseObservation:!!window&&Date.parse(asOf)>Date.parse(window.end),
    asOfCaveat:'사후에 받은 자료는 마감 순간 알려져 있었거나 해당 종가로 매수 가능했다는 뜻이 아닙니다.',
    analysisClose:usable('daily')?d.close:null,referenceClose:d.close,assessments,partial,marketResult,
    news:{selected,reference,unknown},compatibilityConflicts:conflicts,status:'HELD',label:'판단 보류',reasonCodes:[...new Set(codes)],reasons:[...new Set(reasons)],
    riskReady:false,ledgerInputReady:false,tradeAuthorization:'거래 허가 미평가 / 주문 기능 미연결'};
}
module.exports={POLICY,createEodInputs,evaluateEod,isBusinessDate:date,sessionWindow};
