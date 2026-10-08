import {renderDefaultHead,renderRobots,renderSitemap} from './src/seo/publicMetadata.js';

export function publicSearchMetadata(){
  let root;
  return {
    name:'public-search-metadata',
    configResolved(config){root=config.root;},
    transformIndexHtml(html){
      if(!html.includes('<!-- PUBLIC_PAGE_META -->'))throw Error('PUBLIC_PAGE_META_MARKER_MISSING');
      return html.replace('<!-- PUBLIC_PAGE_META -->',renderDefaultHead());
    },
    async writeBundle(options,bundle){
      const {writePublicGuides}=await import('./prerender-build.js');
      await writePublicGuides(root,options.dir,String(bundle['index.html'].source));
    },
    generateBundle(){
      // Regenerate the two public assets from the canonical origin. Their
      // checked-in public copies are generated, never a separate URL config.
      this.emitFile({type:'asset',fileName:'robots.txt',source:renderRobots()});
      this.emitFile({type:'asset',fileName:'sitemap.xml',source:renderSitemap()});
    }
  };
}
