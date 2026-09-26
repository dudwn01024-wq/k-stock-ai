'use strict';
// SYNTHETIC TEST DATA. These dates/session claims are NOT actual KRX evidence.
const {fixture}=require('./observation-fixtures.cjs');
const target='2026-09-25',start='2026-09-22T15:30:00+09:00',end='2026-09-25T15:30:00+09:00';
const received='2026-09-25T18:00:00+09:00',asOf='2026-09-25T18:01:00+09:00';
function eodFixture(symbol='005930',scenario='complete') {
  const v=fixture(symbol,'pass');
  for(const m of Object.values(v.metadata)){m.sourceBusinessDate=target;m.sourceTimestamp=null;m.receivedAt=received;}
  v.eodEvidence={calendar:{market:'KRX',session:'REGULAR',from:'2026-09-22',through:target,days:{
    '2026-09-22':{status:'OPEN',close:start},'2026-09-23':{status:'CLOSED'},'2026-09-24':{status:'CLOSED'},[target]:{status:'OPEN',close:end}}},
    daily:{date:target,close:100,volume:150,averageVolume20:100,market:'KRX',priceBasis:'UNADJUSTED',unit:'KRW/SHARES',complete:true,completionEvidence:'TEST_FIXTURE_ONLY',receivedAt:received},
    supply:{date:target,market:'KRX',unit:'SHARES',unitVerified:true,finality:'FINAL',finalityEvidence:'TEST_FIXTURE_ONLY',foreignerNet:1,institutionNet:1,receivedAt:received},
    news:{coverage:{from:start,through:end,complete:true,evidence:'TEST_FIXTURE_ONLY'},articles:[{publishedAt:'2026-09-24T12:00:00+09:00',meaning:'PUBLICATION_TIME',hasCautionSignal:false,receivedAt:received}]}};
  const t=v.eodEvidence;
  if(scenario==='incomplete')t.daily.complete=false;
  if(scenario==='market')t.daily.market='NXT';
  if(scenario==='provisional')t.supply.finality='PROVISIONAL';
  if(scenario==='news-unknown')t.news.articles[0].publishedAt=null;
  if(scenario==='calendar')t.calendar=null;
  if(scenario==='caution')t.news.articles[0].hasCautionSignal=true;
  if(scenario==='error')throw Error('TEST_SECRET_MUST_NOT_LEAK');
  return v;
}
module.exports={eodFixture,target,start,end,received,asOf};
