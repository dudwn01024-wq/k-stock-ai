'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const baseline='5ad387ff04769dcdde53114bf0079835f0341849';
// Historical UI-only boundaries still protect every other byte. These exact
// diagnostic edits, the below-cutoff boundary overlap fix, and the exact reviewed 02826K record are independently tested.
// A different edit to any of these files must fail before excluding its diff.
const approved={
  'services/recommendationUniverse.js':'dc697c1f80de0df8d4a91bfb72cb7c9ab1c3911d0dd540b199b95066133fdfb5',
  'services/recommendationUniverseDiagnostics.js':'ffea7bc92fc05a80500bbcef631abcacdcc428c03919f0de9504e9a0fb23b0f9',
  'services/expandedRunFailureDiagnostics.js':'0d51b95f080339f9a477b4fc0cad5d1a6401275a982bbe3fb58bec1a10a76d24',
  'services/krxStockSecurityType.js':'62d325c37232b144df3b46a046d96551fbc979213be43d08d43377f0d499a001'
};
function assertApprovedSource(file,source){
  source=require('./without-universe-excluded-overlap.cjs')(source,file);
  const digest=createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex');
  assert.equal(digest,approved[file],'exact universe duplicate diagnostic boundary: '+file);
  if(file==='services/krxStockSecurityType.js')assert.equal(require('./without-reviewed-02826k.cjs')(source),
    execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'),
    'all type validation and classification logic remains outside the single reviewed record edit');
}
function protectedDiff(base,paths){
  const quoteBoundary=require('./without-quote-snapshot.cjs');quoteBoundary.assertAll();
  assert.equal(execFileSync('git',['diff',baseline,base,'--',...Object.keys(approved)],{encoding:'utf8'}),'',
    'historical base has the same universe implementation as the approved starting main');
  for(const file of Object.keys(approved))assertApprovedSource(file,fs.readFileSync(file,'utf8'));
  const privateFiles=require('./private-site-boundary-hashes.cjs');
  const kisFiles=require('./kis-intraday-boundary-hashes.cjs'),stripKis=require('./without-kis-intraday.cjs');
  for(const [file,digest]of Object.entries(kisFiles))assert.equal(createHash('sha256').update(require('./without-universe-recurrence.cjs')(fs.readFileSync(file,'utf8'),file).replaceAll('\r\n','\n')).digest('hex'),digest,'exact manual KIS reference boundary: '+file);
  for(const [file,digest]of Object.entries(privateFiles))assert.equal(createHash('sha256').update(stripKis(fs.readFileSync(file,'utf8'),file)).digest('hex'),digest,'exact private access boundary: '+file);
  return execFileSync('git',['diff',base,'--',...paths,...[...Object.keys(approved),...Object.keys(privateFiles),...Object.keys(kisFiles),...quoteBoundary.files,...require('./without-quote-data-integrity.cjs').files].map(file=>':!'+file)],{encoding:'utf8'});
}
module.exports=protectedDiff;
module.exports.assertApprovedSource=assertApprovedSource;
