'use strict';
// Undo only the exact shared-catalog extraction when checking earlier UI boundaries.
const catalog="const POPULAR_STOCKS = [\n  { name: '삼성전자', code: '005930' },\n  { name: 'SK하이닉스', code: '000660' },\n  { name: 'LG에너지솔루션', code: '373220' },\n  { name: 'NAVER', code: '035420' },\n  { name: '현대차', code: '005380' },\n  { name: '카카오', code: '035720' },\n  { name: '셀트리온', code: '068270' }\n];";
module.exports=source=>{
 const s=source.replaceAll('\r\n','\n'),shared="import { POPULAR_STOCKS } from './stockCatalog.js';";
 if(!s.includes(shared))return s;
 if(s.split(shared).length!==2)throw Error('EXACT_STOCK_CATALOG_BOUNDARY_REQUIRED');
 if(s.split('const TIMEFRAMES = [').length!==2)throw Error('EXACT_TIMEFRAMES_BOUNDARY_REQUIRED');
 return s.replace(shared+'\n','').replace('const TIMEFRAMES = [',catalog+'\nconst TIMEFRAMES = [');
};
