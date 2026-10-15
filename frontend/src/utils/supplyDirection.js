// Wording only. Direction signs do not change the supply point or verdict.
export function supplyDirection(assessment){
  const f=assessment?.foreignerNet,i=assessment?.institutionNet;
  if(!Number.isSafeInteger(f)||!Number.isSafeInteger(i))return null;
  const word=x=>x>0?'순매수':x<0?'순매도':'순매수 0';
  return `외국인 ${word(f)} · 기관 ${word(i)}`;
}
