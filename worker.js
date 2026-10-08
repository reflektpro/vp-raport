// Cloudflare Worker: принимает рапорт с сайта и пересылает в вебхук Discord.
// Секреты (Settings → Variables): WEBHOOK_URL — ссылка вебхука, ROLE_IDS — id ролей через запятую,
// ALLOWED_ORIGIN — адрес сайта, например https://твой-ник.github.io
export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
    if (env.ALLOWED_ORIGIN && req.headers.get("Origin") !== env.ALLOWED_ORIGIN)
      return new Response("Forbidden", { status: 403, headers: cors });

    let form;
    try { form = await req.formData(); } catch { return new Response("Bad form", { status: 400, headers: cors }); }
    const file = form.get("files[0]");
    if (!file || file.type !== "image/png" || file.size > 7 * 1024 * 1024)
      return new Response("Нужна PNG-картинка до 7 МБ", { status: 400, headers: cors });

    let payload = {};
    try { payload = JSON.parse(form.get("payload_json") || "{}"); } catch {}
    const roles = (env.ROLE_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
    // текст: только наши роли, без @everyone/@here и чужих пингов
    let content = String(payload.content || "").slice(0, 1800)
      .replace(/@(everyone|here)/g, "@\u200b$1")
      .replace(/<@&?\d+>/g, "");
    content = roles.map(r => `<@&${r}>`).join(" ") + "\n" + content.trim();

    const out = new FormData();
    out.append("payload_json", JSON.stringify({
      username: "Военная полиция · Рапорты",
      content,
      allowed_mentions: { parse: [], roles },
      attachments: [{ id: 0, filename: "raport.png" }]
    }));
    out.append("files[0]", file, "raport.png");

    const res = await fetch(env.WEBHOOK_URL + "?wait=true", { method: "POST", body: out });
    return new Response(res.ok ? "ok" : await res.text(), { status: res.ok ? 200 : 502, headers: cors });
  }
};
