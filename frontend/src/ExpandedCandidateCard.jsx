import React from 'react';
import './expanded-recommendation.css';
import {recommendationDataDates} from './recommendationDataDates.js';

const gradeLabels={PRIORITY_CANDIDATE:'조건 우수 후보',CHASE_CAUTION:'추격 주의',WATCH_CANDIDATE:'관심 후보'};
const numeric=value=>typeof value==='number'&&Number.isFinite(value);
const number=value=>numeric(value)?value.toLocaleString('ko-KR'):'미확인';
const price=value=>numeric(value)&&value>0?`${number(value)}원`:'미확인';
const percent=value=>numeric(value)?`${value>0?'+':''}${number(value)}%`:'미확인';
const text=value=>typeof value==='string'&&value.trim()?value:'미확인';
const count=value=>Number.isSafeInteger(value)&&value>=0?number(value):'미확인';
const condition=value=>value===true?'통과':value===false?'미충족':'미확인';
const words=value=>Array.isArray(value)?value.filter(x=>typeof x==='string').join(' · ')||'없음':'미확인';
export const safeEvidenceUrl=value=>{
  if(typeof value!=='string')return null;
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}
  catch{return null;}
};
const volumeFields=[['currentVolume','거래량'],['averageVolume20','20일 평균 거래량'],['volumeRatio','거래량 비율'],
  ['foreignerNet','외국인 순수급'],['institutionNet','기관 순수급']];

// Presentation only: no services, hooks, requests, ranking or price calculations.
export default function ExpandedCandidateCard({item,children,screening=false,onSelect}){
  const strategy=item.strategy??{},assessment=item.newsAssessment??{},metadata=item.dataMetadata?.price;
  const riskReward=item.riskReward;
  const dataDates=recommendationDataDates(item);
  const volumePending=strategy.volumePassed===null&&strategy.volumeAssessment?.status==='INTRADAY_PENDING';
  const news=Array.isArray(item.news)?item.news.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)).slice(0,3):null;
  const conditions=[['추세',strategy.trendPassed],['거래량',strategy.volumePassed],['수급',strategy.supplyPassed],['뉴스',assessment.newsPassed]];
  return <>
    <div className="expanded-card-heading">{screening&&onSelect?<button type="button" className="expanded-stock-name" onClick={()=>onSelect({code:item.symbol,name:item.stockName||item.symbol})}>{item.stockName||item.symbol}</button>:<strong>{item.stockName||item.symbol}</strong>}<small>{item.symbol}</small></div>
    <p className="expanded-card-grade">{gradeLabels[item.grade]||text(item.grade)} · 기존 추천 점수 {number(item.score)} / 4</p>
    {!screening&&<dl className="expanded-card-prices">
      <div className="expanded-card-quote"><dt>분석 당시 조회가</dt><dd>{price(item.currentPrice)}</dd></div>
      <div><dt>등락률</dt><dd>{percent(item.changeRate)}</dd></div>
      <div><dt>전략 참고 진입가</dt><dd>{price(strategy.entryPrice)}</dd></div>
      <div><dt>전략 참고 목표가</dt><dd>{price(strategy.takeProfitPrice)}</dd></div>
      <div><dt>전략 참고 손절가</dt><dd>{price(strategy.stopLossPrice)}</dd></div>
    </dl>}
    <ul className="expanded-card-conditions" aria-label="추천 조건">
      {conditions.map(([label,value])=><li key={label} className={value===true?'condition-pass':value===false?'condition-fail':'condition-unknown'}>
        <span>{label}</span><strong>{label==='거래량'&&volumePending?'장중 확인 중':condition(value)}</strong>
      </li>)}
    </ul>
    {volumePending&&<p className="expanded-card-note">당일 누적 거래량은 장 마감 전 최종 판정하지 않습니다.</p>}
    {screening&&<div className="expanded-selection-reasons">
      <p><strong>추천 이유 · 통과 조건</strong> {words(item.passedConditions)}</p>
      <p><strong>미충족 조건</strong> {words(item.failedConditions)}</p>
      {item.pendingConditions?.length>0&&<p><strong>장중 확인 중 조건</strong> {words(item.pendingConditions)}</p>}
      <p><strong>미확인 조건</strong> {words(item.unknownConditions)}</p>
    </div>}
    <section className="expanded-data-dates" aria-label="데이터 기준">
      <h4>데이터 기준</h4>
      {dataDates.mismatch&&<p className="expanded-data-date-warning">데이터 기준일이 서로 다릅니다. 아래 항목별 기준을 확인하세요.</p>}
      <dl>{dataDates.rows.map(row=><div key={row.key}>
        <dt>{row.label}</dt><dd><span>{row.value}</span><small>제공처: {row.source}{row.lookup&&<> · {row.lookup}</>}</small></dd>
      </div>)}</dl>
    </section>
    <details className="expanded-card-evidence"><summary>상세 근거 보기</summary>
      <p className="expanded-card-note">{screening?'분석 당시 저장된 선정 근거이며, 시세 최신성과 매수 허가를 뜻하지 않습니다.':'분석 당시 자료입니다. 참고 가격은 주문 지시가 아니며, 시세 최신성을 보장하지 않습니다.'}</p>
      <h4>거래량·수급</h4>
      <dl className="expanded-card-facts">{volumeFields.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{number(strategy[key])}</dd></div>)}</dl>
      <p className="expanded-card-note">거래량·수급 단위와 확정 여부는 이 화면에서 추가 검증하지 않습니다.</p>
      <h4>뉴스 필터 근거</h4>
      <dl className="expanded-card-facts">
        <div><dt>뉴스 조건</dt><dd>{condition(assessment.newsPassed)}</dd></div>
        <div><dt>저장된 평가 상태</dt><dd>{text(assessment.sentiment)}</dd></div>
        <div><dt>평가 기사 수</dt><dd>{count(assessment.newsCount)}</dd></div>
        <div><dt>긍정 단서 수</dt><dd>{count(assessment.positiveCount)}</dd></div>
        <div><dt>부정 단서 수</dt><dd>{count(assessment.negativeCount)}</dd></div>
      </dl>
      <p className="home-warning">뉴스 필터 통과는 전체 뉴스 확인·악재 없음·최신성 검증·매수 허가를 뜻하지 않습니다.</p>
      {news?.length?<ol className="expanded-card-news">{news.map((article,index)=>{
        const url=safeEvidenceUrl(article.url);
        return <li key={index}><strong>{text(article.title)}</strong>
          {typeof article.summary==='string'&&article.summary.trim()&&<p className="expanded-card-news-summary">{article.summary}</p>}
          <p>제공처/언론사: {text(article.publisher)}</p>
          <p>제공처 표기 시각: {text(article.date??article.dataMetadata?.sourceTimestamp)}</p>
          {url&&<a href={url} target="_blank" rel="noopener noreferrer">저장된 원문 링크</a>}
        </li>;
      })}</ol>:<p>{news?'저장된 뉴스 없음':'저장된 뉴스 미확인'}</p>}
      <p className="expanded-card-note">저장된 뉴스 중 최대 3건을 표시합니다. 제공처 표기 시각은 최초 발행 시각으로 검증되지 않았으며, 뉴스의 최신성·완전성은 미확인입니다.</p>
      {!screening&&<><h4>손익비 · 분석 당시 조회가 기준</h4>
      {riskReward?.available===true?<dl className="expanded-card-facts">
        <div><dt>상승 여력</dt><dd>{percent(riskReward.currentUpsidePercent)}</dd></div>
        <div><dt>하락 위험</dt><dd>{percent(riskReward.currentDownsidePercent)}</dd></div>
        <div><dt>손익비</dt><dd>{number(riskReward.currentRiskRewardRatio)}</dd></div>
      </dl>:<p>손익비 미확인</p>}
      {typeof riskReward?.reason==='string'&&riskReward.reason&&<p className="expanded-card-note">저장된 손익비 근거: {riskReward.reason}</p>}</>}
      <h4>당시 선정 조건</h4>
      <p>통과: {words(item.passedConditions)}</p><p>미충족: {words(item.failedConditions)}</p><p>미확인: {words(item.unknownConditions)}</p>
      {item.pendingConditions?.length>0&&<p>장중 확인 중: {words(item.pendingConditions)}</p>}
      <p className={metadata?.freshnessStatus==='STALE'?'home-warning':'expanded-card-note'}>
        {metadata?.freshnessStatus==='STALE'?'오래된 자료 · 최신성 재확인 필요':'최신성 미확인 · 실시간 시세가 아닙니다.'}
      </p>
    </details>
    {screening&&onSelect&&<button type="button" className="home-secondary expanded-detail-link" onClick={()=>onSelect({code:item.symbol,name:item.stockName||item.symbol})}>현재 상세 분석 보기</button>}
    {children}
  </>;
}
