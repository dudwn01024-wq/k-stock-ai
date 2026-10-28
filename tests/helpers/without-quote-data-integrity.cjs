'use strict';
// New runtime regressions exercise current code. These exact hashes only let old
// byte-boundary tests restore the prior reviewed quote implementation.
const assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const base='94bb1c4bbf9550804243f2f20ca971c7e5ed6326',edits={
  "server.js": {
    "current": "ed57a5c57c41384d1bc004bf23260a01c36ab9816a0f88ce72e61c61b177f58b",
    "baseline": "996fb42d288229e6830f156db18598bcadaf4aa8fc04ed41d2e1eb91e668c88a",
    "marker": "selectAnalysisPrice"
  },
  "services/dataFreshness.js": {
    "current": "ea40bb069fa8cf87f9c499d25a7e0b96a375752e80e57bb1f6eee8ae03d73760",
    "baseline": "93606a7624144d49d9d6ad5931fd2b51f77dff2c8304336cc13dd8819dbda9af",
    "marker": "sourceKstDate"
  },
  "services/naverQuoteSnapshot.js": {
    "current": "66954f78b8a0016e91cba845583ff382f24d1cd7bc2d434e68db7cb4009982df",
    "baseline": "6079f63a5cfeba7686277938aafb806933f32462db22916391746437066ed05d",
    "marker": "SOURCE_TIMESTAMP_KST_CALENDAR_DATE"
  },
  "services/naverMarketData.js": {
    "current": "e083c57b075dd12551dcb75c7fc1f9eeb6084fd935db9102f22bc4e485c0e016",
    "baseline": "ef4f6cbad86f930d970f3bd3a0b1bfadc28cd79c4f1b4fffd01fc8867dff06bc",
    "marker": "snapshotMetadata(latestTrend,"
  },
  "services/kisSupplyRuntime.js": {
    "current": "5b43097ff897747bdefa69bf63503038ab974bb90d6748fcaaa3b0bd3b340be5",
    "baseline": "1a2b191ca0597361707c7ff7a7f2c11f6604a2bdddaaadfc5f95927580e32935",
    "marker": "const {withDataMetadata}"
  },
  "services/kisAutonomousRecommendations.js": {
    "current": "0c957a419061813e58f656917f49cde857088510fcbc49c40fb255cf13f64fd4",
    "baseline": "2bf8e2cf4caaaa5f4d2608c2a89a53e117a70bdf10d9bf6a976f994bd55f3dc1",
    "marker": "const {withDataMetadata}"
  },
  "frontend/src/utils/detailSupply.js": {
    "current": "07f43e6d6279dd4bd3c897a8867ccdf4f19b6575da959fab02025f5e998ae3ad",
    "baseline": "c24835045a4433cc96b3bce7bc82da3c075426ed49a1aaba6bdcee75f4bd6c77",
    "marker": "import {withDataMetadata}"
  },
  "frontend/src/App.jsx": {
    "current": "ff62e48efe8d1371925dcac95286952747f4fb870049e6c2ed2fb246f6257442",
    "baseline": "0fadafd69cbc5c4b7c351076f1a623fd7a709d17e8ec2765649ac644993a066f",
    "marker": "priceBasis: payload?.priceBasis"
  },
  "frontend/src/QuoteProvenance.jsx": {
    "current": "132c186d3e707a5b121267608cb481737de09af6e047f2c155170fbfcd937330",
    "baseline": "9205ae1ddaeaf5ee9dbcc0b64ba947b7d0522f5115d786918bef541a7a121c59",
    "marker": "SOURCE_TIMESTAMP_KST_CALENDAR_DATE"
  },
  "services/analysisProvenance.js": {
    "current": "e58116abb425a2f291bab8f32ef3d53d0e2d1017d0034943e508c32e19dd0bf5",
    "baseline": null,
    "marker": "selectAnalysisPrice"
  },
  "frontend/src/utils/dataMetadata.js": {
    "current": "ede7abd14d47ac94ff76771ef4e230c1ec8faf20be4405f2609a0205d567d50c",
    "baseline": null,
    "marker": "withDataMetadata"
  }
};
const hash=s=>createHash('sha256').update(s).digest('hex');
function restore(source,file){source=require('./without-analysis-diagnostics.cjs')(source,file);const s=source.replaceAll('\r\n','\n'),e=edits[file];if(!e)return s;
 const digest=hash(s);if(digest===e.baseline)return s;
 if(digest!==e.current){if(s.includes(e.marker))assert.fail('exact quote data integrity boundary (exact detail preservation boundary): '+file);return s;}
 if(e.baseline===null)return '';
 const previous=execFileSync('git',['show',base+':'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');
 assert.equal(hash(previous),e.baseline);return previous;}
restore.files=[...new Set([...Object.keys(edits),...require('./without-analysis-diagnostics.cjs').files])];
restore.assertAll=()=>{const inverse=require('./without-analysis-diagnostics.cjs');inverse.assertAll();for(const [file,e]of Object.entries(edits))assert.equal(hash(inverse(fs.readFileSync(file,'utf8'),file)),e.current,'exact quote data integrity boundary: '+file);};
module.exports=restore;
restore.protectedDiff=(base,paths)=>{restore.assertAll();return execFileSync('git',['diff',base,'--',...paths,
  ...restore.files.map(file=>':!'+file)],{encoding:'utf8',windowsHide:true});};
