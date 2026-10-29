'use strict';
// Restore only this exact, regression-tested explanation/display patch for older
// historical byte boundaries. No calculation, risk or provider authorization changes.
const assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const base='fc0d6e85b1ef9b2931d2be64d9969c345a092df5',edits={
  "server.js": {
    "current": "f1e019e42a2bdb37422beaf847d1e9edeb9b49838ef95554c6225ada0e578f7a",
    "baseline": "ed57a5c57c41384d1bc004bf23260a01c36ab9816a0f88ce72e61c61b177f58b",
    "marker": "geminiThinkingConfig"
  },
  "frontend/src/App.jsx": {
    "current": "2db796deb2d3012bcd940dc51fb38425ac4ce8721cfb3ccd9299517e842e6333",
    "baseline": "ff62e48efe8d1371925dcac95286952747f4fb870049e6c2ed2fb246f6257442",
    "marker": "pricePlanState"
  },
  "frontend/src/utils/aiAnalysisError.js": {
    "current": "3c89a023abd42f8fbc4b45045298822705507f08e8f2dc9e08f6ef3b5198e1c2",
    "baseline": "c4f4a5ec40d2fc57ea856503b831838deaf3bb7160bbc34e9fe32fec7255c205",
    "marker": "const causes="
  },
  "frontend/src/PricePlanReference.jsx": {
    "current": "440f79dda739adff12727547c2f7e7721cf28783ab649d52d2b44849cab91626",
    "baseline": null,
    "marker": "pricePlanState"
  },
  "frontend/src/utils/pricePlan.js": {
    "current": "d3956b49304316495db7dbe576176eb423e51ad0f23a568285cb4c2ab4e11b56",
    "baseline": null,
    "marker": "pricePlanState"
  }
};
const hash=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
function restore(source,file){source=require('./without-single-ai-supply.cjs')(source,file);const s=source.replaceAll('\r\n','\n'),e=edits[file];if(!e)return s;
 const digest=hash(s);if(digest===e.baseline)return s;
 if(digest!==e.current){if(e.baseline===null||s.includes(e.marker))assert.fail('exact analysis diagnostics boundary (exact quote data integrity boundary; exact detail preservation boundary): '+file);return s;}
 if(e.baseline===null)return '';
 const previous=execFileSync('git',['show',base+':'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');
 assert.equal(hash(previous),e.baseline);return previous;}
restore.files=[...new Set([...Object.keys(edits),...require('./without-single-ai-supply.cjs').files])];
restore.assertAll=()=>{const inverse=require('./without-single-ai-supply.cjs');inverse.assertAll();for(const[file,e]of Object.entries(edits))assert.equal(hash(inverse(fs.readFileSync(file,'utf8'),file)),e.current,'exact analysis diagnostics boundary: '+file);};
module.exports=restore;
