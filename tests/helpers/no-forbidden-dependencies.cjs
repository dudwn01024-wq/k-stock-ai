'use strict';
// Attribute require() calls to the tested async operation. Process-wide require.cache and
// module.children can contain lazy imports made by unrelated tests through shared modules.
const Module=require('node:module');
const {AsyncLocalStorage}=require('node:async_hooks');
const context=new AsyncLocalStorage();
const load=Module._load;
Module._load=function(request,parent,...rest){
  const active=context.getStore();
  if(active){
    let resolved;
    try{resolved=Module._resolveFilename(request,parent,...rest);}catch{resolved=request;}
    if(active.pattern.test(resolved))active.imports.add(resolved);
  }
  return load.call(this,request,parent,...rest);
};
async function forbiddenImportsDuring(pattern,operation){
  const active={pattern,imports:new Set()};
  const result=await context.run(active,operation);
  return {result,forbidden:[...active.imports].sort()};
}
module.exports={forbiddenImportsDuring};
