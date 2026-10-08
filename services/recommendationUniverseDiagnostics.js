'use strict';
// Exact allowlist: public page bounds/counts only, never raw rows or exceptions.
const positive=value=>Number.isSafeInteger(value)&&value>0;
function safeUniverseCoverage(value){
  if(!value||(value.globalCutoff!==null&&!positive(value.globalCutoff)))return null;
  const result={globalCutoff:value.globalCutoff};
  for(const market of ['KOSPI','KOSDAQ']){
    const page=value[market];
    if(!page||!Number.isInteger(page.pagesFetched)||page.pagesFetched<0||page.pagesFetched>10||
      typeof page.done!=='boolean'||typeof page.covered!=='boolean')return null;
    if(page.pagesFetched===0){
      if(page.lastPageMax!==null||page.lastPageMin!==null||page.done||page.covered)return null;
    }else if(!positive(page.lastPageMax)||!positive(page.lastPageMin)||page.lastPageMin>page.lastPageMax||
      page.covered!==(page.done||(value.globalCutoff!==null&&page.lastPageMax<value.globalCutoff)))return null;
    result[market]={lastPageMax:page.lastPageMax,lastPageMin:page.lastPageMin,
      pagesFetched:page.pagesFetched,done:page.done,covered:page.covered};
  }
  return result;
}
module.exports={safeUniverseCoverage};
