'use strict';
// Exact approved route/head and site noindex edits only. Behavioral coverage lives in public SEO/router tests.
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const base='e21a12dec250697aed94013241ca20bc48909599',hashes={
  "frontend/src/router.jsx": "4cf0f1ed59c2d6c13d98b15ef09c2123e27a41959af2de2e222fe211c4c38c2f",
  "frontend/src/components/PageMeta.jsx": "4d74339a61d0a7cffc1e7bd83bb4ca2b0241c3ac33c679291a66a3c713293a4c",
  "frontend/src/seo/publicMetadata.js": "ea6dda184aaa6df1e11bbf59334b24f872471580b417772fe5bb838d87754a8b"
};
function restoreSource(file,source){
 const current=source.replaceAll('\r\n','\n');if(!Object.hasOwn(hashes,file))return current;
 assert.equal(crypto.createHash('sha256').update(current).digest('hex'),hashes[file],file+' matches only the approved SEO error edits');
 return execFileSync('git',['show',base+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n');
}
module.exports=()=>{for(const file of Object.keys(hashes))restoreSource(file,fs.readFileSync(file,'utf8'));};
module.exports.restoreSource=restoreSource;
