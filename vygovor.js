(() => {
  const C = window.VP_CONFIG || {};
  const UNITS = (window.VYG && window.VYG.units) || [];
  const $ = id => document.getElementById(id);
  const MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  const RANK_DAT = {
    "рядовой":"рядовому","ефрейтор":"ефрейтору","младший сержант":"младшему сержанту",
    "сержант":"сержанту","старший сержант":"старшему сержанту","старшина":"старшине",
    "прапорщик":"прапорщику","старший прапорщик":"старшему прапорщику",
    "младший лейтенант":"младшему лейтенанту","лейтенант":"лейтенанту",
    "старший лейтенант":"старшему лейтенанту","капитан":"капитану","майор":"майору",
    "подполковник":"подполковнику","полковник":"полковнику","генерал-майор":"генерал-майору",
    "генерал-лейтенант":"генерал-лейтенанту","генерал-полковник":"генерал-полковнику",
    "генерал армии":"генералу армии"
  };
  const SAVED = ["fromPos","fromRank","fromName"];
  const state = { kind: "vyg", reserved: null };

  $("city").textContent = C.city || "Москва";
  const now = new Date();
  $("date").value = `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()} г.`;
  UNITS.forEach(u => {
    const o = document.createElement("option");
    o.value = u.id; o.textContent = u.name;
    $("unit").appendChild(o);
  });
  try {
    const saved = JSON.parse(localStorage.getItem("vp_vyg") || "{}");
    if (saved.kind === "pred" || saved.kind === "vyg") state.kind = saved.kind;
    if (UNITS.some(u => u.id === saved.unit)) $("unit").value = saved.unit;
  } catch (e) {}
  SAVED.forEach(id => { const v = localStorage.getItem("vp_"+id); if (v) $(id).value = v; });

  const meas = document.createElement("canvas").getContext("2d");
  function fit(el){
    const cs = getComputedStyle(el);
    meas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const w = Math.max(meas.measureText(el.value || el.placeholder || "").width, 40);
    el.style.width = Math.ceil(w + 12) + "px";
  }
  document.querySelectorAll("input[data-fit]").forEach(el => { fit(el); el.addEventListener("input", () => fit(el)); });
  $("num").value = "";
  fit($("num"));
  document.fonts && document.fonts.ready.then(() => {
    document.querySelectorAll("input[data-fit]").forEach(fit);
    updateSignature();
  });

  document.querySelectorAll(".sign .f").forEach(el => el.addEventListener("input", () => {
    el.classList.remove("bad");
    if (SAVED.includes(el.id)) localStorage.setItem("vp_"+el.id, el.value.trim());
    if (["fromRank","fromName"].includes(el.id)) updateSignature();
  }));
  ["tRank","tName","tPass"].forEach(id => $(id).addEventListener("input", () => {
    $(id).classList.remove("bad");
    if (id === "tPass") { dropNumber(); scheduleHistory(); }
    refill();
  }));
  $("unit").addEventListener("change", () => { persist(); refill(); });
  ["nPoint","nPart","nChapter"].forEach(id => $(id).addEventListener("input", () => { $(id).classList.remove("bad"); refill(); }));
  $("kind").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    state.kind = b.dataset.kind;
    dropNumber();
    persist();
    refill();
    loadHistory();
  });

  function unit(){ return UNITS.find(u => u.id === $("unit").value) || UNITS[0]; }
  function items(){ const u = unit(); return (u && u[state.kind]) || []; }
  function persist(){ localStorage.setItem("vp_vyg", JSON.stringify({ kind: state.kind, unit: $("unit").value })); }
  function digits(s){ return String(s || "").replace(/\D/g, ""); }
  function dropNumber(){
    const key = digits($("tPass").value) + "|" + state.kind;
    if (!state.reserved || state.reserved.key !== key) {
      state.reserved = null;
      $("num").value = "";
      fit($("num"));
    }
  }
  let histTimer = 0;
  function scheduleHistory(){ clearTimeout(histTimer); histTimer = setTimeout(loadHistory, 300); }
  async function loadHistory(){
    const box = $("hist");
    const passport = digits($("tPass").value);
    if (passport.length < 3 || !C.endpoint) { box.className = "hist"; box.innerHTML = ""; return; }
    try {
      const res = await fetch(C.endpoint + "?passport=" + encodeURIComponent(passport));
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const orders = data.orders || [];
      if (!orders.length) {
        box.className = "hist";
        box.innerHTML = "По этому паспорту записей нет.";
        return;
      }
      const lines = orders.map(o => {
        const kind = o.kind === "pred" ? "Предупреждение" : "Выговор";
        return `<li><b>${esc(o.num)}</b> ${esc(kind)}${o.issued ? ", " + esc(o.issued) : ""}${o.unit ? " · " + esc(o.unit) : ""}</li>`;
      }).join("");
      box.className = "hist repeat";
      box.innerHTML = `<b>Повторное.</b> По паспорту уже есть:<ol>${lines}</ol>`;
    } catch (e) {
      box.className = "hist";
      box.textContent = "Историю не удалось загрузить.";
    }
  }
  async function takeNumber(){
    const passport = digits($("tPass").value);
    const key = passport + "|" + state.kind;
    if (state.reserved && state.reserved.key === key) {
      $("num").value = state.reserved.num;
      fit($("num"));
      return state.reserved.num;
    }
    if (!C.endpoint) throw new Error("База номеров не подключена");
    const u = unit();
    const res = await fetch(C.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: state.kind,
        passport,
        name: $("tName").value.trim(),
        rank: $("tRank").value.trim(),
        unit: u ? u.name : "",
        issued: $("date").value.trim()
      })
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    if (!data.num) throw new Error("База не выдала номер");
    state.reserved = { key, num: data.num };
    $("num").value = data.num;
    fit($("num"));
    return data.num;
  }
  function rankDat(raw){
    const t = raw.trim();
    if (!t) return "";
    const d = RANK_DAT[t.toLowerCase()];
    const s = d || t.toLowerCase();
    return s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  function refill(){
    document.querySelectorAll("#kind button").forEach(b => b.classList.toggle("on", b.dataset.kind === state.kind));
    $("kindWord").textContent = state.kind === "pred" ? "предупреждения" : "выговора";
    $("rankShow").textContent = rankDat($("tRank").value) || "________";
    $("nameShow").textContent = $("tName").value.trim() || "________";
    $("passShow").textContent = $("tPass").value.trim() || "______";
    $("normPoint").textContent = $("nPoint").value.trim() || "___";
    $("normPart").textContent = $("nPart").value.trim() || "___";
    $("normChapter").textContent = $("nChapter").value.trim() || "___";
    const list = items();
    const html = list.map(esc).map(t => `<li>${t}</li>`).join("");
    $("workList").innerHTML = html;
    $("dutyPreview").innerHTML = html;
  }

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
  refill();

  function validate(){
    let ok = true, first = null;
    ["tRank","tName","tPass","fromPos","fromRank","fromName","nPoint","nPart","nChapter"].forEach(id => {
      const el = $(id);
      if (!el.value.trim()){ el.classList.add("bad"); ok = false; first = first || el; }
    });
    if (!unit()) { ok = false; status("Выбери подразделение.", "err"); }
    else if (!ok) status("Заполни подсвеченные красным поля.", "err");
    if (first) first.focus();
    return ok && !!unit();
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
          let v = el.value.trim();
          if (el.id === "fromName" && n) v = n.short;
          s.textContent = v; el.replaceWith(s);
        });
        if (!$("stampOn").checked) doc.getElementById("stamp").remove();
      }
    });
  }

  function buildPayload(){
    const roles = (C.roles||[]).filter(Boolean);
    const u = unit();
    const kind = state.kind === "pred" ? "Предупреждение" : "Выговор";
    const lines = [
      roles.map(r => `<@&${r}>`).join(" "),
      `📋 **ПРИКАЗ №${$("num").value.trim()}** о вынесении дисциплинарного взыскания`,
      `**Вид:** ${kind}`,
      `**Подразделение:** ${u ? u.name : ""}`,
      `**Кому:** ${$("tRank").value.trim()} ${$("tName").value.trim()} | паспорт ${$("tPass").value.trim()}`,
      `**От:** ${$("fromPos").value.trim()}, ${$("fromRank").value.trim()} ${$("fromName").value.trim()}`,
      `**Норма:** пункт ${$("nPoint").value.trim()} части ${$("nPart").value.trim()} главы ${$("nChapter").value.trim()} Дисциплинарного устава`,
      `**Отработка:** ${items().join("; ")}`
    ];
    return {
      content: lines.filter(Boolean).join("\n").replace(/@(everyone|here)/g, "@\u200b$1"),
      allowed_mentions: { parse: [], roles }
    };
  }

  $("send").addEventListener("click", async () => {
    if (!validate()) return;
    const target = C.endpoint || (C.directWebhook ? C.directWebhook + (C.directWebhook.includes("?") ? "&" : "?") + "wait=true" : "");
    if (!target){ status("Адрес отправки не настроен: заполни endpoint в config.js.", "err"); return; }
    busy(true); status("Беру номер…");
    try {
      await takeNumber();
      status("Печатаю бланк…");
      const canvas = await renderPNG();
      const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
      const fd = new FormData();
      fd.append("payload_json", JSON.stringify(buildPayload()));
      if (!blob) throw new Error("Не удалось напечатать бланк, попробуй ещё раз");
      fd.append("files[0]", new File([blob], "prikaz.png", { type: "image/png" }));
      status("Отправляю в Discord…");
      const res = await fetch(target, { method: "POST", body: fd });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      status(`Приказ №${$("num").value} отправлен. Руководство уведомлено.`, "ok");
      state.reserved = null;
      $("num").value = "";
      fit($("num"));
      loadHistory();
    } catch (e) {
      status("Не отправилось: " + e.message, "err");
    } finally { busy(false); }
  });

  $("download").addEventListener("click", async () => {
    if (!validate()) return;
    busy(true); status("Беру номер…");
    try {
      await takeNumber();
      status("Печатаю бланк…");
      const canvas = await renderPNG();
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `prikaz_${$("num").value.replace(/[^\wА-я-]/g,"_")}.png`;
      a.click();
      status("Картинка скачана.", "ok");
    } catch (e) { status("Ошибка: " + e.message, "err"); } finally { busy(false); }
  });

  $("clear").addEventListener("click", () => {
    ["tRank","tName","tPass"].forEach(id => { $(id).value = ""; $(id).classList.remove("bad"); });
    dropNumber();
    $("hist").className = "hist";
    $("hist").innerHTML = "";
    refill(); status("");
  });

  window.__vp = { renderPNG, buildPayload, state, items };
  function busy(b){ ["send","download"].forEach(id => $(id).disabled = b); }
  function status(t, cls){ const s = $("status"); s.textContent = t; s.className = "status " + (cls||""); }
  function pad(n){ return String(n).padStart(2,"0"); }
  function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
  function esc(s){ return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
})();
