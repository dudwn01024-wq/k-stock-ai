require('./helpers/local-only.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'frontend/src/App.jsx'), 'utf8');
const helpers = import(pathToFileURL(path.join(root, 'frontend/src/utils/numbers.js')));
const candles = import(pathToFileURL(path.join(root, 'frontend/src/utils/candles.js')));
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
};
// TEST_ONLY: the public chart now uses validated OHLC candles rather than a close Line.
async function chartRows(items) {return (await candles).prepareCandles(items).candles;}
const row=patch=>({testOnly:true,date:'2026-09-18',open:65000,high:75000,low:64000,volume:123,...patch});
for (const [label,price,expected] of [['numeric price',70000,70000],['null',null,null],
  ['undefined',undefined,null],['empty','',null],['zero',0,null],['numeric string','70000',70000]]) {
  test('TEST_ONLY current candle mapping preserves valid '+label+' without inventing missing close',async()=>{
    const rows=await chartRows([row({price})]);
    if(expected===null)assert.equal(rows.length,0);
    else {assert.equal(rows[0].close,expected);assert.equal(Number(rows[0].price),expected);assert.equal(rows[0].volume,123);}
  });
}
test('TEST_ONLY canonical close and legacy price alias remain supported without the removed Line',async()=>{
  assert.equal((await chartRows([row({close:70000,price:69900})]))[0].close,70000);
  assert.equal((await chartRows([row({price:70000})]))[0].close,70000);
  assert.equal((await chartRows([row({close:null,price:70000})])).length,0);
  assert.match(source,/<CandlestickChart rows={chartData}/);assert.doesNotMatch(source,/<Line[\s\S]*?dataKey="price"/);
});

test('actual backend chart response passes through frontend service into chart mapping', async () => {
  const backend = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const start = backend.lastIndexOf('app.get(', backend.indexOf("'/api/stock/chart'"));
  const end = backend.indexOf('\napp.', start + 1);
  const ctx = vm.createContext({
    ...require('../services/dataFreshness'),
    app: { get: (route, handler) => { if(route === '/api/stock/chart') ctx.handler = handler; } },
    validateSymbol: () => true, NAVER_HEADERS: {}, console,
    average: values => values.reduce((a,b) => a+b, 0) / values.length,
    fetch: async () => ({ ok: true, json: async () => [{testOnly:true,localTradedAt:'2026-09-18',openPrice:'65000',highPrice:'75000',lowPrice:'64000',closePrice:'70000',volume:123}] })
  });
  vm.runInContext(backend.slice(backend.indexOf('const parseNumber ='), backend.indexOf('const validateSymbol =')), ctx);
  vm.runInContext(backend.slice(start, end), ctx);
  let payload;
  await ctx.handler({query:{symbol:'005930',timeframe:'1M'}}, { json: value => { payload = value; } });
  assert.equal(payload.chart[0].price, 70000); assert.equal(payload.chart[0].close,70000);
  const frontend = vm.createContext({ ...await helpers,
    fetch: async () => ({ok:true,json:async()=>payload}) });
  vm.runInContext(section('const API_BASE_URL', 'export default function App') +
    '\nthis.service = new RealStockBackendService();', frontend);
  const result = await frontend.service.getStockChart('005930', '1M');
  assert.equal((await chartRows(result.items))[0].price, 70000);
});

test('TEST_ONLY timeframe handler preserves selected symbol and only reloads its chart',()=>{
  const handler=section('  const handleTimeframeChange =','  const changeRate =');
  assert.match(handler,/getStockChart\(activeSymbol, newTimeframe\)/);
  assert.doesNotMatch(handler,/getStockQuote|getStockNews|getStockStrategy|getAIAnalysis|getStockDetailAnalysis|loadRealStockData/);
  assert.match(source,/const \[chartTimeframe, setChartTimeframe\] = useState\('1D'\)/);
  // Actual selected-symbol/range behavior is exercised by shared-detail-news-ui.test.cjs.
});
