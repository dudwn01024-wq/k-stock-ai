import {PUBLIC_PAGE_METADATA,renderDefaultHead,renderRobots,renderSitemap} from './src/seo/publicMetadata.js';
import {POPULAR_STOCKS} from './src/stockCatalog.js';

const guidePaths=new Set([...Object.keys(PUBLIC_PAGE_METADATA),...POPULAR_STOCKS.map(({code})=>'/stocks/'+code)]);
const guideAliases=new Set([...guidePaths].filter(path=>path!=='/').flatMap(path=>[path+'.html',path+'/index.html']));

export function publicSearchMetadata(){
  let root;
  return {
    name:'public-search-metadata',
    configResolved(config){root=config.root;},
    configurePreviewServer(server){
      // Match the documented Render exact-route rewrites plus safe SPA fallback.
      server.middlewares.use((req,res,next)=>{
        const path=new URL(req.url,'http://preview.local').pathname.replace(/\/+$/,'')||'/';
        if(!['GET','HEAD'].includes(req.method)||guidePaths.has(path)||guideAliases.has(path)||
          path.startsWith('/assets/')||path.startsWith('/api/')||
          ['/index.html','/robots.txt','/sitemap.xml','/favicon.ico','/spa-fallback.html'].includes(path))return next();
        req.url='/spa-fallback.html';next();
      });
    },
    transformIndexHtml(html){
      if(!html.includes('<!-- PUBLIC_PAGE_META -->'))throw Error('PUBLIC_PAGE_META_MARKER_MISSING');
      return html.replace('<!-- PUBLIC_PAGE_META -->',renderDefaultHead()+'\n    <meta name="google-site-verification" content="1__oMF1AfA9fD1JOQqhj_DkpHHBxir3E79bzDqeBwRA" />');
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
