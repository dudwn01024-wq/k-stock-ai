'use strict';
// Identity is the provider URL key. Raw poll records remain the immutable metadata versions.
const {createHash}=require('node:crypto');
const {searchArticleIdentity,searchArticleSignature,parsePubDate}=require('./observationSearchNews');
const articleMetadataSignature=item=>createHash('sha256').update(JSON.stringify([
  item?.title??null,item?.description??null])).digest('hex');

function compareArticleObservations(previous,current){
  const oldId=searchArticleIdentity(previous),newId=searchArticleIdentity(current);
  if(!oldId||!newId||!parsePubDate(previous?.pubDateRaw)||!parsePubDate(current?.pubDateRaw))
    return 'INVALID_ARTICLE';
  if(oldId!==newId){
    if(previous?.link&&previous.link===current?.link&&
      Boolean(previous?.originallink)!==Boolean(current?.originallink))
      return 'IDENTITY_MAPPING_CHANGED';
    if(previous?.link&&previous.link===current?.link&&
      previous?.originallink&&current?.originallink)
      return 'TRUE_IDENTITY_COLLISION';
    return 'DIFFERENT_IDENTITY';
  }
  if(previous.pubDateRaw!==current.pubDateRaw)return 'PUBDATE_CHANGED';
  if(previous.originallink!==current.originallink||previous.link!==current.link)
    return 'IDENTITY_MAPPING_CHANGED';
  if(previous.title!==current.title||previous.description!==current.description)
    return 'ARTICLE_METADATA_DRIFT';
  return searchArticleSignature(previous)===searchArticleSignature(current)?'SAME':'UNKNOWN_CONFLICT';
}

module.exports={articleMetadataSignature,compareArticleObservations};
