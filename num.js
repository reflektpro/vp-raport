// Номер документа: база только предлагает следующий свободный, боец может вписать свой.
// Предложение ничего не занимает; номер записывается в базу при «Скачать PNG» или «Отправить».
// Если номер уже занят, база отвечает 409, поле получает свежее предложение, остальной бланк не трогается.
(() => {
  window.VP_NUM = function (opt) {
    const C = window.VP_CONFIG || {};
    const base = String(C.endpoint || "").replace(/\/$/, "");
    const el = opt.el;
    const st = { edited: false, suggested: "", saved: null, ask: 0 };
    el.readOnly = false;
    el.removeAttribute("readonly");
    if (!el.placeholder) el.placeholder = "по порядку";
    el.value = "";
    fitIt();

    el.addEventListener("input", () => {
      const v = el.value.trim();
      st.edited = v !== "" && v !== st.suggested;
      el.classList.remove("bad");
    });
    window.addEventListener("focus", () => refresh(false));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(false); });
    window.addEventListener("storage", e => { if (e.key === "vp_session") refresh(false); });

    function fitIt() { if (opt.fit) opt.fit(el); }
    function token() { return (window.VP_SESSION && window.VP_SESSION()) || ""; }
    function holdsSaved() {
      return !!(st.saved && st.saved.key === opt.person() && el.value.trim() === st.saved.num);
    }
    // Свежее предложение с сервера. Без force не трогает вписанное руками и уже записанный номер.
    async function refresh(force) {
      if (!base || !token()) return;
      if (!force && (st.edited || holdsSaved())) return;
      const my = ++st.ask;
      try {
        const q = "kind=" + encodeURIComponent(opt.kind()) + (opt.type ? "&type=" + encodeURIComponent(opt.type()) : "");
        const res = await fetch(base + "/suggest?" + q, {
          cache: "no-store",
          headers: { Authorization: "Bearer " + token() }
        });
        if (!res.ok) return;
        const d = await res.json();
        if (my !== st.ask || !d || !d.num) return;
        if (!force && (st.edited || holdsSaved())) return;
        st.suggested = String(d.num);
        st.edited = false;
        el.value = st.suggested;
        el.classList.remove("bad");
        fitIt();
      } catch (e) {}
    }
    // Сменился боец или вид документа. Записанный за прошлым бланком номер заменяем предложением,
    // номер, вписанный руками и ещё не записанный, оставляем.
    function changed() {
      if (!st.saved || st.saved.key === opt.person()) return;
      const was = el.value.trim() === st.saved.num;
      st.saved = null;
      if (was) { st.edited = false; refresh(true); }
    }
    // Записать номер из поля (или следующий свободный, если поле пустое). post(raw) возвращает Response.
    async function take(post) {
      const key = opt.person();
      const val = el.value.trim();
      if (st.saved && st.saved.key === key && val === st.saved.num) return st.saved.num;
      const res = await post(val);
      const text = await res.text();
      if (res.status === 403) throw new Error(text || "Сначала войди через Discord");
      if (res.status === 409) {
        st.edited = false;
        await refresh(true);
        el.classList.add("bad");
        throw new Error((text || "Номер уже занят.") + (el.value.trim() ? " Свободный: " + el.value.trim() + "." : ""));
      }
      if (res.status === 400) { el.classList.add("bad"); throw new Error(text || "Номер не принят"); }
      if (!res.ok) throw new Error(text || "Номер не выдан");
      let data = {};
      try { data = JSON.parse(text); } catch (e) { data = {}; }
      if (!data.num) throw new Error("База не выдала номер");
      st.saved = { key, num: String(data.num) };
      st.suggested = "";
      st.edited = false;
      el.value = st.saved.num;
      el.classList.remove("bad");
      fitIt();
      return st.saved.num;
    }
    // Только после успешной отправки в Discord: поле очищается и получает следующее предложение.
    function sent() {
      st.saved = null;
      st.edited = false;
      st.suggested = "";
      el.value = "";
      fitIt();
      refresh(true);
    }
    refresh(true);
    return { refresh, changed, take, sent, state: st };
  };
})();
