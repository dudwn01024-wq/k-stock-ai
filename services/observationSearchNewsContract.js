'use strict';
const {isTargetDate}=require('./observationDaily');
const {stockNameFor}=require('./stockCatalog');
const SCOPE='naver-search-news-only';
const ORIGIN='https://naverapihub.apigw.ntruss.com';
const API_PATH='/search/v1/news';
const DOCUMENT='https://api.ncloud-docs.com/docs/naver-api-hub-search-news';
// Multi-request collection remains synthetic-test-only. A real run permits one approved request.
const TEST_MAX_REQUESTS=3;
const LIVE_MAX_REQUESTS=1;
function executionFor(symbol,targetDate,{query=stockNameFor(symbol),probeDateCutoff,sort='date',display,start=1,searchNewsMaxRequests}={}){
  if(!stockNameFor(symbol)||!isTargetDate(targetDate)||!isTargetDate(probeDateCutoff)||
    query!==stockNameFor(symbol)||sort!=='date'||start!==1||
    !Number.isInteger(display)||display<1||display>100||
    !Number.isInteger(searchNewsMaxRequests)||searchNewsMaxRequests<1||searchNewsMaxRequests>TEST_MAX_REQUESTS||
    1+(searchNewsMaxRequests-1)*display>1000)
    throw Error('SEARCH_NEWS_OPTIONS_INVALID');
  return Object.freeze({scope:SCOPE,symbol,query,targetDate,probeDateCutoff,sort,display,start,searchNewsMaxRequests});
}
module.exports={SCOPE,ORIGIN,API_PATH,DOCUMENT,TEST_MAX_REQUESTS,LIVE_MAX_REQUESTS,executionFor};
