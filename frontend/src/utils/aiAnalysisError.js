const expiryMessage='뉴스 정보가 만료되었습니다.';
const genericMessage='AI 해설을 가져오지 못했습니다.';

// Presentation only. Does not refresh data or change the server snapshot policy.
export function aiAnalysisError(error){
  const message=typeof error==='string'?error:error?.message;
  const expired=error?.code==='DETAIL_NEWS_SNAPSHOT_UNAVAILABLE'||error?.status===410||
    message===expiryMessage||/^상세 뉴스 묶음이 만료되었거나 없습니다\./.test(message??'');
  if(expired)return {message:expiryMessage,title:expiryMessage,
    description:'종목을 다시 조회한 뒤 AI 해설을 요청해주세요.'};
  return {message:message||genericMessage,title:genericMessage,
    description:message||'잠시 후 다시 요청해주세요.'};
}
