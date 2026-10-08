// Cloudflare Worker: принимает рапорт с сайта и пересылает в вебхук Discord.
// Секреты (Settings → Variables): WEBHOOK_URL — ссылка вебхука, ROLE_IDS — id ролей через запятую,
// ALLOWED_ORIGIN — адрес сайта, например https://твой-ник.github.io
export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "text/plain; charset=utf-8"
    };
    const fail = (text, status) => new Response(text, { status, headers: cors });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return fail("Method not allowed", 405);
    if (env.ALLOWED_ORIGIN && req.headers.get("Origin") !== env.ALLOWED_ORIGIN) return fail("Forbidden", 403);

    let parts;
    try { parts = await readParts(req); }
    catch { return fail("Bad form", 400); }
    const file = parts.find(p => p.filename);
    const png = file && file.body[0] === 0x89 && file.body[1] === 0x50 && file.body[2] === 0x4e && file.body[3] === 0x47;
    if (!file || !png || file.body.length > 8 * 1024 * 1024)
      return fail("Картинка не принята: тип «" + ((file && file.type) || "пусто") + "», размер " + (file ? file.body.length : 0) + " байт", 400);

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
    return new Response(res.ok ? "ok" : await res.text(), { status: res.ok ? 200 : 502, headers: cors });
  }
};

// Разбор multipart вручную: встроенный formData() на воркере превращает файл в текст и портит картинку.
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
