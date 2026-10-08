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
  $("num").value = `ВП-${pad(now.getDate())}${pad(now.getMonth()+1)}/${100+Math.floor(Math.random()*900)}`;
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
    // неровности оттиска
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
    busy(true); status("Печатаю бланк…");
    try {
      const canvas = await renderPNG();
      const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
      const fd = new FormData();
      fd.append("payload_json", JSON.stringify(buildPayload()));
      fd.append("files[0]", blob, "raport.png");
      status("Отправляю в Discord…");
      const res = await fetch(target, { method: "POST", body: fd });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      status(`Рапорт №${$("num").value} отправлен. Руководство уведомлено.`, "ok");
      $("num").value = `ВП-${pad(now.getDate())}${pad(now.getMonth()+1)}/${100+Math.floor(Math.random()*900)}`; fit($("num"));
    } catch (e) {
      status("Не отправилось: " + e.message, "err");
    } finally { busy(false); }
  });

  $("download").addEventListener("click", async () => {
    if (!validate()) return;
    busy(true); status("Печатаю бланк…");
    try {
      const canvas = await renderPNG();
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png"); a.download = `raport_${$("num").value.replace(/[^\wА-я-]/g,"_")}.png`; a.click();
      status("Картинка скачана.", "ok");
    } catch (e) { status("Ошибка: " + e.message, "err"); } finally { busy(false); }
  });

  $("clear").addEventListener("click", () => {
    ["tRank","tName","tPass","what","norms","proof","factors","bodycam"].forEach(id => { $(id).value = ""; $(id).classList.remove("bad"); });
    document.querySelectorAll("input[data-fit]").forEach(fit);
    document.querySelectorAll("textarea.f").forEach(grow);
    status("");
  });

  // для автотеста
  window.__vp = { renderPNG, buildPayload, validate };

  function busy(b){ ["send","download"].forEach(id => $(id).disabled = b); }
  function status(t, cls){ const s = $("status"); s.textContent = t; s.className = "status " + (cls||""); }
  function pad(n){ return String(n).padStart(2,"0"); }
  function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
  function esc(s){ return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
})();
