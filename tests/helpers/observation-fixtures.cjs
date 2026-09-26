'use strict';
// TEST DATA ONLY. Never imported by production services or used as a failed-query fallback.
const scenarios={'005930':'pass','000660':'fail','373220':'missing','035420':'unknown','005380':'stale','035720':'error'};
function fixture(symbol,scenario=scenarios[symbol]??'pass') {
  if(scenario==='error')throw Error('SECRET_TEST_ERROR_MUST_NOT_BE_EXPOSED');
  const input={currentPrice:100,chartAnalysis:{ma5:100,ma20:99,ma60:98,rsi14:50,
    macd:{macd:2,signal:1,histogram:1},bollingerBands:{position:50},atr14:10,
    supportResistance:{nearestSupport:{price:100},nearestResistance:{price:120}},
    candlePatterns:{patterns:[]},chartPatterns:{patterns:[]},elliottWave:{detected:false,direction:null}},
    marketContext:{volume:150,averageVolume20:100,foreignerNet:1,institutionNet:1,newsAssessment:{hasCautionSignal:false}},sourceIntegrity:{complete:true}};
  if(scenario==='fail')input.marketContext.newsAssessment.hasCautionSignal=true;
  if(scenario==='missing')input.marketContext.volume=null;
  const metadata=Object.fromEntries(['price','daily','volume','supply','news'].map(group=>[group,{source:'MOCK_FIXTURE',sourceBusinessDate:'2026-09-24',sourceTimestamp:'2026-09-24T09:30:00+09:00',freshnessStatus:scenario==='stale'?'STALE':scenario==='unknown'?'UNKNOWN':'VERIFIED'}]));
  return {symbol,stockName:'테스트 종목',provenance:'MOCK_FIXTURE',input,metadata};
}
module.exports={fixture,scenarios,testClock:()=> '2026-09-24T09:31:00+09:00'};
