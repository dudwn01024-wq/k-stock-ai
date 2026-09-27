'use strict';
require('./helpers/local-only.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createRollingNewsArchiveStore}=require('../services/rollingNewsArchive');

const base=Date.parse('2026-09-27T00:00:00Z');
const article=(minute,tag=String(minute))=>({title:`기사 ${tag}`,originallink:`https://news.example/${tag}`,
  link:`https://search.example/${tag}`,description:`근거 ${tag}`,
  pubDate:new Date(base+minute*60000).toUTCString().replace('GMT','+0000')});
const page=(start,items)=>({start,display:100,items});
async function withStore(fn){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-news-test-'));
  try{return await fn(createRollingNewsArchiveStore({testOnly:true,testDirectory:dir}),dir);}
  finally{await fs.rm(dir,{recursive:true,force:true});}
}
const poll=(store,readPage,maxRequestsPerPoll)=>store.collectSyntheticPoll({symbol:'005930',
  readPage,maxRequestsPerPoll,receivedAtKst:'2026-09-27T16:00:00+09:00'});

test('initial snapshot and one-page watermark are distinct from full coverage',()=>withStore(async store=>{
  const plan=await store.planPoll({symbol:'005930'});
  assert.deepEqual(plan.allowedStarts,[1]);
  assert.equal(plan.maxRequestsPerPoll,1);
  assert.equal(plan.trigger,'EXPLICIT_INTERNAL_ONLY');
  assert.equal(plan.collectionIntervalMinutes,null);
  const first=await poll(store,async ({start})=>page(start,[article(0)]));
  assert.equal(first.event.review.status,'INITIAL_UNVERIFIED');
  assert.equal(first.archive.searchResultContinuityProven,false);
  assert.equal(first.archive.fullCoverageProven,false);
  const starts=[];
  const second=await poll(store,async ({start})=>{
    starts.push(start);return page(start,[article(2),article(1),article(0)]);
  });
  assert.deepEqual(starts,[1]);
  assert.equal(second.event.review.status,'VERIFIED');
  assert.equal(second.archive.articleCount,3);
  assert.equal(second.event.review.duplicateCount,1);
  assert.equal(second.archive.searchResultContinuityProven,true);
  assert.equal(second.archive.fullCoverageProven,false);
  assert.equal(second.archive.requestHistory.length,2);
}));

test('180 new articles reach watermark on page two; distinct URLs with same title remain distinct',()=>withStore(async store=>{
  await poll(store,async ({start})=>page(start,[article(0)]));
  const starts=[];
  const result=await poll(store,async ({start})=>{
    starts.push(start);
    if(start===1)return page(start,Array.from({length:100},(_,i)=>article(180-i)));
    return page(start,[...Array.from({length:80},(_,i)=>article(80-i)),article(0)]);
  });
  assert.deepEqual(starts,[1,101]);
  assert.equal(result.event.review.status,'VERIFIED');
  assert.equal(result.archive.articleCount,181);
  const sameTitle=article(181,'a'),other=article(180,'b');other.title=sameTitle.title;
  const result2=await poll(store,async ({start})=>page(start,[sameTitle,other,article(180)]));
  assert.equal(result2.archive.articleCount,183);
}));

test('five-request bound stops with a persistent gap and never calls start 501',()=>withStore(async store=>{
  await poll(store,async ({start})=>page(start,[article(0)]));
  const starts=[];
  const gap=await poll(store,async ({start})=>{
    starts.push(start);return page(start,Array.from({length:100},(_,i)=>article(1000-start-i)));
  });
  assert.deepEqual(starts,[1,101,201,301,401]);
  assert.equal(gap.event.review.status,'GAP_DETECTED');
  assert.equal(gap.event.review.stopReason,'REQUEST_LIMIT_REACHED');
  assert.equal(gap.archive.searchResultContinuityProven,false);
  assert.ok(gap.archive.warnings.includes('POLL_GAP_DETECTED'));
  const later=await poll(store,async ({start})=>page(start,[article(1001),article(0)]));
  assert.equal(later.archive.searchResultContinuityProven,false);
  assert.ok(later.archive.warnings.includes('POLL_GAP_DETECTED'));
}));

test('parse failure, chronology reversal, duplicate conflict and failed request cannot verify',()=>withStore(async store=>{
  await poll(store,async ({start})=>page(start,[article(0)]));
  const bad=article(3);bad.pubDate='invalid';
  const invalid=await poll(store,async ({start})=>page(start,[bad,article(0)]));
  assert.equal(invalid.event.review.status,'UNVERIFIED');
  assert.equal(invalid.event.review.parseFailureCount,1);
  const reversed=await poll(store,async ({start})=>page(start,[article(1),article(2),article(0)]));
  assert.equal(reversed.event.review.status,'UNVERIFIED');
  assert.equal(reversed.event.review.observedDescendingOrder,false);
  const conflict=article(0);conflict.description='변경됨';
  const result=await poll(store,async ({start})=>page(start,[article(4),conflict]));
  assert.equal(result.event.review.status,'UNVERIFIED');
  assert.equal(result.event.review.duplicateConflictCount,1);
  assert.equal(result.archive.articles.some(item=>item.identity===conflict.originallink),true);
  assert.ok(result.archive.warnings.includes('ARTICLE_IDENTITY_CONFLICT'));
  let calls=0;
  const failed=await poll(store,async()=>{calls++;throw Error('synthetic failure');});
  assert.equal(calls,1);
  assert.equal(failed.event.requests.length,1);
  assert.equal(failed.event.review.status,'FAILED');
}));

test('cross-page chronology reversal blocks continuity even when the watermark appears',()=>withStore(async store=>{
  await poll(store,async ({start})=>page(start,[article(0)]));
  const starts=[];
  const result=await poll(store,async ({start})=>{
    starts.push(start);
    return start===1?page(start,Array.from({length:100},(_,i)=>article(200-i))):
      page(start,[article(201),article(0)]);
  });
  assert.deepEqual(starts,[1,101]);
  assert.equal(result.event.review.watermarkReached,true);
  assert.equal(result.event.review.status,'UNVERIFIED');
  assert.equal(result.archive.searchResultContinuityProven,false);
  assert.ok(result.archive.warnings.includes('PUBDATE_ORDER_REVERSED'));
}));

test('EOD selection is offline, inclusive, and never means all news is covered',()=>withStore(async store=>{
  await poll(store,async ({start})=>page(start,[article(0),article(-1)]));
  await poll(store,async ({start})=>page(start,[article(3),article(2),article(1),article(0)]));
  const selected=await store.selectNewsForEodWindow({symbol:'005930',
    windowStartKst:'2026-09-27T08:59:00+09:00',windowEndKst:'2026-09-27T09:02:00+09:00'});
  assert.equal(selected.status,'ARCHIVE_WINDOW_READY');
  assert.equal(selected.candidateCount,4);
  assert.deepEqual(selected.articles.map(a=>a.pubDateParsed.instant).sort(),
    [-1,0,1,2].map(minute=>new Date(base+minute*60000).toISOString()));
  assert.equal(selected.fullCoverageProven,false);
  const empty=await store.selectNewsForEodWindow({symbol:'005930',
    windowStartKst:'2026-09-27T08:59:10+09:00',windowEndKst:'2026-09-27T08:59:30+09:00'});
  assert.equal(empty.status,'ARCHIVE_WINDOW_READY');
  assert.equal(empty.candidateCount,0);
  assert.match(empty.interpretation,/저장된 NAVER 검색 결과/);
  const before=await store.selectNewsForEodWindow({symbol:'005930',
    windowStartKst:'2026-09-27T08:00:00+09:00',windowEndKst:'2026-09-27T08:01:00+09:00'});
  assert.equal(before.status,'ARCHIVE_WINDOW_INCOMPLETE');
  assert.equal(before.candidateCount,0);
  assert.ok(before.reasons.includes('WINDOW_START_NOT_COVERED'));
}));

test('read-only EOD window selection does not modify poll records',()=>withStore(async (store,dir)=>{
  await poll(store,async ({start})=>page(start,[article(0)]));
  const pollDir=path.join(dir,'005930','polls'),name=(await fs.readdir(pollDir))[0];
  const before=await fs.readFile(path.join(pollDir,name));
  await store.selectNewsForEodWindow({symbol:'005930',windowStartKst:'2026-09-27T08:00:00+09:00',
    windowEndKst:'2026-09-27T09:00:00+09:00'});
  const after=await fs.readFile(path.join(pollDir,name));
  assert.deepEqual(after,before);
}));

test('archive rejects unsafe paths and symlinked poll records; no live poll exists',()=>withStore(async (store,dir)=>{
  await assert.rejects(store.planPoll({symbol:'../005930'}),/NEWS_ARCHIVE_SYMBOL_INVALID/);
  await assert.rejects(store.planPoll({symbol:'C:\\outside'}),/NEWS_ARCHIVE_SYMBOL_INVALID/);
  await assert.rejects(store.planPoll({symbol:'005930',maxRequestsPerPoll:6}),/NEWS_ARCHIVE_POLL_LIMIT_INVALID/);
  const production=createRollingNewsArchiveStore();
  await assert.rejects(production.collectSyntheticPoll({symbol:'005930',readPage:async()=>{}}),
    /NEWS_ARCHIVE_LIVE_POLL_NOT_CONNECTED/);
  await poll(store,async ({start})=>page(start,[article(0)]));
  const pollDir=path.join(dir,'005930','polls'),name=(await fs.readdir(pollDir))[0];
  const source=path.join(pollDir,name),copy=path.join(dir,'copy.json');
  await fs.copyFile(source,copy);await fs.unlink(source);
  try{await fs.symlink(copy,source,'file');}
  catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code))return;throw error;}
  await assert.rejects(store.read('005930'),/NEWS_ARCHIVE_RECORD_INVALID/);
}));
