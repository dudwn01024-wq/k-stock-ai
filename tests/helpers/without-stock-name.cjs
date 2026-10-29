'use strict';
// Exact name-display patch only; calculations, financial readers and API budgets remain protected.
const assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const base='4b0bdb0a74ca2a51033c9c8d364155e7773f4634',edits={
  "frontend/src/App.jsx": {
    "current": "1312fcc50c82c8e7c560921850a65745a52a83be4588d5ad1aabbcb126410c70",
    "baseline": "e43a79acd171d1293992cb106df0e433fa226260db1efae71b4b79bcb0e8e2f6"
  },
  "frontend/src/utils/stockIdentity.js": {
    "current": "bdcf472f679c52bb77aff71044fa8be3198abfa0ff244805428977da2173aacf",
    "baseline": null
  }
};
const hash=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
function restore(source,file){const s=source.replaceAll('\r\n','\n'),e=edits[file];if(!e)return s;
 if(hash(s)===e.baseline)return s;
 if(hash(s)!==e.current&&e.baseline!==null&&!s.includes('resolveStockIdentity'))return s;
 assert.equal(hash(s),e.current,'exact stock-name display boundary (exact single KIS AI input boundary; exact analysis diagnostics boundary; exact quote data integrity boundary; exact detail preservation boundary): '+file);
 if(e.baseline===null)return '';
 const old=execFileSync('git',['show',base+':'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');assert.equal(hash(old),e.baseline);return old;}
restore.files=Object.keys(edits);
restore.assertAll=()=>{for(const[file,e]of Object.entries(edits))assert.equal(hash(fs.readFileSync(file,'utf8')),e.current,'exact stock-name display boundary: '+file);};
module.exports=restore;
