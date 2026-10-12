'use strict';
const {isNaverKrStockItemCode}=require('./naverKrStockItemCode');
// Exact allowlist: public page bounds/counts only, never raw rows or exceptions.
const positive=value=>Number.isSafeInteger(value)&&value>0;
function safeUniverseCoverage(value){
  if(!value||(value.globalCutoff!==null&&!positive(value.globalCutoff)))return null;
  const result={globalCutoff:value.globalCutoff};
  for(const market of ['KOSPI','KOSDAQ']){
    const page=value[market];
    if(!page||!Number.isInteger(page.pagesFetched)||page.pagesFetched<0||page.pagesFetched>10||
      typeof page.done!=='boolean'||typeof page.covered!=='boolean')return null;
    if(page.pagesFetched===0){
      if(page.lastPageMax!==null||page.lastPageMin!==null||page.done||page.covered)return null;
    }else if(!positive(page.lastPageMax)||!positive(page.lastPageMin)||page.lastPageMin>page.lastPageMax||
      page.covered!==(page.done||(value.globalCutoff!==null&&page.lastPageMax<value.globalCutoff)))return null;
    result[market]={lastPageMax:page.lastPageMax,lastPageMin:page.lastPageMin,
      pagesFetched:page.pagesFetched,done:page.done,covered:page.covered};
  }
  return result;
}
// A repeated public identifier and its two positions distinguish row duplication
// from page overlap. Positions alone do not establish why provider ranks changed.
function safeUniverseDuplicate(value){
  if(!isNaverKrStockItemCode(value?.symbol))return null;
  const position=entry=>entry&&['KOSPI','KOSDAQ'].includes(entry.market)&&
    Number.isInteger(entry.page)&&entry.page>=1&&entry.page<=10&&
    Number.isInteger(entry.row)&&entry.row>=1&&entry.row<=100
      ?{market:entry.market,page:entry.page,row:entry.row}:null;
  const first=position(value.first),repeated=position(value.repeated);
  if(!first||!repeated)return null;
  const sameMarket=first.market===repeated.market;
  if(sameMarket&&(repeated.page<first.page||
    (repeated.page===first.page&&repeated.row<=first.row)))return null;
  const kind=!sameMarket?'CROSS_MARKET':first.page===repeated.page?'WITHIN_PAGE':'CROSS_PAGE';
  return {kind,symbol:value.symbol,first,repeated};
}
module.exports={safeUniverseCoverage,safeUniverseDuplicate};
