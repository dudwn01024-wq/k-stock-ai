import {useEffect} from 'react';
import {getPageMeta} from '../seo/publicMetadata.js';

export function applyPageMeta(doc,meta){
  doc.title=meta.title;
  const set=(selector,tag,attributes)=>{
    const matches=Array.from(doc.head.querySelectorAll(selector));
    const node=matches.shift()||doc.createElement(tag);
    for(const duplicate of matches)duplicate.remove();
    for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);
    if(!node.parentNode)doc.head.appendChild(node);
  };
  set('meta[name="description"]','meta',{name:'description',content:meta.description});
  set('meta[name="robots"]','meta',{name:'robots',content:meta.robots});
  if(meta.canonical)set('link[rel="canonical"]','link',{rel:'canonical',href:meta.canonical});
  else for(const node of doc.head.querySelectorAll('link[rel="canonical"]'))node.remove();
}

// Head-only component: no visible markup, network, storage or analysis work.
export default function PageMeta({path='/',stockName=null}){
  useEffect(()=>{
    applyPageMeta(document,getPageMeta(path,stockName));
    // Each route owns its head. Cleanup must not briefly turn an error page
    // into the indexable home during route changes or StrictMode replay.
  },[path,stockName]);
  return null;
}
