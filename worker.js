// Cloudflare Worker: рапорт в Discord и журнал приказов в D1.
// Секреты: WEBHOOK_URL, ROLE_IDS, ALLOWED_ORIGIN. База: DB (D1 vp-prikazy).
export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Content-Type": "text/plain; charset=utf-8"
    };
    const fail = (text, status) => new Response(text, { status, headers: cors });
    const json = (obj, status) => new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8" }
    });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (env.ALLOWED_ORIGIN && req.headers.get("Origin") !== env.ALLOWED_ORIGIN) return fail("Forbidden", 403);

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/rules" && req.method === "GET") return rulesGet(env, cors, fail);
    if (path.startsWith("/admin")) return adminRoute(req, env, url, json, fail, cors);

    if (req.method === "GET") {
      const passport = digits(new URL(req.url).searchParams.get("passport") || "");
      if (passport.length < 3) return fail("Нужен номер паспорта", 400);
      const rows = await env.DB.prepare(
        "SELECT num, kind, name, rank, unit_name AS unit, issued, reason FROM orders WHERE passport = ? ORDER BY id"
      ).bind(passport).all();
      return json({ orders: (rows.results || []).map(o => ({ ...o, num: fixNum(o.num) })) });
    }
    if (req.method !== "POST") return fail("Method not allowed", 405);

    const ctype = req.headers.get("content-type") || "";
    if (ctype.includes("application/json")) {
      let body = {};
      try { body = await req.json(); } catch { return fail("Bad json", 400); }
      if (!(await gateOk(env, body.gate))) return fail("Неверный пароль отправки", 403);
      const passport = digits(body.passport || "");
      if (passport.length < 3) return fail("Нужен номер паспорта", 400);
      const kind = body.kind === "pred" ? "pred" : "vyg";
      const ins = await env.DB.prepare(
        "INSERT INTO orders (num, kind, passport, name, rank, unit_name, issued, reason) VALUES ('', ?, ?, ?, ?, ?, ?, ?)"
      ).bind(kind, passport, clip(body.name, 80), clip(body.rank, 40), clip(body.unit, 160), clip(body.issued, 40), clip(body.reason, 160)).run();
      const id = ins.meta.last_row_id;
      await env.DB.prepare(
        "UPDATE orders SET num = (CASE kind WHEN 'pred' THEN char(1055,1056) ELSE char(1042,1043) END) || '-' || printf('%04d', id) WHERE id = ?"
      ).bind(id).run();
      const row = await env.DB.prepare("SELECT num FROM orders WHERE id = ?").bind(id).first();
      const num = fixNum((row && row.num) || "");
      return json({ num, id });
    }

    let parts;
    try { parts = await readParts(req); }
    catch { return fail("Bad form", 400); }
    const gatePart = parts.find(p => p.name === "gate");
    const gateVal = gatePart ? new TextDecoder().decode(gatePart.body) : "";
    if (!(await gateOk(env, gateVal))) return fail("Неверный пароль отправки", 403);

    const file = parts.find(p => p.filename);
    const png = file && file.body[0] === 0x89 && file.body[1] === 0x50 && file.body[2] === 0x4e && file.body[3] === 0x47;
    if (!file || !png || file.body.length > 8 * 1024 * 1024)
      return fail("Картинка не принята: тип «" + ((file && file.type) || "пусто") + "», размер " + (file ? file.body.length : 0) + " байт", 400);

    const limited = await rateLimit(req, env);
    if (limited) return fail(limited, 429);

    let payload = {};
    try { payload = JSON.parse(new TextDecoder().decode((parts.find(p => p.name === "payload_json") || {}).body || new Uint8Array())); }
    catch {}
    const roles = (env.ROLE_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
    let content = String(payload.content || "").slice(0, 1800)
      .replace(/@(everyone|here)/g, "@\u200b$1")
      .replace(/<@&?\d+>/g, "");
    content = roles.map(r => `<@&${r}>`).join(" ") + "\n" + content.trim();

    const embeds = (Array.isArray(payload.embeds) ? payload.embeds : []).slice(0, 2).map(e => ({
      title: String(e.title || "").slice(0, 256),
      color: Number.isInteger(e.color) ? e.color : undefined,
      description: e.description ? String(e.description).slice(0, 4000) : undefined,
      fields: (Array.isArray(e.fields) ? e.fields : []).slice(0, 25).map(f => ({
        name: String(f.name || "—").slice(0, 256), value: String(f.value || "—").slice(0, 1024), inline: !!f.inline
      }))
    }));

    const out = new FormData();
    out.append("payload_json", JSON.stringify({
      username: "Военная полиция · Рапорты",
      content,
      embeds,
      allowed_mentions: { parse: [], roles },
      attachments: [{ id: 0, filename: "raport.png" }]
    }));
    out.append("files[0]", new Blob([file.body], { type: "image/png" }), "raport.png");

    const res = await fetch(env.WEBHOOK_URL + "?wait=true", { method: "POST", body: out });
    if (res.ok) await rateLog(req, env);
    return new Response(res.ok ? "ok" : await res.text(), { status: res.ok ? 200 : 502, headers: cors });
  }
};


function authed(req, env) {
  const token = String(env.ADMIN_TOKEN || "");
  const got = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || got.length !== token.length) return false;
  let n = 0;
  for (let i = 0; i < token.length; i++) n |= token.charCodeAt(i) ^ got.charCodeAt(i);
  return n === 0;
}
async function gateOk(env, supplied) {
  const stored = await gateGet(env);
  if (!stored) return false;
  const got = String(supplied == null ? "" : supplied);
  if (got.length !== stored.length) return false;
  let n = 0;
  for (let i = 0; i < stored.length; i++) n |= stored.charCodeAt(i) ^ got.charCodeAt(i);
  return n === 0;
}
async function gateGet(env) {
  await kvReady(env);
  const row = await env.DB.prepare("SELECT v FROM kv WHERE k = ?").bind("gate").first();
  if (!row || row.v == null || row.v === "") return null;
  try {
    const p = JSON.parse(row.v);
    return typeof p === "string" && p.length ? p : null;
  } catch {
    const s = String(row.v);
    return s.length ? s : null;
  }
}
async function gatePut(env, password) {
  await kvReady(env);
  await env.DB.prepare(
    "INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v"
  ).bind("gate", JSON.stringify(password)).run();
}
async function rateLimit(req, env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS send_log (ip TEXT, ts INTEGER)").run();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("DELETE FROM send_log WHERE ts < ?").bind(now - 3600).run();
  const ip = req.headers.get("CF-Connecting-IP") || "0";
  const mine = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM send_log WHERE ip = ? AND ts >= ?"
  ).bind(ip, now - 600).first();
  const all = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM send_log WHERE ts >= ?"
  ).bind(now - 3600).first();
  if ((mine && mine.c >= 8) || (all && all.c >= 40)) return "Слишком часто, подожди";
  return null;
}
async function rateLog(req, env) {
  const now = Math.floor(Date.now() / 1000);
  const ip = req.headers.get("CF-Connecting-IP") || "0";
  await env.DB.prepare("INSERT INTO send_log (ip, ts) VALUES (?, ?)").bind(ip, now).run();
}
async function kvReady(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)").run();
}
async function kvGet(env, key) {
  await kvReady(env);
  const row = await env.DB.prepare("SELECT v FROM kv WHERE k = ?").bind(key).first();
  if (!row || !row.v) return null;
  try { return JSON.parse(row.v); } catch { return null; }
}
async function kvSet(env, key, value) {
  await kvReady(env);
  const text = JSON.stringify(value);
  if (text.length > 80000) throw new Error("too big");
  await env.DB.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(key, text).run();
}
async function rulesGet(env, cors, fail) {
  try {
    const body = { promo: await kvGet(env, "promo"), vygovor: await kvGet(env, "vygovor") };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch (e) {
    return fail("База правил недоступна", 500);
  }
}
function promoOk(p) {
  return !!(p && Array.isArray(p.acts) && p.acts.length && p.acts.length <= 80 && p.ladder && typeof p.ladder === "object");
}
function vygOk(v) {
  return !!(v && Array.isArray(v.units) && v.units.length && v.units.length <= 30);
}
async function readBody(req) {
  try { return await req.json(); } catch { return null; }
}
async function adminRoute(req, env, url, json, fail, cors) {
  if (!authed(req, env)) return fail("Неверный пароль", 401);
  const path = url.pathname.replace(/\/+$/, "");
  try {
    if (path === "/admin/rules" && req.method === "GET") return rulesGet(env, cors, fail);
    if (path === "/admin/rules" && req.method === "PUT") {
      const body = await readBody(req);
      if (!body || !promoOk(body.promo) || !vygOk(body.vygovor)) return fail("Правила не приняты", 400);
      await kvSet(env, "promo", body.promo);
      await kvSet(env, "vygovor", body.vygovor);
      return json({ ok: true });
    }
    if (path === "/admin/gate" && req.method === "GET") {
      const g = await gateGet(env);
      return json({ set: !!(g && g.length) });
    }
    if (path === "/admin/gate" && req.method === "PUT") {
      const body = await readBody(req);
      const password = body && typeof body.password === "string" ? body.password : "";
      if (password.length < 4 || password.length > 40) return fail("Пароль от 4 до 40 символов", 400);
      await gatePut(env, password);
      return json({ ok: true, set: true });
    }
    if (path === "/admin/orders" && req.method === "GET") {
      const passport = digits(url.searchParams.get("passport") || "");
      const rows = await env.DB.prepare(
        "SELECT id, num, kind, passport, name, rank, unit_name AS unit, issued, reason FROM orders WHERE (? = '' OR passport = ?) ORDER BY id DESC LIMIT 300"
      ).bind(passport, passport).all();
      return json({ orders: (rows.results || []).map(o => ({ ...o, num: fixNum(o.num) })) });
    }
    if (path === "/admin/orders" && req.method === "PATCH") {
      const b = await readBody(req);
      const id = Number(b && b.id);
      if (!id) return fail("Нет записи", 400);
      const kind = b.kind === "pred" ? "pred" : "vyg";
      await env.DB.prepare(
        "UPDATE orders SET kind = ?, passport = ?, name = ?, rank = ?, unit_name = ?, issued = ?, reason = ? WHERE id = ?"
      ).bind(kind, digits(b.passport), clip(b.name, 80), clip(b.rank, 40), clip(b.unit, 160), clip(b.issued, 40), clip(b.reason, 160), id).run();
      return json({ ok: true });
    }
    if (path === "/admin/orders" && req.method === "DELETE") {
      const id = Number(url.searchParams.get("id"));
      if (!id) return fail("Нет записи", 400);
      await env.DB.prepare("DELETE FROM orders WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
    if (path === "/admin/seq" && req.method === "GET") {
      const seq = await env.DB.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'orders'").first();
      const max = await env.DB.prepare("SELECT MAX(id) AS m FROM orders").first();
      const cur = Number((seq && seq.seq) || (max && max.m) || 0);
      return json({ next: cur + 1, last: Number((max && max.m) || 0) });
    }
    if (path === "/admin/seq" && req.method === "POST") {
      const b = await readBody(req);
      const next = Number(b && b.next);
      if (!Number.isInteger(next) || next < 1 || next > 9999) return fail("Номер от 1 до 9999", 400);
      const upd = await env.DB.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'orders'").bind(next - 1).run();
      if (!upd.meta || !upd.meta.changes) {
        await env.DB.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('orders', ?)").bind(next - 1).run();
      }
      return json({ ok: true, next });
    }
    return fail("Нет такого раздела", 404);
  } catch (e) {
    return fail("Не сохранилось", 500);
  }
}
function fixNum(s) {
  s = String(s || "");
  const ok = (str) => {
    const m = /^(.{2})-(\d+)$/.exec(str);
    if (!m) return false;
    for (const ch of m[1]) {
      const c = ch.codePointAt(0);
      if (c < 0x410 || c > 0x42F) return false;
    }
    return true;
  };
  if (ok(s)) return s;
  const bytes = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c > 255) return s;
    bytes.push(c);
  }
  let t;
  try { t = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes)); }
  catch { return s; }
  return ok(t) ? t : s;
}
function digits(s) { return String(s || "").replace(/\D/g, ""); }
function clip(s, n) { return String(s || "").trim().slice(0, n); }

async function readParts(req) {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(req.headers.get("content-type") || "");
  if (!m) throw new Error("no boundary");
  const marker = new TextEncoder().encode("--" + (m[1] || m[2]));
  const u = new Uint8Array(await req.arrayBuffer());
  const at = [];
  for (let i = 0; i <= u.length - marker.length; i++) {
    let ok = true;
    for (let j = 0; j < marker.length; j++) if (u[i + j] !== marker[j]) { ok = false; break; }
    if (ok) { at.push(i); i += marker.length - 1; }
  }
  const parts = [];
  for (let n = 0; n < at.length - 1; n++) {
    let s = at[n] + marker.length;
    if (u[s] === 45 && u[s + 1] === 45) break;
    if (u[s] === 13 && u[s + 1] === 10) s += 2;
    let e = at[n + 1];
    if (u[e - 2] === 13 && u[e - 1] === 10) e -= 2;
    const part = u.subarray(s, e);
    let sep = -1;
    for (let i = 0; i < part.length - 3; i++) {
      if (part[i] === 13 && part[i + 1] === 10 && part[i + 2] === 13 && part[i + 3] === 10) { sep = i; break; }
    }
    if (sep < 0) continue;
    const header = new TextDecoder().decode(part.subarray(0, sep));
    const name = /name="([^"]*)"/.exec(header);
    const filename = /filename="([^"]*)"/.exec(header);
    const type = /content-type:\s*([^\r\n]+)/i.exec(header);
    parts.push({ name: name && name[1], filename: filename && filename[1], type: type && type[1].trim(), body: part.subarray(sep + 4) });
  }
  return parts;
}
