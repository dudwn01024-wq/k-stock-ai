"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
// The only approved policy changes: display name, pending email, and contact link.
const base='cf5a191c3dd93c48f5b7b8934eae8facc51bcf92';
const previous='운영자 표시명과 개인정보 전용 문의창구는 확인 후 안내할 예정입니다.';
const confirmed='서비스 운영자 표시명은 ‘K-Stock AI 운영자’입니다. 개인정보 관련 문의 이메일은 준비 후 안내할 예정입니다.';
function replaceOne(source,from,to){
 assert.equal(source.split(from).length,2,'exactly one approved contact change');
 return source.replace(from,to);
}
module.exports=()=>{
 for(const file of ['frontend/src/components/PublicPolicyContent.jsx','frontend/src/components/PublicPageNavigation.jsx']){
  let current=fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');
  if(file.endsWith('PublicPolicyContent.jsx')){
   current=replaceOne(current,'<h3 id="contact">','<h3>');
   current=replaceOne(current,confirmed,previous);
  }else current=replaceOne(current,"  {path:'/privacy#contact',label:'문의 안내'},\n",'');
  assert.equal(current,execFileSync('git',['show',base+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'),file+' changes only the approved contact guidance');
 }
};
