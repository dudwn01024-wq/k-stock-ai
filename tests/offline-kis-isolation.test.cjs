'use strict';
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const offline=require('./helpers/offline-kis-source.cjs');
test('TEST_ONLY ordinary provider imports and external fetch remain forbidden after offline source loading',()=>{
  offline('kisAccountProbe');offline('kisUnfilledProbe');
  for(const name of ['kisAuth','kisAccountProbe','kisUnfilledProbe','kisMarketData'])
    assert.throws(()=>require('../services/'+name),/REAL_PROVIDER_FORBIDDEN/);
  assert.throws(()=>fetch('https://example.invalid/TEST_ONLY'),/EXTERNAL_NETWORK_FORBIDDEN/);
  offline.assertNoAmbientAccess();
});
test('TEST_ONLY offline source dependency list excludes native I/O, market data, orders and Risk modules',()=>{
  for(const name of ['fs','https','dotenv','kisMarketData','riskManager','paperTrading','../server'])
    assert.throws(()=>offline(name),/explicit offline KIS dependency/);
  offline.assertNoAmbientAccess();
});
test('TEST_ONLY historical quote inverse accepts only pinned source and rejects an unreviewed mutation',()=>{
  const fs=require('node:fs'),boundary=require('./helpers/without-quote-snapshot.cjs');
  boundary.assertAll();
  const file='frontend/src/ExpandedCandidateCard.jsx',source=fs.readFileSync(file,'utf8');
  const restored=boundary(source,file);assert.notEqual(restored,source.replaceAll('\r\n','\n'));
  boundary.assertSource(file,source);
  assert.throws(()=>boundary.assertSource(file,source+'\n// TEST_ONLY_UNREVIEWED\n'),/exact committed quote snapshot boundary/);
  // Unrecognized source must not be silently restored to an approved old file.
  assert.equal(boundary(source+'\n// TEST_ONLY_UNREVIEWED\n',file),source.replaceAll('\r\n','\n')+'\n// TEST_ONLY_UNREVIEWED\n');
});
