'use strict';

// Test-only export probes. Restore even when installing a later probe fails.
function patchFunctions(specs, wrap){
  const undo=[];
  try{
    for(const {module,keys} of specs){
      for(const key of keys){
        const original=module[key];
        if(typeof original!=='function')throw Error('TEST_PROBE_TARGET_INVALID');
        module[key]=wrap(original,key,module);
        undo.push(()=>{module[key]=original;});
      }
    }
  }catch(error){for(const restore of undo.reverse())restore();throw error;}
  return ()=>{for(const restore of undo.reverse())restore();};
}

// Reload only named test subjects so destructured imports capture this test's probes.
function reloadForTest(names){
  const prior=[];
  try{
    const loaded=names.map(name=>{
      const id=require.resolve(name);
      prior.push([id,require.cache[id]]);
      delete require.cache[id];
      return require(name);
    });
    return {loaded,restore(){
      for(const [id,cached] of prior.reverse()){
        if(cached)require.cache[id]=cached;else delete require.cache[id];
      }
    }};
  }catch(error){
    for(const [id,cached] of prior.reverse()){
      if(cached)require.cache[id]=cached;else delete require.cache[id];
    }
    throw error;
  }
}

module.exports={patchFunctions,reloadForTest};
