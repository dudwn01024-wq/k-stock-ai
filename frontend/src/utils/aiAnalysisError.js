const expiryMessage='뉴스 정보가 만료되었습니다.';
const genericMessage='AI 해설을 가져오지 못했습니다.';
const serviceMessage='AI 해설 서비스를 일시적으로 이용하기 어렵습니다.';
const serviceDescription='잠시 후 다시 시도해 주세요.';
const causes={TIMEOUT:'AI 제공처 응답 시간이 초과되었습니다.',SERVICE_BUSY:'AI 제공처가 일시적으로 요청을 처리하지 못했습니다.',
  RATE_LIMITED:'AI 제공처의 요청 한도에 도달했습니다.',OUTPUT_LIMIT:'AI 답변이 출력 한도 안에서 완료되지 않았습니다.',
  INVALID_RESPONSE:'AI 제공처에서 완전한 해설 형식을 받지 못했습니다.',CONTENT_BLOCKED:'AI 제공처가 해설 생성을 제한했습니다.',
  REQUEST_REJECTED:'AI 제공처가 요청을 수락하지 않았습니다.',NETWORK_ERROR:'AI 제공처와의 통신을 완료하지 못했습니다.'};

// Presentation only. Does not refresh data or change the server snapshot policy.
export function aiAnalysisError(error){
  const message=typeof error==='string'?error:error?.message;
  const expired=error?.code==='DETAIL_NEWS_SNAPSHOT_UNAVAILABLE'||error?.status===410||
    message===expiryMessage||/^상세 뉴스 묶음이 만료되었거나 없습니다\./.test(message??'');
  if(expired)return {message:expiryMessage,title:expiryMessage,
    description:'종목을 다시 조회한 뒤 AI 해설을 요청해주세요.'};
  if(['GEMINI_ALL_MODELS_FAILED','GEMINI_UNAVAILABLE'].includes(error?.code)||
    message===serviceMessage+' '+serviceDescription){
    const reasons=Array.isArray(error?.failureReasons)?[...new Set(error.failureReasons)].filter(key=>Object.hasOwn(causes,key)):[];
    const description=reasons.length?reasons.map(key=>causes[key]).join(' ')+' 가격 계산 자료 부족과는 별개의 해설 오류입니다. '+serviceDescription:serviceDescription;
    return {message:serviceMessage+' '+description,title:serviceMessage,description};
  }
  return {message:message||genericMessage,title:genericMessage,
    description:message||'잠시 후 다시 요청해주세요.'};
}
