export const formatEstimateQuantity=value=>Number.isSafeInteger(value)?new Intl.NumberFormat('ko-KR',{signDisplay:'exceptZero'}).format(value)+'주':'미확인';
export const estimateError=code=>({KIS_ESTIMATE_UNAVAILABLE:'장중 추정 수급을 활성화할 준비가 되지 않았습니다.',
  KIS_ESTIMATE_RATE_LIMITED:'조회 한도 또는 간격에 도달했습니다. 자동 재시도하지 않습니다.',
  KIS_ESTIMATE_BUSY:'다른 수동 조회가 진행 중입니다.',KIS_ESTIMATE_TIMEOUT:'조회 제한시간을 넘겼습니다. 이전 결과는 표시하지 않습니다.',
  KIS_ESTIMATE_SYMBOL_INVALID:'현재 기능은 숫자 6자리 종목코드만 지원합니다.'}[code]||'장중 추정 수급을 가져오지 못했습니다. 자동 재시도하지 않습니다.');
export async function readEstimate(url,{fetchImpl=fetch,signal,manual=false}={}){
  const response=await fetchImpl(url,{method:'GET',credentials:'same-origin',cache:'no-store',signal,
    headers:manual?{'x-kis-estimate-intent':'manual'}:{}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok){const seconds=Number(response.headers.get('retry-after'));
    throw Object.assign(Error(estimateError(body.error)),{code:body.error,retryAfterSeconds:Number.isSafeInteger(seconds)&&seconds>0&&seconds<=900?seconds:null});}
  return body;
}
