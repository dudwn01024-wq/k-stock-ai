'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const front=createRequire(require.resolve('../../frontend/package.json')),React=front('react'),{renderToStaticMarkup}=front('react-dom/server');
const {transformSync}=createRequire(require.resolve('../../frontend/node_modules/vite/package.json'))('esbuild');
const file=require.resolve('../../frontend/src/PublicInformation.jsx');
function load(file,source=fs.readFileSync(file,'utf8')){
 const module={exports:{}};
 vm.runInNewContext(transformSync(source,{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code,{
  module,exports:module.exports,require:name=>{
   if(name==='react')return React;if(name.endsWith('.css'))return {};
   assert.ok(name.startsWith('.'));return load(path.resolve(path.dirname(file),name));
  },fetch:()=>assert.fail('TEST_ONLY_NO_NETWORK')});
 return module.exports;
}
module.exports=base=>{
 const original=load(file,execFileSync('git',['show',base+':frontend/src/PublicInformation.jsx'],{encoding:'utf8'}));
 const current=load(file),render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
 require('./public-contact-boundary.cjs')();
 const html=render(current.default).replace(/<nav class="public-page-navigation"[^>]*>[\s\S]*?<\/nav>/g,'');
 const normalized=html.replace('<h3 id="contact">','<h3>').replace('서비스 운영자 표시명은 ‘K-Stock AI 운영자’입니다. 개인정보 관련 문의 이메일은 준비 후 안내할 예정입니다.','운영자 표시명과 개인정보 전용 문의창구는 확인 후 안내할 예정입니다.');
 assert.equal(normalized,render(original.default),'existing policy text/panels unchanged except confirmed operator/pending contact and navigation');
 for(const context of ['public','strategy','ai'])assert.equal(render(current.InvestmentNotice,{context}),render(original.InvestmentNotice,{context}));
};
