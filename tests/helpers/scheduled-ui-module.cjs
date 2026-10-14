'use strict';
// Actual pure frontend projector for VM-render suites; no client/effect execution.
const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const {transformSync}=createRequire(require.resolve('../../frontend/node_modules/vite/package.json'))('esbuild');
const component={exports:{}};
vm.runInNewContext(transformSync(fs.readFileSync(require.resolve('../../frontend/src/utils/scheduledSupply.js'),'utf8'),{format:'cjs'}).code,
  {module:component,exports:component.exports});
module.exports=component.exports;
