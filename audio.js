/* =====================================================
   AUDIO.JS - Street Racer 3D
   -----------------------------------------------------
   Semua suara dibuat lewat kode (Web Audio API),
   jadi TIDAK perlu file .mp3 / .wav.

   Suara yang tersedia:
   1. Suara mesin  (nada naik-turun mengikuti kecepatan)
   2. Suara nitro  (desis angin + nada mesin naik)
   3. Suara tabrakan (game over)
   4. Suara menang (finish)
   5. Suara klik tombol menu
   6. Suara sukses / gagal di pesan modal (beli, upgrade)
   7. Tombol 🔊 / 🔇 untuk mute

   File ini TIDAK mengubah file game lain. Ia "membungkus"
   fungsi yang sudah ada (startGame, crash, finishRace,
   updateHUD, showGameModal) lalu menambah suara.

   Harus dimuat SETELAH controls.html (lihat index.html).
===================================================== */

(function () {

  "use strict";


  /* =====================================================
     PENGATURAN (silakan diubah-ubah)
  ===================================================== */

  const CONFIG = {

    masterVolume: 0.6,   // volume total (0 - 1)
    engineVolume: 0.18,  // volume suara mesin
    sfxVolume: 0.5,      // volume efek (klik, crash, dll)

    /*
      Kecepatan "penuh" untuk suara mesin.
      Angka ini adalah nilai `speed` di game
      (angka di HUD dibagi 8). Contoh: HUD maksimal
      sekitar 800 KM/H  ->  100.
      Kalau mesin terdengar sudah mentok nada tinggi
      di tengah balapan, naikkan angka ini.
      Kalau nadanya kurang naik, turunkan.
    */
    maxSpeedRef: 100,

    idleFreq: 70,        // nada dasar mesin (Hz)
    gears: 5             // jumlah "gigi" (nada turun sedikit tiap pindah gigi)

  };

  const STORAGE_KEY = "streetracer_muted";


  /* =====================================================
     VARIABEL AUDIO
  ===================================================== */

  let ctx = null;            // AudioContext (dibuat saat klik pertama)
  let master = null;         // pengatur volume total
  let noiseBuffer = null;    // bahan suara "desis" (white noise)

  let engineGain = null;
  let engineFilter = null;
  let engineOsc1 = null;
  let engineOsc2 = null;

  let nitroGain = null;

  let lastSpeed = 0;         // kecepatan terakhir dari game
  let muted = false;

  try {
    muted = localStorage.getItem(STORAGE_KEY) === "1";
  } catch (e) { /* abaikan */ }


  /* =====================================================
     HELPER
  ===================================================== */

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function ready() {
    return ctx && ctx.state === "running" && !muted;
  }

  /* Membaca variabel milik gamelogic.html dengan aman */

  function isRunning() {
    return typeof gameRunning !== "undefined" && gameRunning === true;
  }

  function isPaused() {
    return typeof gamePaused !== "undefined" && gamePaused === true;
  }

  function isNitroOn() {
    return (
      isRunning() &&
      !isPaused() &&
      typeof nitroPressed !== "undefined" &&
      nitroPressed === true &&
      typeof nitro !== "undefined" &&
      nitro > 0
    );
  }


  /* =====================================================
     MEMBUAT AUDIO CONTEXT
     Browser hanya mengizinkan suara setelah pengguna
     menyentuh / mengklik halaman. Jadi dibuat saat itu.
  ===================================================== */

  function initAudio() {

    if (ctx) return;

    const AC = window.AudioContext || window.webkitAudioContext;

    if (!AC) {
      console.warn("[audio] Browser tidak mendukung Web Audio API.");
      return;
    }

    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = muted ? 0 : CONFIG.masterVolume;
    master.connect(ctx.destination);

    noiseBuffer = makeNoiseBuffer();

    buildEngine();
    buildNitro();

    setInterval(tick, 50);

    console.log("[audio] Audio siap.");

  }

  function unlockAudio() {

    initAudio();

    if (ctx && ctx.state === "suspended") {
      ctx.resume();
    }

  }

  function makeNoiseBuffer() {

    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    return buffer;

  }


  /* =====================================================
     SUARA MESIN
     Dua oscillator (gelombang) -> filter -> volume.
     Terus menyala, tetapi volumenya 0 saat tidak balapan.
  ===================================================== */

  function buildEngine() {

    engineOsc1 = ctx.createOscillator();
    engineOsc1.type = "sawtooth";
    engineOsc1.frequency.value = CONFIG.idleFreq;

    engineOsc2 = ctx.createOscillator();
    engineOsc2.type = "square";
    engineOsc2.frequency.value = CONFIG.idleFreq * 0.5;

    const osc2Level = ctx.createGain();
    osc2Level.gain.value = 0.5;

    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 400;
    engineFilter.Q.value = 2;

    engineGain = ctx.createGain();
    engineGain.gain.value = 0;

    engineOsc1.connect(engineFilter);
    engineOsc2.connect(osc2Level);
    osc2Level.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);

    engineOsc1.start();
    engineOsc2.start();

  }


  /* =====================================================
     SUARA NITRO (desis angin)
  ===================================================== */

  function buildNitro() {

    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1800;
    filter.Q.value = 0.8;

    nitroGain = ctx.createGain();
    nitroGain.gain.value = 0;

    source.connect(filter);
    filter.connect(nitroGain);
    nitroGain.connect(master);

    source.start();

  }


  /* =====================================================
     TICK - dijalankan tiap 50 ms
     Menyesuaikan suara mesin & nitro dengan kondisi game.
  ===================================================== */

  function tick() {

    if (!ctx || ctx.state !== "running") return;

    const t = ctx.currentTime;

    const active = isRunning() && !isPaused();
    const nitroOn = isNitroOn();

    const norm = clamp(lastSpeed / CONFIG.maxSpeedRef, 0, 1);

    /* Simulasi gigi: nada naik, lalu turun sedikit saat "pindah gigi" */

    const gearPos = norm * CONFIG.gears;
    const gear = Math.min(CONFIG.gears - 1, Math.floor(gearPos));
    const within = clamp(gearPos - gear, 0, 1);

    let freq = CONFIG.idleFreq + gear * 12 + within * 90;

    if (nitroOn) freq *= 1.25;

    engineOsc1.frequency.setTargetAtTime(freq, t, 0.05);
    engineOsc2.frequency.setTargetAtTime(freq * 0.5, t, 0.05);

    engineFilter.frequency.setTargetAtTime(
      300 + norm * 1200 + (nitroOn ? 600 : 0),
      t,
      0.08
    );

    engineGain.gain.setTargetAtTime(
      active ? CONFIG.engineVolume * (0.7 + 0.3 * norm) : 0,
      t,
      0.1
    );

    nitroGain.gain.setTargetAtTime(
      nitroOn ? 0.25 : 0,
      t,
      0.08
    );

  }


  /* =====================================================
     ALAT PEMBUAT EFEK SUARA
  ===================================================== */

  /* Nada pendek. freqEnd = nada akhir (opsional, untuk efek meluncur) */

  function tone(freq, duration, type, volume, delay, freqEnd) {

    if (!ready()) return;

    const t = ctx.currentTime + (delay || 0);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t);

    if (freqEnd) {
      osc.frequency.exponentialRampToValueAtTime(freqEnd, t + duration);
    }

    const peak = (volume || 0.3) * CONFIG.sfxVolume;

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    osc.connect(gain);
    gain.connect(master);

    osc.start(t);
    osc.stop(t + duration + 0.05);

  }

  /* Letupan suara noise (untuk tabrakan). Filter turun dari fStart ke fEnd */

  function noiseBurst(duration, volume, fStart, fEnd) {

    if (!ready()) return;

    const t = ctx.currentTime;

    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(fStart, t);
    filter.frequency.exponentialRampToValueAtTime(fEnd, t + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime((volume || 0.5) * CONFIG.sfxVolume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    source.start(t);
    source.stop(t + duration + 0.05);

  }


  /* =====================================================
     DAFTAR EFEK SUARA
  ===================================================== */

  const sfx = {

    click: function () {
      tone(700, 0.07, "square", 0.15, 0, 1000);
    },

    start: function () {
      tone(90, 0.7, "sawtooth", 0.3, 0, 320);
    },

    crash: function () {
      noiseBurst(0.9, 1.0, 3000, 150);
      noiseBurst(0.15, 0.7, 6000, 800);
      tone(140, 0.6, "sine", 1.0, 0, 35);
    },

    win: function () {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach(function (n, i) {
        tone(n, i === notes.length - 1 ? 0.7 : 0.3, "triangle", 0.5, i * 0.14);
      });
    },

    success: function () {
      tone(880, 0.12, "sine", 0.4);
      tone(1318, 0.25, "sine", 0.35, 0.1);
    },

    error: function () {
      tone(220, 0.28, "sawtooth", 0.3, 0, 140);
    },

    /* Suara koin. step = urutan koin beruntun, nadanya makin tinggi */

    coin: function (step) {
      const f = 988 * Math.pow(2, clamp(step || 0, 0, 12) / 12);
      tone(f, 0.12, "triangle", 0.45);
      tone(f * 1.5, 0.18, "sine", 0.3, 0.05);
    }

  };

  /* Supaya file lain (coins.js) bisa memutar suara */

  window.GameAudio = {
    play: function (name, arg) {
      if (sfx[name]) sfx[name](arg);
    }
  };


  /* =====================================================
     MEMBUNGKUS FUNGSI GAME
     Fungsi asli tetap jalan seperti biasa, kita hanya
     menambahkan suara sebelum / sesudahnya.
  ===================================================== */

  function wrap(name, handler) {

    const original = window[name];

    if (typeof original !== "function") {
      console.warn("[audio] Fungsi tidak ditemukan, dilewati:", name);
      return;
    }

    window[name] = function () {
      return handler(original, this, arguments);
    };

  }

  /* Mulai balapan */

  wrap("startGame", function (original, self, args) {

    lastSpeed = 0;

    const result = original.apply(self, args);

    if (isRunning()) sfx.start();

    return result;

  });

  /* Tabrakan */

  wrap("crash", function (original, self, args) {

    const wasRunning = isRunning();

    const result = original.apply(self, args);

    if (wasRunning && !isRunning()) sfx.crash();

    return result;

  });

  /* Finish / menang */

  wrap("finishRace", function (original, self, args) {

    const wasRunning = isRunning();

    const result = original.apply(self, args);

    if (wasRunning && !isRunning()) sfx.win();

    return result;

  });

  /* updateHUD dipanggil tiap frame dengan kecepatan -> kita simpan */

  wrap("updateHUD", function (original, self, args) {

    lastSpeed = Number(args[0]) || 0;

    return original.apply(self, args);

  });

  /* Pesan modal: ikon tertentu = suara gagal, sisanya sukses */

  const ERROR_ICONS = ["💰", "🔒", "⚠️"];

  wrap("showGameModal", function (original, self, args) {

    const icon = args[2] || "⚠️";

    if (icon !== "💥") {
      if (ERROR_ICONS.indexOf(icon) !== -1) sfx.error();
      else sfx.success();
    }

    return original.apply(self, args);

  });


  /* =====================================================
     KLIK TOMBOL MENU
     Satu pendengar untuk semua tombol (event delegation).
     Tombol kontrol (kiri/kanan/nitro) sengaja tidak diberi
     suara klik supaya tidak berisik saat bermain.
  ===================================================== */

  const CLICK_SELECTOR =
    ".menu-btn, .small-btn, .back, .modal-btn, .pause-side-btn";

  document.addEventListener("click", function (e) {

    if (e.target.closest && e.target.closest(CLICK_SELECTOR)) {
      sfx.click();
    }

  });


  /* =====================================================
     MEMBUKA KUNCI AUDIO (sentuhan / klik / tombol pertama)
  ===================================================== */

  document.addEventListener("pointerdown", unlockAudio);
  document.addEventListener("keydown", unlockAudio);
  document.addEventListener("touchstart", unlockAudio, { passive: true });

  /* Matikan suara saat tab disembunyikan */

  document.addEventListener("visibilitychange", function () {

    if (!ctx) return;

    if (document.hidden) ctx.suspend();
    else ctx.resume();

  });


  /* =====================================================
     TOMBOL MUTE 🔊 / 🔇
  ===================================================== */

  function createMuteButton() {

    const style = document.createElement("style");

    /* Posisi (top/right/ukuran) diatur otomatis oleh placeToggle() */

    style.textContent = `

      #audioToggle {
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 100;
        width: 42px;
        height: 42px;
        border-radius: 50%;
        border: 2px solid rgba(255,255,255,.25);
        background: rgba(15,23,42,.88);
        color: white;
        font-size: 17px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 5px 18px rgba(0,0,0,.4);
      }

      #audioToggle:active {
        transform: scale(.94);
      }

    `;

    document.head.appendChild(style);

    const button = document.createElement("button");
    button.id = "audioToggle";
    button.type = "button";
    button.title = "Suara on / off";
    button.textContent = muted ? "🔇" : "🔊";

    button.addEventListener("click", function () {

      muted = !muted;

      button.textContent = muted ? "🔇" : "🔊";

      try {
        localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
      } catch (e) { /* abaikan */ }

      if (master) {
        master.gain.setTargetAtTime(
          muted ? 0 : CONFIG.masterVolume,
          ctx.currentTime,
          0.03
        );
      }

    });

    document.body.appendChild(button);

    /*
      Saat balapan, tombol ditaruh tepat DI BAWAH tombol pause
      (posisinya dibaca langsung dari tombol pause).
      Di menu, tombol ada di pojok kanan atas.
    */

    function placeToggle() {

      const pause = document.getElementById("pauseBtn");

      let top = 12;
      let right = 12;
      let size = 42;

      if (pause) {

        const r = pause.getBoundingClientRect();

        if (r.width > 0 && r.height > 0) {
          size = r.width;
          top = r.bottom + 8;
          right = window.innerWidth - r.right;
        }

      }

      button.style.width = size + "px";
      button.style.height = size + "px";
      button.style.top = top + "px";
      button.style.right = right + "px";

    }

    placeToggle();
    setInterval(placeToggle, 300);
    window.addEventListener("resize", placeToggle);

  }

  createMuteButton();


  console.log("Audio.js berhasil dimuat.");

})();
