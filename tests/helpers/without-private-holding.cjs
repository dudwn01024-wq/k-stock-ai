// Only the new route registration and server-data retention are stripped.
// Every existing server calculation, response and provider path stays protected.
module.exports=value=>value.replaceAll('\r\n','\n')
  .replace("const {createHoldingGuidanceAccess,registerHoldingGuidanceRoutes}=require('./services/holdingGuidanceAccess');\nconst holdingGuidanceAccess=createHoldingGuidanceAccess();\nregisterHoldingGuidanceRoutes(app,holdingGuidanceAccess);\n",'')
  .replace("      // Retain only server-calculated detail data for the private, no-fetch judgment.\n      if(includeNewsSnapshot)holdingGuidanceAccess.rememberStrategy({symbol,snapshotId:newsResult.snapshot?.id,\n        strategy:{...strategy,currentPrice,dataMetadata:{dateConsistency:dateConsistency([quote?.dataMetadata?.price, quote?.dataMetadata?.supply, latestRow?.dataMetadata])}}});\n",'');
