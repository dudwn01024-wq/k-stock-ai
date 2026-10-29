'use strict';
// Only this exact authorized KIS/input/observational-analysis patch is reversible in historical tests.
const assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const base='41b374cd2fc94ef46ab33d8306e343f24e7f3dbd',edits={
  "server.js": {
    "current": "6cd12120dd4b871d03be5df93fe0003a59af8231979f913f6b26fecaa088c7a9",
    "baseline": "f1e019e42a2bdb37422beaf847d1e9edeb9b49838ef95554c6225ada0e578f7a",
    "marker": "buildSingleSupplyAiInput"
  },
  "frontend/src/App.jsx": {
    "current": "e43a79acd171d1293992cb106df0e433fa226260db1efae71b4b79bcb0e8e2f6",
    "baseline": "2db796deb2d3012bcd940dc51fb38425ac4ce8721cfb3ccd9299517e842e6333",
    "marker": "AnalysisExtensions"
  },
  "frontend/src/QuoteProvenance.jsx": {
    "current": "c4d2265ad7a356d2696ecbb0a6ebd3c5c3667a9898ff4b1b4c1541f4ae4f9f28",
    "baseline": "132c186d3e707a5b121267608cb481737de09af6e047f2c155170fbfcd937330",
    "marker": "KIS_CURRENT_QUOTE"
  },
  "frontend/src/utils/detailSupply.js": {
    "current": "3445c433d0af4406c9af1ea68aee050ca825085ac59a1e80a9c40a294758ae5b",
    "baseline": "07f43e6d6279dd4bd3c897a8867ccdf4f19b6575da959fab02025f5e998ae3ad",
    "marker": "KIS_CURRENT_QUOTE"
  },
  "frontend/src/RecommendationOutcomes.jsx": {
    "current": "485f29453d19506a7aa9d8e26b7c27cac45fa8bb99f320f98f09e5bc53c88e3a",
    "baseline": "153773e48c147c7a8cf3d2900269459e40a7b922b38a55131226eabed9e14dbb",
    "marker": "TRACKING_BLOCKED_PROVIDER_MISMATCH"
  },
  "services/kisMarketData.js": {
    "current": "6f7487de0dc83a9497e82b5ab9a4d7f679813d9f20db80ddecbff24121d43508",
    "baseline": "736d691bdf6dd00a3c69ceb91fff465d2b0a7d96abd2945e5f1c0eb7e0220fd6",
    "marker": "screeningSnapshot"
  },
  "services/recommendationFastScreen.js": {
    "current": "32fa1cb16dc6f6a5a0a5c015ba2bdc0d1d65214097c5c4739f5c30c92be1ff5d",
    "baseline": "384e6ead6966afd0d9bf1f9d77c4ff6deff4c20fe686d9eebcf32d8ba86b9f1c",
    "marker": "inputFormat"
  },
  "services/recommendationOutcomeBaseline.js": {
    "current": "e068b9d39513b9d7896f49423ccd1a23a7857d0126de55c59c237e02689c9443",
    "baseline": "aa0d8070f7df29aa6e1a04c6f3800f8663267d930e445c911a2cc4bf487b7660",
    "marker": "KIS_PROVIDER"
  },
  "services/recommendationOutcomeCollector.js": {
    "current": "07ed16f43c3c09b3ef202937f5a5701531617438dbeaf29c05bff14cb8f0365a",
    "baseline": "867d2d2f4296f068ce9385b992e029680b99747f9d575ed6f5487e2faf1199fe",
    "marker": "KIS_DAILY_OHLCV"
  },
  "services/recommendationOutcomes.js": {
    "current": "693367caeff8f3ab89ba1fdf2c54974a762422ac77c8d0557a69b51ef07fcbd0",
    "baseline": "4732fedaaec4f392953398e310fb9fd1a473bf2a56e53ebd7d6eb4d13a301df1",
    "marker": "KIS_DAILY_OHLCV"
  },
  "services/aiAnalysisInput.js": {
    "current": "bb25289aa60b6aa18445a31daeec82f9bb0f2fa8953723f7edb0b5c51a08e4f3",
    "baseline": null,
    "marker": "module.exports"
  },
  "frontend/src/AiSupplyProvenance.jsx": {
    "current": "a3e5a685cc4db0bed48cbd9b04191ab795d7e5661bae6b048441d1e1c19244e5",
    "baseline": null,
    "marker": "module.exports"
  },
  "frontend/src/AnalysisExtensions.jsx": {
    "current": "3c20a302f48542ae4aba2efddff433695bc70822300386b026a5c36b07d08c7b",
    "baseline": null,
    "marker": "module.exports"
  },
  "services/kisRecommendationDaily.js": {
    "current": "8da7efdd1c1840cfc3f502797d1c0cbb2e8b9e4feebe92c139eca8f826844184",
    "baseline": null,
    "marker": "module.exports"
  },
  "services/analysisExtensions.js": {
    "current": "ae7b51d43734e675fa445653b7b3c223e3370dcf180e4813aba974cb88b7d6cd",
    "baseline": null,
    "marker": "module.exports"
  },
  "services/chartPatternCandidates.js": {
    "current": "93e250928cc4173919ee2bb3dd6cd4f32be14d4e51c1670cbf2a85d1e57139d5",
    "baseline": null,
    "marker": "module.exports"
  },
  "services/elliottWaveCandidates.js": {
    "current": "255d5a4345cbf9b45977b0f118af36d0f3e7f9fcf537b386d675253729ef5da3",
    "baseline": null,
    "marker": "module.exports"
  },
  "services/analysisPriceScenarios.js": {
    "current": "7e8a1076cd8fba86ae7ae18b7e9c9eb2dec6ea83fbaf43035e881661b305ea2f",
    "baseline": null,
    "marker": "module.exports"
  },
  "services/kisChartRoutes.js": {
    "current": "46a584c85c8c9498038d2d896938b356e7220d6da5ac623455122003ef8edd9d",
    "baseline": null,
    "marker": "module.exports"
  },
  "frontend/src/KisPeriodChart.jsx": {
    "current": "e9c6da483368a857366ee4898233ec1d1725093536d047c46039a71039fa35c6",
    "baseline": null,
    "marker": "module.exports"
  },
  "frontend/src/kis-period-chart.css": {
    "current": "e2751b6dc6ebe437d5163c0a850a563126af2baed720c4b446c12b67a840f23d",
    "baseline": null,
    "marker": "module.exports"
  },
  "frontend/src/utils/kisChartViewport.js": {
    "current": "db7f93234f8ddadf1f5cc22afb9cf10c2ab0689707a7aba386fa5c3b5f728cfd",
    "baseline": null,
    "marker": "module.exports"
  },
  "frontend/src/utils/kisChartRequest.js": {
    "current": "99ab6bc2d274b7d516c265127b67b1616b65b1fbc468746d743ec1fed4afd277",
    "baseline": null,
    "marker": "module.exports"
  },
  "services/kisQuoteSnapshot.js": {
    "current": "6476f2aa5219e23ace6151615a69a231818b16c4d816402c70879c2ae640d1cd",
    "baseline": null,
    "marker": "module.exports"
  },
  "services/kisQuoteService.js": {
    "current": "1fae2cc918f0b48b1120efd10c476f87393aaa4825c27c337cf61b132126ea63",
    "baseline": null,
    "marker": "module.exports"
  }
};
const hash=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
function restore(source,file){source=require('./without-panel-language.cjs')(source,file);source=require('./without-stock-name.cjs')(source,file);const s=source.replaceAll('\r\n','\n'),e=edits[file];if(!e)return s;
 const digest=hash(s);if(digest===e.baseline)return s;
 if(digest!==e.current){if(e.baseline===null||s.includes(e.marker))assert.fail('exact single KIS AI input boundary (exact analysis diagnostics boundary; exact quote data integrity boundary; exact detail preservation boundary): '+file);return s;}
 if(e.baseline===null)return '';
 const previous=execFileSync('git',['show',base+':'+file],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');assert.equal(hash(previous),e.baseline);return previous;}
restore.files=[...new Set([...Object.keys(edits),...require('./without-stock-name.cjs').files])];
restore.assertAll=()=>{const panel=require('./without-panel-language.cjs');panel.assertAll();require('./without-stock-name.cjs').assertAll();const inverse=(source,file)=>require('./without-stock-name.cjs')(panel(source,file),file);for(const[file,e]of Object.entries(edits))assert.equal(hash(inverse(fs.readFileSync(file,'utf8'),file)),e.current,'exact single KIS AI input boundary: '+file);};
module.exports=restore;
