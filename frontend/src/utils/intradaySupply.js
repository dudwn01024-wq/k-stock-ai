export const formatEstimateQuantity=value=>Number.isSafeInteger(value)?new Intl.NumberFormat('ko-KR',{signDisplay:'exceptZero'}).format(value)+'주':'미확인';
export function estimateQuantityDiagnosis(state,format){
  if(state==='PRESENT')return null;
  if(state==='MISSING')return format==='FIELD_ABSENT'?'응답에 수량 필드가 없습니다.':
    ['NULL','UNDEFINED','EMPTY_STRING','WHITESPACE_STRING'].includes(format)?'응답 수량이 빈 값입니다.':'응답 수량이 없거나 빈 값입니다.';
  const labels={DECIMAL_STRING:'소수점 문자열을 받아 정수 수량으로 확인하지 못했습니다.',
    GROUPED_STRING:'쉼표가 포함된 문자열을 받아 정수 수량으로 확인하지 못했습니다.',
    INTEGER_STRING:'정수 문자열이 허용 범위를 벗어나 확인하지 못했습니다.',
    DECIMAL_NUMBER:'소수 숫자를 받아 정수 수량으로 확인하지 못했습니다.',
    UNSAFE_NUMBER:'숫자가 안전한 정수 범위를 벗어났습니다.',
    NON_FINITE_NUMBER:'유효한 숫자로 확인하지 못했습니다.',OTHER_STRING:'지원하지 않는 문자열 형식입니다.',OTHER_TYPE:'지원하지 않는 값 형식입니다.'};
  return state==='INVALID'?(Object.prototype.hasOwnProperty.call(labels,format)?labels[format]:'수량이 정수 형식이나 허용 범위를 충족하지 않습니다.'):'수량 상태를 확인하지 못했습니다.';
}
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
