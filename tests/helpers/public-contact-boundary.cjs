"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
// Only the user-approved display name, public email, contact link and About contact section may differ.
const base='cf5a191c3dd93c48f5b7b8934eae8facc51bcf92';
const previous='운영자 표시명과 개인정보 전용 문의창구는 확인 후 안내할 예정입니다.';
const confirmed='서비스 운영자 표시명은 ‘K-Stock AI 운영자’입니다. 개인정보 관련 문의 이메일은 준비 후 안내할 예정입니다.';
function replaceOne(source,from,to){
 assert.equal(source.split(from).length,2,'exactly one approved contact change');
 return source.replace(from,to);
}
function restoreSource(file,source){
 let current=source.replaceAll('\r\n','\n');
 if(file.endsWith('PublicPolicyContent.jsx')){
  current=replaceOne(current,"export function PublicContactContent(){\n  return <>서비스 운영자 표시명은 ‘K-Stock AI 운영자’입니다. 개인정보 및 서비스 문의: <a href=\"mailto:kstockaiunyeongja@gmail.com\">kstockaiunyeongja@gmail.com</a>.</>;\n}\n\n",'');
  current=replaceOne(current,'<PublicContactContent/>',confirmed);
  current=replaceOne(current,'플랫폼 로그의 보관기간·처리 범위는','플랫폼 로그의 보관기간·처리 범위와 문의창구는');
  current=replaceOne(current,'플랫폼 보관정책을 확인하면','문의창구와 플랫폼 보관정책을 확정하면');
 }else if(file.endsWith('PublicPages.jsx')){
  current=replaceOne(current,'InvestmentNoticeContent,PrivacyContent,AdvertisingNoticeContent,PublicContactContent','InvestmentNoticeContent,PrivacyContent,AdvertisingNoticeContent');
  current=replaceOne(current,'    <h2>운영 및 문의</h2>\n    <p><PublicContactContent/></p>\n','');
 }
 return current;
}
function restoreHtml(html){
 return html.replace("서비스 운영자 표시명은 ‘K-Stock AI 운영자’입니다. 개인정보 및 서비스 문의: <a href=\"mailto:kstockaiunyeongja@gmail.com\">kstockaiunyeongja@gmail.com</a>.",confirmed)
  .replace('플랫폼 로그의 보관기간·처리 범위는','플랫폼 로그의 보관기간·처리 범위와 문의창구는')
  .replace('플랫폼 보관정책을 확인하면','문의창구와 플랫폼 보관정책을 확정하면');
}
module.exports=()=>{
 for(const file of ['frontend/src/components/PublicPolicyContent.jsx','frontend/src/components/PublicPageNavigation.jsx','frontend/src/pages/PublicPages.jsx']){
  let current=restoreSource(file,fs.readFileSync(file,'utf8'));
  if(file.endsWith('PublicPolicyContent.jsx')){
   current=replaceOne(current,'<h3 id="contact">','<h3>');
   current=replaceOne(current,confirmed,previous);
  }else if(file.endsWith('PublicPageNavigation.jsx'))current=replaceOne(current,"  {path:'/privacy#contact',label:'문의 안내'},\n",'');
  assert.equal(current,execFileSync('git',['show',base+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'),file+' changes only the approved contact guidance');
 }
};

module.exports.restoreSource=restoreSource;
module.exports.restoreHtml=restoreHtml;
