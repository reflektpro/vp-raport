(async () => {
  const C = window.VP_CONFIG || {};
  const live = window.VP_RULES ? await window.VP_RULES : null;
  if (live && live.promo && Array.isArray(live.promo.acts)) window.PROMO = live.promo;
  if (live && live.vygovor && Array.isArray(live.vygovor.units)) window.VYG = live.vygovor;
  const $ = id => document.getElementById(id);
  const MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  const SAVED = ["fromPos","fromRank","fromName","staticId"];
  const RANK_INS = {"рядовой":"рядового","ефрейтор":"ефрейтора","младший сержант":"младшего сержанта","сержант":"сержанта","старший сержант":"старшего сержанта","старшина":"старшины","прапорщик":"прапорщика","старший прапорщик":"старшего прапорщика","младший лейтенант":"младшего лейтенанта","лейтенант":"лейтенанта","старший лейтенант":"старшего лейтенанта","капитан":"капитана","майор":"майора","подполковник":"подполковника","полковник":"полковника","генерал-майор":"генерал-майора","генерал-лейтенант":"генерал-лейтенанта","генерал-полковник":"генерал-полковника","генерал армии":"генерала армии"};
  let P = window.PROMO;
  let CATS = [];
  function buildCats(){
    CATS = [];
    P.acts.forEach(a => {
      CATS.push(a);
      if (a.key === "vzysk") CATS.push({ key:"vygovor", name:"Выговор, не из рапорта выше", pts:0, doc:"Выговоров, не вошедших в рапорты на взыскание", sub:true });
    });
    CATS.push({ key:"proc", name:"Передача процессуальных действий", pts:0, doc:"Передано процессуальных действий" });
  }
  buildCats();

  $("hdr").innerHTML = (C.header||[]).map(esc).join("<br>");
  $("city").textContent = C.city || "Москва";
  const now = new Date();
  $("date").value = `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()} г.`;
  SAVED.forEach(id => { const v = localStorage.getItem("vp_"+id); if (v) $(id).value = v; });

  const weekAgo = new Date(now); weekAgo.setDate(now.getDate()-6);
  $("fromDate").value = iso(weekAgo);
  $("toDate").value = iso(now);

  const meas = document.createElement("canvas").getContext("2d");
  function fit(el){
    const cs = getComputedStyle(el);
    meas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const w = Math.max(meas.measureText(el.value || el.placeholder || "").width, 40);
    el.style.width = Math.ceil(w + 12) + "px";
  }
  document.querySelectorAll("input[data-fit]").forEach(el => { fit(el); el.addEventListener("input", () => fit(el)); });
  document.fonts && document.fonts.ready.then(() => {
    document.querySelectorAll("input[data-fit]").forEach(fit);
    updateSignature();
  });

  document.querySelectorAll(".f").forEach(el => el.addEventListener("input", () => {
    el.classList.remove("bad");
    if (SAVED.includes(el.id)) localStorage.setItem("vp_"+el.id, el.value.trim());
    if (["fromRank","fromName"].includes(el.id)) updateSignature();
    if (el.id === "fromName" || el.id === "staticId") dropPaper();
    refill();
  }));
  ["fromDate","toDate"].forEach(id => $(id).addEventListener("change", refill));

  function parseName(full){
    const p = full.trim().split(/\s+/).filter(Boolean).map(cap);
    if (p.length >= 3) return {surname:p[0], short:`${p[0]} ${p[1][0]}. ${p[2][0]}.`, initial:p[1][0]};
    if (p.length === 2) return {surname:p[1], short:`${p[1]} ${p[0][0]}.`, initial:p[0][0]};
    if (p.length === 1) return {surname:p[0], short:p[0], initial:""};
    return null;
  }
  function rng(seedStr){
    let h = 2166136261;
    for (const ch of seedStr) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
  }
  function updateSignature(){
    const n = parseName($("fromName").value);
    const t = $("autoText"), path = $("autoPath");
    const hint = document.querySelector(".sign-hint");
    if (!n){ t.textContent = ""; path.setAttribute("d",""); hint.textContent = "подпись появится сама"; drawStamp("x"); return; }
    hint.textContent = "в документе: " + n.short;
    const r = rng(n.surname + n.initial);
    const len = 3 + Math.floor(r()*3);
    t.textContent = (n.initial || "") + n.surname[0] + n.surname.slice(1, len).toLowerCase();
    const fs = 34 + Math.round(r()*8);
    t.style.fontSize = fs + "px";
    t.style.transform = `rotate(${-(4 + r()*8)}deg) skewX(${-(6 + r()*10)}deg)`;
    meas.font = `${fs}px "Marck Script"`;
    const tw = Math.min(150, meas.measureText(t.textContent).width);
    const ex = 14 + tw, ey = 38 + r()*8;
    path.setAttribute("d", `M ${ex} ${ey}
      C ${ex + 18} ${ey + 22}, ${ex - 40} ${ey + 34}, ${18 + r()*10} ${70 + r()*8}
      C ${4} ${84}, ${60 + r()*20} ${78 + r()*6}, ${120 + r()*20} ${64 + r()*6}
      S ${200 + r()*15} ${44 + r()*10}, ${226 + r()*8} ${40 + r()*8}`);
    drawStamp(n.surname);
  }
  function drawStamp(seed){
    const S = 360, cv = document.createElement("canvas"); cv.width = cv.height = S;
    const g = cv.getContext("2d"), cx = S/2, ink = "rgba(36,58,160,1)";
    g.strokeStyle = ink; g.fillStyle = ink;
    ring(g, cx, 172, 5); ring(g, cx, 162, 2); ring(g, cx, 118, 3);
    circleText(g, (C.stampOuter||"") + " ✶ ", cx, 138, "bold 25px 'Times New Roman', Tinos, serif");
    circleText(g, (C.stampInner||"") + " ✶ ", cx, 98, "bold 17px 'Times New Roman', Tinos, serif");
    g.font = "bold 28px 'Times New Roman', Tinos, serif"; g.textAlign = "center";
    g.fillText(C.stampCenter || "", cx, cx + 62);
    const em = $("emblemSrc");
    if (em && em.complete && em.naturalWidth){
      const t = document.createElement("canvas"); t.width = 130; t.height = 88;
      const tg = t.getContext("2d"); tg.drawImage(em, 0, 0, 130, 88);
      tg.globalCompositeOperation = "source-in"; tg.fillStyle = ink; tg.fillRect(0,0,130,88);
      g.drawImage(t, cx-65, cx-62);
    }
    const r = rng("stamp" + seed), img = g.getImageData(0,0,S,S), a = img.data;
    for (let i = 3; i < a.length; i += 4) if (a[i] && r() < 0.18) a[i] = a[i] * (0.25 + r()*0.5);
    g.putImageData(img, 0, 0);
    const out = document.createElement("canvas"); out.width = out.height = S;
    const og = out.getContext("2d"); og.translate(cx,cx); og.rotate((r()*40-20)*Math.PI/180); og.drawImage(cv,-cx,-cx);
    $("stamp").src = out.toDataURL("image/png");
  }
  function ring(g, c, rad, w){ g.lineWidth = w; g.beginPath(); g.arc(c, c, rad, 0, Math.PI*2); g.stroke(); }
  function circleText(g, text, c, rad, font){
    g.save(); g.font = font; g.textAlign = "center"; g.textBaseline = "middle";
    const chars = [...text], step = (Math.PI*2) / chars.length;
    chars.forEach((ch, i) => {
      const ang = -Math.PI/2 + i*step;
      g.save(); g.translate(c + rad*Math.cos(ang), c + rad*Math.sin(ang)); g.rotate(ang + Math.PI/2); g.fillText(ch, 0, 0); g.restore();
    });
    g.restore();
  }
  const emImg = new Image(); emImg.id = "emblemSrc"; emImg.src = "emblem.png"; emImg.style.display = "none";
  emImg.onload = () => updateSignature(); document.body.appendChild(emImg);
  $("stampOn").addEventListener("change", e => $("stamp").style.visibility = e.target.checked ? "visible" : "hidden");
  updateSignature();

  // ---------- работа за неделю ----------
  const state = JSON.parse(localStorage.getItem("vp_week") || "{}");
  const save = () => localStorage.setItem("vp_week", JSON.stringify(state));
  const st = k => (state[k] = state[k] || { n: 0, links: "" });
  const LINK = /^(https?:\/\/)?[^\s\/.]+(\.[^\s\/.]+)+(\/\S*)?$/i;
  const linksOf = k => (st(k).links || "").split(/\s+/).map(s => s.trim()).filter(s => LINK.test(s));

  const box = $("acts");
  let group = null;
  function syncWeekFromDom(){
    box.querySelectorAll(".act").forEach(row => {
      const key = row.dataset.key, s = st(key);
      const nIn = row.querySelector("[data-n]"), once = row.querySelector("[data-once]"), ta = row.querySelector("textarea");
      if (nIn) s.n = Math.max(0, Number(nIn.value) || 0);
      if (once) s.n = once.checked ? 1 : 0;
      if (ta) s.links = ta.value;
    });
    save();
  }
  function fillWeekActs(){
    box.innerHTML = "";
    CATS.forEach(c => {
      const row = document.createElement("div");
      row.className = "act" + (c.sub ? " sub" : "");
      row.dataset.key = c.key;
      row.innerHTML = `
      <div class="act-top">
        <div class="act-name">${esc(c.name)}${c.pts ? `<span class="pts">+${c.pts}</span>` : ""}</div>
        ${c.once
          ? `<label class="act-once"><input type="checkbox" data-once ${st(c.key).n ? "checked" : ""}></label>`
          : `<div class="ctr"><button data-d="-1">−</button><input type="number" min="0" value="${st(c.key).n}" data-n><button data-d="1">+</button></div>`}
      </div>
      <details><summary>ссылки (<span data-lc>0</span>)</summary><textarea rows="2" placeholder="по одной ссылке на строку"></textarea></details>`;
      row.querySelector("textarea").value = st(c.key).links;
      box.appendChild(row);
    });
    const vz = box.querySelector('[data-key="vzysk"]'), vg = box.querySelector('[data-key="vygovor"]');
    group = document.createElement("div"); group.className = "cat-group";
    if (vz && vg) { vz.before(group); group.append(vz, vg); }
  }
  fillWeekActs();
  window.addEventListener("vp-rules", () => {
    syncWeekFromDom();
    P = window.PROMO;
    if (!P || !Array.isArray(P.acts)) return;
    buildCats();
    fillWeekActs();
    refill();
  });

  box.addEventListener("click", e => {
    const b = e.target.closest("button[data-d]"); if (!b) return;
    const key = b.closest(".act").dataset.key, s = st(key);
    s.n = Math.max(0, s.n + Number(b.dataset.d));
    b.parentElement.querySelector("[data-n]").value = s.n;
    save(); refill();
  });
  box.addEventListener("change", e => { if (e.target.matches("[data-once]")) { st(e.target.closest(".act").dataset.key).n = e.target.checked ? 1 : 0; save(); refill(); } });
  box.addEventListener("input", e => {
    const row = e.target.closest(".act"); if (!row) return;
    const s = st(row.dataset.key);
    if (e.target.matches("[data-n]")) s.n = Math.max(0, Number(e.target.value) || 0);
    if (e.target.matches("[data-once]")) s.n = e.target.checked ? 1 : 0;
    if (e.target.matches("textarea")) {
      s.links = e.target.value;
      const got = linksOf(row.dataset.key).length;
      const once = row.querySelector("[data-once]");
      if (once) { if (got && !s.n) { s.n = 1; once.checked = true; } }
      else if (got > s.n) { s.n = got; row.querySelector("[data-n]").value = s.n; }
    }
    save(); refill();
  });

  function done(){ return CATS.map(c => ({...c, n: st(c.key).n, links: linksOf(c.key)})).filter(c => c.n > 0); }
  function totalPts(){ return CATS.reduce((s,c) => s + st(c.key).n * (c.pts || 0), 0); }
  function bothCounted(){ return st("vzysk").n > 0 && st("vygovor").n > 0; }

  function refill(){
    const n = parseName($("fromName").value);
    $("nameInText").textContent = $("fromName").value.trim() || "________";
    $("posInText").textContent = $("fromPos").value.trim() || "________";
    const rank = $("fromRank").value.trim();
    $("rankInText").textContent = RANK_INS[rank.toLowerCase()] || rank.toLowerCase() || "________";
    $("staticInText").textContent = $("staticId").value.trim() || "____";
    $("fromText").textContent = human($("fromDate").value);
    $("toText").textContent = human($("toDate").value);

    const list = done();
    const pts = totalPts();
    $("workList").innerHTML = list.length
      ? list.map(c => `<li>${esc(c.doc || c.name)}: ${c.n}${c.pts ? ` (${c.n * c.pts} баллов)` : ""}.</li>`).join("")
      : `<li class="ph">здесь появится сделанное за неделю</li>`;
    $("summary").textContent = pts ? `Итого набрано баллов: ${pts}.` : "";
    $("barText").textContent = pts ? `${pts} баллов за неделю` : "0 баллов";
    $("barFill").style.width = pts ? "100%" : "0";
    $("barFill").classList.toggle("full", pts > 0);
    const proofs = list.reduce((s,c) => s + c.links.length, 0);
    $("proofCount").textContent = proofs;
    $("appendix").style.display = proofs ? "" : "none";
    box.querySelectorAll(".act").forEach(row => {
      const s = st(row.dataset.key);
      row.classList.toggle("done", s.n > 0);
      row.querySelector("[data-lc]").textContent = linksOf(row.dataset.key).length;
    });
    if (group) group.classList.toggle("on", st("vzysk").n > 0 || st("vygovor").n > 0);
    $("vygNote").classList.toggle("ok", !bothCounted());
  }

  function linkList(links){
    return links.map((u,i) => `[${i+1}](${/^https?:/i.test(u) ? u : "https://" + u})`).join(" ");
  }
  function buildPayload(){
    const roles = C.roles || [];
    const fromLine = `${$("fromPos").value.trim()}, ${$("fromRank").value.trim()} ${$("fromName").value.trim()} | ${$("staticId").value.trim()}`;
    const period = `${human($("fromDate").value)} — ${human($("toDate").value)}`;
    const list = done();
    const lines = list.map(c => `${c.doc || c.name} (${c.n}${c.pts ? `, ${c.n * c.pts} б.` : ""}): ${linkList(c.links)}`.trim());
    let body = [
      `📋 **ЕЖЕНЕДЕЛЬНЫЙ ОТЧЁТ №${$("num").value.trim()}**`,
      `**От:** ${fromLine}`,
      `**Период:** ${period}`,
      `**Баллы:** ${totalPts()}`,
      "",
      `Я, ${$("fromName").value.trim()}, ${$("fromPos").value.trim()} в звании ${$("rankInText").textContent} в промежуток времени от ${human($("fromDate").value)} до ${human($("toDate").value)} выполнил следующую работу:`,
      ...lines
    ].join("\n");
    const fields = [];
    if (body.length > 1700) {
      body = body.split("\n").map(l => l.replace(/: \[.*/, ": ссылки в карточке ниже")).join("\n").slice(0, 1700);
      list.forEach(c => { if (c.links.length) fields.push({ name: `${c.name} ×${c.n}`.slice(0,250), value: linkList(c.links).slice(0,1000), inline: false }); });
    }
    const payload = {
      username: "Военная полиция · Рапорты",
      content: [roles.map(x => `<@&${x}>`).join(" "), body].filter(Boolean).join("\n").replace(/@(everyone|here)/g, "@\u200b$1"),
      allowed_mentions: { parse: [], roles },
      attachments: [{ id: 0, filename: "raport.png" }]
    };
    if (fields.length) payload.embeds = [{ title: "Доказательства", color: 0xC9A227, fields: fields.slice(0, 25) }];
    return payload;
  }

  async function renderPNG(){
    if (document.fonts) await document.fonts.ready;
    const n = parseName($("fromName").value);
    return html2canvas($("paper"), {
      scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false,
      onclone: doc => {
        const p = doc.getElementById("paper"); p.classList.add("rendering");
        p.querySelectorAll("input.f").forEach(el => {
          const s = doc.createElement("span");
          s.textContent = el.id === "fromName" && n ? n.short : el.value.trim();
          el.replaceWith(s);
        });
        p.querySelectorAll("#workList .ph").forEach(e => e.remove());
        if (!$("stampOn").checked) doc.getElementById("stamp").remove();
      }
    });
  }

  function personKey(){ return $("fromName").value.trim() + "|" + $("staticId").value.trim(); }
  function authHead(extra){
    const h = extra ? Object.assign({}, extra) : {};
    h.Authorization = "Bearer " + ((window.VP_SESSION && window.VP_SESSION()) || "");
    return h;
  }
  // Номер: база предлагает следующий, поле можно править. Занятый номер тоже записывается —
  // с предупреждением в строке статуса (дубль разрешён нарочно), PNG и Discord берут этот номер.
  const numBox = window.VP_NUM({ el: $("num"), kind: () => "week", person: personKey, fit });
  function dropPaper(){ numBox.changed(); }
  async function takePaper(){
    if (!C.endpoint) throw new Error("База номеров не подключена");
    return numBox.take(raw => fetch(String(C.endpoint).replace(/\/$/, "") + "/paper", {
      method: "POST",
      headers: authHead({ "Content-Type": "application/json" }),
      body: JSON.stringify({ kind: "week", num: raw, name: $("fromName").value.trim(), passport: "" })
    }));
  }

  function validate(){
    let ok = true, first = null;
    document.querySelectorAll(".f.req").forEach(el => { if (!el.value.trim()){ el.classList.add("bad"); ok = false; first = first || el; } });
    if (!ok){ status("Заполни подсвеченные красным поля.", "err"); first.focus(); return false; }
    if (!$("fromDate").value || !$("toDate").value){ status("Укажи период отчёта.", "err"); return false; }
    if (!done().length){ status("Отметь, что сделано за неделю.", "err"); return false; }
    return true;
  }
  $("send").addEventListener("click", async () => {
    if (!validate()) return;
    if (bothCounted() && !confirm("И рапорты на взыскание, и выговоры заполнены. Выговор, выданный этим же рапортом, второй раз считать нельзя. Всё равно отправить?")) return;
    const target = C.endpoint || (C.directWebhook ? C.directWebhook + (C.directWebhook.includes("?") ? "&" : "?") + "wait=true" : "");
    if (!target){ status("Адрес отправки не настроен: заполни endpoint в config.js.", "err"); return; }
    busy(true); status("Беру номер…");
    try {
      await takePaper();
      numStatus("Печатаю бланк…");
      const canvas = await renderPNG();
      const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("Не удалось напечатать бланк, попробуй ещё раз");
      const fd = new FormData();
      fd.append("payload_json", JSON.stringify(buildPayload()));
      fd.append("files[0]", new File([blob], "raport.png", { type: "image/png" }));
      fd.append("kind", "week");
      fd.append("num", $("num").value.trim());
      numStatus("Отправляю в Discord…");
      const res = await fetch(target, { method: "POST", body: fd, headers: C.endpoint ? authHead() : undefined });
      const errText = await res.text();
      if (res.status === 403) throw new Error(errText || "Сначала войди через Discord");
      if (!res.ok) throw new Error(`${res.status} ${errText}`);
      numStatus(`Отчёт №${$("num").value} отправлен. Руководство уведомлено.`, "ok");
      numBox.sent();
    } catch (e) { status("Не отправилось: " + e.message, "err"); } finally { busy(false); }
  });
  $("download").addEventListener("click", async () => {
    if (!validate()) return;
    busy(true); status("Беру номер…");
    try {
      await takePaper();
      numStatus("Печатаю бланк…");
      const canvas = await renderPNG(), a = document.createElement("a");
      a.href = canvas.toDataURL("image/png"); a.download = `otchet_${$("num").value.replace(/[^\wА-я-]/g,"_")}.png`; a.click();
      numStatus("Картинка скачана.", "ok");
    } catch (e) { status("Ошибка: " + e.message, "err"); } finally { busy(false); }
  });
  $("clear").addEventListener("click", () => {
    if (!confirm("Обнулить всё, что отмечено за эту неделю?")) return;
    Object.keys(state).forEach(k => delete state[k]); save(); location.reload();
  });

  refill();
  window.__vp = { buildPayload, renderPNG, state, done };
  function busy(b){ ["send","download"].forEach(id => $(id).disabled = b); }
  function status(t, cls){ const s = $("status"); s.textContent = t; s.className = "status " + (cls||""); }
  // Статус после записи номера: если номер уже был у другого документа, показываем предупреждение (не ошибку).
  function numStatus(t, cls){ const w = numBox.warning ? numBox.warning() : ""; status(w ? numBox.note(t) : t, w ? "warn" : cls); }
  function pad(n){ return String(n).padStart(2,"0"); }
  function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
  function esc(s){ return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
  function iso(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
  function human(v){ const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v||""); return m ? `${m[3]}.${m[2]}.${m[1]}` : "ДД.ММ.ГГГГ"; }
})();
