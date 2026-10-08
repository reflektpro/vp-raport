(() => {
  const REDIRECT = "https://reflektpro.github.io/vp-raport/auth.html";

  function token() { return localStorage.getItem("vp_session") || ""; }
  function user() {
    try { return JSON.parse(localStorage.getItem("vp_user") || "null"); }
    catch (e) { return null; }
  }
  window.VP_SESSION = function () { return token(); };

  function paint() {
    const top = document.querySelector(".topbar");
    if (!top) return;
    let bar = document.getElementById("vpAuth");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "vpAuth";
      bar.className = "vp-auth";
      top.appendChild(bar);
    }
    bar.textContent = "";
    const tok = token();
    const u = user();
    if (tok && u && u.username) {
      const span = document.createElement("span");
      span.textContent = "Вы " + u.username + " · ";
      const out = document.createElement("button");
      out.type = "button";
      out.textContent = "Выйти";
      out.addEventListener("click", () => {
        localStorage.removeItem("vp_session");
        localStorage.removeItem("vp_user");
        paint();
      });
      bar.appendChild(span);
      bar.appendChild(out);
      return;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Войти через Discord";
    btn.addEventListener("click", login);
    bar.appendChild(btn);
  }

  async function login() {
    const C = window.VP_CONFIG || {};
    const base = String(C.endpoint || "").replace(/\/$/, "");
    if (!base) return;
    let clientId = "";
    try {
      const res = await fetch(base + "/auth/client", { cache: "no-store" });
      const data = await res.json();
      clientId = data && data.clientId || "";
    } catch (e) { clientId = ""; }
    if (!clientId) {
      const st = document.getElementById("status");
      if (st) { st.textContent = "Вход Discord ещё не настроен"; st.className = "status err"; }
      return;
    }
    const url = "https://discord.com/oauth2/authorize?client_id=" + encodeURIComponent(clientId)
      + "&response_type=code&scope=identify&redirect_uri=" + encodeURIComponent(REDIRECT)
      + "&state=" + encodeURIComponent(location.href);
    location.href = url;
  }

  if (document.querySelector(".topbar")) paint();
  else document.addEventListener("DOMContentLoaded", paint);
})();
