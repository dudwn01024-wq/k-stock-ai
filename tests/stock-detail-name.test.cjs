'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),front=createRequire(require.resolve('../frontend/package.json')),React=front('react');
const {transformSync}=createRequire(require.resolve('../frontend/node_modules/vite/package.json'))('esbuild');
function helpers(){const file=require.resolve('./shared-detail-news-ui.test.cjs'),actual=createRequire(file),req=name=>name==='node:test'?{test(){}}:actual(name);req.resolve=actual.resolve;
 const context={require:req,module:{exports:{}},console,URL,setImmediate};vm.runInNewContext(fs.readFileSync(file,'utf8'),context);return context.module.exports;}
const {harness,visit,tick,bindings}=helpers();
const quote=symbol=>({symbol,source:'KIS_CURRENT_QUOTE',stockName:null,currentPrice:100,volume:0,tradingValue:null});
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};
const text=node=>node==null?'':typeof node!=='object'?String(node):React.Children.toArray(node.props?.children).map(text).join('');
const identity=h=>visit(h.render(),node=>node.props?.['data-testid']==='stock-detail-identity');
const source=h=>text(visit(h.render(),node=>node.props?.['data-testid']==='stock-name-source'));
const load=async options=>{const h=harness({quoteResponse:async symbol=>quote(symbol),...options});h.render();h.runEffects();await tick();return h;};
function moduleFor(){const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync('frontend/src/utils/stockIdentity.js','utf8'),{loader:'js',format:'cjs'}).code,{module,exports:module.exports});return module.exports;}

test('TEST_ONLY name catalogue exactly reuses all existing watchlist pairs without changing the seven popular buttons',()=>{
 const code=fs.readFileSync('server.js','utf8'),literal=code.match(/const RECOMMENDATION_WATCHLIST\s*=\s*(\[[\s\S]*?\]);/)[1];
 const stocks=vm.runInNewContext(literal),catalog=moduleFor().KNOWN_STOCK_NAMES;
 assert.equal(stocks.length,50);assert.deepEqual(JSON.parse(JSON.stringify(catalog)),Object.fromEntries(stocks.map(x=>[x.symbol,x.name])));
 assert.equal((fs.readFileSync('frontend/src/stockCatalog.js','utf8').match(/code:/g)||[]).length,7);
});
for(const [symbol,name]of [['005930','삼성전자'],['000660','SK하이닉스'],['012450','한화에어로스페이스']])test('TEST_ONLY direct detail shows exact name beside zero-prefixed code with KIS null name: '+symbol,async()=>{
 const h=await load({symbol});assert.equal(text(identity(h)),name+symbol);assert.equal(h.state('activeName'),name);
 assert.equal(source(h),'종목명 정보: 기존 종목 목록');assert.equal(h.calls.length,3);assert.equal(h.state('quoteData').stockName,null);
 assert.equal(h.state('quoteData').source,'KIS_CURRENT_QUOTE');assert.equal(h.state('quoteData').volume,0);assert.equal(h.state('quoteData').tradingValue,null);
 assert.equal(visit(h.render(),n=>n.type?.name==='PageMeta').props.stockName,name);h.unmount();
});
test('TEST_ONLY recommendation exact code/name survives route remount and a fresh App after reload without extra reads',async()=>{
 const shared=storage(),h=await load({storage:shared});await h.select('171090','TEST_ONLY 선행테크');
 assert.equal(text(identity(h)),'TEST_ONLY 선행테크171090');assert.equal(source(h),'종목명 정보: 추천 목록');
 const fresh=await load({symbol:'171090',storage:shared});assert.equal(text(identity(fresh)),'TEST_ONLY 선행테크171090');
 assert.equal(fresh.calls.length,3);assert.ok(fresh.calls.every(x=>!x.pathname.endsWith('/search')));h.unmount();fresh.unmount();
});
test('TEST_ONLY company-name search stores server-matched symbol/name then displays it after navigation and reload',async()=>{
 const shared=storage(),h=await load({storage:shared,searchResponse:async()=>({symbol:'171090',stockName:'TEST_ONLY 검색테크',source:'Naver stock search data'})});
 h.states[bindings.indexOf('searchQuery')]='TEST_ONLY 검색테크';
 await visit(h.render(),n=>n.type==='form'&&n.props.onSubmit?.name==='handleSearch').props.onSubmit({preventDefault(){}});await tick();
 assert.equal(text(identity(h)),'TEST_ONLY 검색테크171090');assert.equal(source(h),'종목명 정보: 종목 검색 결과');
 const fresh=await load({symbol:'171090',storage:shared});assert.equal(fresh.state('activeName'),'TEST_ONLY 검색테크');
 assert.equal(h.calls.length,5);assert.equal(h.calls.filter(x=>x.pathname.endsWith('/search')).length,1);assert.equal(fresh.calls.length,3);
 h.unmount();fresh.unmount();
});
test('TEST_ONLY unknown fresh direct code has explicit missing-name label and the code appears once',async()=>{
 const h=await load({symbol:'171091'});assert.equal(text(identity(h)),'종목명 미확인171091');assert.match(source(h),/확인된 종목명이 없습니다/);
 assert.equal(visit(h.render(),n=>n.type?.name==='PageMeta').props.stockName,null);assert.equal(h.calls.length,3);h.unmount();
});
test('TEST_ONLY selecting an unknown code after a known one cannot retain the old name',async()=>{
 const h=await load({symbol:'005930'});h.navigate('171092');await tick();assert.equal(text(identity(h)),'종목명 미확인171092');
 assert.doesNotMatch(text(identity(h)),/삼성전자/);assert.equal(h.calls.length,6);h.unmount();
});
test('TEST_ONLY slow old quote cannot replace the next stock name or metadata',async()=>{
 let finish;const pending=new Promise(r=>finish=r);
 const h=harness({symbol:'005930',quoteResponse:async symbol=>{if(symbol==='005930')await pending;return quote(symbol);}});
 h.render();h.runEffects();h.navigate('000660');await tick();assert.equal(text(identity(h)),'SK하이닉스000660');
 finish();await tick();assert.equal(text(identity(h)),'SK하이닉스000660');assert.equal(h.state('activeIdentity').symbol,'000660');h.unmount();
});
test('TEST_ONLY late company-search result neither navigates nor stores obsolete metadata',async()=>{
 let finish;const pending=new Promise(r=>finish=r),shared=storage();
 const h=await load({storage:shared,searchResponse:async()=>{await pending;return {symbol:'171093',stockName:'TEST_ONLY 늦은이름'};}});
 h.states[bindings.indexOf('searchQuery')]='TEST_ONLY 늦은이름';const request=visit(h.render(),n=>n.type==='form'&&n.props.onSubmit?.name==='handleSearch').props.onSubmit({preventDefault(){}});
 h.navigate('000660');await tick();finish();await request;await tick();assert.equal(text(identity(h)),'SK하이닉스000660');
 const fresh=await load({symbol:'171093',storage:shared});assert.equal(fresh.state('activeIdentity').name,null);h.unmount();fresh.unmount();
});
test('TEST_ONLY refresh keeps current identity while re-reading only existing quote/detail/chart endpoints',async()=>{
 const h=await load({symbol:'005930'});await visit(h.render(),n=>n.type==='button'&&React.Children.toArray(n.props.children).some(c=>c?.props?.children==='새로고침')).props.onClick();await tick();
 assert.equal(text(identity(h)),'삼성전자005930');assert.equal(h.calls.length,6);assert.equal(h.calls.filter(x=>x.pathname.endsWith('/ai-analysis')||x.pathname.endsWith('/search')).length,0);h.unmount();
});
test('TEST_ONLY registry rejects code-as-name, malformed symbol and unusable names without guessing',()=>{
 const m=moduleFor();for(const record of [{symbol:'171094',name:'171094',source:'SEARCH'},{symbol:171094,name:'TEST_ONLY',source:'SEARCH'},
 {symbol:'171094',name:'<script>',source:'SEARCH'},{symbol:'171094',name:'TEST_ONLY',source:'UNTRUSTED'},
 {symbol:'171094',name:'',source:'SEARCH'},{symbol:'171094',name:'종목명 미확인',source:'SEARCH'}])assert.equal(m.rememberStockIdentity(record),null);
 assert.equal(m.resolveStockIdentity('171094').name,null);assert.equal(m.resolveStockIdentity('171094',{quote:{symbol:'171095',stockName:'WRONG'}}).name,null);
 assert.equal(m.resolveStockIdentity('171094',{quote:{symbol:'171094',source:'KIS_CURRENT_QUOTE',stockName:'UNDOCUMENTED'}}).name,null);
});
test('TEST_ONLY corrupted or blocked session storage never blocks analysis or borrows another code name',()=>{
 const m=moduleFor();for(const shared of [{getItem(){throw Error('TEST_ONLY_DENIED');},setItem(){throw Error('TEST_ONLY_DENIED');}},
 {getItem:()=>'{invalid',setItem(){}},{getItem:()=>JSON.stringify([{symbol:'171096',name:'TEST_ONLY 別名',source:'SEARCH'}])}]){
 assert.equal(m.resolveStockIdentity('171097',{storage:shared}).name,null);
 assert.equal(m.resolveStockIdentity('000660',{storage:shared}).name,'SK하이닉스');
 assert.equal(m.rememberStockIdentity({symbol:'171098',name:'TEST_ONLY 기억이름',source:'SEARCH'},{storage:shared}).name,'TEST_ONLY 기억이름');
 }
});
test('TEST_ONLY code/name heading wraps long Korean names while preserving separate source and code',async()=>{
 const h=await load();await h.select('171099','TEST_ONLY 매우긴한글종목이름을모바일에서도잘보여줍니다');
 const row=identity(h),heading=visit(row,n=>n.type==='h2');assert.match(row.props.className,/flex-wrap/);assert.equal(heading.props.style.overflowWrap,'anywhere');
 assert.ok(text(row).includes('171099'));assert.equal(source(h),'종목명 정보: 추천 목록');h.unmount();
});
test('TEST_ONLY exact historical inverse accepts only the reviewed name patch and rejects an additional App edit',()=>{
 const inverse=require('./helpers/without-stock-name.cjs'),source=fs.readFileSync('frontend/src/App.jsx','utf8');
 const previous=require('node:child_process').execFileSync('git',['show','4b0bdb0a74ca2a51033c9c8d364155e7773f4634:frontend/src/App.jsx'],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');
 inverse.assertAll();assert.equal(inverse(source,'frontend/src/App.jsx'),previous);
 assert.throws(()=>inverse(source+'\n// TEST_ONLY unauthorized edit','frontend/src/App.jsx'),/exact stock-name display boundary/);
});
