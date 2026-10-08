'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
// Preserve historic dependency checks, allowing only the explicitly approved router addition.
module.exports=base=>{
  const current=JSON.parse(fs.readFileSync('frontend/package.json','utf8'));
  assert.equal(current.dependencies['react-router-dom'],'7.18.4');
  delete current.dependencies['react-router-dom'];
  assert.deepEqual(current,JSON.parse(execFileSync('git',['show',base+':frontend/package.json'],{encoding:'utf8'})));
  const lock=JSON.parse(fs.readFileSync('frontend/package-lock.json','utf8'));
  assert.equal(lock.packages[''].dependencies['react-router-dom'],'7.18.4');
  for(const name of ['react-router-dom','react-router'])assert.equal(lock.packages['node_modules/'+name].version,'7.18.4');
};
