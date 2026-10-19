'use strict';
// Exact inverse for historical source boundaries. Runtime tests use current source.
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const baseline='7a24520b7b6a9ff3018e2d7d1e65ea9ce329fbb511aeaa30e6ecf1736d1bae85';
const current='07a2d5275d9a7e34f76f9052438bb9faace36b3a93aff1274f3a1adc5428b938';
const marker='  // A missing upper level blocks the price plan, not independent measured conditions.';
const hash=value=>createHash('sha256').update(value).digest('hex');
module.exports=(source,file)=>{
  if(file!=='services/tradingStrategy.js')return source;
  const value=source.replaceAll('\r\n','\n'),digest=hash(value);
  if(digest===baseline||!value.includes(marker))return value;
  assert.equal(digest,current,'exact missing-resistance evidence patch');
  const start=value.indexOf(marker),end=value.indexOf('  if (\n    !Number.isFinite(\n      support',start);
  assert.ok(start>=0&&end>start,'exact missing-resistance patch markers');
  const previous=value.slice(0,start)+value.slice(end);
  assert.equal(hash(previous),baseline,'all other strategy bytes unchanged');
  return previous;
};
