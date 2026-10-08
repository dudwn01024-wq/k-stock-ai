'use strict';
const effect="  useEffect(()=>{\n    document.title=routeSymbol&&quoteData?.symbol===routeSymbol\n      ? (quoteData.stockName||routeSymbol)+' 주식 분석 | K-Stock AI':'K-Stock AI';\n    return()=>{document.title='K-Stock AI';};\n  },[routeSymbol,quoteData?.symbol,quoteData?.stockName]);\n\n",insert="      <PageMeta path={routeSymbol?'/stocks/'+routeSymbol:'/'} stockName={routeSymbol&&quoteData?.symbol===routeSymbol?quoteData.stockName:null}/>\n";
module.exports=source=>{
  let s=require('./without-stock-landing.cjs')(source).replaceAll('\r\n','\n');
  if(!s.includes("import PageMeta from './components/PageMeta.jsx';"))return s;
  const replacements=[
    ["import PageMeta from './components/PageMeta.jsx';\n",''],
    [insert,''],
    ['  const recommendationLoader=useMemo',effect+'  const recommendationLoader=useMemo']
  ];
  for(const [after,before] of replacements){if(s.split(after).length!==2)throw Error('EXACT_SEO_BOUNDARY_REQUIRED');s=s.replace(after,before);}
  return s;
};
