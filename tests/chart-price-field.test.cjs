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
// TEST_ONLY: legacy Naver/candle compatibility remains tested separately from the native KIS public chart.
async function chartRows(items) {return (await candles).prepareCandles(items).candles;}
const row=patch=>({testOnly:true,date:'2026-09-18',open:65000,high:75000,low:64000,volume:123,...patch});
for (const [label,price,expected] of [['numeric price',70000,70000],['null',null,null],
  ['undefined',undefined,null],['empty','',null],['zero',0,null],['numeric string','70000',70000]]) {
  test('TEST_ONLY legacy candle mapping preserves valid '+label+' without inventing missing close',async()=>{
    const rows=await chartRows([row({price})]);
    if(expected===null)assert.equal(rows.length,0);
    else {assert.equal(rows[0].close,expected);assert.equal(Number(rows[0].price),expected);assert.equal(rows[0].volume,123);}
  });
}
test('TEST_ONLY legacy candle close/price aliases remain supported while App renders native KIS periods',async()=>{
  assert.equal((await chartRows([row({close:70000,price:69900})]))[0].close,70000);
  assert.equal((await chartRows([row({price:70000})]))[0].close,70000);
  assert.equal((await chartRows([row({close:null,price:70000})])).length,0);
  assert.match(source,/<KisPeriodChart\b/);assert.doesNotMatch(source,/<CandlestickChart\b/);assert.doesNotMatch(source,/<Line[\s\S]*?dataKey="price"/);
});

test('TEST_ONLY legacy Naver backend chart response retains OHLC and price-alias candle compatibility', async () => {
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
  const mapped=await chartRows(payload.chart);
  assert.equal(mapped[0].close,70000);assert.equal(mapped[0].price,70000);assert.equal(mapped[0].volume,123);
  assert.equal(payload.symbol,'005930');
});

test('TEST_ONLY native frontend service requests the selected KIS period and preserves its raw provenance',async()=>{
  const calls=[],payload={testOnly:true,symbol:'005930',period:'W',source:'KIS_NATIVE_PERIOD_OHLCV',status:'READY',
    rows:[{date:'2026-09-18',open:65000,high:75000,low:64000,close:70000,volume:0}],
    metadata:{source:'KIS_NATIVE_PERIOD_OHLCV',requestedPeriod:'W',sourceBusinessDate:'2026-09-18',sourceTimestamp:null}};
  const frontend=vm.createContext({...await helpers,fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>payload};}});
  vm.runInContext(section('const API_BASE_URL','export default function App')+'\nthis.service=new RealStockBackendService();',frontend);
  const signal={testOnly:true},result=await frontend.service.getStockChart('005930','W',{signal});
  assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/stock/kis-chart?symbol=005930&period=W');
  assert.equal(calls[0].options.signal,signal);assert.equal(result,payload);assert.equal(result.rows[0].volume,0);
  assert.equal(result.metadata.sourceTimestamp,null);assert.equal(result.metadata.sourceBusinessDate,'2026-09-18');
  assert.equal(calls.some(call=>call.url.includes('/stock/chart?')),false);
});

test('TEST_ONLY native period handler retains selected symbol and reloads only chart, without quote/detail/news/AI calls',()=>{
  const handler=section('  const handleTimeframeChange =','  const changeRate =');
  assert.match(handler,/chartLoader.load\(\{symbol:activeSymbol,period\}\)/);
  assert.doesNotMatch(handler,/getStockQuote|getStockNews|getStockStrategy|getAIAnalysis|getStockDetail|loadRealStockData/);
  assert.match(source,/const \[chartTimeframe, setChartTimeframe\] = useState\('D'\)/);
  const chartCalls=[],selected=[],forbidden=()=>{throw Error('TEST_ONLY_ANALYSIS_MUST_NOT_RELOAD');};
  const context=vm.createContext({TIMEFRAMES:['D','W','M','Y'].map(code=>({code})),activeSymbol:'005930',
    setChartTimeframe:period=>selected.push(period),chartLoader:{load:async input=>{chartCalls.push(input);}},
    backendService:{getStockQuote:forbidden,getStockNews:forbidden,getStockStrategy:forbidden,getAIAnalysis:forbidden,getStockDetail:forbidden},loadRealStockData:forbidden});
  vm.runInContext(handler+'\nthis.change=handleTimeframeChange;',context);
  for(const period of ['D','W','M','Y'])context.change(period);context.change('1D');
  assert.deepEqual(selected,['D','W','M','Y']);
  assert.deepEqual(JSON.parse(JSON.stringify(chartCalls)),['D','W','M','Y'].map(period=>({symbol:'005930',period})));
});
