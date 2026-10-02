// Separate request generations prevent late list/detail/comparison responses mixing.
export function createHistoryLoader(service,publish){
  let generation=0;
  return {
    cancel(){generation++;},
    async list(page=1,symbol=''){
      const run=++generation;publish({loading:true,error:null,detail:null,comparison:null});
      try{const list=await service.getHistory({page,symbol});if(run===generation)publish({list,loading:false});}
      catch(e){if(run===generation)publish({loading:false,error:e.message});}
    },
    async detail(scanId){
      const run=++generation;publish({loading:true,error:null,detail:null,comparison:null});
      try{const detail=await service.getHistoryDetail(scanId);if(detail.scanId!==scanId)throw Error('이력 실행 식별자가 일치하지 않습니다.');if(run===generation)publish({detail,loading:false});}
      catch(e){if(run===generation)publish({loading:false,error:e.message});}
    },
    async compare(before,after){
      const run=++generation;publish({loading:true,error:null,comparison:null});
      try{const comparison=await service.compareHistory(before,after);if(comparison.beforeScanId!==before||comparison.afterScanId!==after)throw Error('비교 실행 식별자가 일치하지 않습니다.');if(run===generation)publish({comparison,loading:false});}
      catch(e){if(run===generation)publish({loading:false,error:e.message});}
    }
  };
}
export const historyAIStatus={DISABLED:'AI 설명 미실행',NOT_REQUESTED:'AI 미요청',NOT_REQUIRED:'AI 대상 없음',PENDING:'AI 진행 중',COMPLETED:'AI 설명 완료',PARTIAL:'AI 설명 부분 완료',FAILED:'AI 실패',INTERRUPTED_UNKNOWN:'AI 완료·중단 미확인'};
export const historyChangeStatus={NEWLY_SELECTED:'새로 선정',RETAINED:'계속 선정',NO_LONGER_SELECTED:'이번 실행에서 후보 제외',NOT_SELECTED:'두 실행 모두 후보 아님',NOT_COMPARABLE:'자료 부족·조회 실패로 비교 불가'};
