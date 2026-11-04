// SABI BUSINESS V2 API additions. Merge these routes into the existing worker.js routeApi()
// This file is a standalone replacement worker for the V2 endpoints and static assets.
const COOKIE="sabi_session";
function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8",...headers}})}
function cookieValue(req,name){const raw=req.headers.get("Cookie")||"";const x=raw.split(";").map(v=>v.trim()).find(v=>v.startsWith(name+"="));return x?decodeURIComponent(x.slice(name.length+1)):null}
async function sha(v){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function currentUser(req,env){const t=cookieValue(req,COOKIE);if(!t)return null;return await env.DB.prepare(`SELECT u.id,u.email,u.role,u.business_name,u.language,b.id AS business_id FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN businesses b ON b.owner_user_id=u.id WHERE s.token_hash=? AND s.expires_at>datetime('now')`).bind(await sha(t)).first()}
async function readBody(req){try{return await req.json()}catch{return {}}}
function slug(){return crypto.randomUUID().replaceAll("-","").slice(0,16)}
function safeText(v,max=200){return String(v??"").trim().slice(0,max)}
async function api(req,env){
 const u=new URL(req.url),p=u.pathname,m=req.method.toUpperCase();
 if(p.startsWith("/api/public/menu/")&&m==="GET"){
  const q=safeText(p.split("/").pop(),80);
  const table=await env.DB.prepare(`SELECT t.id,t.table_name,b.id AS business_id,b.name AS business_name FROM tables t JOIN businesses b ON b.id=t.business_id WHERE t.qr_slug=? AND t.is_active=1`).bind(q).first();
  if(!table)return json({error:"Menu nuk u gjet."},404);
  const products=await env.DB.prepare(`SELECT p.id,p.name,p.description,p.price_cents,p.image_url,c.name AS category FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.business_id=? AND p.is_available=1 ORDER BY c.sort_order,p.name`).bind(table.business_id).all();
  return json({business:{name:table.business_name},table:{name:table.table_name},products:products.results||[]});
 }
 const user=await currentUser(req,env);if(!user)return json({error:"Duhet të hysh në llogari."},401);
 if(user.role!=="business"||!user.business_id)return json({error:"Ky funksion është për llogaritë e biznesit."},403);
 const bid=user.business_id;
 if(p==="/api/v2/overview"&&m==="GET"){
  const stats=await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM products WHERE business_id=?) products,(SELECT COUNT(*) FROM orders WHERE business_id=? AND status IN ('new','accepted','preparing')) active_orders,(SELECT COUNT(*) FROM reservations WHERE business_id=? AND status='pending') pending_reservations,(SELECT COALESCE(SUM(total_cents),0) FROM orders WHERE business_id=? AND status='completed') completed_revenue`).bind(bid,bid,bid,bid).first();
  const orders=await env.DB.prepare(`SELECT id,customer_name,total_cents,status,created_at FROM orders WHERE business_id=? ORDER BY created_at DESC LIMIT 15`).bind(bid).all();
  return json({stats,orders:orders.results||[]});
 }
 if(p==="/api/v2/products"&&m==="GET"){
  const r=await env.DB.prepare(`SELECT p.*,c.name category FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.business_id=? ORDER BY p.created_at DESC`).bind(bid).all();return json({products:r.results||[]});
 }
 if(p==="/api/v2/products"&&m==="POST"){
  const d=await readBody(req),name=safeText(d.name,100),description=safeText(d.description,500),price=Number(d.priceCents);
  if(name.length<2||!Number.isInteger(price)||price<0||price>100000000)return json({error:"Kontrollo emrin dhe çmimin."},400);
  const id=crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO products(id,business_id,name,description,price_cents,image_url,is_available,created_at) VALUES(?,?,?,?,?,?,1,datetime('now'))`).bind(id,bid,name,description,price,safeText(d.imageUrl,500)).run();
  return json({ok:true,id},201);
 }
 if(p.startsWith("/api/v2/products/")&&m==="DELETE"){
  const id=safeText(p.split("/").pop(),80);await env.DB.prepare("DELETE FROM products WHERE id=? AND business_id=?").bind(id,bid).run();return json({ok:true});
 }
 if(p==="/api/v2/tables"&&m==="GET"){
  const r=await env.DB.prepare("SELECT id,table_name,qr_slug,seats,is_active FROM tables WHERE business_id=? ORDER BY created_at DESC").bind(bid).all();return json({tables:r.results||[]});
 }
 if(p==="/api/v2/tables"&&m==="POST"){
  const d=await readBody(req),name=safeText(d.name,50),seats=Math.max(1,Math.min(30,Number(d.seats)||2));
  if(name.length<1)return json({error:"Vendos emrin e tavolinës."},400);
  const id=crypto.randomUUID(),q=slug();
  await env.DB.prepare("INSERT INTO tables(id,business_id,table_name,qr_slug,seats,created_at) VALUES(?,?,?,?,?,datetime('now'))").bind(id,bid,name,q,seats).run();
  return json({ok:true,id,qrSlug:q},201);
 }
 if(p==="/api/v2/orders"&&m==="GET"){
  const r=await env.DB.prepare("SELECT * FROM orders WHERE business_id=? ORDER BY created_at DESC LIMIT 100").bind(bid).all();return json({orders:r.results||[]});
 }
 if(p.startsWith("/api/v2/orders/")&&p.endsWith("/status")&&m==="PATCH"){
  const id=safeText(p.split("/")[4],80),d=await readBody(req),status=safeText(d.status,20);
  if(!["new","accepted","preparing","ready","completed","cancelled"].includes(status))return json({error:"Status i pavlefshëm."},400);
  await env.DB.prepare("UPDATE orders SET status=? WHERE id=? AND business_id=?").bind(status,id,bid).run();return json({ok:true});
 }
 if(p==="/api/v2/reservations"&&m==="GET"){
  const r=await env.DB.prepare("SELECT * FROM reservations WHERE business_id=? ORDER BY reservation_at DESC LIMIT 100").bind(bid).all();return json({reservations:r.results||[]});
 }
 if(p==="/api/v2/customers"&&m==="GET"){
  const r=await env.DB.prepare("SELECT * FROM customers WHERE business_id=? ORDER BY created_at DESC LIMIT 200").bind(bid).all();return json({customers:r.results||[]});
 }
 if(p==="/api/v2/expenses"&&m==="GET"){
  const r=await env.DB.prepare("SELECT * FROM expenses WHERE business_id=? ORDER BY expense_date DESC LIMIT 200").bind(bid).all();return json({expenses:r.results||[]});
 }
 return json({error:"Endpoint nuk u gjet."},404);
}
export default {async fetch(req,env){const u=new URL(req.url);if(u.pathname.startsWith("/api/v2/")||u.pathname.startsWith("/api/public/")){try{return await api(req,env)}catch(e){return json({error:"Gabim serveri."},500)}}if(env.ASSETS)return env.ASSETS.fetch(req);return new Response("SABI BUSINESS V2",{status:200})}};
