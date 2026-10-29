'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
const front=createRequire(require.resolve('../frontend/package.json')),React=front('react'),{renderToStaticMarkup}=front('react-dom/server'),{transformSync}=front('esbuild');
const root=path.resolve('frontend/src');
function load(file,react=React){const module={exports:{}};vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,
  {module,exports:module.exports,require:name=>name==='react'?react:name.endsWith('.css')?{}:load(path.resolve(path.dirname(file),name),react),console});return module.exports;}
const utils=load(path.join(root,'utils/kisChartViewport.js'));
const Chart=load(path.join(root,'KisPeriodChart.jsx')).default;
const plain=value=>JSON.parse(JSON.stringify(value));
const rows=(count=80)=>Array.from({length:count},(_,index)=>({date:new Date(Date.UTC(2026,5,1+index)).toISOString().slice(0,10),
  open:100+index,high:103+index,low:99+index,close:102+index,volume:index===count-1?0:1000+index,
  dataMetadata:{requestedPeriod:'D',sourceBusinessDate:new Date(Date.UTC(2026,5,1+index)).toISOString().slice(0,10)},
  periodStatus:index===count-1?'CURRENT_PERIOD_PROVISIONAL':'PAST_PERIOD_FINALITY_UNCONFIRMED'}));
const metadata=(data,period='D')=>({source:'KIS_NATIVE_PERIOD_OHLCV',responseSymbol:'005930',identityBasis:'RESPONSE_SYMBOL',sourceBusinessDate:data.at(-1)?.date??null,
  sourceTimestamp:null,receivedAt:'2026-10-29T01:00:00Z',requestedMarket:'J',requestedPeriod:period,requestedAdjustment:'0',
  marketScope:'UNKNOWN',periodStatus:'CURRENT_PERIOD_PROVISIONAL',calendarIncomplete:true,maxRows:100,onePage:true,fullHistory:false,sourceFinality:'UNCONFIRMED',priceUnit:'KRW',volumeUnit:'SHARES'});
const props=(data=rows(),period='D')=>({rows:data,period,metadata:metadata(data,period),status:'READY'});
const html=input=>renderToStaticMarkup(React.createElement(Chart,input));
function all(element,predicate){if(!element||typeof element!=='object')return [];
  return [...(predicate(element)?[element]:[]),...React.Children.toArray(element.props?.children).flatMap(child=>all(child,predicate))];}
function text(element){return React.Children.toArray(element?.props?.children).map(value=>typeof value==='object'?text(value):String(value)).join('');}
function interactive(input){
  const hooks=[];let cursor=0,current=input,tree;
  const react={...React,useMemo:fn=>fn(),useEffect:()=>{},useId:()=>':TEST_ONLY:',
    useState(initial){const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};
      return [hooks[index].value,next=>{hooks[index].value=typeof next==='function'?next(hooks[index].value):next;}];},
    useRef(initial){const index=cursor++;if(!hooks[index])hooks[index]={current:initial};return hooks[index];}};
  const View=load(path.join(root,'KisPeriodChart.jsx'),react).default;
  const render=()=>{cursor=0;tree=View(current);return tree;};render();
  return {render,tree:()=>tree,props:next=>{current=next;return render();},find:(tag,label)=>all(tree,element=>element.type===tag&&(!label||text(element).includes(label)))[0],
    values:()=>all(tree,element=>typeof element.type==='function'&&element.type.name==='Values')[0]?.props,
    click(label){const item=all(tree,element=>element.type==='button'&&(text(element)===label||element.props['aria-label']===label))[0];assert.ok(item,label);
      assert.equal(item.props.disabled===true,false,label+' disabled');item.props.onClick();return render();}};
}

test('TEST_ONLY native period identity/units/dates/OHLC are verified, with zero volume separate from missing',()=>{
  const data=rows(4),before=JSON.stringify(data);data[1].volume=null;
  const result=utils.prepareKisPeriodRows(data,{period:'D',metadata:metadata(data)});
  assert.equal(result.rows.at(-1).volume,0);assert.equal(result.rows[1].volume,null);assert.equal(result.missingVolumeCount,1);
  assert.equal(data[0].volume,1000);assert.notEqual(JSON.stringify(data),before,'fixture changed exactly one volume before the reader');
  for(const change of [{requestedPeriod:'W'},{source:'NAVER'},{identityBasis:'REQUEST_SYMBOL_ONLY'},{requestedAdjustment:'1'},
    {responseSymbol:'00593A'},{priceUnit:'USD'}]){
    assert.equal(utils.prepareKisPeriodRows(data,{period:'D',metadata:{...metadata(data),...change}}).reason,'NATIVE_SOURCE_UNVERIFIED');
  }
  for(const item of [{...data[0],open:null},{...data[0],high:0},{...data[0],close:Infinity},{...data[0],low:200},
    {...data[0],date:'2026-02-30'},{...data[0],dataMetadata:{sourceBusinessDate:'2026-05-31'}}]){
    assert.equal(utils.prepareKisPeriodRows([item,...data.slice(1)],{period:'D',metadata:metadata(data)}).reason,'NATIVE_ROW_INVALID');
  }
  assert.equal(utils.prepareKisPeriodRows([data[0],...data],{period:'D',metadata:metadata(data)}).reason,'NATIVE_ROW_INVALID');
  assert.equal(utils.prepareKisPeriodRows(data,{period:'D',metadata:{...metadata(data),sourceBusinessDate:'2026-06-30'}}).reason,'SOURCE_DATE_MISMATCH');
});

test('TEST_ONLY MA uses full native period history before cropping and preserves warmup/missing values',()=>{
  const data=rows(80),ma=utils.movingAverageSeries(data,60);
  assert.equal(ma[58],null);assert.equal(ma[59],131.5);assert.equal(ma[79],151.5);
  const view=utils.viewportForBars(data.length,20);assert.equal(ma.slice(view.start,view.end)[0],132.5,'hidden preceding bars provide the visible MA warmup');
  const broken=data.map(value=>({...value}));broken[60].close=null;
  assert.equal(utils.movingAverageSeries(broken,5)[64],null);assert.equal(utils.movingAverageSeries(broken,5)[65],165);
  assert.deepEqual(plain(utils.movingAverageSeries(data,0)),[]);
});

test('TEST_ONLY visible-bar zoom/pan/presets clamp at actual supplied history without generating bars',()=>{
  const latest=utils.viewportForBars(100,20);assert.deepEqual(plain(latest),{start:80,end:100});
  assert.deepEqual(plain(utils.panViewport(latest,100,-999)),{start:0,end:20});
  assert.deepEqual(plain(utils.panViewport(latest,100,999)),{start:80,end:100});
  assert.deepEqual(plain(utils.zoomViewport(latest,100,.5)),{start:90,end:100});
  assert.deepEqual(plain(utils.zoomViewport({start:0,end:20},100,.5,0)),{start:0,end:10});
  assert.deepEqual(plain(utils.zoomViewport(latest,100,99)),{start:0,end:100});
  assert.deepEqual(plain(utils.viewportForBars(3,20)),{start:0,end:3});assert.deepEqual(plain(utils.viewportForBars(0,'ALL')),{start:0,end:0});
  assert.equal(utils.indexAtPointer(-200,{left:10,width:600},latest,100),80);
  assert.equal(utils.indexAtPointer(1000,{left:10,width:600},latest,100),99);
  assert.equal(utils.indexAtPointer(200,{left:0,width:400,viewBoxWidth:800},latest,100),90,'SVG-scaled pointer coordinates use the same margins as the drawing');
  assert.equal(utils.indexAtPointer(NaN,{left:10,width:600},latest,100),null);
});

test('TEST_ONLY actual pointer controller preserves touch scroll until explicit pan mode and handles cancellation/multiple pointers',()=>{
  let mode='INSPECT',range={start:40,end:60},selected=null,prevented=0,captured=0,released=0;
  const target={setPointerCapture:()=>captured++,releasePointerCapture:()=>released++};
  const event=(extra={})=>({pointerId:1,clientX:250,button:0,isPrimary:true,pointerType:'touch',currentTarget:target,preventDefault:()=>prevented++,...extra});
  const controller=utils.createKisChartPointerController({getViewport:()=>range,getTotal:()=>100,getMode:()=>mode,
    getRect:()=>({left:0,width:600}),onViewport:value=>{range=value;},onSelect:value=>{selected=value;}});
  controller.pointerDown(event());assert.equal(prevented,0);assert.equal(captured,0);assert.ok(Number.isInteger(selected));
  const before=selected;controller.pointerMove(event({clientX:400}));assert.equal(selected,before,'touch scrolling does not turn into a hover drag');
  mode='PAN';controller.pointerDown(event());assert.equal(captured,1);assert.equal(controller.dragging(),true);
  controller.pointerMove(event({pointerId:2,clientX:500}));assert.equal(range.start,40);
  controller.pointerMove(event({clientX:483}));assert.deepEqual(plain(range),{start:30,end:50});
  controller.pointerCancel(event());assert.equal(controller.dragging(),false);assert.equal(released,1);
  const cancelled=plain(range);controller.pointerMove(event({clientX:50}));assert.deepEqual(plain(range),cancelled);
  controller.pointerDown(event({isPrimary:false}));assert.equal(controller.dragging(),false);
  controller.pointerDown(event({button:2}));assert.equal(controller.dragging(),false);
  const stopped=prevented;controller.pointerDown(event({currentTarget:{setPointerCapture:()=>{throw Error('TEST_ONLY_CANCELLED_POINTER');}}}));
  assert.equal(controller.dragging(),false);assert.equal(prevented,stopped,'cancelled capture cannot leave scrolling blocked by a phantom drag');
});

test('TEST_ONLY actual SVG/React output labels native units and scope without implying analysis-period changes or full history',()=>{
  for(const [period,label]of [['D','일봉'],['W','주봉'],['M','월봉'],['Y','년봉']]){
    const data=rows(80).map(row=>({...row,dataMetadata:{...row.dataMetadata,requestedPeriod:period}}));const rendered=html(props(data,period));
    for(const value of ['표시 주기 '+label,'분석 기준 일봉','KIS 원천 '+label,'수정주가','조회 시각 2026-10-29T01:00:00Z','원천 시각 미확인',
      '시장 범위 미확인','전체 과거 자료가 아닙니다','MA는 표시 중인 주기의 종가','1회 응답 범위','0주','진행 중 잠정 봉'])assert.ok(rendered.includes(value),period+' '+value);
    assert.match(rendered,/<svg/);assert.match(rendered,/role="group" tabindex="0"/);assert.match(rendered,/차트 확대/);
    assert.doesNotMatch(rendered,/1분봉|실시간 확정|모든 과거/);
  }
});

test('TEST_ONLY real component controls zoom/pan/presets/reset and MA switches using full-period arrays',()=>{
  const propsValue=props(),view=interactive(propsValue);
  assert.match(text(view.find('p','봉 · 받은 자료')),/60\/80봉/);
  view.click('최근 20봉');assert.match(text(view.find('p','봉 · 받은 자료')),/20\/80봉/);assert.equal(view.values().index,79);
  assert.equal(view.values().averages[60][79],151.5);
  view.click('차트 확대');assert.match(text(view.find('p','봉 · 받은 자료')),/14\/80봉/);
  view.click('← 과거로');assert.equal(view.values().index,75);
  view.click('받은 봉 전체');assert.match(text(view.find('p','봉 · 받은 자료')),/80\/80봉/);
  view.click('보기 초기화');assert.match(text(view.find('p','봉 · 받은 자료')),/60\/80봉/);
  const checkbox=all(view.tree(),element=>element.type==='input')[2];assert.equal(checkbox.props.checked,false);
  checkbox.props.onChange({target:{checked:true}});view.render();assert.equal(view.values().enabled[60],true);
  const beforeSource=JSON.stringify(propsValue.rows);view.click('차트 끌어 이동');assert.equal(view.find('button','차트 끌어 이동').props['aria-pressed'],true);
  assert.equal(JSON.stringify(propsValue.rows),beforeSource);
});

test('TEST_ONLY keyboard selection and new-symbol/period/row changes cannot retain old crosshair or viewport',()=>{
  const input=props(),view=interactive(input),svg=view.find('svg');let prevented=0;
  svg.props.onKeyDown({key:'Home',preventDefault:()=>prevented++});view.render();assert.equal(view.values().index,0);
  view.find('svg').props.onKeyDown({key:'ArrowRight',preventDefault:()=>prevented++});view.render();assert.equal(view.values().index,1);
  view.find('svg').props.onKeyDown({key:'End',preventDefault:()=>prevented++});view.render();assert.equal(view.values().index,79);assert.equal(prevented,3);
  view.click('최근 20봉');view.props({...input,metadata:{...input.metadata,responseSymbol:'000660'}});
  assert.match(text(view.find('p','봉 · 받은 자료')),/60\/80봉/);assert.equal(view.values().index,79);
  const annualRows=rows(10).map(row=>({...row,dataMetadata:{...row.dataMetadata,requestedPeriod:'Y'}}));view.props(props(annualRows,'Y'));
  assert.match(text(view.find('p','봉 · 받은 자료')),/10\/10봉/);assert.equal(view.values().index,9);
});

test('TEST_ONLY loading/error/empty/invalid views hide stale financial SVG and only manual retry/cancel handlers run',()=>{
  let retries=0,cancelled=0;const base={...props(),onRetry:()=>retries++,onCancel:()=>cancelled++,error:'TEST_ONLY_PRIVATE_TOKEN'};
  const loading=interactive({...base,status:'LOADING'});assert.equal(loading.find('svg'),undefined);loading.click('조회 취소');assert.equal(cancelled,1);assert.equal(retries,0);
  const errorView=interactive({...base,status:'ERROR'});assert.equal(errorView.find('svg'),undefined);assert.equal(retries,0);errorView.click('선택한 주기 다시 조회');assert.equal(retries,1);
  for(const status of ['ERROR','LOADING','EMPTY','IDLE']){
    const rendered=html({...base,status});assert.doesNotMatch(rendered,/<svg|TEST_ONLY_PRIVATE_TOKEN|거래량 0주/);
  }
  const invalid=html({...base,metadata:{...base.metadata,requestedPeriod:'W'}});assert.match(invalid,/원천·종목·주기·단위를 확인하지 못했습니다/);assert.doesNotMatch(invalid,/<svg/);
});

test('TEST_ONLY missing volume is not a zero bar and incomplete/native source warnings remain visible',()=>{
  const data=rows(10);data[3].volume=null;const rendered=html(props(data));
  assert.match(rendered,/거래량 미확인 1봉/);assert.match(rendered,/실제 0주는 0주로 유지/);
  assert.match(rendered,/기간 종료 전 달라질 수 있습니다/);
  const old=props(data);old.metadata.periodStatus='PAST_PERIOD_FINALITY_UNCONFIRMED';assert.match(html(old),/최종 확정 여부를 확인한 자료는 아닙니다/);
  const css=fs.readFileSync('frontend/src/kis-period-chart.css','utf8');assert.match(css,/touch-action:pan-y/);assert.match(css,/kp-panning svg\{touch-action:none/);
  const src=fs.readFileSync('frontend/src/KisPeriodChart.jsx','utf8');assert.doesNotMatch(src,/\bfetch\s*\(|\bonWheel\s*=/);
});

test('TEST_ONLY short supplied history has one selected range and never offers unavailable 40/60 bars as active',()=>{
  const view=interactive(props(rows(20))),ranges=()=>all(view.tree(),el=>el.type==='button'&&['최근 20봉','최근 40봉','최근 60봉','받은 봉 전체'].includes(text(el)));
  assert.deepEqual(ranges().filter(el=>el.props['aria-pressed']).map(text),['받은 봉 전체']);
  for(const label of ['최근 40봉','최근 60봉'])assert.equal(view.find('button',label).props.disabled,true);
  view.click('받은 봉 전체');assert.equal(ranges().filter(el=>el.props['aria-pressed']).length,1);
  view.props(props(rows(80)));view.click('최근 20봉');assert.deepEqual(ranges().filter(el=>el.props['aria-pressed']).map(text),['최근 20봉']);
});
