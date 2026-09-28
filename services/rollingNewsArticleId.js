'use strict';
const {createHash}=require('node:crypto');

// Stable internal ID for one article identity within one archive. Source URLs stay unchanged.
function articleIdFor(archiveId,identity){
  if(typeof archiveId!=='string'||!archiveId||typeof identity!=='string'||!identity)
    throw Error('NEWS_ARTICLE_IDENTITY_INVALID');
  return `rna_${createHash('sha256').update(archiveId).update('\0').update(identity).digest('hex')}`;
}
module.exports={articleIdFor};
