(async () => {
  const C = window.VP_CONFIG || {};
  const live = window.VP_RULES ? await window.VP_RULES : null;
  if (live && live.promo && Array.isArray(live.promo.acts)) window.PROMO = live.promo;
  if (live && live.vygovor && Array.isArray(live.vygovor.units)) window.VYG = live.vygovor;
  let P = window.PROMO;
  const $ = id => document.getElementById(id);
  const MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  const SAVED = ["fromPos","fromRank","fromName"];
  const RANK_INS = {"рядовой":"рядового","ефрейтор":"ефрейтора","младший сержант":"младшего сержанта","сержант":"сержанта","старший сержант":"старшего сержанта","старшина":"старшины","прапорщик":"прапорщика","старший прапорщик":"старшего прапорщика","младший лейтенант":"младшего лейтенанта","лейтенант":"лейтенанта","старший лейтенант":"старшего лейтенанта","капитан":"капитана","майор":"майора","подполковник":"подполковника","полковник":"полковника","генерал-майор":"генерал-майора","генерал-лейтенант":"генерал-лейтенанта","генерал-полковник":"генерал-полковника","генерал армии":"генерала армии"};

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
    if (el.id === "fromName") dropPaper();
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

  // ================= калькулятор =================
  const state = JSON.parse(localStorage.getItem("vp_promo") || "{}"); // key -> {n, links}
  const save = () => localStorage.setItem("vp_promo", JSON.stringify(state));
  const st = k => (state[k] = state[k] || { n: 0, links: "" });
  const linksOf = k => (st(k).links || "").split(/\s+/).map(s => s.trim()).filter(s => /^(https?:\/\/)?[^\s\/.]+(\.[^\s\/.]+)+(\/\S*)?$/i.test(s));
  const findRank = r => Object.keys(P.ladder).find(k => k.toLowerCase() === r.trim().toLowerCase());

  // строим список видов работы в панели
  const actsBox = $("acts");
  function syncActsFromDom(){
    actsBox.querySelectorAll(".act").forEach(row => {
      const k = row.dataset.key;
      const s = st(k);
      const nIn = row.querySelector("[data-n]"), once = row.querySelector("[data-once]"), ta = row.querySelector("[data-links]");
      if (nIn) s.n = Math.max(0, parseInt(nIn.value) || 0);
      if (once) s.n = once.checked ? 1 : 0;
      if (ta) s.links = ta.value;
    });
    save();
  }
  function addActRow(a){
    const row = document.createElement("div"); row.className = "act"; row.dataset.key = a.key;
    row.innerHTML = `
      <div class="act-top">
        <div class="act-name">${esc(a.name)}${a.pts ? `<span class="pts">+${a.pts}</span>` : ""}</div>
        ${a.once
          ? `<label class="act-once"><input type="checkbox" data-once></label>`
          : `<div class="ctr"><button data-d="-1">−</button><input type="number" min="0" value="0" data-n><button data-d="1">+</button></div>`}
      </div>
      <details><summary>ссылки (<span data-lc>0</span>)</summary><textarea data-links rows="2" placeholder="по одной ссылке на строку"></textarea></details>`;
    actsBox.appendChild(row);
    const s = st(a.key);
    const nIn = row.querySelector("[data-n]"), once = row.querySelector("[data-once]"), ta = row.querySelector("[data-links]");
    if (nIn) nIn.value = s.n; if (once) once.checked = s.n > 0; ta.value = s.links || "";
    row.querySelectorAll("button[data-d]").forEach(b => b.addEventListener("click", () => {
      s.n = Math.max(0, (+nIn.value || 0) + (+b.dataset.d)); nIn.value = s.n; recalc();
    }));
    nIn && nIn.addEventListener("input", () => { s.n = Math.max(0, parseInt(nIn.value) || 0); recalc(); });
    once && once.addEventListener("change", () => { s.n = once.checked ? 1 : 0; recalc(); });
    ta.addEventListener("input", () => {
      s.links = ta.value;
      const lc = linksOf(a.key).length;
      if (!a.once && lc > s.n) { s.n = lc; nIn.value = lc; }
      if (a.once && lc && !s.n) { s.n = 1; once.checked = true; }
      recalc();
    });
  }
  function fillActs(){
    actsBox.innerHTML = "";
    P.acts.forEach(addActRow);
  }
  fillActs();
  window.addEventListener("vp-rules", () => {
    syncActsFromDom();
    P = window.PROMO;
    if (!P || !Array.isArray(P.acts)) return;
    fillActs();
    recalc();
  });

  function compute(){
    const rank = findRank($("fromRank").value || "");
    const step = rank ? P.ladder[rank] : null;
    let total = 0, proofs = 0;
    P.acts.forEach(a => { total += st(a.key).n * a.pts; proofs += linksOf(a.key).length; });
    const res = { rank, step, total, proofs, items: [], missing: 0, met: false, covered: 0 };
    if (step){
      Object.entries(step.need).forEach(([k, need]) => {
        const a = P.acts.find(x => x.key === k), have = Math.min(st(k).n, a.once ? 1 : 1e9);
        res.items.push({ a, need, have, lack: Math.max(0, need - have) });
      });
      const lackSwap = res.items.filter(i => !i.a.once).reduce((s, i) => s + i.lack, 0);
      const lackHard = res.items.filter(i => i.a.once).reduce((s, i) => s + i.lack, 0);
      const excess = Math.max(0, total - step.points);
      const canCover = Math.floor(excess / P.pointsPerItem);
      res.missing = lackSwap + lackHard;
      res.covered = Math.min(lackSwap, canCover);
      res.met = total >= step.points && lackHard === 0 && lackSwap <= canCover;
      res.left = { pts: Math.max(0, step.points - total), swap: Math.max(0, lackSwap - canCover), hard: lackHard };
    }
    return res;
  }

  function recalc(){
    save();
    const r = compute();
    document.querySelectorAll(".act").forEach(row => {
      const k = row.dataset.key; row.querySelector("[data-lc]").textContent = linksOf(k).length;
      row.classList.toggle("done", st(k).n > 0);
    });
    // имя, должность, звание в тексте
    const nm = $("fromName").value.trim(), ps = $("fromPos").value.trim(), rk = $("fromRank").value.trim();
    $("nameInText").textContent = nm || "________";
    $("posInText").textContent = ps ? ps : "________";
    $("rankInText").textContent = rk ? (RANK_INS[rk.toLowerCase()] || rk.toLowerCase()) : "________";
    if (r.step && (!$("target").value.trim() || $("target").dataset.auto === "1")) {
      $("target").value = r.step.to.toLowerCase().replace(/^./, c => c.toUpperCase()); $("target").dataset.auto = "1"; fit($("target"));
    }
    const tg = $("target").value.trim();
    // панель
    if (r.step){
      $("route").innerHTML = `${esc(r.rank)} <span>→</span> ${esc(r.step.to)}`;
      const pct = Math.min(100, Math.round(r.total / r.step.points * 100));
      $("barFill").style.width = pct + "%"; $("barFill").classList.toggle("full", r.total >= r.step.points);
      $("barText").textContent = `${r.total} / ${r.step.points} баллов`;
      $("crit").innerHTML = r.items.map(i => `<li class="${i.lack ? "no" : "ok"}">${i.lack ? "✗" : "✓"} ${esc(i.a.once ? i.a.name : i.a.name.replace(/\s*\(.*\)$/, ""))}${i.a.once ? "" : ` <b>${Math.min(i.have, i.need)}/${i.need}</b>`}</li>`).join("")
        + `<li class="${r.total >= r.step.points ? "ok" : "no"}">${r.total >= r.step.points ? "✓" : "✗"} Набрать ${r.step.points} баллов <b>${r.total}</b></li>`;
      let note;
      if (r.met) note = r.covered ? `Готово к подаче. Недостающие пункты (${r.covered}) закрыты лишними баллами: ${P.pointsPerItem} баллов за пункт.` : "Все критерии выполнены, можно подавать.";
      else {
        const parts = [];
        if (r.left.pts) parts.push(`${r.left.pts} баллов`);
        if (r.left.swap) parts.push(`${r.left.swap} пункт(ов) критерия, каждый можно заменить ${P.pointsPerItem} баллами сверх нормы`);
        if (r.left.hard) parts.push(`лекцию, экзамен или стажировку: их баллами не заменить`);
        note = "Не хватает: " + parts.join("; ") + ".";
      }
      $("critNote").textContent = note; $("critNote").className = "crit-note " + (r.met ? "ok" : "no");
    } else {
      $("route").textContent = rk ? `Для звания «${rk}» система повышений не описана. Баллы считаются, критерии не проверяются.` : "Укажи текущее звание внизу бланка";
      $("barFill").style.width = "0"; $("barText").textContent = `${r.total} баллов`;
      $("crit").innerHTML = ""; $("critNote").textContent = "";
    }
    // список достижений на бланке
    const lis = [];
    P.acts.forEach(a => {
      const n = st(a.key).n; if (!n) return;
      lis.push(a.once ? `${a.doc}.` : `${a.doc}: ${n}${a.pts ? ` (${n * a.pts} баллов)` : ""}.`);
    });
    $("achList").innerHTML = lis.length ? lis.map(t => `<li>${esc(t)}</li>`).join("") : `<li class="ph">отмечай выполненное в калькуляторе справа, список заполнится сам</li>`;
    let sum = `Итого набрано баллов: <b>${r.total}</b>`;
    if (r.step) sum += ` при необходимых ${r.step.points}. ` + (r.met
      ? (r.covered ? `Критерии повышения выполнены, недостающие пункты (${r.covered}) закрыты баллами из расчёта ${P.pointsPerItem} баллов за пункт.` : "Критерии повышения выполнены в полном объёме.")
      : "");
    else sum += ".";
    $("summary").innerHTML = sum;
    $("proofCount").textContent = r.proofs;
    $("appendix").style.display = r.proofs ? "" : "none";
    return r;
  }
  $("target").addEventListener("input", () => { $("target").dataset.auto = $("target").value.trim() ? "0" : "1"; });
  ["fromName","fromPos","fromRank"].forEach(id => $(id).addEventListener("input", recalc));
  recalc();

  // ---------- проверка и картинка ----------
  function validate(){
    let ok = true, first = null;
    document.querySelectorAll(".f.req").forEach(el => { if (!el.value.trim()){ el.classList.add("bad"); ok = false; first = first || el; } });
    if (!ok){ status("Заполни подсвеченные красным поля.", "err"); first.focus(); }
    return ok;
  }
  async function renderPNG(){
    if (document.fonts) await document.fonts.ready;
    const n = parseName($("fromName").value);
    return html2canvas($("paper"), {
      scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false,
      onclone: doc => {
        const p = doc.getElementById("paper"); p.classList.add("rendering");
        p.querySelectorAll("input.f").forEach(el => {
          const s = doc.createElement("span"); let v = el.value.trim();
          if (el.id === "fromName" && n) v = n.short;
          if (el.id === "target") v = RANK_INS[v.toLowerCase()] || v.toLowerCase();
          s.textContent = v; el.replaceWith(s);
        });
        p.querySelectorAll("textarea.f").forEach(el => {
          const tv = el.value.trim();
          if (!tv) { el.closest(".extra-wrap") ? el.closest(".extra-wrap").remove() : el.remove(); return; }
          const d = doc.createElement("div"); d.style.whiteSpace = "pre-wrap"; d.style.textAlign = "justify"; d.style.textIndent = "48px";
          d.textContent = cap(tv); el.replaceWith(d);
        });
        p.querySelectorAll("#achList .ph").forEach(e => e.remove());
        if (!$("stampOn").checked) doc.getElementById("stamp").remove();
      }
    });
  }

  function personKey(){ return $("fromName").value.trim(); }
  function authHead(extra){
    const h = extra ? Object.assign({}, extra) : {};
    h.Authorization = "Bearer " + ((window.VP_SESSION && window.VP_SESSION()) || "");
    return h;
  }
  // Номер: база предлагает следующий, поле можно править. Занятый номер тоже записывается —
  // с предупреждением в строке статуса (дубль разрешён нарочно), PNG и Discord берут этот номер.
  const numBox = window.VP_NUM({ el: $("num"), kind: () => "promo", person: personKey, fit });
  function dropPaper(){ numBox.changed(); }
  async function takePaper(){
    if (!C.endpoint) throw new Error("База номеров не подключена");
    return numBox.take(raw => fetch(String(C.endpoint).replace(/\/$/, "") + "/paper", {
      method: "POST",
      headers: authHead({ "Content-Type": "application/json" }),
      body: JSON.stringify({ kind: "promo", num: raw, name: $("fromName").value.trim(), passport: "" })
    }));
  }

  // ---------- отправка ----------
  function buildPayload(r){
    const roles = (C.roles||[]).filter(Boolean);
    const lines = [
      roles.map(x => `<@&${x}>`).join(" "),
      `📈 **РАПОРТ №${$("num").value.trim()}** на повышение в звании`,
      `**От:** ${$("fromPos").value.trim()}, ${$("fromRank").value.trim()} ${$("fromName").value.trim()}`,
      `**Прошу:** ${$("fromRank").value.trim()} → ${$("target").value.trim()}`,
      `**Баллы:** ${r.total}${r.step ? ` / ${r.step.points}` : ""}` + (r.step ? ` · **Критерии:** ${r.met ? (r.covered ? `выполнены ✅ (${r.covered} пункт(а) закрыто баллами)` : "выполнены ✅") : "не выполнены ❌"}` : "")
    ];
    const fields = [];
    P.acts.forEach(a => {
      const L = linksOf(a.key); if (!L.length) return;
      let v = "";
      L.forEach((u, i) => { const m = `[${i+1}](${/^https?:/i.test(u) ? u : "https://" + u}) `; if ((v + m).length <= 1000) v += m; });
      fields.push({ name: `${a.name.replace(/\s*\(.*\)$/, "")} ×${st(a.key).n}`.slice(0, 250), value: v.trim(), inline: false });
    });
    const payload = {
      username: "Военная полиция · Рапорты",
      content: lines.filter(Boolean).join("\n").replace(/@(everyone|here)/g, "@\u200b$1"),
      allowed_mentions: { parse: [], roles },
      attachments: [{ id: 0, filename: "raport.png" }]
    };
    if (fields.length) payload.embeds = [{ title: "Доказательства", color: 0xC9A227, fields: fields.slice(0, 25) }];
    return payload;
  }

  async function doRender(){ const c = await renderPNG(); return c; }
  $("send").addEventListener("click", async () => {
    if (!validate()) return;
    const r = compute();
    if (r.step && !r.met && !confirm("Критерии повышения пока не выполнены. Всё равно отправить рапорт?")) return;
    const target = C.endpoint || (C.directWebhook ? C.directWebhook + (C.directWebhook.includes("?") ? "&" : "?") + "wait=true" : "");
    if (!target){ status("Адрес отправки не настроен: заполни endpoint в config.js.", "err"); return; }
    busy(true); status("Беру номер…");
    try {
      await takePaper();
      numStatus("Печатаю бланк…");
      const canvas = await doRender();
      const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
      const fd = new FormData();
      fd.append("payload_json", JSON.stringify(buildPayload(r)));
      if (!blob) throw new Error("Не удалось напечатать бланк, попробуй ещё раз");
      fd.append("files[0]", new File([blob], "raport.png", { type: "image/png" }));
      fd.append("kind", "promo");
      fd.append("num", $("num").value.trim());
      numStatus("Отправляю в Discord…");
      const res = await fetch(target, { method: "POST", body: fd, headers: C.endpoint ? authHead() : undefined });
      const errText = await res.text();
      if (res.status === 403) throw new Error(errText || "Сначала войди через Discord");
      if (!res.ok) throw new Error(`${res.status} ${errText}`);
      numStatus(`Рапорт №${$("num").value} отправлен. Руководство уведомлено.`, "ok");
      numBox.sent();
    } catch (e) { status("Не отправилось: " + e.message, "err"); } finally { busy(false); }
  });
  $("download").addEventListener("click", async () => {
    if (!validate()) return;
    busy(true); status("Беру номер…");
    try {
      await takePaper();
      numStatus("Печатаю бланк…");
      const canvas = await doRender(), a = document.createElement("a");
      a.href = canvas.toDataURL("image/png"); a.download = `raport_${$("num").value.replace(/[^\wА-я-]/g,"_")}.png`; a.click();
      numStatus("Картинка скачана.", "ok");
    } catch (e) { status("Ошибка: " + e.message, "err"); } finally { busy(false); }
  });
  $("clear").addEventListener("click", () => {
    if (!confirm("Обнулить все отмеченные достижения и ссылки?")) return;
    Object.keys(state).forEach(k => delete state[k]); save(); location.reload();
  });

  window.__vp = { compute, buildPayload, renderPNG, state };
  function busy(b){ ["send","download"].forEach(id => $(id).disabled = b); }
  function status(t, cls){ const s = $("status"); s.textContent = t; s.className = "status " + (cls||""); }
  // Статус после записи номера: если номер уже был у другого документа, показываем предупреждение (не ошибку).
  function numStatus(t, cls){ const w = numBox.warning ? numBox.warning() : ""; status(w ? numBox.note(t) : t, w ? "warn" : cls); }
  function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
  function esc(s){ return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
})();
