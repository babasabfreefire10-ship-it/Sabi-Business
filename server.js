const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');
const sessions = new Map();
const attempts = new Map();
const cookie = (req, name) => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1);
const privateCookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const origin = 'https://sabi-business.vibekit.bot';
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('sabi-data.sqlite');
db.exec('CREATE TABLE IF NOT EXISTS professionals (id INTEGER PRIMARY KEY, name TEXT NOT NULL, trade TEXT NOT NULL, city TEXT NOT NULL, phone TEXT NOT NULL, description TEXT NOT NULL, created TEXT NOT NULL)');
const allowed = ['Elektriçist','Hidraulik','Teknik elektroshtëpiak','Bojaxhi','Tjetër'];
const server = http.createServer((req,res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (status,data) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(data)); };
  if(req.method === 'GET' && url.pathname === '/studio-login') {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const login = new URL('https://app.vibekit.bot/auth/app/owner');
    login.searchParams.set('return_to', origin + '/vk-owner'); login.searchParams.set('code_challenge', challenge);
    res.writeHead(302, {'Location': login.toString(), 'Set-Cookie':privateCookie('sabi_verifier',verifier,300),'Cache-Control':'no-store'}); return res.end();
  }
  if(req.method === 'GET' && url.pathname === '/vk-owner') {
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'"});
    return res.end(`<!doctype html><html lang="sq"><meta name="viewport" content="width=device-width"><title>Hyrja në studio</title><body><p id="status">Duke verifikuar hyrjen…</p><script>const p=new URLSearchParams(location.hash.slice(1));const code=p.get('vk_sign_in');history.replaceState(null,'',location.pathname);if(!code){document.querySelector('#status').textContent='Hyrja dështoi. Kthehu dhe provo përsëri.'}else{fetch('/api/owner-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})}).then(r=>{if(!r.ok)throw Error();location.replace('/studio')}).catch(()=>document.querySelector('#status').textContent='Hyrja dështoi. Kthehu dhe provo përsëri.')}<\/script></body></html>`);
  }
  if(req.method === 'POST' && url.pathname === '/api/owner-login') {
    let raw=''; req.on('data',c=>{raw+=c;if(raw.length>5000)req.destroy()}); return req.on('end',async()=>{try {
      const verifier=cookie(req,'sabi_verifier'), code=JSON.parse(raw).code;
      if(!verifier || typeof code!=='string' || !process.env.VIBEKIT_SIGN_IN_URL || !process.env.VIBEKIT_AI_TOKEN)return json(401,{error:'Hyrja dështoi.'});
      const r=await fetch(process.env.VIBEKIT_SIGN_IN_URL,{method:'POST',headers:{Authorization:`Bearer ${process.env.VIBEKIT_AI_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({code,code_verifier:verifier})});
      const data=await r.json(); if(!r.ok || data.user?.owner!==true)return json(403,{error:'Vetëm pronari mund të hyjë.'});
      const token=crypto.randomBytes(32).toString('base64url'); sessions.set(token,{expires:Date.now()+8*60*60*1000,unlocked:false});
      res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':[privateCookie('sabi_owner',token,28800),privateCookie('sabi_verifier','',0)],'Cache-Control':'no-store'});res.end('{"ok":true}');
    }catch{return json(401,{error:'Hyrja dështoi.'})}});
  }
  if(req.method === 'GET' && url.pathname === '/studio') {
    const token=cookie(req,'sabi_owner'), session=sessions.get(token); if(!session || session.expires<Date.now()){res.writeHead(302,{Location:'/studio-login'});return res.end()}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return fs.createReadStream(session.unlocked ? 'studio.html' : 'studio-code.html').pipe(res);
  }
  if(req.method === 'POST' && url.pathname === '/api/studio-unlock') {
    const token=cookie(req,'sabi_owner'), session=sessions.get(token); if(!session || session.expires<Date.now())return json(401,{error:'Hyr përsëri si pronar.'});
    if(req.headers.origin !== origin)return json(403,{error:'Kërkesë e palejuar.'});
    const count=attempts.get(token) || {n:0,until:0}; if(count.until>Date.now())return json(429,{error:'Shumë tentativa. Provo pas 15 minutash.'});
    let raw='';req.on('data',c=>{raw+=c;if(raw.length>3000)req.destroy()});return req.on('end',()=>{try{
      const configured=process.env.STUDIO_ACCESS_CODE, supplied=JSON.parse(raw).code;
      if(!configured)return json(503,{error:'Kodi nuk është konfiguruar ende.'});
      if(typeof supplied!=='string'||supplied.length>200)return json(400,{error:'Kodi nuk është i vlefshëm.'});
      const a=crypto.createHash('sha256').update(configured).digest(), b=crypto.createHash('sha256').update(supplied).digest();
      if(!crypto.timingSafeEqual(a,b)){count.n++; if(count.n>=5){count.n=0;count.until=Date.now()+15*60*1000}attempts.set(token,count);return json(403,{error:'Kodi nuk është i saktë.'})}
      attempts.delete(token);session.unlocked=true;return json(200,{ok:true});
    }catch{return json(400,{error:'Kërkesë e pavlefshme.'})}});
  }
  if(req.method === 'POST' && url.pathname === '/api/design') {
    const token=cookie(req,'sabi_owner'), session=sessions.get(token); if(!session || session.expires<Date.now() || !session.unlocked)return json(401,{error:'Hyr dhe zhblloko studion private.'});
    if(req.headers.origin !== origin)return json(403,{error:'Kërkesë e palejuar.'});
    let raw='';req.on('data',c=>{raw+=c;if(raw.length>10000)req.destroy()});return req.on('end',async()=>{try{
      const prompt=String(JSON.parse(raw).prompt||'').trim(); if(prompt.length<10||prompt.length>2000)return json(400,{error:'Përshkruaje dizajnin me 10–2000 karaktere.'});
      if(!process.env.VIBEKIT_AI_URL || !process.env.VIBEKIT_AI_TOKEN)return json(503,{error:'Shërbimi AI nuk është ende i disponueshëm.'});
      const r=await fetch(process.env.VIBEKIT_AI_URL+'/image',{method:'POST',headers:{Authorization:`Bearer ${process.env.VIBEKIT_AI_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({prompt})});
      const data=await r.json(); if(!r.ok)return json(r.status,{error:r.status===402?'Nuk ka kredite të mjaftueshme për imazhe.':r.status===429?'Është arritur kufiri i përdorimit. Provo më vonë.':'Krijimi nuk u krye. Provo më vonë.'});
      if(!data.image)return json(502,{error:'Nuk u kthye një imazh.'});return json(200,{image:data.image});
    }catch{return json(502,{error:'Nuk u lidhëm me shërbimin AI.'})}});
  }
  if(req.method === 'GET' && url.pathname === '/') { res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); return fs.createReadStream('index.html').pipe(res); }
  if(req.method === 'GET' && url.pathname === '/api/professionals') {
    const trade = (url.searchParams.get('trade') || '').slice(0,60), city = (url.searchParams.get('city') || '').trim().slice(0,80);
    return json(200, db.prepare('SELECT id,name,trade,city,phone,description FROM professionals WHERE (? = \'\' OR trade = ?) AND (? = \'\' OR lower(city) LIKE lower(?)) ORDER BY id DESC LIMIT 100').all(trade,trade,city,`%${city}%`));
  }
  if(req.method === 'POST' && url.pathname === '/api/professionals') {
    let raw=''; req.on('data',chunk => { raw += chunk; if(raw.length > 10000) req.destroy(); });
    return req.on('end',() => { try {
      const input = JSON.parse(raw); const name=String(input.name||'').trim(), trade=String(input.trade||'').trim(), city=String(input.city||'').trim(), phone=String(input.phone||'').trim(), description=String(input.description||'').trim();
      if(name.length < 2 || name.length > 80 || !allowed.includes(trade) || city.length < 2 || city.length > 80 || !/^[+0-9 ()-]{7,25}$/.test(phone) || description.length < 10 || description.length > 400 || input.consent !== true) return json(400,{error:'Plotëso të gjitha fushat saktë dhe prano publikimin.'});
      db.prepare('INSERT INTO professionals (name,trade,city,phone,description,created) VALUES (?,?,?,?,?,?)').run(name,trade,city,phone,description,new Date().toISOString());
      return json(201,{ok:true});
    } catch { return json(400,{error:'Të dhënat nuk u dërguan saktë.'}); } });
  }
  json(404,{error:'Nuk u gjet.'});
});
server.listen(process.env.PORT || 3000, '0.0.0.0');
