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
  set('link[rel="canonical"]','link',{rel:'canonical',href:meta.canonical});
}

// Head-only component: no visible markup, network, storage or analysis work.
export default function PageMeta({path='/',stockName=null}){
  useEffect(()=>{
    applyPageMeta(document,getPageMeta(path,stockName));
    return()=>applyPageMeta(document,getPageMeta('/'));
  },[path,stockName]);
  return null;
}
