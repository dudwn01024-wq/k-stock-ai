'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const baseline='5ad387ff04769dcdde53114bf0079835f0341849';
// Historical UI-only boundaries still protect every other byte. These exact
// three diagnostic edits are independently covered by the universe regressions.
// A different edit to any of these files must fail before excluding its diff.
const approved={
  'services/recommendationUniverse.js':'532e75354bb41adaaa85a533922e4abd63ae67bbf3cd7d68645c2e199dc35acf',
  'services/recommendationUniverseDiagnostics.js':'0a166fa2d19e7caa040b9535381bc2be33d9193b090b59ab2a8aa020826c5410',
  'services/expandedRunFailureDiagnostics.js':'878d34bd7a27dce5c9ae87a7f8017c1aec788a060db206a82467a22ec7cba5e6'
};
function assertApprovedSource(file,source){
  const digest=createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex');
  assert.equal(digest,approved[file],'exact universe duplicate diagnostic boundary: '+file);
}
function protectedDiff(base,paths){
  assert.equal(execFileSync('git',['diff',baseline,base,'--',...Object.keys(approved)],{encoding:'utf8'}),'',
    'historical base has the same universe implementation as the approved starting main');
  for(const file of Object.keys(approved))assertApprovedSource(file,fs.readFileSync(file,'utf8'));
  return execFileSync('git',['diff',base,'--',...paths,...Object.keys(approved).map(file=>':!'+file)],{encoding:'utf8'});
}
module.exports=protectedDiff;
module.exports.assertApprovedSource=assertApprovedSource;
