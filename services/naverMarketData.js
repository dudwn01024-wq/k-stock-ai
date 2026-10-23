'use strict';
// Existing server readers extracted without changing normalization or news rules.
const {dataFreshness,dateConsistency}=require('./dataFreshness');
const {MAX_PAGES}=require('./observationNewsContract');
const {quoteMetrics,snapshotMetadata}=require('./naverQuoteSnapshot');
const NAVER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const parseNumber = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? value
      : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const cleaned =
    value
      .replace(/,/g, '')
      .replace(/\s/g, '')
      .trim();

  if (!cleaned) {
    return null;
  }

  const num =
    Number(cleaned);

  return Number.isFinite(num)
    ? num
    : null;
};

const getIntegrationInfoValue = (
  integrationData,
  code
) => {
  if (
    !integrationData ||
    !Array.isArray(
      integrationData.totalInfos
    )
  ) {
    return null;
  }

  const found =
    integrationData.totalInfos.find(
      (item) =>
        item &&
        item.code === code
    );

  return found
    ? found.value
    : null;
};

const getLatestDealTrend = (
  integrationData
) => {
  if (
    !integrationData ||
    !Array.isArray(
      integrationData.dealTrendInfos
    )
  ) {
    return null;
  }

  const list =
    integrationData.dealTrendInfos.filter(
      Boolean
    );

  if (
    list.length === 0
  ) {
    return null;
  }

  const getDateValue =
    (item) =>
      item.localTradedAt ||
      item.tradeDate ||
      item.bizdate ||
      item.date ||
      item.localDate ||
      null;

  const withDate =
    list.filter((item) =>
      getDateValue(item)
    );

  if (
    withDate.length ===
    list.length
  ) {
    return [...list].sort(
      (a, b) =>
        String(
          getDateValue(b)
        ).localeCompare(
          String(
            getDateValue(a)
          )
        )
    )[0];
  }

  return list[0];
};

const assessLatestNews = (news) => {
  const list = Array.isArray(news)
    ? news.slice(0, 10)
    : [];

  const positiveKeywords = [
    '수주',
    '계약',
    '공급계약',
    '실적 개선',
    '호실적',
    '흑자전환',
    '매출 증가',
    '영업이익 증가',
    '증익',
    '승인',
    '허가',
    '신제품',
    '증설',
    '투자 확대',
    '자사주 매입',
    '자사주 소각',
    '배당 확대',
    '목표가 상향'
  ];

  const negativeKeywords = [
    '적자전환',
    '적자 확대',
    '실적 부진',
    '영업손실',
    '매출 감소',
    '영업이익 감소',
    '감익',
    '리콜',
    '소송',
    '과징금',
    '제재',
    '압수수색',
    '횡령',
    '배임',
    '유상증자',
    '전환사채',
    'CB 발행',
    '하향',
    '목표가 하향',
    '계약 해지',
    '공급 중단'
  ];

  let positiveCount = 0;
  let negativeCount = 0;

  const positiveHeadlines = [];
  const negativeHeadlines = [];

  for (const item of list) {
    const text =
      `${item?.title || ''} ${item?.summary || ''}`.trim();

    if (!text) {
      continue;
    }

    const positiveHit =
      positiveKeywords.some(
        (keyword) =>
          text.includes(keyword)
      );

    const negativeHit =
      negativeKeywords.some(
        (keyword) =>
          text.includes(keyword)
      );

    if (
      positiveHit &&
      !negativeHit
    ) {
      positiveCount += 1;

      if (item?.title) {
        positiveHeadlines.push(
          item.title
        );
      }
    }

    if (negativeHit) {
      negativeCount += 1;

      if (item?.title) {
        negativeHeadlines.push(
          item.title
        );
      }
    }
  }

  const sentiment =
    negativeCount > 0
      ? 'CAUTION'
      : positiveCount > 0
        ? 'POSITIVE'
        : list.length > 0
          ? 'NEUTRAL'
          : 'INSUFFICIENT_DATA';

  // 뉴스가 없으면 통과로 간주하지 않습니다.
  // 명확한 악재가 하나라도 있으면
  // 최우선 후보에서 제외합니다.
  const newsPassed =
    list.length === 0
      ? null
      : negativeCount === 0;

  return {
    newsPassed,

    sentiment,

    newsCount:
      list.length,

    positiveCount,

    negativeCount,

    positiveHeadlines:
      positiveHeadlines.slice(
        0,
        3
      ),

    negativeHeadlines:
      negativeHeadlines.slice(
        0,
        3
      ),

    reason:
      list.length === 0
        ? '최신 뉴스 데이터가 없어 뉴스 조건을 판단할 수 없습니다.'
        : negativeCount > 0
          ? '최신 뉴스에서 주의 키워드가 확인되어 최우선 추천에서 제외합니다.'
          : positiveCount > 0
            ? '최신 뉴스에서 긍정 재료가 확인되고 명확한 주의 키워드는 확인되지 않았습니다.'
            : '최신 뉴스는 확인되지만 명확한 호재·악재 키워드가 없어 중립으로 판단합니다.'
  };
};


function createNaverMarketData({fetchImpl=(...args)=>globalThis.fetch(...args),failFast=false,allowNewsPageSize20=false}={}) {
const fetch=fetchImpl;
const fetchStockQuoteData = async function(symbol,{includeSupply=true}={}){
  const basicResponse=await fetch(`https://m.stock.naver.com/api/stock/${symbol}/basic`,{headers:NAVER_HEADERS});
  if(!basicResponse.ok)throw Error(`Failed to fetch stock basic data: HTTP ${basicResponse.status}`);
  const basicData=await basicResponse.json(),basicReceivedAt=new Date().toISOString();
  if(basicData?.itemCode&&basicData.itemCode!==symbol)throw Error('Stock basic symbol mismatch');
  const priceMetadata=snapshotMetadata(basicData,'Naver basic',basicReceivedAt);
  const basicMetrics=quoteMetrics({basic:basicData,basicReceivedAt});
  let integrationData=null,integrationReceivedAt=null;
  // Use one response for the entire metrics group. A KRX polling amount must
  // never fill a hole in a different market/session's volume or OHLC snapshot.
  if(includeSupply||['volume','tradingValue','highPrice','lowPrice'].some(key=>basicMetrics[key]===null)){
    try{
      const response=await fetch(`https://m.stock.naver.com/api/stock/${symbol}/integration`,{headers:NAVER_HEADERS});
      if(response.ok){
        const data=await response.json();
        if(data?.itemCode&&data.itemCode!==symbol)throw Error('Stock integration symbol mismatch');
        integrationData=data;integrationReceivedAt=new Date().toISOString();
      }else if(failFast)throw Error(`Integration fetch failed: HTTP ${response.status}`);
    }catch(error){
      if(failFast)throw error;
      console.warn(`[K-Stock AI] Integration fetch failed for ${symbol}:`,error.message);
    }
  }
  const metrics=quoteMetrics({basic:basicData,basicReceivedAt,integration:integrationData,integrationReceivedAt});
  let foreignerNet=null,institutionNet=null,supplyDate=null;
  let supplyMetadata=dataFreshness({source:includeSupply?'Naver integration':'NOT_REQUESTED'});
  const latestTrend=includeSupply?getLatestDealTrend(integrationData):null;
  if(latestTrend){
    foreignerNet=parseNumber(latestTrend.foreignerPureBuyQuant);
    institutionNet=parseNumber(latestTrend.organPureBuyQuant);
    supplyDate=latestTrend.localTradedAt??latestTrend.tradeDate??latestTrend.bizdate??latestTrend.date??latestTrend.localDate??null;
    supplyMetadata=dataFreshness({source:'Naver integration',date:supplyDate,
      timestamp:latestTrend.localTradedAt??null,receivedAt:integrationReceivedAt});
  }
  return {symbol,stockName:basicData.stockName||null,currentPrice:parseNumber(basicData.closePrice??basicData.nowPrice),
    priceChange:parseNumber(basicData.compareToPreviousClosePrice),changeRate:parseNumber(basicData.fluctuationsRatio),
    openPrice:metrics.openPrice,highPrice:metrics.highPrice,lowPrice:metrics.lowPrice,volume:metrics.volume,tradingValue:metrics.tradingValue,
    foreignerNet,institutionNet,foreignerBuy:null,foreignerSell:null,institutionBuy:null,institutionSell:null,supplyDate,
    dataMetadata:{price:priceMetadata,quoteMetrics:metrics.metadata,volume:metrics.metadata,tradingValue:metrics.metadata,
      ohlc:metrics.metadata,supply:supplyMetadata,dateConsistency:dateConsistency([priceMetadata,metrics.metadata,supplyMetadata])}};
};

const fetchStockNewsBySymbol =
  async (symbol, {page=1,pageSize=10}={}) => {
    if(!Number.isInteger(page)||page<1||page>MAX_PAGES||
      (pageSize!==10&&!(allowNewsPageSize20&&pageSize===20)))throw Error('INVALID_NEWS_PAGE');
    const response =
      await fetch(
        `https://m.stock.naver.com/api/news/stock/${symbol}?pageSize=${pageSize}&page=${page}`,
        {
          headers:
            NAVER_HEADERS
        }
      );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch stock news: HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    let rawList = [];

    if (
      Array.isArray(data)
    ) {
      rawList =
        data.flatMap(
          (group) =>
            group &&
            Array.isArray(
              group.items
            )
              ? group.items
              : []
        );
    } else if (
      data &&
      Array.isArray(
        data.items
      )
    ) {
      rawList =
        data.items;
    }

    const receivedAt = new Date().toISOString();
    return rawList.map(
      (item) => {
        const rawTitle =
          item.tit ||
          item.title ||
          null;

        const cleanTitle =
          rawTitle
            ? rawTitle.replace(
                /<[^>]+>/g,
                ''
              )
            : null;

        const rawSummary =
          item.subtit ||
          item.body ||
          item.summary ||
          null;

        const cleanSummary =
          rawSummary
            ? rawSummary.replace(
                /<[^>]+>/g,
                ''
              )
            : null;

        const articleId =
          item.articleId ||
          item.id ||
          null;

        const officeId =
          item.officeId ||
          null;

        let articleUrl =
          item.url ||
          null;

        if (
          officeId &&
          articleId
        ) {
          articleUrl =
            `https://n.news.naver.com/mnews/article/${officeId}/${articleId}`;
        }

        return {
          dataMetadata: dataFreshness({ source: 'Naver news',
            timestamp: item.datetime ?? item.createdAt ?? item.date ?? null, receivedAt }),
          id:
            articleId,

          title:
            cleanTitle,

          publisher:
            item.officeName ||
            item.publisher ||
            null,

          date:
            item.datetime ||
            item.createdAt ||
            item.date ||
            null,

          summary:
            cleanSummary,

          url:
            articleUrl
        };
      }
    );
  };

return {fetchStockQuoteData,fetchStockNewsBySymbol};
}
module.exports={createNaverMarketData,assessLatestNews};
