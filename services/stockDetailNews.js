'use strict';
const {randomUUID}=require('node:crypto');
const {assessLatestNews}=require('./naverMarketData');

const DETAIL_NEWS_TTL_MS=5*60*1000;
const MAX_DETAIL_NEWS_SNAPSHOTS=50;
const freeze=value=>{
  if(value&&typeof value==='object'){
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const failure=(code,status,message)=>Object.assign(Error(message),{code,status});

// Only normalized provider articles are retained. No client news, credentials or disk writes.
function createStockDetailNews({fetchNews,now=Date.now,ttlMs=DETAIL_NEWS_TTL_MS,maxEntries=MAX_DETAIL_NEWS_SNAPSHOTS}){
  const snapshots=new Map();
  const prune=()=>{
    for(const [id,snapshot] of snapshots)if(now()>=snapshot.expiresAt)snapshots.delete(id);
  };
  return {
    async create(symbol){
      if(!/^\d{6}$/.test(symbol))throw failure('DETAIL_SYMBOL_INVALID',400,'올바른 종목코드가 필요합니다.');
      let news,status;
      try{
        const result=await fetchNews(symbol);
        if(!Array.isArray(result))throw Error('INVALID_NORMALIZED_NEWS');
        news=JSON.parse(JSON.stringify(result));
        status='READY';
      }catch{
        news=[];
        status='LOOKUP_FAILED';
      }
      const receivedAt=new Date(now()).toISOString();
      const snapshot=freeze({id:randomUUID(),symbol,news,receivedAt,status,
        newsAssessment:status==='READY'?assessLatestNews(news):null,expiresAt:now()+ttlMs});
      prune();
      while(snapshots.size>=maxEntries)snapshots.delete(snapshots.keys().next().value);
      snapshots.set(snapshot.id,snapshot);
      return snapshot;
    },
    get(id,symbol){
      if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
        throw failure('DETAIL_NEWS_SNAPSHOT_INVALID',400,'뉴스 묶음 식별자가 올바르지 않습니다.');
      prune();
      const snapshot=snapshots.get(id);
      if(!snapshot)throw failure('DETAIL_NEWS_SNAPSHOT_UNAVAILABLE',410,'상세 뉴스 묶음이 만료되었거나 없습니다. 상세 자료를 다시 조회한 뒤 AI 해설을 요청하세요. 자동 재조회하지 않습니다.');
      if(snapshot.symbol!==symbol)throw failure('DETAIL_NEWS_SYMBOL_MISMATCH',400,'종목과 뉴스 묶음이 일치하지 않습니다.');
      return snapshot;
    }
  };
}
module.exports={createStockDetailNews,DETAIL_NEWS_TTL_MS,MAX_DETAIL_NEWS_SNAPSHOTS};
