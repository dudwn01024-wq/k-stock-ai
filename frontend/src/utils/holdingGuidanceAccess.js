// Explicit private POSTs only. No credential or personal-input persistence.
const messages={
  HOLDING_GUIDANCE_UNAVAILABLE:'현재 이용할 수 없는 비공개 기능입니다.',
  HOLDING_GUIDANCE_UNAUTHORIZED:'인증을 확인할 수 없습니다. 다시 잠금 해제해주세요.',
  HOLDING_GUIDANCE_RATE_LIMITED:'잠금 해제 시도가 제한되었습니다. 잠시 후 다시 시도해주세요.',
  HOLDING_GUIDANCE_INPUT_INVALID:'입력 내용을 확인해주세요.',
  HOLDING_GUIDANCE_DETAIL_UNAVAILABLE:'상세 자료가 만료되었습니다. 종목을 다시 조회해주세요.',
};
export async function holdingGuidancePost(baseUrl,action,body,token){
  if(!['unlock','evaluate'].includes(action))throw Error('요청을 확인할 수 없습니다.');
  const response=await fetch(baseUrl+'/stock/holding-guidance/'+action,{method:'POST',credentials:'omit',cache:'no-store',
    headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),
    signal:AbortSignal.timeout(10000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const code=Object.hasOwn(messages,data.error)?data.error:'HOLDING_GUIDANCE_UNAVAILABLE';
    throw Object.assign(Error(messages[code]),{code});}
  return data;
}
