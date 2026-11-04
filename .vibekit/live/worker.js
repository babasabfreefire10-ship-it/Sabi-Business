const COOKIE = "sabi_session";
const SESSION_DAYS = 7;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}
function htmlEscape(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function cookieValue(request, name) {
  const raw = request.headers.get("Cookie") || "";
  const item = raw.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}
function setCookie(value, maxAge = SESSION_DAYS * 86400) {
  return `${COOKIE}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
function clearCookie() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
async function hashPassword(password, saltHex) {
  const salt = saltHex ? Uint8Array.from(saltHex.match(/.{1,2}/g).map(x => parseInt(x,16))) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", salt, iterations:210000, hash:"SHA-256" }, key, 256);
  const hash = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2,"0")).join("");
  const saltOut = [...salt].map(b => b.toString(16).padStart(2,"0")).join("");
  return { salt: saltOut, hash };
}
async function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(b => b.toString(16).padStart(2,"0")).join("");
}
async function digest(value) {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(data)].map(b => b.toString(16).padStart(2,"0")).join("");
}
async function body(request) {
  try { return await request.json(); } catch { return {}; }
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "")) && String(email).length <= 190;
}
async function getUser(request, env) {
  const token = cookieValue(request, COOKIE);
  if (!token) return null;
  const tokenHash = await digest(token);
  const row = await env.DB.prepare(
    `SELECT u.id,u.email,u.role,u.business_name,u.language
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=? AND s.expires_at > datetime('now')`
  ).bind(tokenHash).first();
  return row || null;
}
async function requireUser(request, env) {
  const user = await getUser(request, env);
  return user;
}
async function createSession(userId, env) {
  const token = await newToken();
  const tokenHash = await digest(token);
  await env.DB.prepare(
    `INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at)
     VALUES (?, ?, ?, datetime('now','+${SESSION_DAYS} days'), datetime('now'))`
  ).bind(crypto.randomUUID(), userId, tokenHash).run();
  return token;
}
async function routeApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === "GET" && path === "/api/health") {
    return json({ ok:true, app:"SABI BUSINESS", version:"1.0.0" });
  }

  if (method === "POST" && path === "/api/register") {
    const data = await body(request);
    const email = String(data.email || "").trim().toLowerCase();
    const password = String(data.password || "");
    const businessName = String(data.businessName || "").trim();
    const language = ["sq","en","it","de"].includes(data.language) ? data.language : "sq";
    if (!validEmail(email)) return json({ error:"Vendos një email të vlefshëm." }, 400);
    if (password.length < 8 || password.length > 128) return json({ error:"Fjalëkalimi duhet të ketë të paktën 8 karaktere." }, 400);
    if (businessName.length < 2 || businessName.length > 100) return json({ error:"Emri i biznesit duhet të ketë 2–100 karaktere." }, 400);
    const exists = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
    if (exists) return json({ error:"Ky email është regjistruar më parë." }, 409);
    const pw = await hashPassword(password);
    const userId = crypto.randomUUID();
    const businessId = crypto.randomUUID();
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO users (id,email,password_hash,password_salt,role,business_name,language,created_at)
          VALUES (?,?,?,?, 'business',?,?,datetime('now'))`).bind(userId,email,pw.hash,pw.salt,businessName,language),
        env.DB.prepare(`INSERT INTO businesses (id,owner_user_id,name,created_at)
          VALUES (?,?,?,datetime('now'))`).bind(businessId,userId,businessName)
      ]);
    } catch (e) {
      return json({ error:"Regjistrimi nuk u krye. Provo përsëri." }, 500);
    }
    const token = await createSession(userId, env);
    return json({ ok:true, user:{ id:userId,email,role:"business",business_name:businessName,language } }, 201,
      { "set-cookie":setCookie(token) });
  }

  if (method === "POST" && path === "/api/login") {
    const data = await body(request);
    const email = String(data.email || "").trim().toLowerCase();
    const password = String(data.password || "");
    const user = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
    if (!user) return json({ error:"Email ose fjalëkalim i pasaktë." }, 401);
    const check = await hashPassword(password, user.password_salt);
    if (check.hash !== user.password_hash) return json({ error:"Email ose fjalëkalim i pasaktë." }, 401);
    const token = await createSession(user.id, env);
    return json({ ok:true, user:{ id:user.id,email:user.email,role:user.role,business_name:user.business_name,language:user.language } },
      200, { "set-cookie":setCookie(token) });
  }

  if (method === "POST" && path === "/api/logout") {
    const token = cookieValue(request, COOKIE);
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await digest(token)).run();
    return json({ ok:true }, 200, { "set-cookie":clearCookie() });
  }

  if (method === "GET" && path === "/api/me") {
    const user = await requireUser(request, env);
    if (!user) return json({ user:null }, 200);
    return json({ user });
  }

  if (method === "POST" && path === "/api/setup-admin") {
    const setupKey = request.headers.get("x-setup-key") || "";
    if (!env.ADMIN_SETUP_KEY || setupKey !== env.ADMIN_SETUP_KEY) return json({ error:"Çelësi i konfigurimit nuk është i saktë." }, 403);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").first();
    if (count && count.n > 0) return json({ error:"Admin është krijuar tashmë. Përdor hyrjen normale." }, 409);
    const data = await body(request);
    const email = String(data.email || "").trim().toLowerCase();
    const password = String(data.password || "");
    if (!validEmail(email) || password.length < 12) return json({ error:"Përdor email të vlefshëm dhe fjalëkalim të paktën 12 karaktere." }, 400);
    const exists = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
    if (exists) return json({ error:"Ky email ekziston." }, 409);
    const pw = await hashPassword(password);
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO users (id,email,password_hash,password_salt,role,business_name,language,created_at)
      VALUES (?,?,?,?, 'admin','SABI BUSINESS','sq',datetime('now'))`).bind(id,email,pw.hash,pw.salt).run();
    return json({ ok:true, message:"Admin u krijua. Tani hyr me email dhe fjalëkalim." }, 201);
  }

  const user = await requireUser(request, env);
  if (!user) return json({ error:"Duhet të hysh në llogari." }, 401);

  if (method === "GET" && path === "/api/dashboard") {
    if (user.role === "admin") {
      const stats = await env.DB.prepare(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE role='business') AS businesses,
          (SELECT COUNT(*) FROM users) AS users,
          (SELECT COUNT(*) FROM sessions WHERE expires_at > datetime('now')) AS active_sessions
      `).first();
      const businesses = await env.DB.prepare(`
        SELECT u.id,u.email,u.business_name,u.language,u.created_at
        FROM users u WHERE u.role='business' ORDER BY u.created_at DESC LIMIT 100
      `).all();
      return json({ role:"admin", stats, businesses:businesses.results || [] });
    }
    const business = await env.DB.prepare("SELECT id,name,created_at FROM businesses WHERE owner_user_id=?").bind(user.id).first();
    return json({ role:"business", business, stats:{ products:0,orders:0,reservations:0 } });
  }

  if (method === "PATCH" && path === "/api/business/profile") {
    if (user.role !== "business") return json({ error:"Nuk ke leje." }, 403);
    const data = await body(request);
    const name = String(data.businessName || "").trim();
    const language = ["sq","en","it","de"].includes(data.language) ? data.language : user.language;
    if (name.length < 2 || name.length > 100) return json({ error:"Emri nuk është i vlefshëm." }, 400);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET business_name=?,language=? WHERE id=?").bind(name,language,user.id),
      env.DB.prepare("UPDATE businesses SET name=? WHERE owner_user_id=?").bind(name,user.id)
    ]);
    return json({ ok:true });
  }

  return json({ error:"Endpoint nuk u gjet." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await routeApi(request, env); }
      catch (e) { return json({ error:"Gabim i brendshëm i serverit." }, 500); }
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("SABI BUSINESS is running. Configure the ASSETS binding.", { status:200 });
  }
};
