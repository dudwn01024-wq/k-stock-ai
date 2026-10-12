// Session transport only: no passwords, persistent tokens, or analysis trigger.
export async function startPrivateSiteClient(mount,{window:win=window,document:doc=document}={}){
  const nativeFetch=win.fetch.bind(win);let session=null,timer=null,checking=false;
  const hide=()=>{doc.documentElement.style.visibility='hidden';};
  const lock=()=>{session=null;if(timer)win.clearTimeout(timer);hide();
    try{win.sessionStorage.clear();win.localStorage.clear();}catch{}
    win.location.replace('/login');};
  async function check(){
    if(checking)return;checking=true;hide();
    try{const r=await nativeFetch('/api/site-access/session',{credentials:'same-origin',cache:'no-store'});
      if(!r.ok)throw Error();const next=await r.json(),expiry=Date.parse(next.expiresAt);
      if(typeof next.csrfToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(next.csrfToken)||!Number.isFinite(expiry)||expiry<=Date.now())throw Error();
      session={...next,expiry};if(timer)win.clearTimeout(timer);timer=win.setTimeout(lock,Math.max(0,expiry-Date.now()));
      doc.documentElement.style.visibility='';return true;
    }catch{lock();return false;}finally{checking=false;}
  }
  if(!await check())return;
  win.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,win.location.origin);
    if(url.origin!==win.location.origin)throw Error('SITE_CROSS_ORIGIN_REQUEST_REJECTED');
    if(!session||Date.now()>=session.expiry){lock();throw Error('SITE_AUTH_REQUIRED');}
    const headers=new Headers(typeof input==='string'?options.headers:input.headers);
    if(options.headers)for(const [k,v]of new Headers(options.headers))headers.set(k,v);
    if(url.pathname.startsWith('/api/'))headers.set('X-Site-CSRF',session.csrfToken);
    const response=await nativeFetch(input,{...options,headers,credentials:'same-origin',cache:'no-store'});
    if(response.status===401){lock();throw Error('SITE_AUTH_REQUIRED');}return response;
  };
  const bar=doc.createElement('nav');bar.className='private-site-bar';bar.setAttribute('aria-label','비공개 접속');
  const label=doc.createElement('span');label.textContent='비공개 접속 · 1시간 후 다시 인증';
  const button=doc.createElement('button');button.type='button';button.textContent='로그아웃';
  button.addEventListener('click',async()=>{button.disabled=true;try{await win.fetch('/api/site-access/logout',{method:'POST'});}finally{lock();}});
  bar.append(label,button);doc.body.prepend(bar);
  win.addEventListener('pagehide',hide);
  win.addEventListener('pageshow',event=>{if(event.persisted)void check();});
  doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState==='visible')void check();});
  mount();
}
