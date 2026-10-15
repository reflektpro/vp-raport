// Уголовные дела: бланки дознавателя ВП по УПК RMRP. Дела и бланки хранятся в localStorage (vp_ud),
// номер дела вписывается руками: в воркере нет отдельного счётчика для уголовных дел.
(async () => {
  const C = window.VP_CONFIG || {};
  const U = window.UD;
  const $ = id => document.getElementById(id);
  const MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  const OFF = ["fromPos","fromRank","fromName","staticId"];
  const CASE_F = ["num","article","suspName","suspInfo","applicant","victim","chiefPos","chiefRank","chiefName"];
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const pad = n => String(n).padStart(2, "0");
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const human = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v||""); return m ? `${+m[3]} ${MONTHS[+m[2]-1]} ${m[1]} г.` : "«__» ______ 20__ г."; };
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  // ---------- хранилище ----------
  let S;
  try { S = JSON.parse(localStorage.getItem("vp_ud") || "null"); } catch (e) { S = null; }
  if (!S || typeof S !== "object" || !S.cases) S = { cur: "", cases: {} };
  const save = () => localStorage.setItem("vp_ud", JSON.stringify(S));
  function newCase() {
    const id = "c" + Date.now().toString(36);
    S.cases[id] = { num: "", article: "", suspName: "", suspInfo: "", applicant: "", victim: "", chiefPos: "", chiefRank: "", chiefName: "", docs: {}, created: Date.now() };
    S.cur = id; save(); return id;
  }
  if (!S.cur || !S.cases[S.cur]) { const ids = Object.keys(S.cases); if (ids.length) S.cur = ids[ids.length - 1]; else newCase(); }
  const cs = () => S.cases[S.cur];
  let docKey = new URLSearchParams(location.search).get("doc") || localStorage.getItem("vp_ud_doc") || "raport";
  if (!U.DOCS.find(d => d.key === docKey)) docKey = "raport";
  const def = () => U.DOCS.find(d => d.key === docKey);
  function dd() {
    const c = cs(); c.docs = c.docs || {};
    const d = c.docs[docKey] = c.docs[docKey] || { ev: [], date: iso(new Date()) };
    def().fields.forEach(f => { if (f.fromCase && d[f.id] == null && c[f.fromCase]) d[f.id] = c[f.fromCase]; });
    if (!Array.isArray(d.ev)) d.ev = [];
    return d;
  }

  // ---------- панель ----------
  OFF.forEach(id => { const v = localStorage.getItem("vp_" + id); if (v) $(id).value = v; });
  OFF.forEach(id => $(id).addEventListener("input", () => { localStorage.setItem("vp_" + id, $(id).value.trim()); $(id).classList.remove("bad"); if (id === "fromName") updateSignature(); paint(); }));

  function fillCases() {
    $("caseSel").innerHTML = Object.entries(S.cases).map(([id, c]) =>
      `<option value="${id}" ${id === S.cur ? "selected" : ""}>${c.num ? "УД № " + esc(c.num) : "новое дело"}${c.suspName ? " · " + esc(c.suspName) : ""}</option>`).join("");
    const c0 = cs();
    // старое поле «Начальник» одной строкой: переносим в «звание и имя», должность вводится отдельно
    if (c0.chief && !c0.chiefName && !c0.chiefPos) { c0.chiefName = c0.chief; delete c0.chief; save(); }
    CASE_F.forEach(k => { $("c_" + k).value = cs()[k] || ""; $("c_" + k).classList.remove("bad"); });
  }
  $("caseSel").addEventListener("change", () => { S.cur = $("caseSel").value; save(); fillCases(); fillDoc(); });
  $("caseNew").addEventListener("click", () => { newCase(); fillCases(); fillDoc(); $("c_num").focus(); });
  $("caseDel").addEventListener("click", () => {
    if (!confirm("Удалить это дело и все его черновики из браузера? Отправленные в Discord бланки останутся.")) return;
    delete S.cases[S.cur]; S.cur = ""; const ids = Object.keys(S.cases);
    if (ids.length) S.cur = ids[ids.length - 1]; else newCase();
    save(); fillCases(); fillDoc();
  });
  CASE_F.forEach(k => $("c_" + k).addEventListener("input", () => {
    cs()[k] = $("c_" + k).value; $("c_" + k).classList.remove("bad"); save();
    if (["suspName","suspInfo","victim","applicant"].includes(k)) { const D = def(); if (D.fields.some(f => f.id === "people")) fillDoc(); }
    if (k === "num" || k === "suspName") { const o = $("caseSel").selectedOptions[0]; if (o) o.textContent = (cs().num ? "УД № " + cs().num : "новое дело") + (cs().suspName ? " · " + cs().suspName : ""); }
    paint();
  }));

  // список бланков по стадиям
  $("docSel").innerHTML = Object.entries(U.STAGES).map(([n, name]) =>
    `<optgroup label="${n}. ${esc(name)}">${U.DOCS.filter(d => d.stage == n).map(d => `<option value="${d.key}">${esc(d.short)}</option>`).join("")}</optgroup>`).join("");
  $("docSel").addEventListener("change", () => { docKey = $("docSel").value; localStorage.setItem("vp_ud_doc", docKey); fillDoc(); });

  function fillDoc() {
    $("docSel").value = docKey;
    const D = def(), d = dd();
    $("docArts").textContent = D.arts;
    $("docRoute").textContent = D.route || "";
    $("d_date").value = d.date || iso(new Date());
    $("docFields").innerHTML = D.fields.map(f => {
      const val = esc(d[f.id] || "");
      let inp;
      if (f.type === "area") inp = `<textarea data-k="${f.id}" rows="3" placeholder="${esc(f.ph || "")}">${val}</textarea>`;
      else if (f.type === "select") inp = `<select data-k="${f.id}"><option value="">— выбери —</option>${f.options.map(o => `<option ${o === d[f.id] ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
      else inp = `<input data-k="${f.id}" ${f.type === "time" ? 'type="time"' : ""} value="${val}" placeholder="${esc(f.ph || "")}">`;
      let add = "";
      if (f.id === "people") {
        const opts = ["подозреваемый", "потерпевший", "заявитель"].filter(r => fromRole(r));
        if (opts.length) add = `<div class="ud-addp">${opts.map(r => `<button type="button" class="mini" data-addp="${r}">+ ${r}</button>`).join(" ")}</div>`;
      }
      return `<label class="plab">${esc(f.label)}${inp}</label>${add}`;
    }).join("");
    fillEv(); paint();
  }
  $("docFields").addEventListener("input", e => { const k = e.target.dataset.k; if (!k) return; dd()[k] = e.target.value; e.target.classList.remove("bad"); save(); paint(); });
  // ФИО по процессуальному положению из карточки дела
  function fromRole(role) {
    const c = cs(), t = s => (s || "").trim();
    if (role === "подозреваемый") return t(c.suspName) ? t(c.suspName) + (t(c.suspInfo) ? ", " + t(c.suspInfo) : "") : "";
    if (role === "потерпевший") return t(c.victim);
    if (role === "заявитель") return t(c.applicant);
    return "";
  }
  $("docFields").addEventListener("change", e => {
    const k = e.target.dataset.k; if (!k) return; const d = dd(); d[k] = e.target.value;
    const f = def().fields.find(x => x.id === k);
    if (f && f.fills) {
      const tgt = d[f.fills] || "", nv = fromRole(e.target.value);
      // перезаписываем только пустое поле или ранее подставленное автоматически
      if (!tgt.trim() || tgt === d["_auto_" + f.fills]) {
        d[f.fills] = nv; d["_auto_" + f.fills] = nv;
        const inp = $("docFields").querySelector(`[data-k="${f.fills}"]`); if (inp) inp.value = nv;
      }
    }
    save(); paint();
  });
  // кнопки «+ из дела» для списка участвующих лиц в протоколах
  $("docFields").addEventListener("click", e => {
    const b = e.target.closest("[data-addp]"); if (!b) return;
    const d = dd(), line = fromRole(b.dataset.addp); if (!line) return;
    const row = `${line.split(",")[0]} — ${b.dataset.addp}`;
    const cur = (d.people || "").split("\n").map(s => s.trim()).filter(Boolean);
    if (!cur.some(x => x.startsWith(line.split(",")[0]))) cur.push(row);
    d.people = cur.join("\n"); save();
    const ta = $("docFields").querySelector('[data-k="people"]'); if (ta) ta.value = d.people;
    paint();
  });
  $("d_date").addEventListener("change", () => { dd().date = $("d_date").value; save(); paint(); });

  // ---------- доказательства (без ограничения количества) ----------
  function fillEv() {
    const ev = dd().ev;
    $("evList").innerHTML = ev.map((x, i) => `<div class="ev-row" data-i="${i}">
      <span class="ev-n">${i + 1}.</span><input data-ev="t" list="evTypes" placeholder="что это" value="${esc(x.t)}">
      <input data-ev="u" placeholder="ссылка" value="${esc(x.u)}"><button type="button" data-del title="Убрать">×</button></div>`).join("");
  }
  $("evAdd").addEventListener("click", () => { dd().ev.push({ t: "", u: "" }); save(); fillEv(); paint(); const r = $("evList").lastElementChild; r && r.querySelector("input").focus(); });
  $("evList").addEventListener("input", e => { const r = e.target.closest(".ev-row"); if (!r) return; dd().ev[+r.dataset.i][e.target.dataset.ev] = e.target.value; save(); paint(); });
  $("evList").addEventListener("click", e => { if (!e.target.matches("[data-del]")) return; dd().ev.splice(+e.target.closest(".ev-row").dataset.i, 1); save(); fillEv(); paint(); });
  const evOk = () => dd().ev.filter(x => (x.t || "").trim() || (x.u || "").trim());

  // ---------- подпись и печать (как на других бланках) ----------
  function parseName(full) {
    const p = full.trim().split(/\s+/).filter(Boolean).map(cap);
    if (p.length >= 3) return { surname: p[0], short: `${p[0]} ${p[1][0]}. ${p[2][0]}.`, initial: p[1][0] };
    if (p.length === 2) return { surname: p[1], short: `${p[1]} ${p[0][0]}.`, initial: p[0][0] };
    if (p.length === 1) return { surname: p[0], short: p[0], initial: "" };
    return null;
  }
  function rng(seed) { let h = 2166136261; for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; }; }
  const meas = document.createElement("canvas").getContext("2d");
  const stampSrc = new Image(); stampSrc.src = "stamp.png";
  const stampReady = stampSrc.decode().catch(() => {}).then(() => updateSignature());
  function updateSignature() {
    const n = parseName($("fromName").value), t = $("autoText"), path = $("autoPath");
    if (!n) { t.textContent = ""; path.setAttribute("d", ""); drawStamp("x"); return; }
    const r = rng(n.surname + n.initial), len = 3 + Math.floor(r() * 3);
    t.textContent = (n.initial || "") + n.surname[0] + n.surname.slice(1, len).toLowerCase();
    const fs = 34 + Math.round(r() * 8); t.style.fontSize = fs + "px";
    t.style.transform = `rotate(${-(4 + r() * 8)}deg) skewX(${-(6 + r() * 10)}deg)`;
    meas.font = `${fs}px "Marck Script"`;
    const tw = Math.min(150, meas.measureText(t.textContent).width), ex = 14 + tw, ey = 38 + r() * 8;
    path.setAttribute("d", `M ${ex} ${ey} C ${ex + 18} ${ey + 22}, ${ex - 40} ${ey + 34}, ${18 + r() * 10} ${70 + r() * 8} C 4 84, ${60 + r() * 20} ${78 + r() * 6}, ${120 + r() * 20} ${64 + r() * 6} S ${200 + r() * 15} ${44 + r() * 10}, ${226 + r() * 8} ${40 + r() * 8}`);
    drawStamp(n.surname);
  }
  function drawStamp(seed) {
    if (!stampSrc.complete || !stampSrc.naturalWidth) return;
    const SZ = 440, cx = SZ / 2, d = SZ * 0.97, r = rng("stamp" + seed);
    const out = document.createElement("canvas"); out.width = out.height = SZ;
    const g = out.getContext("2d"); g.translate(cx, cx); g.rotate((r() * 40 - 20) * Math.PI / 180); g.drawImage(stampSrc, -d / 2, -d / 2, d, d);
    $("stamp").src = out.toDataURL("image/png");
  }
  async function stampLoaded() { await stampReady; const s = $("stamp"); if (s.getAttribute("src")) await s.decode().catch(() => {}); }
  $("stampOn").addEventListener("change", e => $("stamp").style.visibility = e.target.checked ? "visible" : "hidden");
  document.fonts && document.fonts.ready.then(updateSignature);

  // ---------- бланк ----------
  $("hdr").innerHTML = (C.header || []).map(esc).join("<br>");
  function ctx() {
    const c = Object.assign({}, cs());
    c.offPos = $("fromPos").value.trim(); c.offName = $("fromName").value.trim();
    c.offRank = $("fromRank").value.trim().toLowerCase();
    return c;
  }
  function paint() {
    const D = def(), d = dd(), c = ctx();
    $("pTitle").textContent = D.title;
    $("pSub").textContent = D.sub;
    $("pDate").textContent = human(d.date);
    $("pCity").textContent = C.city || "Москва";
    // до возбуждения дела номера УД нет: у рапорта/заявления/отказа — собственный рег. № (необязательный)
    $("pNum").textContent = D.noCase ? (d.regNo && d.regNo.trim() ? "Рег. № " + d.regNo.trim() : "") : (c.num ? "УД № " + c.num : "УД № ____");
    $("pTo").innerHTML = D.to ? D.to(c, d) : ""; $("pTo").style.display = D.to ? "" : "none";
    $("pApprove").style.display = D.approve ? "" : "none";
    $("pBody").innerHTML = D.body(c, d);
    const ev = evOk();
    $("pApp").style.display = ev.length ? "" : "none";
    $("pAppList").innerHTML = ev.map((x, i) => `<div class="app-row">${i + 1}. ${esc((x.t || "Материал").trim())}${x.u ? " (ссылка в сообщении)" : ""}</div>`).join("");
    const ppl = (d.people || "").split("\n").map(s => s.trim()).filter(Boolean);
    let extra = "";
    if (D.applicantSign) extra += `<div class="ud-sl"><span>Заявитель</span><span class="ud-line"></span><span>${esc(d.appName || "")}</span></div>`;
    if (D.proto) extra += ppl.map(p => `<div class="ud-sl"><span>${esc(p.split(/[—,-]/)[0].trim())}</span><span class="ud-line"></span><span>(подпись)</span></div>`).join("");
    $("pSigns").innerHTML = extra; $("pSigns").style.display = extra ? "" : "none";
    $("sPos").textContent = c.offPos || "должность"; $("sRank").textContent = $("fromRank").value.trim() || "звание";
    const n = parseName(c.offName); $("sName").textContent = n ? n.short : "И. Фамилия";
    $("sStatic").textContent = $("staticId").value.trim() || "____";
    const probs = (D.check ? D.check(c, d) : []);
    $("checks").innerHTML = probs.map(p => `<li>${esc(p)}</li>`).join("");
    $("checksBox").style.display = probs.length ? "" : "none";
  }

  function validate() {
    let first = null;
    const mark = el => { el.classList.add("bad"); first = first || el; };
    OFF.forEach(id => { if (!$(id).value.trim()) mark($(id)); });
    if (!def().noCase && !String(cs().num || "").trim()) mark($("c_num"));
    if (first) { status(def().noCase ? "Заполни подсвеченные поля: дознаватель." : "Заполни подсвеченные поля: дознаватель и номер дела.", "err"); first.focus(); return false; }
    const D = def(), probs = D.check ? D.check(ctx(), dd()) : [];
    if (probs.length && !confirm("По требованиям УПК не хватает:\n• " + probs.join("\n• ") + "\n\nВсё равно продолжить?")) return false;
    return true;
  }

  async function renderPNG() {
    if (document.fonts) await document.fonts.ready;
    await stampLoaded();
    return html2canvas($("paper"), {
      scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false,
      onclone: doc => { const p = doc.getElementById("paper"); p.classList.add("rendering"); if (!$("stampOn").checked) doc.getElementById("stamp").remove(); }
    });
  }
  function fileBase() { return "ud_" + (String(cs().num).replace(/[^\w-]/g, "") || "x").slice(0, 16) + "_" + docKey; }
  function link(u) { u = String(u).trim(); return /^https?:/i.test(u) ? u : "https://" + u; }
  function buildPayload() {
    const D = def(), d = dd(), c = cs();
    const off = `${$("fromPos").value.trim()}, ${$("fromRank").value.trim()} ${$("fromName").value.trim()} | ${$("staticId").value.trim()}`;
    const ev = evOk();
    const lines = [
      D.noCase ? `⚖️ **МАТЕРИАЛ ПРОВЕРКИ${d.regNo && d.regNo.trim() ? " · рег. № " + d.regNo.trim() : ""}** · ${D.short}` : `⚖️ **УГОЛОВНОЕ ДЕЛО № ${c.num}** · ${D.short}`,
      `**Основание:** ${D.arts}`,
      `**Дознаватель:** ${off}`,
      c.article ? `**Статья УК:** ${c.article}` : "",
      c.suspName ? `**Лицо:** ${c.suspName}${c.suspInfo ? ", " + c.suspInfo : ""}` : "",
      (c.victim || "").trim() ? `**Потерпевший:** ${c.victim.trim()}` : "",
      (c.applicant || "").trim() ? `**Заявитель:** ${c.applicant.trim()}` : "",
      `**Дата:** ${human(d.date)}`,
      D.route ? `**Направить:** ${D.route}` : "",
      d.video ? `**Видеозапись:** ${link(d.video)}` : ""
    ].filter(Boolean);
    if (ev.length) { lines.push("**Приложение:**"); ev.forEach((x, i) => lines.push(`${i + 1}. ${(x.t || "Материал").trim()}${x.u ? " — " + link(x.u) : ""}`)); }
    let body = lines.join("\n");
    const payload = { username: "Военная полиция · Рапорты", allowed_mentions: { parse: [], roles: C.roles || [] } };
    if (body.length > 1700) {
      const head = lines.slice(0, lines.indexOf("**Приложение:**") < 0 ? lines.length : lines.indexOf("**Приложение:**"));
      body = head.join("\n").slice(0, 1600) + "\n**Приложение:** ссылки в карточке ниже";
      const chunks = []; let cur = "";
      ev.forEach((x, i) => { const l = `${i + 1}. ${(x.t || "Материал").trim()}${x.u ? " — " + link(x.u) : ""}\n`; if ((cur + l).length > 1000) { chunks.push(cur); cur = ""; } cur += l; });
      if (cur) chunks.push(cur);
      payload.embeds = [{ title: "Приложение", color: 0xC9A227, fields: chunks.slice(0, 25).map((v, i) => ({ name: `Материалы, часть ${i + 1}`, value: v, inline: false })) }];
    }
    payload.content = [(C.roles || []).map(x => `<@&${x}>`).join(" "), body].filter(Boolean).join("\n").replace(/@(everyone|here)/g, "@\u200b$1");
    return payload;
  }
  function authHead() { return { Authorization: "Bearer " + ((window.VP_SESSION && window.VP_SESSION()) || "") }; }
  function busy(b) { ["send", "download"].forEach(id => $(id).disabled = b); }
  function status(t, cls) { const s = $("status"); s.textContent = t; s.className = "status " + (cls || ""); }

  $("send").addEventListener("click", async () => {
    if (!validate()) return;
    const target = C.endpoint || (C.directWebhook ? C.directWebhook + (C.directWebhook.includes("?") ? "&" : "?") + "wait=true" : "");
    if (!target) { status("Адрес отправки не настроен.", "err"); return; }
    busy(true); status("Печатаю бланк…");
    try {
      const canvas = await renderPNG();
      const fd = new FormData();
      fd.append("payload_json", JSON.stringify(buildPayload()));
      await VP_PAGES.addFiles(fd, canvas, fileBase());
      fd.append("kind", "ud_" + docKey);
      fd.append("num", String(cs().num));
      status("Отправляю в Discord…");
      const res = await fetch(target, { method: "POST", body: fd, headers: C.endpoint ? authHead() : undefined });
      const t = await res.text();
      if (res.status === 403) throw new Error(t || "Сначала войди через Discord");
      if (!res.ok) throw new Error(`${res.status} ${t}`);
      dd().sent = Date.now(); save();
      status(def().noCase ? `«${def().short}» отправлен.` : `«${def().short}» по УД № ${cs().num} отправлен.`, "ok");
    } catch (e) { status("Не отправилось: " + e.message, "err"); } finally { busy(false); }
  });
  $("download").addEventListener("click", async () => {
    if (!validate()) return;
    busy(true); status("Печатаю бланк…");
    try { const n = VP_PAGES.download(await renderPNG(), fileBase()); status(n > 1 ? `Скачано листов: ${n}.` : "Скачано.", "ok"); }
    catch (e) { status("Не получилось: " + e.message, "err"); } finally { busy(false); }
  });
  $("clearDoc").addEventListener("click", () => {
    if (!confirm("Очистить поля этого бланка в текущем деле?")) return;
    delete cs().docs[docKey]; save(); fillDoc();
  });

  fillCases(); fillDoc(); updateSignature();
  window.__ud = { buildPayload, renderPNG, setDoc: k => { docKey = k; fillDoc(); }, S, save, fillCases, fillDoc, paint };
})();
