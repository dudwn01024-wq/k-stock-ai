export const outcomeStatusLabel=status=>({
  READY:'관찰 완료',PENDING:'거래일 자료 대기',NOT_COLLECTED:'수집 대기',
  TRACKING_BLOCKED_NO_BASELINE:'기준 자료 부족',LOOKUP_RETRY_REQUIRED:'재수집 필요',
  BACKFILL_WINDOW_UNAVAILABLE:'조회 범위 밖'
}[status]||'상태 미확인');
export function createOutcomeLoader(service,publish){
  let generation=0;
  return {
    cancel(){generation++;},
    async load(scanId){
      const current=++generation;publish({data:null,loading:true,error:null});
      try{
        const value=await service.getRecommendationOutcomes(scanId);
        if(value?.scanId!==scanId||value.schemaVersion!=='RECOMMENDATION_OUTCOME_V1'||!Array.isArray(value.candidates)||!Array.isArray(value.summary))
          throw Error('가격 변화 기록의 실행·형식을 확인할 수 없습니다.');
        if(current===generation)publish({data:value,loading:false,error:null});
      }catch(error){if(current===generation)publish({data:null,loading:false,error:error.message||'저장된 가격 변화 자료를 읽지 못했습니다.'});}
    }
  };
}
