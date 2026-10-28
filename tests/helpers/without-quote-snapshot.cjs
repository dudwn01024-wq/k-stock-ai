'use strict';
// Exact committed 94bb1c4 quote/UI changes only. Runtime tests always use current
// production source; this inverse repairs older byte-boundary test composition.
const assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const previous='a0d89272abc0d4e902226da0c7de8feb83273c2c',edits={
  "frontend/src/App.jsx": {
    "current": "0fadafd69cbc5c4b7c351076f1a623fd7a709d17e8ec2765649ac644993a066f",
    "baseline": "01854300aa321c97eb0db205f4021d4df19d8dec55d24a685aaf0478a66fa2ad"
  },
  "frontend/src/ExpandedCandidateCard.jsx": {
    "current": "715e3308f4668758bfb5975b02d9cde78e23a2365fbcebfc61ea9849ba16da57",
    "baseline": "eb1367ab6296bf157061b8a774b1434a5ff8d54ae87dd96a6defed099f85a820"
  },
  "frontend/src/ExpandedRecommendation.jsx": {
    "current": "97e7d7e43be820f3bca8740107cc8b99d56b675bca6c322725ce8e55f9dd6e1a",
    "baseline": "dabf2e6774c5a31161ba15f578b2db4230ecafca1effb14f64367a2915f86447"
  },
  "frontend/src/QuoteProvenance.jsx": {
    "current": "9205ae1ddaeaf5ee9dbcc0b64ba947b7d0522f5115d786918bef541a7a121c59",
    "baseline": null
  },
  "frontend/src/RecommendationHistory.jsx": {
    "current": "053bb3310245aaff6fb15c9836909cf83b00aec125e05ccc80a788b23bac31e3",
    "baseline": "c7576dddda6fef52c5fa38602d51da750c7b60fe03a207ba155215f202cb1079"
  },
  "frontend/src/public-home.css": {
    "current": "74671de23d74169e01d44ba3de97aaf90b8181ea59ad09f78c24b419f130833e",
    "baseline": "e0591437b1fc6cf4acd48b5d90b2e38dc6a542144d34250b363a6290c43e92a6"
  },
  "frontend/src/recommendationDataDates.js": {
    "current": "ceceb19834617d728fc3ccc4fb12d7469f6e22de3ea939e2ab39e181829e32d5",
    "baseline": "20465d6f0b260a28967e0c328d22b6230a5b379cb848a5d328d2ac5a5fd53b8d"
  },
  "services/naverMarketData.js": {
    "current": "ef4f6cbad86f930d970f3bd3a0b1bfadc28cd79c4f1b4fffd01fc8867dff06bc",
    "baseline": "4b3f5e08e40c7eabdf22e098aa9e5f8de2d28ced05a2be745e039ffe676055da"
  },
  "services/naverQuoteSnapshot.js": {
    "current": "6079f63a5cfeba7686277938aafb806933f32462db22916391746437066ed05d",
    "baseline": null
  }
};
const hash=s=>createHash('sha256').update(s).digest('hex');
function restore(source,file){const value=require('./without-quote-data-integrity.cjs')(source,file),e=edits[file];
 if(!e||hash(value)===e.baseline)return value;
 if(hash(value)!==e.current)return value; // Older inverses still verify their own exact hashes.
 if(e.baseline===null)return '';
 const before=execFileSync('git',['show',previous+':'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');
 assert.equal(hash(before),e.baseline,'exact pre-quote-snapshot source: '+file);return before;}
restore.files=Object.keys(edits);
restore.assertSource=(file,source)=>{
 const value=require('./without-quote-data-integrity.cjs')(source,file);
 assert.equal(hash(value),edits[file].current,'exact committed quote snapshot boundary: '+file);
};
restore.assertAll=()=>{require('./without-quote-data-integrity.cjs').assertAll();
 for(const file of Object.keys(edits))restore.assertSource(file,fs.readFileSync(file,'utf8'));};
restore.protectedDiff=(base,paths)=>{restore.assertAll();return execFileSync('git',['diff',base,'--',...paths,
 ...[...restore.files,...require('./without-quote-data-integrity.cjs').files].map(file=>':!'+file)],{encoding:'utf8',windowsHide:true});};
module.exports=restore;
