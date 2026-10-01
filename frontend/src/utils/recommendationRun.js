export function normalizeCandidates(result){
  if(!['priority','chase','watch'].every(key=>Array.isArray(result?.[key])))throw Error('후보 조회 응답을 확인하지 못했습니다.');
  const recommendations=[...result.priority,...result.chase,...result.watch];
  return {...result,recommendations,universeSize:result.scannedCount??null,
    recommendationCount:result.candidateCount??recommendations.length,
    priorityCandidateCount:result.priorityCount??result.priority.length,
    chaseCautionCount:result.chaseCount??result.chase.length,watchCandidateCount:result.watchCount??result.watch.length};
}

// One generation owns both candidate and AI state, including failures/finalizers.
export function createRecommendationLoader(service,publish){
  let generation=0;
  return {
    cancel(){generation++;},
    async load(){
      const run=++generation;
      const update=patch=>{if(run===generation)publish(patch);};
      update({data:null,loading:true,error:null,ai:null,aiLoading:false,aiError:null});
      let data;
      try{data=normalizeCandidates(await service.getRecommendations());}
      catch(error){update({loading:false,error:error.message||'후보를 불러오지 못했습니다.'});return;}
      if(run!==generation)return;
      update({data,loading:false});
      if(!data.scanId){
        update({aiError:'서버 응답에 scanId가 없어 AI 설명을 연결할 수 없습니다. 서버 업데이트 후 후보를 다시 조회해 주세요.'});return;
      }
      if(![...data.priority,...data.chase].length){
        update({ai:{scanId:data.scanId,aiStatus:'NOT_REQUIRED',ai:[]}});return;
      }
      update({aiLoading:true});
      try{
        const ai=await service.getRecommendationAI(data.scanId);
        if(ai.scanId!==data.scanId)throw Error('AI 설명의 분석 실행이 일치하지 않습니다. 후보를 다시 조회해 주세요.');
        update({ai,aiError:ai.aiError??null});
      }catch(error){update({aiError:error.message||'AI 설명을 가져오지 못했습니다.'});}
      finally{update({aiLoading:false});}
    }
  };
}
