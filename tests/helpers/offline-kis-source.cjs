'use strict';
require('./local-only.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
// Execute these reviewed modules with explicit test-only dependencies. The normal
// provider import guard stays enabled. No ambient process, credentials or fetch
// are available; only the existing tests' injected fake senders can run.
const names=new Set(['kisAuth','kisAccountTransport','kisAccountProbe','kisUnfilledProbe','kisUnfilledReadOnly',
  'kisLiveAccountSnapshot','kisOrderCoverage','kisAccountReadOnly','kisAccountSnapshotMapper',
  'kisAccountDisplaySnapshot','dataFreshness']);
const cache=new Map(),attempts=[];
const forbidden=kind=>()=>{attempts.push(kind);throw Error('OFFLINE_KIS_AMBIENT_ACCESS_FORBIDDEN');};
const noFetch=forbidden('fetch'),noProcess=new Proxy({},{get:forbidden('process')});
const noConsole=new Proxy({},{get:forbidden('console')});
function load(name){
  assert.ok(names.has(name),'explicit offline KIS dependency: '+name);
  if(cache.has(name))return cache.get(name).exports;
  const file=path.join(__dirname,'../../services',name+'.js'),module={exports:{}};
  const source=fs.readFileSync(file,'utf8');cache.set(name,module);
  const requireOffline=id=>{assert.match(id,/^\.\/[A-Za-z]+$/,'no native, environment, storage, or transport imports');return load(id.slice(2));};
  // A same-realm CommonJS wrapper preserves WeakSet provenance and strict object
  // comparisons while shadowing every ambient production entry point.
  const execute=new Function('module','exports','require','process','fetch','globalThis','global','console',source);
  execute(module,module.exports,requireOffline,noProcess,noFetch,Object.freeze({fetch:noFetch}),Object.freeze({fetch:noFetch}),noConsole);
  return module.exports;
}
load.assertNoAmbientAccess=()=>assert.deepEqual(attempts,[],'offline KIS tests used only explicitly injected fake senders');
module.exports=load;
