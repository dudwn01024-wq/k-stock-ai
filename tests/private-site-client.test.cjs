'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const modulePromise=import(pathToFileURL(require.resolve('../frontend/src/privateSiteClient.js')));
function fixture({authorized=true,expired=false}={}){
 const calls=[],events={},docEvents={},buttons=[],elements=[];let mounted=0,cleared=0;const redirects=[];
 const node=()=>({style:{},setAttribute(){},append(){},addEventListener(name,handler){this[name]=handler;}});
 const doc={documentElement:{style:{}},visibilityState:'visible',body:{prepend:x=>elements.push(x)},createElement:tag=>{const n=node();if(tag==='button')buttons.push(n);return n;},addEventListener:(n,h)=>docEvents[n]=h};
 const win={location:{origin:'https://private.example.test',replace:x=>redirects.push(x)},sessionStorage:{clear:()=>cleared++},localStorage:{clear:()=>cleared++},
  setTimeout:(fn,ms)=>{events.expire=fn;return 1;},clearTimeout(){},addEventListener:(n,h)=>events[n]=h,
  fetch:async(url,options)=>{calls.push({url,options});return {ok:authorized,status:authorized?200:401,json:async()=>({csrfToken:'A'.repeat(43),expiresAt:new Date(Date.now()+(expired?-1000:3600000)).toISOString()})};}};
 return {win,doc,calls,events,docEvents,buttons,redirects,mount:()=>mounted++,mounted:()=>mounted,cleared:()=>cleared};
}
test('TEST_ONLY authenticated bootstrap performs session check only and preserves cookie/CSRF for old holder transport',async()=>{
 const {startPrivateSiteClient}=await modulePromise,f=fixture();await startPrivateSiteClient(f.mount,{window:f.win,document:f.doc});
 assert.equal(f.mounted(),1);assert.deepEqual(f.calls.map(x=>x.url),['/api/site-access/session']);
 await f.win.fetch('/api/stock/holding-guidance/evaluate',{method:'POST',credentials:'omit',headers:{Authorization:'Bearer TEST_ONLY'},body:'TEST_ONLY'});
 const call=f.calls.at(-1);assert.equal(call.options.credentials,'same-origin');assert.equal(call.options.cache,'no-store');
 assert.equal(call.options.headers.get('x-site-csrf'),'A'.repeat(43));assert.equal(call.options.headers.get('authorization'),'Bearer TEST_ONLY');
 await assert.rejects(f.win.fetch(new URL('https://other.example.test/api/data')),/CROSS_ORIGIN/);
 assert.equal(f.calls.length,2);
});
test('TEST_ONLY unavailable/expired session never mounts analysis; logout, back/visibility and timer clear private state',async()=>{
 const {startPrivateSiteClient}=await modulePromise;
 for(const patch of [{authorized:false},{expired:true}]){const f=fixture(patch);await startPrivateSiteClient(f.mount,{window:f.win,document:f.doc});assert.equal(f.mounted(),0);assert.equal(f.cleared(),2);assert.deepEqual(f.redirects,['/login']);}
 const f=fixture();await startPrivateSiteClient(f.mount,{window:f.win,document:f.doc});f.events.pagehide();assert.equal(f.doc.documentElement.style.visibility,'hidden');
 f.events.pageshow({persisted:true});await new Promise(setImmediate);assert.equal(f.doc.documentElement.style.visibility,'');
 await f.buttons[0].click();assert.equal(f.calls.at(-1).url,'/api/site-access/logout');assert.equal(f.cleared(),2);assert.deepEqual(f.redirects,['/login']);
 const timer=fixture();await startPrivateSiteClient(timer.mount,{window:timer.win,document:timer.doc});timer.events.expire();assert.deepEqual(timer.redirects,['/login']);
});
