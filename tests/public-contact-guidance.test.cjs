"use strict";
require('./helpers/local-only.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
const front=createRequire(require.resolve('../frontend/package.json')),React=front('react'),{renderToStaticMarkup}=front('react-dom/server'),{transformSync}=front('esbuild');
function load(file){
 const module={exports:{}};
 vm.runInNewContext(transformSync(fs.readFileSync(file,'utf8'),{loader:'jsx',format:'cjs'}).code,{module,exports:module.exports,
  fetch:()=>assert.fail('CONTACT_NETWORK_FORBIDDEN'),require:name=>{
   if(name==='react')return React;if(name.endsWith('.css'))return {};
   assert.ok(name.startsWith('.'));assert.doesNotMatch(name,/App|router|utils|services/);
   return load(path.resolve(path.dirname(file),name));
  }});return module.exports;
}
const {PrivacyContent,PublicContactContent}=load(require.resolve('../frontend/src/components/PublicPolicyContent.jsx'));
const {default:Navigation}=load(require.resolve('../frontend/src/components/PublicPageNavigation.jsx'));
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
test('TEST_ONLY contact change is limited to the exact approved name, approved public-email paragraph and link',()=>require('./helpers/public-contact-boundary.cjs')());
test('TEST_ONLY shared footer contact link points to the one real privacy-page anchor',()=>{
 const body=render(PrivacyContent),links=render(Navigation,{currentPath:'/privacy'});
 assert.equal((body.match(/id="contact"/g)||[]).length,1);
 assert.match(links,/<a href="\/privacy#contact">문의 안내<\/a>/);
 assert.equal((links.match(/aria-current="page"/g)||[]).length,1);
 assert.match(links,/<a href="\/privacy" aria-current="page">/);
});
test('TEST_ONLY confirmed service display name uses only the approved public email without inventing retention or legal identity',()=>{
 for(const includeTitle of [true,false]){
  const html=render(PrivacyContent,{includeTitle});
  for(const text of ['서비스 운영자 표시명은 ‘K-Stock AI 운영자’입니다.','개인정보 및 서비스 문의:',
   '확인되지 않은 보관기간을 임의로 표시하지 않습니다.','비밀번호·평균매수가·개인정보를 공개 이슈나 댓글에 올리지 마세요.'])assert.ok(html.includes(text));
  assert.equal((html.match(/href="mailto:kstockaiunyeongja@gmail.com"/g)||[]).length,1);
  assert.doesNotMatch(html,/준비 후 안내|법정 실명|실명 요건 충족|광고 활성화 완료/);
 }
});
test('TEST_ONLY contact is present in built initial privacy HTML and all 12 guide navigations without new route/sitemap',()=>{
 const routes=['about','analysis-method','data-sources','investment-notice','privacy',...['005930','000660','373220','035420','005380','035720','068270'].map(x=>'stocks/'+x)];
 for(const route of routes){
  const html=fs.readFileSync('frontend/dist/'+route+'.html','utf8');
  assert.match(html,/href="\/privacy#contact">문의 안내/);
  if(route==='privacy'){assert.match(html,/id="contact"/);assert.ok(html.includes('href="mailto:kstockaiunyeongja@gmail.com"'));
  }
  if(route.startsWith('stocks/'))assert.match(html,/name="robots" content="noindex,follow"/);
 }
 assert.equal((fs.readFileSync('frontend/public/sitemap.xml','utf8').match(/<loc>/g)||[]).length,6);
});

test('TEST_ONLY About and privacy share the approved public contact without network or duplicate source',()=>{
 const {AboutPage}=load(require.resolve('../frontend/src/pages/PublicPages.jsx'));
 const contact=render(PublicContactContent);
 assert.ok(render(AboutPage).includes(contact));assert.ok(render(PrivacyContent).includes(contact));
 assert.equal((fs.readFileSync('frontend/src/components/PublicPolicyContent.jsx','utf8').match(/mailto:/g)||[]).length,1);
 for(const route of ['about','privacy'])assert.ok(fs.readFileSync('frontend/dist/'+route+'.html','utf8').includes(contact));
});
