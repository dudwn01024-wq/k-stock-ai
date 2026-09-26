'use strict';

function resolveExecutionMode(mode, nodeEnv) {
  const paperEnabled=mode==='personal-local' && nodeEnv!=='production';
  return Object.freeze({mode:paperEnabled?'personal-local':'public',paperEnabled,
    host:paperEnabled?'127.0.0.1':'0.0.0.0'});
}

function installExecutionMode(app, config, {observation}={}) {
  if(!config.paperEnabled) {
    // Before CORS preflight and any future SPA/static fallback: all methods are 404.
    app.use('/api/paper',(req,res)=>res.status(404).json({error:'NOT_FOUND'}));
    app.use('/api/observation',(req,res)=>res.status(404).json({error:'NOT_FOUND'}));
  }
  app.use(require('cors')());
  app.get('/api/runtime-config', (req,res)=>{
    res.set('Cache-Control','no-store');
    res.json({mode:config.mode,paperEnabled:config.paperEnabled});
  });
  if(config.paperEnabled) {
    app.use('/api/observation',require('./observationApi').createObservationRouter(observation));
    app.use('/api/paper',require('./paperApi').createPaperRouter({allowLocalMutations:true}));
  }
}

module.exports={resolveExecutionMode,installExecutionMode};
