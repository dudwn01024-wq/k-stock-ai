// Display metadata only. No quotes, financial data, network or AI are read here.
// These exact pairs reuse the existing server RECOMMENDATION_WATCHLIST.
export const KNOWN_STOCK_NAMES = Object.freeze({
  '005930':'삼성전자','000660':'SK하이닉스','373220':'LG에너지솔루션','207940':'삼성바이오로직스',
  '005380':'현대차','000270':'기아','068270':'셀트리온','035420':'NAVER','035720':'카카오',
  '005490':'POSCO홀딩스','105560':'KB금융','055550':'신한지주','086790':'하나금융지주',
  '316140':'우리금융지주','028260':'삼성물산','006400':'삼성SDI','051910':'LG화학',
  '012450':'한화에어로스페이스','329180':'HD현대중공업','042660':'한화오션','034020':'두산에너빌리티',
  '064350':'현대로템','015760':'한국전력','033780':'KT&G','017670':'SK텔레콤','066570':'LG전자',
  '009150':'삼성전기','003490':'대한항공','090430':'아모레퍼시픽','352820':'하이브',
  '010140':'삼성중공업','011200':'HMM','010950':'S-Oil','096770':'SK이노베이션',
  '003670':'포스코퓨처엠','247540':'에코프로비엠','086520':'에코프로','003230':'삼양식품',
  '004170':'신세계','139480':'이마트','035250':'강원랜드','010130':'고려아연',
  '018260':'삼성에스디에스','259960':'크래프톤','251270':'넷마블','323410':'카카오뱅크',
  '377300':'카카오페이','402340':'SK스퀘어','267250':'HD현대','011070':'LG이노텍'
});

export const STOCK_NAME_SOURCES = Object.freeze({
  CATALOG:'기존 종목 목록', SEARCH:'종목 검색 결과', RECOMMENDATION:'추천 목록', RESPONSE:'종목 응답의 이름 정보'
});
const CACHE_KEY='k-stock-ai.stock-name-metadata.v1';
const MAX_RECORDS=1000, MAX_STORAGE_LENGTH=400000;
const memory=new Map();
const validSymbol=symbol=>typeof symbol==='string'&&/^\d{6}$/.test(symbol);
const storageOrNull=()=>{try{return typeof window==='undefined'?null:window.sessionStorage;}catch{return null;}};
const cleanName=(name,symbol)=>{
  if(typeof name!=='string')return null;
  const value=name.trim();
  return value&&value.length<=120&&!/[\x00-\x1f\x7f<>\uFFFD]/.test(value)&&!/^\d+$/.test(value)&&
    value!==symbol&&!['종목명 미확인','종목명 없음','UNKNOWN'].includes(value)?value:null;
};
const normalized=record=>{
  if(!validSymbol(record?.symbol)||!Object.hasOwn(STOCK_NAME_SOURCES,record?.source))return null;
  const name=cleanName(record.name,record.symbol);
  return name?{symbol:record.symbol,name,source:record.source}:null;
};
const readStored=storage=>{
  try{
    const raw=storage?.getItem?.(CACHE_KEY);
    if(typeof raw!=='string'||raw.length>MAX_STORAGE_LENGTH)return [];
    const parsed=JSON.parse(raw);
    return Array.isArray(parsed)?parsed.slice(-MAX_RECORDS).map(normalized).filter(Boolean):[];
  }catch{return [];}
};

export function rememberStockIdentity(record,{storage=storageOrNull()}={}){
  const value=normalized(record);
  if(!value)return null;
  memory.delete(value.symbol);memory.set(value.symbol,value);
  while(memory.size>MAX_RECORDS)memory.delete(memory.keys().next().value);
  try{
    const records=new Map(readStored(storage).map(item=>[item.symbol,item]));
    records.delete(value.symbol);records.set(value.symbol,value);
    storage?.setItem?.(CACHE_KEY,JSON.stringify([...records.values()].slice(-MAX_RECORDS)));
  }catch{/* Storage denial must not block name display or analysis. */}
  return value;
}

export function resolveStockIdentity(symbol,{quote=null,storage=storageOrNull()}={}){
  if(!validSymbol(symbol))return {symbol:null,name:null,source:null};
  // KIS_CURRENT_QUOTE has no documented stock-name field. Keep its metrics separate.
  const responseName=quote?.symbol===symbol&&quote.source!=='KIS_CURRENT_QUOTE'?cleanName(quote.stockName,symbol):null;
  if(responseName)return {symbol,name:responseName,source:'RESPONSE'};
  if(Object.hasOwn(KNOWN_STOCK_NAMES,symbol))return {symbol,name:KNOWN_STOCK_NAMES[symbol],source:'CATALOG'};
  const cached=memory.get(symbol)??readStored(storage).find(record=>record.symbol===symbol);
  return cached?{...cached}:{symbol,name:null,source:null};
}
