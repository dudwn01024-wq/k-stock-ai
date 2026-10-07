'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const front=createRequire(require.resolve('../frontend/package.json')),React=front('react'),{renderToStaticMarkup}=front('react-dom/server');
const {transformSync}=createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
function load(file,react=React){const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,
  {module,exports:module.exports,Date,Number,Map,Intl,require:name=>{
    if(name==='react')return react;if(name.endsWith('.css'))return {};
    if(name==='recharts')return new Proxy({},{get:(_target,key)=>props=>React.createElement('div',{'data-chart':key},props.children)});
    return load(path.resolve(path.dirname(file),name),react);
  }});return module.exports;}
const utils=load(require.resolve('../frontend/src/utils/candles.js'));
const component=require.resolve('../frontend/src/CandlestickChart.jsx');
const candle=(patch={})=>({testOnly:true,date:'2026-10-03',open:100,high:120,low:90,close:110,price:110,volume:0,...patch});
test('TEST_ONLY candle preparation sorts by actual business date, preserves zero volume and never mutates source',()=>{
  const input=[candle(),candle({date:'2026-10-02',volume:null})],before=JSON.stringify(input);
  const result=utils.prepareCandles(input);assert.equal(result.invalidCount,0);assert.equal(result.candles[0].date,'2026-10-02');
  assert.equal(result.candles[0].volume,null);assert.equal(result.candles[1].volume,0);assert.equal(JSON.stringify(input),before);
  assert.deepEqual(JSON.parse(JSON.stringify(result.candles[1].candleRange)),[90,120]);
});
test('TEST_ONLY malformed OHLC, dates and ambiguous duplicate days are excluded, never coerced to zero',()=>{
  for(const patch of [{open:null},{high:0},{low:-1},{close:NaN},{close:Infinity},{high:105},{low:101},{date:'2026-02-30'}])
    assert.equal(utils.prepareCandles([candle(patch)]).candles.length,0);
  assert.equal(utils.prepareCandles([candle(),candle()]).candles.length,0);
  const legacy=candle();delete legacy.close;assert.equal(utils.prepareCandles([legacy]).candles[0].close,110);
  assert.equal(utils.prepareCandles([candle({close:null})]).candles.length,0);
});
for(const [close,state] of [[110,'상승'],[95,'하락'],[100,'보합']])
test('TEST_ONLY real wick/body geometry and textual OHLCV for '+state,()=>{
  const row=candle({close}),geometry=utils.candleGeometry({x:10,y:20,width:10,height:60,payload:row});
  assert.equal(geometry.wickTop,20);assert.equal(geometry.wickBottom,80);
  assert.equal(geometry.bodyY,Math.min(20+(120-100)*2,20+(120-close)*2));
  assert.equal(geometry.bodyHeight,Math.max(2,Math.abs(100-close)*2));
  const {CandleShape}=load(component),html=renderToStaticMarkup(React.createElement('svg',null,React.createElement(CandleShape,{x:10,y:20,width:10,height:60,payload:row})));
  assert.match(html,/candle-wick/);assert.match(html,/candle-body/);assert.match(html,new RegExp(state));
  for(const label of ['시가','고가','저가','종가','거래량'])assert.match(html,new RegExp(label));
});
test('TEST_ONLY all-flat doji and tiny bodies remain visible; low/high domain has visual padding only',()=>{
  const row=candle({open:100,close:100,high:100,low:100});
  const g=utils.candleGeometry({x:0,y:10,width:8,height:0,payload:row});assert.equal(g.bodyHeight,2);
  const domain=utils.candleDomain([candle()]);assert.ok(domain[0]>0&&domain[0]<90&&domain[1]>120);
  assert.equal(candle().low,90);assert.equal(utils.candleGeometry({x:null,y:0,width:8,height:0,payload:row}),null);
});
test('TEST_ONLY tooltip shows date and five actual values, missing volume differs from zero',()=>{
  const {CandleTooltip}=load(component);
  for(const volume of [null,0]){
    const html=renderToStaticMarkup(React.createElement(CandleTooltip,{active:true,payload:[{payload:candle({volume})}]}));
    assert.match(html,/2026-10-03/);for(const label of ['시가','고가','저가','종가','거래량'])assert.match(html,new RegExp(label));
    assert.match(html,volume===null?/<dd>미확인<\/dd>/:/<dd>0<\/dd>/);
  }
});
test('TEST_ONLY candle selection uses no network/storage and price/volume panels have distinct scales',()=>{
  let selected;const {CandleShape,default:Chart}=load(component),row=candle();
  CandleShape({x:0,y:0,width:8,height:60,payload:row,onSelect:value=>selected=value}).props.onClick();assert.equal(selected,row);
  const html=renderToStaticMarkup(React.createElement(Chart,{rows:[row]}));
  assert.match(html,/candle-price-panel/);assert.match(html,/candle-volume-panel/);
  const source=fs.readFileSync(component,'utf8');assert.equal((source.match(/<BarChart /g)||[]).length,2);
  assert.doesNotMatch(source,/\bfetch\(|localStorage|<Line\b/);assert.match(source,/candleDomain\(candles\)/);
});
test('TEST_ONLY App defaults daily, exposes supported ranges, labels KIS patterns and leaves pattern engine unchanged',()=>{
  const source=fs.readFileSync(require.resolve('../frontend/src/App.jsx'),'utf8');
  assert.match(source,/chartTimeframe, setChartTimeframe\] = useState\('1D'\)/);
  assert.match(source,/getStockChart\(symbol, timeframe = '1D'\)/);
  assert.match(source,/symbol, name, timeframe = '1D'/);assert.doesNotMatch(source,/<Line\b|code: '5Y'|label: '1일'/);
  const codes=[...source.slice(source.indexOf('const TIMEFRAMES'),source.indexOf('const formatKRW')).matchAll(/code: '([^']+)'/g)].map(x=>x[1]);
  assert.deepEqual(codes,['1D','1W','1M','3M','6M','1Y']);
  assert.match(source,/6\. 패턴 분석[\s\S]{0,120}KIS 일봉 기준/);
  for(const field of ['candlePatterns.patterns','chartPatterns.patterns','elliottWave'])assert.match(source,new RegExp(field.replace('.', '\\.')));
  const {execFileSync}=require('node:child_process');
  const engine=fs.readFileSync(require.resolve('../services/chartAnalysis.js'),'utf8').replace(/\r\n/g,'\n');
  assert.ok(engine===execFileSync('git',['show','origin/main:services/chartAnalysis.js'],{encoding:'utf8'}).replace(/\r\n/g,'\n'),'pattern engine unchanged');
});
