import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createServer} from 'vite';
import {escapeHtml,renderDefaultHead} from './src/seo/publicMetadata.js';

export async function writePublicGuides(root,outDir,template){
  // A middleware-only SSR loader: no listener, proxy, env files or analysis App.
  const server=await createServer({
    configFile:false,envDir:false,root,
    server:{middlewareMode:true,watch:null,ws:false},
    optimizeDeps:{noDiscovery:true,include:[]},
    plugins:[{name:'guide-only-imports',enforce:'pre',resolveId(id){
      if(/(?:^|\/)(?:App|StockAppRoute|router)\.jsx$|(?:^|\/)(?:utils|services)\//.test(id))
        throw Error('PRERENDER_ANALYSIS_IMPORT_FORBIDDEN');
    }}]
  });
  try{
    const {renderPublicGuides}=await server.ssrLoadModule('/prerender.jsx');
    if(!template.includes(renderDefaultHead())||!template.includes('<div id="root"></div>'))
      throw Error('PRERENDER_TEMPLATE_MARKER_MISSING');
    for(const {path,meta,body} of renderPublicGuides()){
      const head='<title>'+escapeHtml(meta.title)+'</title>\n    '+
        '<meta name="description" content="'+escapeHtml(meta.description)+'" />\n    '+
        '<meta name="robots" content="'+meta.robots+'" />\n    '+
        '<link rel="canonical" href="'+escapeHtml(meta.canonical)+'" />';
      const html=template.replace(renderDefaultHead(),head).replace('<div id="root"></div>',
        '<div id="root" data-prerendered="'+escapeHtml(path)+'">'+body+'</div>');
      // Vite resolves /guide via guide.html; directory hosts use guide/index.html.
      // Both are generated from the same canonical route and identical markup.
      for(const target of [resolve(outDir,'.'+path+'.html'),resolve(outDir,'.'+path,'index.html')]){
        await mkdir(dirname(target),{recursive:true});
        await writeFile(target,html,'utf8');
      }
    }
  }finally{await server.close();}
}
