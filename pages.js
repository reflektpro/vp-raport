// Разбивка готового бланка на листы A4 (ФЗ-42 ст. 2.2: со второй страницы номер посередине верхнего поля).
// Режем только по полностью белым строкам пикселей, чтобы не разрезать строку текста или подпись.
(() => {
  const A4 = 1123, TOP = 60, BOTTOM = 60; // CSS-пиксели листа 794×1123
  function blankRow(data, w){
    for (let i = 0; i < w * 4; i += 4) if (data[i] < 235 || data[i+1] < 235 || data[i+2] < 235) return false;
    return true;
  }
  function pages(canvas){
    const s = canvas.width / 794, H = Math.round(A4 * s);
    if (canvas.height <= H + 2) return [canvas];
    const ctx = canvas.getContext("2d");
    const top = Math.round(TOP * s), bottom = Math.round(BOTTOM * s);
    const cuts = []; let y = 0, first = true;
    while (y < canvas.height) {
      const room = H - bottom - (first ? 0 : top);
      if (canvas.height - y <= H - (first ? 0 : top)) { cuts.push([y, canvas.height]); break; }
      let cut = y + room;
      const min = y + Math.round(room * 0.5);
      for (let c = cut; c > min; c--) {
        if (blankRow(ctx.getImageData(0, c, canvas.width, 1).data, canvas.width)) { cut = c; break; }
      }
      cuts.push([y, cut]);
      y = cut;
      while (y < canvas.height && blankRow(ctx.getImageData(0, y, canvas.width, 1).data, canvas.width)) y++;
      first = false;
    }
    // хвост из одних белых строк не делает отдельный лист
    if (cuts.length > 1) {
      const [a, b] = cuts[cuts.length - 1];
      if (b - a < 4 * s) cuts.pop();
    }
    const total = cuts.length;
    if (total === 1) return [canvas];
    return cuts.map(([a, b], i) => {
      const out = document.createElement("canvas");
      out.width = canvas.width; out.height = H;
      const g = out.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, out.width, out.height);
      const dy = i === 0 ? 0 : top;
      g.drawImage(canvas, 0, a, canvas.width, b - a, 0, dy, canvas.width, b - a);
      if (i > 0) {
        g.fillStyle = "#000";
        g.font = `${Math.round(16 * s)}px "Times New Roman", Tinos, serif`;
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(String(i + 1), out.width / 2, Math.round(top / 2));
      }
      return out;
    });
  }
  const blob = c => new Promise(r => c.toBlob(r, "image/png"));
  // Листы в FormData: files[0..n-1], имена base.png или base_1.png, base_2.png…
  async function addFiles(fd, canvas, base){
    const list = pages(canvas).slice(0, 10);
    const names = [];
    for (let i = 0; i < list.length; i++) {
      const b = await blob(list[i]);
      if (!b) throw new Error("Не удалось напечатать бланк, попробуй ещё раз");
      const name = list.length === 1 ? base + ".png" : `${base}_${i + 1}.png`;
      fd.append(`files[${i}]`, new File([b], name, { type: "image/png" }));
      names.push(name);
    }
    return names;
  }
  function download(canvas, base){
    const list = pages(canvas);
    list.forEach((c, i) => {
      const a = document.createElement("a");
      a.href = c.toDataURL("image/png");
      a.download = list.length === 1 ? base + ".png" : `${base}_стр${i + 1}.png`;
      a.click();
    });
    return list.length;
  }
  window.VP_PAGES = { pages, addFiles, download };
})();
