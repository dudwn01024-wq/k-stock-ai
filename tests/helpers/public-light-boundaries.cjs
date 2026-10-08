'use strict';
const assert=require('node:assert/strict');
const strip=source=>source.replaceAll('\r\n','\n').replace("import './light-theme.css';\n",'').replace("import CurrentAnalysisSummary from './CurrentAnalysisSummary.jsx';\n",'');
module.exports={strip,assertApp(current,expected){
 current=strip(current);expected=strip(expected);
 const boundary='  return (\n    <div className={`public-home';
 const a=current.indexOf(boundary),b=expected.indexOf(boundary);assert.ok(a>0&&b>0,'known App display boundary');
 assert.equal(current.slice(0,a),expected.slice(0,b),'all services, requests, state, effects, handlers and calculations are byte-identical');
 const handlers=source=>[...source.matchAll(/on(?:Click|Submit|Change|Select)=\{([^}]+)\}/g)].map(match=>match[0]).sort();
 assert.deepEqual(handlers(current),handlers(expected),'all existing UI actions are identical');
}};
