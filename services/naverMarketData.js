'use strict';
// Existing server readers extracted without changing normalization or news rules.
const {dataFreshness,dateConsistency}=require('./dataFreshness');
const {MAX_PAGES}=require('./observationNewsContract');
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
const fetchStockQuoteData =
  async (symbol) => {
    const basicResponse =
      await fetch(
        `https://m.stock.naver.com/api/stock/${symbol}/basic`,
        {
          headers:
            NAVER_HEADERS
        }
      );

    if (
      !basicResponse.ok
    ) {
      throw new Error(
        `Failed to fetch stock basic data: HTTP ${basicResponse.status}`
      );
    }

    const basicData =
      await basicResponse.json();

    const basicReceivedAt = new Date().toISOString();
    const priceMetadata = dataFreshness({ source: 'Naver basic',
      date: basicData.localTradedAt ?? basicData.bizdate ?? null,
      timestamp: basicData.localTradedAt ?? null, receivedAt: basicReceivedAt });
    let volumeMetadata = { ...priceMetadata };
    let supplyMetadata = dataFreshness({ source: 'Naver integration' });

    const currentPrice =
      parseNumber(
        basicData.closePrice ||
        basicData.nowPrice
      );

    const priceChange =
      parseNumber(
        basicData.compareToPreviousClosePrice
      );

    const changeRate =
      parseNumber(
        basicData.fluctuationsRatio
      );

    const stockName =
      basicData.stockName ||
      null;

    let volume =
      parseNumber(
        basicData.accumulatedTradingVolume ??
        basicData.volume ??
        basicData.tradingVolume ??
        basicData.executedVolume
      );

    let tradingValue =
      parseNumber(
        basicData.accumulatedTradingValue ||
        basicData.tradingValue
      );

    let highPrice =
      parseNumber(
        basicData.highPrice ||
        basicData.maxPrice
      );

    let lowPrice =
      parseNumber(
        basicData.lowPrice ||
        basicData.minPrice
      );

    if (
      volume === null ||
      tradingValue === null ||
      highPrice === null ||
      lowPrice === null
    ) {
      try {
        const priceResponse =
          await fetch(
            `https://m.stock.naver.com/api/stock/${symbol}/price?pageSize=1&page=1`,
            {
              headers:
                NAVER_HEADERS
            }
          );

        if (
          priceResponse.ok
        ) {
          const priceData =
            await priceResponse.json();

          if (
            Array.isArray(
              priceData
            ) &&
            priceData.length >
              0
          ) {
            const latest =
              priceData[0];

            if (
              highPrice ===
              null
            ) {
              highPrice =
                parseNumber(
                  latest.highPrice
                );
            }

            if (
              lowPrice ===
              null
            ) {
              lowPrice =
                parseNumber(
                  latest.lowPrice
                );
            }

            if (
              volume ===
              null
            ) {
              volume =
                parseNumber(
                  latest.accumulatedTradingVolume ??
                  latest.volume
                );
              volumeMetadata = dataFreshness({ source: 'Naver daily price', date: latest.localTradedAt ?? latest.bizdate ?? null, timestamp: latest.localTradedAt ?? null, receivedAt: new Date().toISOString() });
            }

            if (
              tradingValue ===
              null
            ) {
              tradingValue =
                parseNumber(
                  latest.accumulatedTradingValue ||
                  latest.tradingValue
                );
            }
          }
        }
      } catch (error) {
        if (failFast) throw error;
        console.warn(
          `[K-Stock AI] Latest price fallback failed for ${symbol}:`,
          error.message
        );
      }
    }

    if (
      tradingValue ===
      null
    ) {
      try {
        const realtimeResponse =
          await fetch(
            `https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${symbol}`,
            {
              headers:
                NAVER_HEADERS
            }
          );

        if (
          realtimeResponse.ok
        ) {
          const realtimeData =
            await realtimeResponse.json();

          const realtimeItem =
            realtimeData
              ?.result
              ?.areas
              ?.[0]
              ?.datas
              ?.[0] ||
            null;

          if (
            realtimeItem
          ) {
            tradingValue =
              parseNumber(
                realtimeItem.aa ||
                realtimeItem.accumulatedTradingValue
              );
          }
        }
      } catch (error) {
        if (failFast) throw error;
        console.warn(
          `[K-Stock AI] Realtime trading value fetch failed for ${symbol}:`,
          error.message
        );
      }
    }

    let foreignerNet =
      null;

    let institutionNet =
      null;

    let supplyDate =
      null;

    try {
      const integrationResponse =
        await fetch(
          `https://m.stock.naver.com/api/stock/${symbol}/integration`,
          {
            headers:
              NAVER_HEADERS
          }
        );

      if (
        integrationResponse.ok
      ) {
        const integrationData =
          await integrationResponse.json();

        if (
          tradingValue ===
          null
        ) {
          tradingValue =
            parseNumber(
              getIntegrationInfoValue(
                integrationData,
                'accumulatedTradingValue'
              )
            );
        }

        const latestTrend =
          getLatestDealTrend(
            integrationData
          );

        if (
          latestTrend
        ) {
          foreignerNet =
            parseNumber(
              latestTrend.foreignerPureBuyQuant
            );

          institutionNet =
            parseNumber(
              latestTrend.organPureBuyQuant
            );

          supplyMetadata = dataFreshness({ source: 'Naver integration', date: latestTrend.localTradedAt ?? latestTrend.tradeDate ?? latestTrend.bizdate ?? latestTrend.date ?? latestTrend.localDate ?? null, timestamp: latestTrend.localTradedAt ?? null, receivedAt: new Date().toISOString() });
          supplyDate =
            latestTrend.localTradedAt ||
            latestTrend.tradeDate ||
            latestTrend.bizdate ||
            latestTrend.date ||
            latestTrend.localDate ||
            null;
        }
      }
    } catch (error) {
        if (failFast) throw error;
      console.warn(
        `[K-Stock AI] Integration fetch failed for ${symbol}:`,
        error.message
      );
    }

    return {
      symbol,
      stockName,
      currentPrice,
      priceChange,
      changeRate,
      volume,
      tradingValue,
      highPrice,
      lowPrice,
      foreignerNet,
      institutionNet,

      foreignerBuy:
        null,

      foreignerSell:
        null,

      institutionBuy:
        null,

      institutionSell:
        null,

      dataMetadata: { price: priceMetadata, volume: volumeMetadata, supply: supplyMetadata,
        dateConsistency: dateConsistency([priceMetadata, volumeMetadata, supplyMetadata]) },
      supplyDate
    };
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
