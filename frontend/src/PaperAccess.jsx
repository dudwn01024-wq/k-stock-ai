import React, {useEffect, useState} from 'react';

// Server capability only; browser storage/query parameters never enable PAPER.
export default function PaperAccess({apiBase,active,onOpen,children}) {
  const [allowed,setAllowed]=useState(false);
  useEffect(()=>{
    let current=true;
    setAllowed(false);
    fetch(`${apiBase}/runtime-config`,{cache:'no-store'})
      .then(async response=>{
        const config=response.ok?await response.json():null;
        if(current)setAllowed(config?.mode==='personal-local'&&config?.paperEnabled===true);
      }).catch(()=>{if(current)setAllowed(false);});
    return ()=>{current=false;};
  },[apiBase]);
  if(!allowed)return null;
  return <>
    <button onClick={onOpen} className="border border-amber-500 text-amber-300 rounded px-3 py-2 mb-4">모의투자 / PAPER</button>
    {active?children:null}
  </>;
}
