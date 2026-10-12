'use strict';
// One-owner access only. No provider, account, order, or credential-generation API.
const crypto=require('node:crypto'),path=require('node:path');
const COOKIE='__Host-kstock-site',TTL_MS=60*60*1000,WINDOW_MS=15*60*1000,MAX_FAILURES=5,MAX_SESSIONS=50;
const issue=(code,status)=>Object.assign(Error(code),{code,status});
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;
  const x=crypto.createHash('sha256').update(a).digest(),y=crypto.createHash('sha256').update(b).digest();return crypto.timingSafeEqual(x,y);};
function createPrivateSiteAccess({env={},now=Date.now,random=()=>crypto.randomBytes(24),testOnly=false}={}){
  const password=env.SITE_ACCESS_PASSWORD,secret=env.SITE_SESSION_SECRET;
  let origin=null;
  try{const u=new URL(env.SITE_PUBLIC_ORIGIN);if((u.protocol==='https:'||(testOnly===true&&u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))&&
    !u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash)origin=u.origin;}catch{}
  const enabled=typeof password==='string'&&password.length>=12&&Buffer.byteLength(password)<=1024&&
    typeof secret==='string'&&Buffer.byteLength(secret)>=32&&Buffer.byteLength(secret)<=4096&&origin!==null;
  const hmac=(scope,value)=>crypto.createHmac('sha256',secret).update(scope+'\0'+value).digest('base64url');
  const verifier=enabled?crypto.scryptSync(password,hmac('password-salt',origin),32):null;
  const sessions=new Map(),attempts=new Map();let totalFailures=0,globalUntil=0;
  const prune=()=>{const time=now();for(const [id,s]of sessions)if(time>=s.expiresAt)sessions.delete(id);
    for(const [id,a]of attempts)if(time>=a.until)attempts.delete(id);if(time>=globalUntil){totalFailures=0;globalUntil=time+WINDOW_MS;}};
  const ready=()=>{if(!enabled)throw issue('SITE_ACCESS_UNAVAILABLE',503);};
  const checkOrigin=(value,required=false)=>{ready();if((required&&value!==origin)||(value!==undefined&&value!==origin))throw issue('SITE_ORIGIN_REJECTED',403);};
  function session(cookie){
    ready();prune();if(typeof cookie!=='string'||cookie.length>8192)throw issue('SITE_AUTH_REQUIRED',401);
    const values=cookie.split(';').map(x=>x.trim()).filter(x=>x.startsWith(COOKIE+'='));
    if(values.length!==1)throw issue('SITE_AUTH_REQUIRED',401);
    const value=values[0].slice(COOKIE.length+1),match=/^([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/.exec(value);
    if(!match||!equal(match[2],hmac('session',match[1])))throw issue('SITE_AUTH_REQUIRED',401);
    const s=sessions.get(match[1]);if(!s||now()>=s.expiresAt)throw issue('SITE_AUTH_REQUIRED',401);
    return {id:match[1],expiresAt:s.expiresAt,csrfToken:hmac('csrf',match[1])};
  }
  return {enabled,origin,session,
    login(value,peer,requestOrigin){
      ready();checkOrigin(requestOrigin,true);prune();
      const key=typeof peer==='string'?peer:'unknown',a=attempts.get(key);
      if((a?.count??0)>=MAX_FAILURES||totalFailures>=20||(!a&&attempts.size>=1000))throw issue('SITE_LOGIN_RATE_LIMITED',429);
      const valid=typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=1024;
      const candidate=valid?crypto.scryptSync(value,hmac('password-salt',origin),32):null;
      if(!candidate||!crypto.timingSafeEqual(candidate,verifier)){
        attempts.set(key,{count:(a?.count??0)+1,until:a?.until??now()+WINDOW_MS});totalFailures++;
        throw issue('SITE_AUTH_REQUIRED',401);
      }
      attempts.delete(key);if(sessions.size>=MAX_SESSIONS)throw issue('SITE_SESSION_LIMIT',429);
      const bytes=random();if(!Buffer.isBuffer(bytes)||bytes.length!==24)throw issue('SITE_ACCESS_UNAVAILABLE',503);
      const id=bytes.toString('base64url');if(sessions.has(id))throw issue('SITE_ACCESS_UNAVAILABLE',503);
      const expiresAt=now()+TTL_MS;sessions.set(id,{expiresAt});
      return {cookie:COOKIE+'='+id+'.'+hmac('session',id)+'; Path=/; Max-Age='+TTL_MS/1000+'; Secure; HttpOnly; SameSite=Strict',expiresAt};
    },
    check(cookie,csrf,requestOrigin,{write=false}={}){const s=session(cookie);checkOrigin(requestOrigin,write);
      if(!equal(csrf,s.csrfToken))throw issue('SITE_CSRF_REJECTED',403);return s;},
    logout(cookie,csrf,requestOrigin){const s=this.check(cookie,csrf,requestOrigin,{write:true});sessions.delete(s.id);},
    clearCookie:()=>COOKIE+'=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict'
  };
}
function installPrivateSite(app,{env={},access=createPrivateSiteAccess({env}),dist=path.resolve(__dirname,'../frontend/dist')}={}){
  const express=require('express'),{loginHtml,loginScript,loginCss}=require('./privateSiteLogin');
  const deny=(res,error)=>{const status=[401,403,429,503].includes(error?.status)?error.status:503;
    if(status===429)res.set('Retry-After',String(WINDOW_MS/1000));return res.status(status).json({error:error?.code??'SITE_ACCESS_UNAVAILABLE'});};
  app.use((req,res,next)=>{res.set('Cache-Control','no-store');res.set('Vary','Cookie');res.set('X-Robots-Tag','noindex, nofollow, noarchive');
    res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','no-referrer');res.set('X-Frame-Options','DENY');
    res.set('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");next();});
  // Keep private trading/collection surfaces closed, even if a local-mode switch is supplied.
  for(const prefix of ['/api/paper','/api/observation'])app.use(prefix,(req,res)=>res.status(404).json({error:'NOT_FOUND'}));
  app.get('/healthz',(req,res)=>res.status(204).end());
  app.get('/login',(req,res)=>{try{access.session(req.headers.cookie);return res.redirect(303,'/');}catch{}
    res.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.status(access.enabled?200:503).type('html').send(loginHtml(access.enabled));});
  app.get('/site-login.js',(req,res)=>res.type('application/javascript').send(loginScript));
  app.get('/site-login.css',(req,res)=>res.type('text/css').send(loginCss));
  const json=express.json({limit:'2kb',strict:true});
  app.post('/api/site-access/login',json,(req,res)=>{try{
    if(Object.keys(req.query).length||!req.body||Array.isArray(req.body)||Object.keys(req.body).length!==1||!Object.hasOwn(req.body,'password'))throw issue('SITE_INPUT_INVALID',403);
    const s=access.login(req.body.password,req.socket?.remoteAddress,req.headers.origin);
    res.set('Set-Cookie',s.cookie);res.json({expiresAt:new Date(s.expiresAt).toISOString()});
  }catch(e){deny(res,e);}finally{if(req.body&&typeof req.body==='object')delete req.body.password;}});
  app.all(['/login','/site-login.js','/site-login.css','/healthz','/api/site-access/login'],(req,res)=>res.status(405).json({error:'METHOD_NOT_ALLOWED'}));
  app.use((error,req,res,next)=>{if(req.path.toLowerCase().replace(/\/+$/,'')!=='/api/site-access/login')return next(error);
    res.status(error.type==='entity.too.large'?413:400).json({error:'SITE_INPUT_INVALID'});});
  // Gate every route, including future routes and static fallbacks, before body parsing or providers.
  app.use((req,res,next)=>{try{
    const pathname=req.path.toLowerCase(),api=pathname==='/api'||pathname.startsWith('/api/');
    req.siteSession=access.session(req.headers.cookie);
    if(req.headers.origin!==undefined&&req.headers.origin!==access.origin)throw issue('SITE_ORIGIN_REJECTED',403);
    if((api&&pathname!=='/api/site-access/session')||!['GET','HEAD'].includes(req.method))access.check(req.headers.cookie,req.headers['x-site-csrf'],req.headers.origin,
      {write:!['GET','HEAD'].includes(req.method)});
    next();
  }catch(e){if(!/^\/api(?:\/|$)/i.test(req.path)&&e.status===401)return res.redirect(303,'/login');deny(res,e);}});
  app.get('/api/site-access/session',(req,res)=>res.json({expiresAt:new Date(req.siteSession.expiresAt).toISOString(),csrfToken:req.siteSession.csrfToken}));
  app.post('/api/site-access/logout',(req,res)=>{try{access.logout(req.headers.cookie,req.headers['x-site-csrf'],req.headers.origin);
    res.set('Set-Cookie',access.clearCookie());res.set('Clear-Site-Data','"cache", "storage"');res.status(204).end();}catch(e){deny(res,e);}});
  const staticFiles=express.static(dist,{index:false,maxAge:0,etag:false,lastModified:false,setHeaders:res=>res.setHeader('Cache-Control','no-store')});
  return {access,serveApp(req,res,next){
    if(/^\/api(?:\/|$)/i.test(req.path))return next();
    if(!['GET','HEAD'].includes(req.method))return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
    staticFiles(req,res,()=>res.sendFile('index.html',{root:dist,headers:{'Cache-Control':'no-store'}},error=>{if(error&&!res.headersSent)res.status(503).json({error:'SITE_UI_UNAVAILABLE'});}));
  }};
}
module.exports={createPrivateSiteAccess,installPrivateSite,COOKIE,TTL_MS,WINDOW_MS,MAX_FAILURES};
