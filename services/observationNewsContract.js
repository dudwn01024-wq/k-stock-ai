'use strict';
const {isTargetDate}=require('./observationDaily');
const SCOPE='naver-news-only',PAGE=1,PAGE_SIZE=10,MAX_PAGES=5;
const PAGE_SIZES=Object.freeze([10,20]);
const API_PATH='/api/news/stock/005930';
function pageOptions(input){
  if(input===undefined)return null; // Preserve the exact shape of older one-page approvals.
  const hasProbe=input&&Object.hasOwn(input,'probeDateCutoff');
  const keys=hasProbe?'maxPages,naverNewsMaxRequests,pageSize,probeDateCutoff':'maxPages,naverNewsMaxRequests,pageSize';
  if(!input||Object.keys(input).sort().join(',')!==keys||
    !PAGE_SIZES.includes(input.pageSize)||!Number.isInteger(input.maxPages)||input.maxPages<1||input.maxPages>MAX_PAGES||
    !Number.isInteger(input.naverNewsMaxRequests)||input.naverNewsMaxRequests<1||input.naverNewsMaxRequests>input.maxPages||
    hasProbe&&!isTargetDate(input.probeDateCutoff))
    throw Error('NEWS_PAGE_OPTIONS_INVALID');
  return Object.freeze({...input});
}
function executionFor(symbol,targetDate,options){
  const selected=pageOptions(options);
  return selected?{scope:SCOPE,symbol,targetDate,...selected}:
    {scope:SCOPE,symbol,targetDate,page:PAGE,pageSize:PAGE_SIZE,naverNewsMaxRequests:1};
}
module.exports={SCOPE,PAGE,PAGE_SIZE,PAGE_SIZES,MAX_PAGES,API_PATH,pageOptions,executionFor};
