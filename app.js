(() => {
  const C = window.VP_CONFIG || {};
  const $ = id => document.getElementById(id);
  const MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  const RANK_GEN = {"рядовой":"рядового","ефрейтор":"ефрейтора","младший сержант":"младшего сержанта","сержант":"сержанта","старший сержант":"старшего сержанта","старшина":"старшины","прапорщик":"прапорщика","старший прапорщик":"старшего прапорщика","младший лейтенант":"младшего лейтенанта","лейтенант":"лейтенанта","старший лейтенант":"старшего лейтенанта","капитан":"капитана","майор":"майора","подполковник":"подполковника","полковник":"полковника","генерал-майор":"генерал-майора"};
  const SAVED = ["fromPos","fromRank","fromName"];

  // ---------- шапка и значения по умолчанию ----------
  $("hdr").innerHTML = (C.header||[]).map(esc).join("<br>");
  $("city").textContent = C.city || "Москва";
  const now = new Date();
  $("date").value = `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()} г.`;
  SAVED.forEach(id => { const v = localStorage.getItem("vp_"+id); if (v) $(id).value = v; });

  // ---------- автоширина полей и автовысота текстовых блоков ----------
  const meas = document.createElement("canvas").getContext("2d");
  function fit(el){
    const cs = getComputedStyle(el);
    meas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const w = Math.max(meas.measureText(el.value || el.placeholder || "").width, 40);
    el.style.width = Math.ceil(w + 12) + "px";
  }
  function grow(el){ el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
  document.querySelectorAll("input[data-fit]").forEach(el => { fit(el); el.addEventListener("input", () => fit(el)); });
  document.querySelectorAll("textarea.f").forEach(el => { grow(el); el.addEventListener("input", () => grow(el)); });
  document.fonts && document.fonts.ready.then(() => {
    document.querySelectorAll("input[data-fit]").forEach(fit);
    document.querySelectorAll("textarea.f").forEach(grow);
    updateSignature();
  });

  document.querySelectorAll(".f").forEach(el => el.addEventListener("input", () => {
    el.classList.remove("bad");
    if (SAVED.includes(el.id)) localStorage.setItem("vp_"+el.id, el.value.trim());
    if (["fromRank","fromName"].includes(el.id)) updateSignature();
    if (el.id === "tName" || el.id === "tPass") dropPaper();
  }));

  // ---------- ФИО ----------
  function parseName(full){
    const p = full.trim().split(/\s+/).filter(Boolean).map(cap);
    if (p.length >= 3) return {surname:p[0], short:`${p[0]} ${p[1][0]}. ${p[2][0]}.`, initial:p[1][0]};
    if (p.length === 2) return {surname:p[1], short:`${p[1]} ${p[0][0]}.`, initial:p[0][0]};
    if (p.length === 1) return {surname:p[0], short:p[0], initial:""};
    return null;
  }
  function surnameGen(s){
    const l = s.toLowerCase();
    if (/(ский|цкий)$/.test(l)) return s.slice(0,-2)+"ого";
    if (/(ов|ев|ёв|ин|ын)$/.test(l)) return s+"а";
    return s;
  }

  // ---------- автоподпись ----------
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
    // росчерк: от конца подписи петлёй вниз-влево и длинным хвостом вправо (в пределах 240x100)
    const ex = 14 + tw, ey = 38 + r()*8;
    const d = `M ${ex} ${ey}
      C ${ex + 18} ${ey + 22}, ${ex - 40} ${ey + 34}, ${18 + r()*10} ${70 + r()*8}
      C ${4} ${84}, ${60 + r()*20} ${78 + r()*6}, ${120 + r()*20} ${64 + r()*6}
      S ${200 + r()*15} ${44 + r()*10}, ${226 + r()*8} ${40 + r()*8}`;
    path.setAttribute("d", d);
    drawStamp(n.surname);
  }

  // ---------- печать ----------
  function drawStamp(seed){
    // оттиск — готовая картинка stamp.png, повёрнутая на случайный (но постоянный для фамилии) угол
    if (!stampSrc.complete || !stampSrc.naturalWidth) return;
    const S = 440, cx = S/2, d = S*0.97, r = rng("stamp" + seed);
    const out = document.createElement("canvas"); out.width = out.height = S;
    const og = out.getContext("2d"); og.translate(cx,cx); og.rotate((r()*40-20)*Math.PI/180); og.drawImage(stampSrc,-d/2,-d/2,d,d);
    $("stamp").src = out.toDataURL("image/png");
  }
  const stampSrc = new Image(); stampSrc.src = "stamp.png";
  const stampReady = stampSrc.decode().catch(() => {}).then(() => updateSignature());
  async function stampLoaded(){
    await stampReady;
    const s = $("stamp"); if (s.getAttribute("src")) await s.decode().catch(() => {});
  }
  $("stampOn").addEventListener("change", e => $("stamp").style.visibility = e.target.checked ? "visible" : "hidden");
  updateSignature();

  // ---------- проверка ----------
  const LINK = /^(https?:\/\/)?[^\s\/.]+(\.[^\s\/.]+)+(\/\S*)?$/i;
  function validate(){
    let ok = true, first = null;
    document.querySelectorAll(".f.req").forEach(el => {
      if (!el.value.trim()){ el.classList.add("bad"); ok = false; first = first || el; }
    });
    const bc = $("bodycam");
    if (bc.value.trim() && !LINK.test(bc.value.trim())){ bc.classList.add("bad"); ok = false; first = first || bc; status("Это не похоже на ссылку. Вставь адрес видео целиком.", "err"); }
    else if (!ok) status("Заполни подсвеченные красным поля.", "err");
    if (first) first.focus();
    return ok;
  }

  // ---------- картинка ----------
  async function renderPNG(){
    if (document.fonts) await document.fonts.ready;
    await stampLoaded();
    const n = parseName($("fromName").value);
    const canvas = await html2canvas($("paper"), {
      scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false,
      onclone: doc => {
        const p = doc.getElementById("paper"); p.classList.add("rendering");
        p.querySelectorAll("input.f").forEach(el => {
          const s = doc.createElement("span");
          let v = el.value.trim();
          if (el.id === "fromName" && n) v = n.short;
          if (el.id === "bodycam") { el.remove(); return; }
          if (el.id === "tRank") v = v.toLowerCase();
          s.textContent = v; el.replaceWith(s);
        });
        p.querySelectorAll("textarea.f").forEach(el => {
          const d = doc.createElement("div");
          d.style.whiteSpace = "pre-wrap"; d.style.textAlign = "justify";
          const tv = el.value.trim(); d.textContent = el.id === "proof" ? cap(tv) : (tv || "—"); el.replaceWith(d);
        });
        const hasBc = !!$("bodycam").value.trim(), hasPr = !!$("proof").value.trim();
        p.querySelectorAll(".bc-colon").forEach(e => e.remove());
        if (!hasBc) doc.getElementById("appendixRow").remove();
        if (!hasPr) doc.getElementById("appendixRow2").remove();
        else if (!hasBc) doc.getElementById("app2num").textContent = "1.";
        if (!hasBc && !hasPr) p.querySelector(".appendix").remove();
        if (!$("stampOn").checked) doc.getElementById("stamp").remove();
      }
    });
    return canvas;
  }

  function digitsOnly(s){ return String(s || "").replace(/\D/g, ""); }
  function personKey(){ return $("tName").value.trim() + "|" + digitsOnly($("tPass").value); }
  function authHead(extra){
    const h = extra ? Object.assign({}, extra) : {};
    h.Authorization = "Bearer " + ((window.VP_SESSION && window.VP_SESSION()) || "");
    return h;
  }
  // Номер: база предлагает следующий, поле можно править. Занятый номер тоже записывается —
  // с предупреждением в строке статуса (дубль разрешён нарочно), PNG и Discord берут этот номер.
  const numBox = window.VP_NUM({ el: $("num"), kind: () => "raport", person: personKey, fit });
  function dropPaper(){ numBox.changed(); }
  async function takePaper(){
    if (!C.endpoint) throw new Error("База номеров не подключена");
    return numBox.take(raw => fetch(String(C.endpoint).replace(/\/$/, "") + "/paper", {
      method: "POST",
      headers: authHead({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        kind: "raport",
        num: raw,
        name: $("tName").value.trim() || $("fromName").value.trim(),
        passport: digitsOnly($("tPass").value)
      })
    }));
  }

  // ---------- отправка ----------
  function buildPayload(){
    const roles = (C.roles||[]).filter(Boolean);
    const bc = $("bodycam").value.trim();
    const url = bc && !/^https?:/i.test(bc) ? "https://" + bc : bc;
    const lines = [
      roles.map(r => `<@&${r}>`).join(" "),
      `📄 **РАПОРТ №${$("num").value.trim()}** о совершении дисциплинарного проступка`,
      `**От:** ${$("fromPos").value.trim()}, ${$("fromRank").value.trim()} ${$("fromName").value.trim()}`,
      `**Нарушитель:** ${$("tRank").value.trim()} ${$("tName").value.trim()} | паспорт ${$("tPass").value.trim()}`
    ];
    if (url) lines.push(`**Приложение:** [Боди камера](${url})`);
    return {
      username: "Военная полиция · Рапорты",
      content: lines.filter(Boolean).join("\n").replace(/@(everyone|here)/g, "@\u200b$1"),
      allowed_mentions: { parse: [], roles },
      attachments: [{ id: 0, filename: "raport.png" }]
    };
  }

  $("send").addEventListener("click", async () => {
    if (!validate()) return;
    const target = C.endpoint || (C.directWebhook ? C.directWebhook + (C.directWebhook.includes("?") ? "&" : "?") + "wait=true" : "");
    if (!target){ status("Адрес отправки не настроен: заполни endpoint в config.js.", "err"); return; }
    busy(true); status("Беру номер…");
    try {
      await takePaper();
      numStatus("Печатаю бланк…");
      const canvas = await renderPNG();
      const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
      const fd = new FormData();
      fd.append("payload_json", JSON.stringify(buildPayload()));
      if (!blob) throw new Error("Не удалось напечатать бланк, попробуй ещё раз");
      fd.append("files[0]", new File([blob], "raport.png", { type: "image/png" }));
      fd.append("kind", "raport");
      fd.append("num", $("num").value.trim());
      numStatus("Отправляю в Discord…");
      const res = await fetch(target, { method: "POST", body: fd, headers: C.endpoint ? authHead() : undefined });
      const errText = await res.text();
      if (res.status === 403) throw new Error(errText || "Сначала войди через Discord");
      if (!res.ok) throw new Error(`${res.status} ${errText}`);
      numStatus(`Рапорт №${$("num").value} отправлен. Руководство уведомлено.`, "ok");
      numBox.sent();
    } catch (e) {
      status("Не отправилось: " + e.message, "err");
    } finally { busy(false); }
  });

  $("download").addEventListener("click", async () => {
    if (!validate()) return;
    busy(true); status("Беру номер…");
    try {
      await takePaper();
      numStatus("Печатаю бланк…");
      const canvas = await renderPNG();
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png"); a.download = `raport_${$("num").value.replace(/[^\wА-я-]/g,"_")}.png`; a.click();
      numStatus("Картинка скачана.", "ok");
    } catch (e) { status("Ошибка: " + e.message, "err"); } finally { busy(false); }
  });

  $("clear").addEventListener("click", () => {
    ["tRank","tName","tPass","what","norms","proof","factors","bodycam"].forEach(id => { $(id).value = ""; $(id).classList.remove("bad"); });
    document.querySelectorAll("input[data-fit]").forEach(fit);
    document.querySelectorAll("textarea.f").forEach(grow);
    dropPaper();
    status("");
  });

  // для автотеста
  window.__vp = { renderPNG, buildPayload, validate };

  function busy(b){ ["send","download"].forEach(id => $(id).disabled = b); }
  function status(t, cls){ const s = $("status"); s.textContent = t; s.className = "status " + (cls||""); }
  // Статус после записи номера: если номер уже был у другого документа, показываем предупреждение (не ошибку).
  function numStatus(t, cls){ const w = numBox.warning ? numBox.warning() : ""; status(w ? numBox.note(t) : t, w ? "warn" : cls); }
  function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
  function esc(s){ return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
})();
