'use strict';
// Only the exact approved read-only explanation/layout patch is reversible.
const assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const base='2624c2f5293077e9e6ee678df378714e71fc30c8',file='frontend/src/AnalysisExtensions.jsx',current='79d625b16a33da173972fe9e6e23b4b683847de7731391764bc971af64ae61ff',baseline='3c20a302f48542ae4aba2efddff433695bc70822300386b026a5c36b07d08c7b';
const hash=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
function restore(source,path){const s=source.replaceAll('\r\n','\n');if(path!==file||hash(s)===baseline)return s;
 if(hash(s)!==current&&!s.includes('extension-status-title'))return s;
 assert.equal(hash(s),current,'exact panel language boundary (exact single KIS AI input boundary; exact analysis diagnostics boundary; exact quote data integrity boundary; exact detail preservation boundary): '+file);
 const previous=execFileSync('git',['show',base+':'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');assert.equal(hash(previous),baseline);return previous;}
restore.files=[file];restore.assertAll=()=>assert.equal(hash(fs.readFileSync(file,'utf8')),current,'exact panel language boundary: '+file);
module.exports=restore;
