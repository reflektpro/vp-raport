// Cloudflare Worker: рапорт в Discord, номера бланков и журнал приказов в D1.
// Секреты (не в git): WEBHOOK_URL, ROLE_IDS, ALLOWED_ORIGIN, ADMIN_TOKEN, DISCORD_CLIENT_SECRET.
// DISCORD_CLIENT_ID — открытый id приложения. База: DB (D1).
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
    if (path === "/auth/client" && req.method === "GET") return authClient(env, cors);
    if (path === "/auth/discord" && req.method === "POST") return authDiscord(req, env, json, fail);
    if (path === "/paper" && req.method === "POST") return paperPost(req, env, json, fail);
    if (path === "/suggest" && req.method === "GET") return suggestGet(req, env, url, cors, fail);

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
    // Приказ (JSON): POST / или POST /order.
    if (ctype.includes("application/json")) return orderPost(req, env, json, fail);

    let parts;
    try { parts = await readParts(req); }
    catch { return fail("Bad form", 400); }
    const who = await requireUser(req, env, fail);
    if (who.error) return who.error;

    const file = parts.find(p => p.filename);
    const png = file && file.body[0] === 0x89 && file.body[1] === 0x50 && file.body[2] === 0x4e && file.body[3] === 0x47;
    if (!file || !png || file.body.length > 8 * 1024 * 1024)
      return fail("Картинка не принята: тип «" + ((file && file.type) || "пусто") + "», размер " + (file ? file.body.length : 0) + " байт", 400);

    const limited = await rateLimit(req, env, who.user.id);
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
    if (res.ok) {
      await rateLog(req, env, who.user.id);
      const meta = sendMeta(parts, content);
      await writeAudit(env, req, who.user, "send", meta.kind, meta.num);
    }
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
async function rateLimit(req, env, discordId) {
  await ensure(env);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("DELETE FROM send_log WHERE ts < ?").bind(now - 3600).run();
  const mine = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM send_log WHERE discord_id = ? AND ts >= ?"
  ).bind(discordId, now - 600).first();
  const all = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM send_log WHERE ts >= ?"
  ).bind(now - 3600).first();
  if ((mine && mine.c >= 8) || (all && all.c >= 40)) return "Слишком часто, подожди";
  return null;
}
async function rateLog(req, env, discordId) {
  const now = Math.floor(Date.now() / 1000);
  const ip = req.headers.get("CF-Connecting-IP") || "0";
  await env.DB.prepare("INSERT INTO send_log (ip, ts, discord_id) VALUES (?, ?, ?)").bind(ip, now, discordId).run();
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
      const re = await wantNum(env, "orders", ORDER_PREFIX, kind, id, b.num);
      if (re.error) return fail(re.error, re.status);
      await env.DB.prepare(
        "UPDATE orders SET kind = ?, passport = ?, name = ?, rank = ?, unit_name = ?, issued = ?, reason = ?, num = COALESCE(?, num) WHERE id = ?"
      ).bind(kind, digits(b.passport), clip(b.name, 80), clip(b.rank, 40), clip(b.unit, 160), clip(b.issued, 40), clip(b.reason, 160), re.num, id).run();
      const row = await env.DB.prepare("SELECT num FROM orders WHERE id = ?").bind(id).first();
      const num = fixNum((row && row.num) || "");
      return json(withWarn({ ok: true, num }, re.num && await numDup(env, "orders", kind, num, id), num));
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
    if (path === "/admin/papers" && req.method === "GET") {
      await ensure(env);
      const kind = PAPER_KINDS.includes(url.searchParams.get("kind")) ? url.searchParams.get("kind") : "";
      const q = clip(url.searchParams.get("q"), 80);
      const rows = await env.DB.prepare(
        "SELECT id, kind, num, name, passport, rank, note, discord_id, discord_name, created, edited FROM papers" +
        " WHERE (?1 = '' OR kind = ?1) AND (?2 = '' OR name LIKE ?3 OR num LIKE ?3 OR discord_name LIKE ?3 OR (?4 <> '' AND passport = ?4))" +
        " ORDER BY id DESC LIMIT 300"
      ).bind(kind, q, "%" + q + "%", digits(q)).all();
      return json({ papers: (rows.results || []).map(p => ({ ...p, num: fixNum(p.num) })) });
    }
    if (path === "/admin/papers" && req.method === "PATCH") {
      await ensure(env);
      const b = await readBody(req);
      const id = Number(b && b.id);
      if (!id) return fail("Нет записи", 400);
      const cur = await env.DB.prepare("SELECT kind FROM papers WHERE id = ?").bind(id).first();
      if (!cur) return fail("Нет записи", 404);
      const re = await wantNum(env, "papers", PAPER_PREFIX, String(cur.kind || ""), id, b.num);
      if (re.error) return fail(re.error, re.status);
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        "UPDATE papers SET name = ?, passport = ?, rank = ?, note = ?, edited = ?, num = COALESCE(?, num) WHERE id = ?"
      ).bind(clip(b.name, 80), digits(b.passport).slice(0, 20), clip(b.rank, 40), clip(b.note, 300), now, re.num, id).run();
      const row = await env.DB.prepare("SELECT num FROM papers WHERE id = ?").bind(id).first();
      const num = fixNum((row && row.num) || "");
      return json(withWarn({ ok: true, num }, re.num && await numDup(env, "papers", String(cur.kind || ""), num, id), num));
    }
    if (path === "/admin/papers" && req.method === "DELETE") {
      await ensure(env);
      const id = Number(url.searchParams.get("id"));
      if (!id) return fail("Нет записи", 400);
      await env.DB.prepare("DELETE FROM papers WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
    if (path === "/admin/paper-seq" && req.method === "GET") {
      await ensure(env);
      const out = {};
      for (const k of PAPER_KINDS) {
        const c = await env.DB.prepare("SELECT n FROM counters WHERE kind = ?").bind(k).first();
        const last = Number((c && c.n) || 0);
        out[k] = { last, next: last + 1 };
      }
      return json(out);
    }
    if (path === "/admin/paper-seq" && req.method === "POST") {
      await ensure(env);
      const b = await readBody(req);
      const kind = b && PAPER_KINDS.includes(b.kind) ? b.kind : "";
      if (!kind) return fail("Не тот вид", 400);
      const next = Number(b.next);
      if (!Number.isInteger(next) || next < 1 || next > 9999) return fail("Номер от 1 до 9999", 400);
      await env.DB.prepare(
        "INSERT INTO counters (kind, n) VALUES (?1, ?2) ON CONFLICT(kind) DO UPDATE SET n = excluded.n"
      ).bind(kind, next - 1).run();
      return json({ ok: true, kind, next });
    }
    if (path === "/admin/audit" && req.method === "GET") {
      await ensure(env);
      const rows = await env.DB.prepare(
        "SELECT id, ts, discord_id, discord_name, action, kind, num, ip FROM audit ORDER BY id DESC LIMIT 200"
      ).all();
      return json({ rows: rows.results || [] });
    }
    if (path === "/admin/bans" && req.method === "GET") {
      await ensure(env);
      const rows = await env.DB.prepare(
        "SELECT discord_id, username, created FROM bans ORDER BY created DESC"
      ).all();
      return json({ bans: rows.results || [] });
    }
    if (path === "/admin/ban" && req.method === "POST") {
      await ensure(env);
      const b = await readBody(req);
      const discordId = String((b && (b.discordId || b.discord_id)) || "").replace(/\D/g, "");
      if (!discordId) return fail("Нет Discord id", 400);
      let username = "";
      const s = await env.DB.prepare(
        "SELECT username FROM sessions WHERE discord_id = ? ORDER BY created DESC LIMIT 1"
      ).bind(discordId).first();
      if (s && s.username) username = String(s.username);
      else {
        const a = await env.DB.prepare(
          "SELECT discord_name FROM audit WHERE discord_id = ? ORDER BY id DESC LIMIT 1"
        ).bind(discordId).first();
        if (a && a.discord_name) username = String(a.discord_name);
      }
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        "INSERT INTO bans (discord_id, username, created) VALUES (?, ?, ?) ON CONFLICT(discord_id) DO UPDATE SET username = excluded.username, created = excluded.created"
      ).bind(discordId, clip(username, 80), now).run();
      return json({ ok: true });
    }
    if (path === "/admin/ban" && req.method === "DELETE") {
      await ensure(env);
      const id = String(url.searchParams.get("id") || "").replace(/\D/g, "");
      if (!id) return fail("Нет записи", 400);
      await env.DB.prepare("DELETE FROM bans WHERE discord_id = ?").bind(id).run();
      return json({ ok: true });
    }
    return fail("Нет такого раздела", 404);
  } catch (e) {
    return fail("Не сохранилось", 500);
  }
}

let schemaReady = false;
async function ensure(env) {
  if (schemaReady) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS counters (kind TEXT PRIMARY KEY, n INTEGER NOT NULL)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS papers (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, num TEXT, name TEXT, passport TEXT, discord_id TEXT, discord_name TEXT, created INTEGER)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, discord_id TEXT, username TEXT, created INTEGER)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS bans (discord_id TEXT PRIMARY KEY, username TEXT, created INTEGER)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, discord_id TEXT, discord_name TEXT, action TEXT, kind TEXT, num TEXT, ip TEXT)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS send_log (ip TEXT, ts INTEGER)").run();
  await addColumn(env, "ALTER TABLE send_log ADD COLUMN discord_id TEXT");
  await addColumn(env, "ALTER TABLE papers ADD COLUMN rank TEXT");
  await addColumn(env, "ALTER TABLE papers ADD COLUMN note TEXT");
  await addColumn(env, "ALTER TABLE papers ADD COLUMN edited INTEGER");
  schemaReady = true;
}
async function addColumn(env, sql) {
  try {
    await env.DB.prepare(sql).run();
  } catch (e) {
    const m = String((e && e.message) || e);
    if (!/duplicate column/i.test(m)) throw e;
  }
}
// Префиксы номеров собираются в SQLite через char(): в исходнике нет кириллицы.
// ? — вид документа, по нему выбирается префикс.
const PAPER_KINDS = ["raport", "promo", "week"];
const PAPER_PREFIX = "(CASE ? WHEN 'raport' THEN char(1042,1055) WHEN 'promo' THEN char(1055,1042) WHEN 'week' THEN char(1054,1058) END)";
const ORDER_PREFIX = "(CASE ? WHEN 'pred' THEN char(1055,1056) ELSE char(1042,1043) END)";
// Новый номер одной записи, только если админ явно вписал цифры. Пусто — номер не трогаем.
// Другие записи не перенумеровываются. Занятый номер того же вида тоже можно: дубль разрешён нарочно
// (опечатку проще удалить, чем писать отменяющий приказ), в ответе будет предупреждение.
async function wantNum(env, table, prefix, kind, id, raw) {
  const s = digits(raw == null ? "" : raw);
  if (!s) return { num: null };
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 99999) return { error: "Номер от 1 до 99999", status: 400 };
  const row = await env.DB.prepare(
    "SELECT " + prefix + " || '-' || printf('%04d', ?) AS want, num AS cur FROM " + table + " WHERE id = ?"
  ).bind(kind, n, id).first();
  if (!row) return { error: "Нет записи", status: 404 };
  if (!row.want) return { error: "Не тот вид", status: 400 };
  if (fixNum(row.cur) === fixNum(row.want)) return { num: null };
  return { num: row.want };
}
// Те же префиксы с нумерованными параметрами: ?1 / ?2 — вид документа.
const PAPER_PREFIX_1 = "(CASE ?1 WHEN 'raport' THEN char(1042,1055) WHEN 'promo' THEN char(1055,1042) WHEN 'week' THEN char(1054,1058) END)";
const ORDER_PREFIX_2 = "(CASE ?2 WHEN 'pred' THEN char(1055,1056) ELSE char(1042,1043) END)";
// Номер из поля сайта: «5», «0005», «ВГ-0005», «№ 5». Пусто — номер выдаёт база.
function parseWant(raw) {
  if (raw == null) return {};
  const s = String(raw).trim();
  if (!s) return {};
  const m = /^\D{0,8}?(\d{1,6})\D{0,4}$/.exec(s);
  const n = m ? Number(m[1]) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 9999) return { error: "Номер — число от 1 до 9999" };
  return { n };
}
// Номер уже есть у другой записи: не отказ, а предупреждение. Дубли разрешены нарочно.
function dupMsg(num) { return "Номер " + num + " уже есть. Если это опечатка, удали лишний в админке."; }
function withWarn(obj, dup, num) {
  if (dup) obj.warning = dupMsg(num);
  return obj;
}
// Полный номер собирает SQLite: префикс через char().
async function numText(env, table, kind, n) {
  const pre = table === "orders" ? "(CASE ?1 WHEN 'pred' THEN char(1055,1056) ELSE char(1042,1043) END)" : PAPER_PREFIX_1;
  const row = await env.DB.prepare("SELECT " + pre + " || '-' || printf('%04d', ?2) AS num").bind(kind, n).first();
  return fixNum((row && row.num) || "");
}
// Есть ли этот номер у другой записи (с учётом старых записей с испорченной кодировкой).
// Проверяется после записи, поэтому видны и два одновременных бланка с одним номером.
async function numDup(env, table, kind, num, id) {
  const m = /-(\d+)$/.exec(String(num || ""));
  if (!m) return false;
  const tail = "%-" + m[1];
  try {
    const rows = table === "orders"
      ? await env.DB.prepare("SELECT num FROM orders WHERE num LIKE ? AND id <> ?").bind(tail, id).all()
      : await env.DB.prepare("SELECT num FROM papers WHERE kind = ? AND num LIKE ? AND id <> ?").bind(kind, tail, id).all();
    return (rows.results || []).some(r => fixNum(r.num) === num);
  } catch (e) { return false; }
}
// Следующий свободный номер: счётчик + 1, занятые пропускаются. Приказы ВГ и ПР считаются вместе.
async function nextFree(env, table, kind) {
  let cur;
  if (table === "orders") {
    cur = await orderSeq(env);
    if (!cur) {
      const max = await env.DB.prepare("SELECT MAX(id) AS m FROM orders").first();
      cur = Number((max && max.m) || 0);
    }
  } else {
    const c = await env.DB.prepare("SELECT n FROM counters WHERE kind = ?").bind(kind).first();
    cur = Number((c && c.n) || 0);
  }
  const rows = table === "orders"
    ? await env.DB.prepare("SELECT num FROM orders").all()
    : await env.DB.prepare("SELECT num FROM papers WHERE kind = ?").bind(kind).all();
  const used = new Set();
  for (const r of rows.results || []) {
    const m = /-(\d+)$/.exec(fixNum(r.num));
    if (m) used.add(Number(m[1]));
  }
  let n = cur + 1;
  while (used.has(n)) n++;
  return n >= 1 && n <= 9999 ? n : 0;
}
function authClient(env, cors) {
  return new Response(JSON.stringify({ clientId: env.DISCORD_CLIENT_ID || "" }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
async function authDiscord(req, env, json, fail) {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return fail("Вход Discord ещё не настроен", 500);
  await ensure(env);
  let body = {};
  try { body = await req.json(); } catch { return fail("Bad json", 400); }
  const code = String(body.code || "").trim();
  if (!code) return fail("Нет кода", 400);
  const redirect = "https://reflektpro.github.io/vp-raport/auth.html";
  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("client_id", env.DISCORD_CLIENT_ID);
  form.set("client_secret", env.DISCORD_CLIENT_SECRET);
  form.set("redirect_uri", redirect);
  form.set("code", code);
  const tok = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  });
  if (!tok.ok) return fail("Discord не подтвердил вход", 400);
  let tokJson = {};
  try { tokJson = await tok.json(); } catch { return fail("Discord не подтвердил вход", 400); }
  const access = tokJson.access_token;
  if (!access) return fail("Discord не подтвердил вход", 400);
  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: "Bearer " + access }
  });
  if (!meRes.ok) return fail("Discord не подтвердил вход", 400);
  let me = {};
  try { me = await meRes.json(); } catch { return fail("Discord не подтвердил вход", 400); }
  const id = String(me.id || "");
  const username = String(me.username || "");
  if (!/^\d{2,32}$/.test(id)) return fail("Discord не подтвердил вход", 400);
  if (await isBanned(env, id)) return fail("Доступ закрыт", 403);
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let token = "";
  for (const b of bytes) token += b.toString(16).padStart(2, "0");
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "INSERT INTO sessions (token, discord_id, username, created) VALUES (?, ?, ?, ?)"
  ).bind(token, id, clip(username, 80), now).run();
  return json({ token, id, username });
}
async function sessionUser(req, env) {
  await ensure(env);
  const got = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!/^[0-9a-f]{64}$/.test(got)) return null;
  const row = await env.DB.prepare(
    "SELECT discord_id, username, created FROM sessions WHERE token = ?"
  ).bind(got).first();
  if (!row) return null;
  const now = Math.floor(Date.now() / 1000);
  if (now - Number(row.created || 0) > 7 * 24 * 60 * 60) return null;
  return { id: String(row.discord_id || ""), username: String(row.username || "") };
}
async function isBanned(env, id) {
  const row = await env.DB.prepare("SELECT discord_id FROM bans WHERE discord_id = ?").bind(id).first();
  return !!row;
}
async function requireUser(req, env, fail) {
  const user = await sessionUser(req, env);
  if (!user || !user.id) return { error: fail("Сначала войди через Discord", 403) };
  if (await isBanned(env, user.id)) return { error: fail("Доступ закрыт", 403) };
  return { user };
}
async function paperPost(req, env, json, fail) {
  await ensure(env);
  let body = {};
  try { body = await req.json(); } catch { return fail("Bad json", 400); }
  const kind = body.kind === "raport" || body.kind === "promo" || body.kind === "week" ? body.kind : "";
  if (!kind) return fail("Не тот вид", 400);
  const who = await requireUser(req, env, fail);
  if (who.error) return who.error;
  const w = parseWant(body.num);
  if (w.error) return fail(w.error, 400);
  const f = [clip(body.name, 80), digits(body.passport || ""), who.user.id, clip(who.user.username, 80), Math.floor(Date.now() / 1000)];
  let row = null, n = 0;
  try {
    if (w.n) {
      // Номер вписан руками: пишем как есть, даже если он уже занят (дубль разрешён, будет предупреждение).
      n = w.n;
      row = await paperInsert(env, kind, n, f, true);
    } else {
      for (let i = 0; i < 5 && !row; i++) {
        n = await nextFree(env, "papers", kind);
        if (!n) return fail("Свободных номеров нет, впиши номер сам", 409);
        row = await paperInsert(env, kind, n, f, false);
      }
    }
  } catch (e) {
    return fail("Номер не записался, попробуй ещё раз", 500);
  }
  if (!row || !row.num) return fail("Не выдался номер", 500);
  const num = fixNum(row.num);
  const dup = await numDup(env, "papers", kind, num, Number(row.id));
  try {
    // Счётчик только вверх: номер выше счётчика двигает его, номер из пропуска не трогает.
    await env.DB.prepare(
      "INSERT INTO counters (kind, n) VALUES (?1, ?2) ON CONFLICT(kind) DO UPDATE SET n = max(n, excluded.n)"
    ).bind(kind, n).run();
    await writeAudit(env, req, who.user, "paper", kind, num);
  } catch (e) {}
  return json(withWarn({ num, id: row.id, digits: n }, dup, num));
}
// Одна запись. dupOk — номер вписан руками, пишем даже поверх занятого (дубль разрешён).
// Без dupOk (номер выдаёт база) строка вставляется, только если такого номера этого вида ещё нет.
async function paperInsert(env, kind, n, f, dupOk) {
  const want = PAPER_PREFIX_1 + " || '-' || printf('%04d', ?2)";
  return env.DB.prepare(
    "INSERT INTO papers (kind, num, name, passport, discord_id, discord_name, created) " +
    "SELECT ?1, " + want + ", ?3, ?4, ?5, ?6, ?7 " +
    (dupOk ? "" : "WHERE NOT EXISTS (SELECT 1 FROM papers WHERE kind = ?1 AND num = " + want + ") ") + "RETURNING id, num"
  ).bind(kind, n, ...f).first();
}
async function orderPost(req, env, json, fail) {
  let body = {};
  try { body = await req.json(); } catch { return fail("Bad json", 400); }
  const who = await requireUser(req, env, fail);
  if (who.error) return who.error;
  const passport = digits(body.passport || "");
  if (passport.length < 3) return fail("Нужен номер паспорта", 400);
  const kind = body.kind === "pred" ? "pred" : "vyg";
  const w = parseWant(body.num);
  if (w.error) return fail(w.error, 400);
  const f = [passport, clip(body.name, 80), clip(body.rank, 40), clip(body.unit, 160), clip(body.issued, 40), clip(body.reason, 160)];
  let row = null, n = 0, seqBefore = 0;
  try {
    seqBefore = await orderSeq(env);
    if (w.n) {
      // Номер вписан руками: пишем как есть, даже если он уже занят (дубль разрешён, будет предупреждение).
      n = w.n;
      row = await orderInsert(env, kind, n, f, true);
    } else {
      for (let i = 0; i < 5 && !row; i++) {
        n = await nextFree(env, "orders", kind);
        if (!n) return fail("Свободных номеров нет, впиши номер сам", 409);
        row = await orderInsert(env, kind, n, f, false);
      }
    }
  } catch (e) {
    return fail("Номер не записался, попробуй ещё раз", 500);
  }
  if (!row || !row.num) return fail("Не выдался номер", 500);
  const num = fixNum(row.num);
  const dup = await numDup(env, "orders", kind, num, Number(row.id));
  try {
    await orderSeqAfter(env, Math.max(seqBefore, n), Number(row.id));
    await writeAudit(env, req, who.user, "order", kind, num);
  } catch (e) {}
  return json(withWarn({ num, id: row.id, digits: n }, dup, num));
}
// Строка приказа. id стараемся взять равным номеру (как раньше: номер = id);
// если этот id занят другой записью, база выдаёт id сама, номер остаётся выбранным.
// dupOk — номер вписан руками, пишем даже поверх занятого (дубль разрешён).
// Без dupOk (номер выдаёт база) занятый номер не пишем — вернётся null, берётся следующий.
async function orderInsert(env, kind, n, f, dupOk) {
  const want = ORDER_PREFIX_2 + " || '-' || printf('%04d', ?3)";
  const guard = dupOk ? "" : "WHERE NOT EXISTS (SELECT 1 FROM orders WHERE num = " + want + ") ";
  const row = await env.DB.prepare(
    "INSERT OR IGNORE INTO orders (id, num, kind, passport, name, rank, unit_name, issued, reason) " +
    "SELECT ?1, " + want + ", ?2, ?4, ?5, ?6, ?7, ?8, ?9 " + guard + "RETURNING id, num"
  ).bind(n, kind, n, ...f).first();
  if (row) return row;
  if (!dupOk) {
    // Не вставилось: либо номер уже занят (берём следующий), либо занят только id (пробуем id от базы).
    const dup = await env.DB.prepare(
      "SELECT id FROM orders WHERE num = (CASE ?1 WHEN 'pred' THEN char(1055,1056) ELSE char(1042,1043) END) || '-' || printf('%04d', ?2)"
    ).bind(kind, n).first();
    if (dup) return null;
  }
  // id занят: id выдаёт база. Без OR IGNORE — если что-то не даёт записать, будет ошибка, а не тихий пропуск.
  return env.DB.prepare(
    "INSERT INTO orders (id, num, kind, passport, name, rank, unit_name, issued, reason) " +
    "SELECT ?1, " + want + ", ?2, ?4, ?5, ?6, ?7, ?8, ?9 " + guard + "RETURNING id, num"
  ).bind(null, kind, n, ...f).first();
}
// Следующий номер приказа живёт в sqlite_sequence (его же правит /admin/seq).
async function orderSeq(env) {
  const seq = await env.DB.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'orders'").first();
  return Number((seq && seq.seq) || 0);
}
// После вставки счётчик = max(было, выбранный номер). Если id выдала сама база и он ушёл выше, возвращаем.
async function orderSeqAfter(env, target, newId) {
  const now = await orderSeq(env);
  if (now === newId && newId > target) {
    await env.DB.prepare("UPDATE sqlite_sequence SET seq = ?1 WHERE name = 'orders' AND seq = ?2").bind(target, newId).run();
  } else if (now < target) {
    const upd = await env.DB.prepare("UPDATE sqlite_sequence SET seq = ?1 WHERE name = 'orders' AND seq < ?1").bind(target).run();
    if (!upd.meta || !upd.meta.changes) {
      const has = await env.DB.prepare("SELECT 1 AS x FROM sqlite_sequence WHERE name = 'orders'").first();
      if (!has) await env.DB.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('orders', ?)").bind(target).run();
    }
  }
}
// Только предложение: следующий свободный номер и префикс. Ничего не записывает и не занимает.
// Вписать занятый номер всё равно можно — это лишь подсказка.
async function suggestGet(req, env, url, cors, fail) {
  const who = await requireUser(req, env, fail);
  if (who.error) return who.error;
  const k = String(url.searchParams.get("kind") || "");
  const t = String(url.searchParams.get("type") || "");
  let table, kind;
  if (k === "order" || k === "pred" || k === "vyg") { table = "orders"; kind = (k === "pred" || t === "pred") ? "pred" : "vyg"; }
  else if (PAPER_KINDS.includes(k)) { table = "papers"; kind = k; }
  else return fail("Не тот вид", 400);
  try {
    const n = await nextFree(env, table, kind);
    if (!n) return fail("Свободных номеров нет, впиши номер сам", 409);
    const num = await numText(env, table, kind, n);
    return new Response(JSON.stringify({ num, digits: n }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
  } catch (e) {
    return fail("База номеров недоступна", 500);
  }
}
async function writeAudit(env, req, user, action, kind, num) {
  const ip = req.headers.get("CF-Connecting-IP") || "";
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "INSERT INTO audit (ts, discord_id, discord_name, action, kind, num, ip) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(now, user.id, clip(user.username, 80), action, clip(kind, 40), clip(num, 40), clip(ip, 64)).run();
}
function partText(parts, name) {
  const p = parts.find(x => x.name === name && !x.filename);
  return p ? new TextDecoder().decode(p.body).trim() : "";
}
function sendMeta(parts, content) {
  let kind = partText(parts, "kind").slice(0, 40);
  let num = partText(parts, "num").slice(0, 40);
  if (!num) {
    const m = /\u2116\s*([^\s<*]+)/.exec(String(content || ""));
    if (m) num = m[1].replace(/[*_`]/g, "").slice(0, 40);
  }
  return { kind, num };
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
