// ===== Настройки сайта рапортов ГУ ВП =====
window.VP_CONFIG = {
  // Адрес Cloudflare Worker (см. README). Через него ссылка на вебхук не светится на сайте.
  endpoint: "https://curly-disk-ebd7.reflektpro8.workers.dev",

  // ТОЛЬКО ДЛЯ ТЕСТА: прямая ссылка на вебхук Discord. На публичном сайте оставь пустым,
  // иначе любой сможет вытащить ссылку из кода и спамить в канал.
  directWebhook: "",

  // Роли, которые пингуются при подаче рапорта (руководство ГУ ВП)
  roles: ["1321249388965793844", "1321249411954774128", "1321249413024452608"],

  // Шапка бланка
  header: [
    "МИНИСТЕРСТВО ОБОРОНЫ РОССИЙСКОЙ ФЕДЕРАЦИИ",
    "ГЛАВНОЕ УПРАВЛЕНИЕ ВОЕННОЙ ПОЛИЦИИ"
  ],
  city: "Москва",

  // Печать
  stampOuter: "МИНИСТЕРСТВО ОБОРОНЫ РОССИЙСКОЙ ФЕДЕРАЦИИ",
  stampInner: "ВОЕННАЯ ПОЛИЦИЯ ✶ ВОИНСКАЯ ЧАСТЬ №12132",
  stampCenter: "ГУ ВП"
};

window.VP_RULES = (async () => {
  const C = window.VP_CONFIG;
  if (!C || !C.endpoint) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(String(C.endpoint).replace(/\/$/, "") + "/rules", { cache: "no-store", signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
})();

(function () {
  const C = window.VP_CONFIG;
  if (!C || !C.endpoint) return;
  let last = "";
  const url = String(C.endpoint).replace(/\/$/, "") + "/rules";
  async function tick() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return;
      const data = await res.json();
      const text = JSON.stringify(data);
      if (!last) { last = text; return; }
      if (text === last) return;
      if (!data || !(data.promo || data.vygovor)) return;
      last = text;
      if (data.promo && Array.isArray(data.promo.acts)) window.PROMO = data.promo;
      if (data.vygovor && Array.isArray(data.vygovor.units)) window.VYG = data.vygovor;
      window.VP_RULES = Promise.resolve(data);
      window.dispatchEvent(new Event("vp-rules"));
    } catch (e) {}
  }
  setInterval(tick, 5000);
})();
