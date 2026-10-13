'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const baseline='5ad387ff04769dcdde53114bf0079835f0341849';
// Historical UI-only boundaries still protect every other byte. These exact
// diagnostic edits and the exact reviewed 02826K record are independently tested.
// A different edit to any of these files must fail before excluding its diff.
const approved={
  'services/recommendationUniverse.js':'532e75354bb41adaaa85a533922e4abd63ae67bbf3cd7d68645c2e199dc35acf',
  'services/recommendationUniverseDiagnostics.js':'0a166fa2d19e7caa040b9535381bc2be33d9193b090b59ab2a8aa020826c5410',
  'services/expandedRunFailureDiagnostics.js':'878d34bd7a27dce5c9ae87a7f8017c1aec788a060db206a82467a22ec7cba5e6',
  'services/krxStockSecurityType.js':'62d325c37232b144df3b46a046d96551fbc979213be43d08d43377f0d499a001'
};
function assertApprovedSource(file,source){
  const digest=createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex');
  assert.equal(digest,approved[file],'exact universe duplicate diagnostic boundary: '+file);
  if(file==='services/krxStockSecurityType.js')assert.equal(require('./without-reviewed-02826k.cjs')(source),
    execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'),
    'all type validation and classification logic remains outside the single reviewed record edit');
}
function protectedDiff(base,paths){
  assert.equal(execFileSync('git',['diff',baseline,base,'--',...Object.keys(approved)],{encoding:'utf8'}),'',
    'historical base has the same universe implementation as the approved starting main');
  for(const file of Object.keys(approved))assertApprovedSource(file,fs.readFileSync(file,'utf8'));
  const privateFiles=require('./private-site-boundary-hashes.cjs');
  const kisFiles=require('./kis-intraday-boundary-hashes.cjs'),stripKis=require('./without-kis-intraday.cjs');
  for(const [file,digest]of Object.entries(kisFiles))assert.equal(createHash('sha256').update(fs.readFileSync(file,'utf8').replaceAll('\r\n','\n')).digest('hex'),digest,'exact manual KIS reference boundary: '+file);
  for(const [file,digest]of Object.entries(privateFiles))assert.equal(createHash('sha256').update(stripKis(fs.readFileSync(file,'utf8'),file)).digest('hex'),digest,'exact private access boundary: '+file);
  return execFileSync('git',['diff',base,'--',...paths,...[...Object.keys(approved),...Object.keys(privateFiles),...Object.keys(kisFiles)].map(file=>':!'+file)],{encoding:'utf8'});
}
module.exports=protectedDiff;
module.exports.assertApprovedSource=assertApprovedSource;
