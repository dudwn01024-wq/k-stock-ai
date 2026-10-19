'use strict';
// TEST_ONLY synthetic rows. Only the logged symbol, positions, request count and
// previous page bounds are reproduced; no production row body was retained.
const {createRecommendationUniverse}=require('../../services/recommendationUniverse');
const clock=()=>new Date('2026-10-19T00:50:39Z');
function rows(market){return Array.from({length:700},(_,i)=>{
  const page=Math.floor(i/100),offset=i%100;
  const ranges=market==='KOSPI'?[[7000000000000,6000000000000],[5000000000000,3000000000000],
    [2204554923600,1109804428000],[1109804428000,600000000000],[500000000000,400000000000],
    [300000000000,200000000000],[100000000000,1000000000]]:
    [[3000000000000,900000000000],[799042344750,415941167200],[400000000000,300000000000],
    [200000000000,150000000000],[100000000000,90000000000],[80000000000,70000000000],[60000000000,50000000000]];
  const [max,min]=ranges[page];
  return {itemCode:String((market==='KOSPI'?0:100000)+i+1).padStart(6,'0'),stockName:'TEST_ONLY_'+market+'_'+i,
    stockType:'domestic',stockEndType:'stock',stockExchangeType:{code:market==='KOSPI'?'KS':'KQ'},sosok:market==='KOSPI'?'0':'1',
    marketValueRaw:String(max-Math.round((max-min)*offset/99)),localTradedAt:'2026-10-19T09:50:39+09:00'};
});}
function fixture({change=()=>{},create=createRecommendationUniverse,overlap=true,officialSecurityTypeRecords}={}){
  const requests=[],markets={KOSPI:rows('KOSPI'),KOSDAQ:rows('KOSDAQ')};
  markets.KOSPI[299].itemCode='00680K';markets.KOSPI[300].stockEndType='preferred';
  const loader=create({testOnly:true,clock,...(officialSecurityTypeRecords?{officialSecurityTypeRecords}:{}),fetchPage:async args=>{
    requests.push({...args});const all=markets[args.market];
    const result={stocks:structuredClone(all.slice((args.page-1)*100,args.page*100)),totalCount:all.length,hasNext:args.page*100<all.length};
    if(overlap&&args.market==='KOSPI'&&args.page===4)result.stocks[0]=structuredClone(markets.KOSPI[299]);
    await change(result,args,markets);return result;
  }});
  return {requests,markets,load:()=>loader.load()};
}
module.exports={fixture,clock};
