/* =====================================================
   FPS.JS - Alat ukur performa (SEMENTARA)
   -----------------------------------------------------
   Menampilkan kotak kecil saat balapan berisi:
   - FPS dan frame terlambat (tanda patah-patah)
   - Jumlah draw call & segitiga (seberapa berat dunia 3D)
   - Ukuran canvas & pixel ratio (seberapa berat resolusi)
   - Bayangan & antialias aktif atau tidak
   - Nama GPU yang dipakai browser

   Setelah selesai diagnosa, hapus saja baris
   includeScript("fps.js") di index.html.

   Harus dimuat SETELAH gamelogic.html.
===================================================== */

(function () {

  "use strict";

  let frames = 0;
  let worst = 0;
  let lastFrameTime = 0;
  let gpuName = null;

  const box = document.createElement("div");

  box.id = "fpsBox";

  box.style.cssText =
    "position:fixed;" +
    "left:50%;" +
    "transform:translateX(-50%);" +
    "bottom:110px;" +
    "z-index:60;" +
    "display:none;" +
    "padding:8px 12px;" +
    "border-radius:10px;" +
    "background:rgba(0,0,0,.75);" +
    "color:#4ade80;" +
    "font:12px/1.5 Consolas,monospace;" +
    "white-space:pre;" +
    "pointer-events:none;";

  document.body.appendChild(box);


  function isRunning() {
    return typeof gameRunning !== "undefined" && gameRunning === true;
  }

  function getGpuName() {

    if (gpuName !== null) return gpuName;

    try {

      const gl = renderer.getContext();
      const ext = gl.getExtension("WEBGL_debug_renderer_info");

      gpuName = ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : "(tidak diketahui)";

    } catch (e) {
      gpuName = "(tidak diketahui)";
    }

    return gpuName;

  }

  function onOff(v) {
    return v ? "ON" : "OFF";
  }


  /* Hitung frame: updateHUD dipanggil tiap frame saat balapan */

  const original = window.updateHUD;

  if (typeof original === "function") {

    window.updateHUD = function () {

      const now = performance.now();

      if (lastFrameTime > 0) {
        const delta = now - lastFrameTime;
        if (delta > worst && delta < 1000) worst = delta;
      }

      lastFrameTime = now;
      frames++;

      return original.apply(this, arguments);

    };

  } else {
    console.warn("[fps] updateHUD tidak ditemukan.");
  }


  /* Perbarui tampilan tiap 0,5 detik */

  setInterval(function () {

    const show = isRunning() && frames > 0;

    box.style.display = show ? "block" : "none";

    if (!show) {
      frames = 0;
      worst = 0;
      lastFrameTime = 0;
      return;
    }

    const fps = Math.round(frames * 2);

    let text = "FPS: " + fps + "   frame terburuk: " + Math.round(worst) + " ms";

    try {

      const info = renderer.info.render;
      const canvas = renderer.domElement;

      let aa = false;

      try {
        aa = renderer.getContext().getContextAttributes().antialias;
      } catch (e) { /* abaikan */ }

      text +=
        "\nDraw call: " + info.calls +
        "   Segitiga: " + info.triangles +
        "\nCanvas: " + canvas.width + " x " + canvas.height +
        "   Pixel ratio: " + renderer.getPixelRatio().toFixed(2) +
        " (layar: " + window.devicePixelRatio.toFixed(2) + ")" +
        "\nBayangan: " + onOff(renderer.shadowMap.enabled) +
        "   Antialias: " + onOff(aa) +
        "\nGPU: " + getGpuName() +
        "\nMode: " + (
          window.GAME_QUALITY && window.GAME_QUALITY.low
            ? "RENDAH (browser tanpa GPU asli)"
            : "NORMAL"
        );

    } catch (e) {
      text += "\n(info renderer tidak tersedia)";
    }

    box.textContent = text;

    frames = 0;
    worst = 0;

  }, 500);


  console.log("Fps.js berhasil dimuat.");

})();
