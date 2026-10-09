// Canonical origin is configured here only. Build assets use this same source.
export const PUBLIC_SITE_URL='https://k-stock-ai-1.onrender.com';
export const PUBLIC_PAGE_METADATA=Object.freeze({
  '/':{title:'K-Stock AI | 국내주식 데이터 분석',description:'국내주식의 가격, 거래량, 수급, 기술적 지표와 뉴스를 한곳에서 확인할 수 있는 주식 분석 참고 서비스입니다.'},
  '/about':{title:'K-Stock AI 소개 | 국내주식 분석 서비스',description:'K-Stock AI가 분석하는 국내주식 데이터와 정보 제공 목적, 분석 후보·상세 분석·AI 해설의 역할을 소개합니다.'},
  '/analysis-method':{title:'주식 분석 방법 | K-Stock AI',description:'추세, 거래량, 수급, RSI, MACD, ATR, 지지선·저항선과 AI 해설 등 K-Stock AI의 분석 방법과 한계를 설명합니다.'},
  '/data-sources':{title:'데이터 출처 및 기준 안내 | K-Stock AI',description:'K-Stock AI에서 사용하는 국내주식 데이터의 출처, 기준일, 조회시각, 장중 데이터와 일봉 기준을 안내합니다.'},
  '/investment-notice':{title:'투자정보 이용안내 | K-Stock AI',description:'K-Stock AI 분석 정보의 참고 목적, 원금 손실 위험, 데이터와 AI의 한계 및 이용 시 주의사항을 안내합니다.'},
  '/privacy':{title:'개인정보처리방침 | K-Stock AI',description:'K-Stock AI의 개인정보 처리 현황, 비공개 보유자 기능과 향후 광고·쿠키 관련 안내를 제공합니다.'}
});
export function getPageMeta(path='/',stockName=null){
  const clean=typeof path==='string'?path.split(/[?#]/)[0].replace(/\/+$/,'')||'/':'/';
  const stock=/^\/stocks\/\d{6}$/.test(clean);
  // Invalid symbols and unknown URLs are error screens, never home aliases.
  // A syntactically valid six-digit symbol retains its unresolved-stock policy.
  if(!stock&&!Object.hasOwn(PUBLIC_PAGE_METADATA,clean))return {
    title:clean.startsWith('/stocks/')?'종목코드를 확인해주세요 | K-Stock AI':'페이지를 찾을 수 없습니다 | K-Stock AI',
    description:'요청하신 페이지 주소를 확인해주세요. 메인 화면에서 공개 분석 안내와 종목 검색을 이용할 수 있습니다.',
    canonical:null,robots:'noindex,follow'
  };
  const canonicalPath=clean;
  const content=stock?{
    title:stockName?stockName+' 주식 분석 | K-Stock AI':'종목 상세 분석 | K-Stock AI',
    description:'선택한 국내주식의 시장 데이터와 분석 기준을 확인하는 상세 공유 화면입니다. 분석 정보는 투자 참고용입니다.'
  }:PUBLIC_PAGE_METADATA[canonicalPath];
  // Stock indexing is deferred until crawler-safe data reads are designed.
  // noindex is an indexing instruction, not a provider-request/crawling limit.
  return {...content,canonical:PUBLIC_SITE_URL+canonicalPath,robots:stock?'noindex,follow':'index,follow'};
}
export const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function renderDefaultHead(){
  const meta=getPageMeta('/');
  // SPA fallback is shared by every URL. Inject canonical only after routing,
  // so /about never receives an initial HTML canonical pointing to home.
  return '<title>'+escapeHtml(meta.title)+'</title>\n    <meta name="description" content="'+escapeHtml(meta.description)+'" />\n    <meta name="robots" content="'+meta.robots+'" />';
}
export function renderRobots(){return 'User-agent: *\nAllow: /\n\nSitemap: '+PUBLIC_SITE_URL+'/sitemap.xml\n';}
export function renderSitemap(){
  const urls=Object.keys(PUBLIC_PAGE_METADATA).map(route=>'  <url><loc>'+escapeHtml(PUBLIC_SITE_URL+route)+'</loc></url>').join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+urls+'\n</urlset>\n';
}
