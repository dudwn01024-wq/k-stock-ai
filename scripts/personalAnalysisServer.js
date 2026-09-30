'use strict';
// Dedicated personal server: no dotenv, public app, scheduler, provider, or runner import.
const path=require('node:path');
const {createPersonalAnalysisApp}=require('../services/personalAnalysisHttp');
const mode=process.env.KSTOCK_EXECUTION_MODE??'personal-local';
const roots=(process.env.KSTOCK_PERSONAL_ANALYSIS_ROOTS??'').split(path.delimiter)
  .filter(Boolean).map(value=>path.resolve(value));
const port=Number(process.env.KSTOCK_PERSONAL_ANALYSIS_PORT??5000);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('DASHBOARD_PORT_INVALID');
const app=createPersonalAnalysisApp({mode,roots});
app.listen(port,'127.0.0.1',()=>{
  process.stdout.write(`Personal analysis read-only server: http://127.0.0.1:${port}\n`);
});
