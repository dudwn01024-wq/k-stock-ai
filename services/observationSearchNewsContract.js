'use strict';
const {isTargetDate}=require('./observationDaily');
const {stockNameFor}=require('./stockCatalog');
const SCOPE='naver-search-news-only';
const ORIGIN='https://naverapihub.apigw.ntruss.com';
const API_PATH='/search/v1/news';
const DOCUMENT='https://api.ncloud-docs.com/docs/naver-api-hub-search-news';
// Legacy probes retain their original cap. Target-window requests need a separate exact approval.
const TEST_MAX_REQUESTS=3;
const LIVE_MAX_REQUESTS=1;
const WINDOW_MAX_REQUESTS=10;
const ROLLING_MAX_REQUESTS=5;
const instant=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?\+09:00$/.test(value)&&Number.isFinite(Date.parse(value));
const watermark=value=>value===null||value&&typeof value==='object'&&
  Object.keys(value).sort().join(',')==='identity,instant,pubDateRaw,signature'&&
  typeof value.identity==='string'&&value.identity.length>0&&typeof value.signature==='string'&&
  typeof value.pubDateRaw==='string'&&typeof value.instant==='string'&&Number.isFinite(Date.parse(value.instant));
function executionFor(symbol,targetDate,options={}){
  const {mode,query=stockNameFor(symbol),probeDateCutoff,sort='date',display,start=1,searchNewsMaxRequests,
    calendarEvidenceRef,windowStartKst,windowEndKst,initialStart,startStep,maxRequests,
    maxRequestsPerPoll,expectedArchiveId,expectedWatermark,expectedArchiveRevision}=options;
  if(mode==='rolling-poll'){
    if(Object.keys(options).some(key=>!['mode','query','sort','display','initialStart','startStep',
      'maxRequestsPerPoll','expectedArchiveId','expectedWatermark','expectedArchiveRevision'].includes(key))||
      targetDate!==undefined||!stockNameFor(symbol)||query!==stockNameFor(symbol)||sort!=='date'||
      display!==100||initialStart!==1||startStep!==100||
      maxRequestsPerPoll!==(expectedWatermark===null?1:ROLLING_MAX_REQUESTS)||
      !(expectedArchiveId===null||typeof expectedArchiveId==='string'&&
        /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(expectedArchiveId))||
      !watermark(expectedWatermark)||!Number.isInteger(expectedArchiveRevision)||expectedArchiveRevision<0||
      (expectedArchiveRevision===0)!==(expectedArchiveId===null&&expectedWatermark===null)||
      expectedArchiveRevision>0&&expectedArchiveId===null)
      throw Error('SEARCH_NEWS_OPTIONS_INVALID');
    return Object.freeze({scope:SCOPE,mode,symbol,query,sort,display,initialStart,startStep,
      maxRequestsPerPoll,expectedArchiveId,expectedWatermark,expectedArchiveRevision});
  }
  if(mode==='target-window'){
    if(Object.keys(options).some(key=>!['mode','query','calendarEvidenceRef','windowStartKst','windowEndKst',
      'sort','display','initialStart','startStep','maxRequests'].includes(key)))throw Error('SEARCH_NEWS_OPTIONS_INVALID');
    if(!stockNameFor(symbol)||!isTargetDate(targetDate)||query!==stockNameFor(symbol)||sort!=='date'||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(calendarEvidenceRef??'')||
      !instant(windowStartKst)||!instant(windowEndKst)||Date.parse(windowStartKst)>=Date.parse(windowEndKst)||
      display!==100||initialStart!==1||startStep!==100||
      !Number.isInteger(maxRequests)||maxRequests<1||maxRequests>WINDOW_MAX_REQUESTS||
      initialStart+(maxRequests-1)*startStep+display-1>1000)
      throw Error('SEARCH_NEWS_OPTIONS_INVALID');
    return Object.freeze({scope:SCOPE,mode,symbol,query,targetDate,calendarEvidenceRef,
      windowStartKst,windowEndKst,sort,display,initialStart,startStep,maxRequests});
  }
  if(mode!==undefined)throw Error('SEARCH_NEWS_OPTIONS_INVALID');
  if(Object.keys(options).some(key=>!['query','probeDateCutoff','sort','display','start','searchNewsMaxRequests'].includes(key)))
    throw Error('SEARCH_NEWS_OPTIONS_INVALID');
  if(!stockNameFor(symbol)||!isTargetDate(targetDate)||!isTargetDate(probeDateCutoff)||
    query!==stockNameFor(symbol)||sort!=='date'||start!==1||
    !Number.isInteger(display)||display<1||display>100||
    !Number.isInteger(searchNewsMaxRequests)||searchNewsMaxRequests<1||searchNewsMaxRequests>TEST_MAX_REQUESTS||
    1+(searchNewsMaxRequests-1)*display>1000)
    throw Error('SEARCH_NEWS_OPTIONS_INVALID');
  return Object.freeze({scope:SCOPE,symbol,query,targetDate,probeDateCutoff,sort,display,start,searchNewsMaxRequests});
}
module.exports={SCOPE,ORIGIN,API_PATH,DOCUMENT,TEST_MAX_REQUESTS,LIVE_MAX_REQUESTS,WINDOW_MAX_REQUESTS,
  ROLLING_MAX_REQUESTS,executionFor};
