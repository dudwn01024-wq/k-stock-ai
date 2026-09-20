const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'frontend/src/App.jsx'), 'utf8');
const helpers = import(pathToFileURL(path.join(root, 'frontend/src/utils/numbers.js')));
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
};
async function chartRows(items) {
  const context = vm.createContext({ ...await helpers, chartData: items, useMemo: fn => fn() });
  vm.runInContext(section('  const chartRows =', '  const changeRate =') + '\nthis.rows = chartRows;', context);
  return context.rows;
}

for (const [label, price, expected] of [['numeric price', 70000, 70000], ['null', null, null],
  ['undefined', undefined, null], ['empty', '', null], ['zero', 0, 0], ['numeric string', '70000', 70000]]) {
  test('actual chart mapping preserves ' + label + ' without requiring close', async () => {
    const rows = await chartRows([{ date: '2026-09-18', price, volume: 123 }]);
    assert.equal(rows[0].price, expected); assert.equal(rows[0].volume, 123);
  });
}
test('chart uses API price even when a conflicting close exists; absent price never falls back', async () => {
  assert.equal((await chartRows([{ price: 70000, close: 99999 }]))[0].price, 70000);
  assert.equal((await chartRows([{ close: 99999 }]))[0].price, null);
  assert.match(source, /<Line[\s\S]*?dataKey="price"/);
});

test('actual backend chart response passes through frontend service into chart mapping', async () => {
  const backend = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const start = backend.lastIndexOf('app.get(', backend.indexOf("'/api/stock/chart'"));
  const end = backend.indexOf('\napp.', start + 1);
  const ctx = vm.createContext({
    app: { get: (route, handler) => { if(route === '/api/stock/chart') ctx.handler = handler; } },
    validateSymbol: () => true, NAVER_HEADERS: {}, console,
    average: values => values.reduce((a,b) => a+b, 0) / values.length,
    fetch: async () => ({ ok: true, json: async () => [{localTradedAt:'2026-09-18', closePrice:'70000', volume:123}] })
  });
  vm.runInContext(backend.slice(backend.indexOf('const parseNumber ='), backend.indexOf('const validateSymbol =')), ctx);
  vm.runInContext(backend.slice(start, end), ctx);
  let payload;
  await ctx.handler({query:{symbol:'005930',timeframe:'1M'}}, { json: value => { payload = value; } });
  assert.equal(payload.chart[0].price, 70000); assert.equal(payload.chart[0].close, undefined);
  const frontend = vm.createContext({ ...await helpers,
    fetch: async () => ({ok:true,json:async()=>payload}) });
  vm.runInContext(section('const API_BASE_URL', 'export default function App') +
    '\nthis.service = new RealStockBackendService();', frontend);
  const result = await frontend.service.getStockChart('005930', '1M');
  assert.equal((await chartRows(result.items))[0].price, 70000);
});

test('timeframe change preserves selected symbol and does not restart initial Samsung effect', async () => {
  const requests = []; let memo, memoDeps, effectDeps, effects = 0;
  const same = (a,b) => a && a.length === b.length && a.every((v,i) => v === b[i]);
  const context = vm.createContext({ chartTimeframe:'1M', activeSymbol:'005930', console,
    backendService: {
      getStockQuote: async symbol => ({stockName:symbol}),
      getStockChart: async (symbol,timeframe) => {requests.push([symbol,timeframe]); return {items:[],supported:true};},
      getStockNews: async()=>[], getStockStrategy: async()=>({}), getAIAnalysis: async()=>({})
    },
    useCallback: (fn,deps) => {if(!same(memoDeps,deps)){memo=fn;memoDeps=deps;} return memo;},
    useEffect: (fn,deps) => {if(!same(effectDeps,deps)){effectDeps=deps;effects++;fn();}}
  });
  for(const name of ['setIsRefreshing','setLoading','setErrorMsg','setQuoteData','setChartData',
    'setChartSupported','setNewsList','setStrategyData','setActiveName','setSearchQuery',
    'setAiLoading','setAiError','setAiAnalysis']) context[name] = ()=>{};
  context.setActiveSymbol = value => {context.activeSymbol=value;};
  context.setChartTimeframe = value => {context.chartTimeframe=value;};
  const render = () => vm.runInContext('(() => {' +
    section('  const loadRealStockData =', '  const loadRecommendations =') +
    section('  const handleTimeframeChange =', '  const chartRows =') +
    '\nthis.load = loadRealStockData; this.change = handleTimeframeChange; })()', context);
  render(); await new Promise(setImmediate);
  await context.load('000660','SK하이닉스','1M');
  await context.change('3M'); render(); await new Promise(setImmediate);
  assert.equal(context.activeSymbol,'000660'); assert.equal(effects,1);
  assert.deepEqual(requests,[['005930','1M'],['000660','1M'],['000660','3M']]);
});
