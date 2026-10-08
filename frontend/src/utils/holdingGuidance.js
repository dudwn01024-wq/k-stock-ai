// Input validation only. The private judgment runs on the authenticated server.
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
export function parseAverageBuyPrice(value){
  if(typeof value==='number')return positive(value)?value:null;
  if(typeof value!=='string'||!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))return null;
  const number=Number(value);
  return positive(number)?number:null;
}
