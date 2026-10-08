'use strict';
// TEST_ONLY head DOM fixture. Browser QA also verifies the real DOM.
module.exports=()=>{
 const nodes=[];
 const head={appendChild(node){node.parentNode=head;nodes.push(node);return node;},
  querySelectorAll(selector){const [,tag,key,value]=selector.match(/^(\w+)\[(\w+)="([^"]+)"\]$/)||[];
   if(!tag)throw Error('TEST_ONLY_UNSUPPORTED_HEAD_SELECTOR');
   return nodes.filter(node=>node.tagName===tag&&node.getAttribute(key)===value);}};
 return {title:'K-Stock AI',head,getElementById:()=>null,createElement(tagName){
  const attributes={};return {tagName,parentNode:null,setAttribute(key,value){attributes[key]=String(value);},getAttribute(key){return attributes[key]??null;},
   remove(){const index=nodes.indexOf(this);if(index>=0)nodes.splice(index,1);this.parentNode=null;}};
 }};
};
