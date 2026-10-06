/* =====================================================
   COINS.JS - Street Racer 3D  (versi RINGAN)
   -----------------------------------------------------
   Fitur:
   1. Koin emas tersebar di jalan, ambil dengan menabraknya
   2. Uang tetap didapat walau game over
      (uang koin + bonus jarak)
   3. Jackpot besar kalau sampai finish
   4. Penghitung koin di layar saat balapan
   5. Rincian hadiah di layar hasil

   OPTIMASI:
   - Semua koin digambar dengan InstancedMesh, jadi hanya
     2 "draw call" berapa pun jumlah koinnya (sebelumnya
     tiap koin = 2 objek terpisah).
   - Tidak membuat / menghapus objek 3D saat balapan
     (mengurangi patah-patah akibat garbage collection).
   - Update posisi HUD koin lebih jarang & hanya jika berubah.

   File ini TIDAK mengubah file game lain. Ia "membungkus"
   fungsi yang sudah ada (startGame, updateHUD, crash,
   finishRace, backToHome).

   Harus dimuat SETELAH gamelogic.html (lihat index.html).
===================================================== */

(function () {

  "use strict";


  /* =====================================================
     PENGATURAN (silakan diubah-ubah)
  ===================================================== */

  const CONFIG = {

    coinValue: 15,          // uang untuk setiap 1 koin

    coinGap: [200, 400],    // jarak antar kelompok koin (makin besar = makin jarang)
    patternSize: [5, 8],    // jumlah koin dalam 1 kelompok
    coinSpacing: 7,         // jarak antar koin dalam 1 kelompok

    spawnZ: -240,           // posisi koin muncul (jauh di depan)
    removeZ: 20,            // koin dihapus setelah lewat titik ini

    crashDivisor: 50,       // bonus game over = jarak / angka ini
    jackpot: 5000,          // bonus besar kalau sampai finish

    maxCoins: 64            // batas koin di layar bersamaan
  };


  /* =====================================================
     VARIABEL
  ===================================================== */

  /* Data koin: { x, z, rot } -- hanya angka, bukan objek 3D */

  let coins = [];
  let coinCount = 0;         // jumlah koin yang sudah diambil
  let combo = 0;             // koin beruntun (untuk nada suara)
  let comboTimer = 0;

  let distSinceSpawn = 0;
  let nextGap = 0;
  let lastTime = 0;

  let outerMesh = null;      // InstancedMesh untuk badan koin
  let innerMesh = null;      // InstancedMesh untuk lingkaran dalam
  let dummy = null;
  let warned = false;

  let coinHud = null;
  let hudKey = "";


  /* =====================================================
     HELPER
  ===================================================== */

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function randBetween(a, b) {
    return a + Math.random() * (b - a);
  }

  function randInt(a, b) {
    return Math.floor(randBetween(a, b + 1));
  }

  function isRunning() {
    return typeof gameRunning !== "undefined" && gameRunning === true;
  }

  function getLanes() {
    return (typeof LANES !== "undefined") ? LANES : [-5, -2.5, 0, 2.5, 5];
  }

  function coinMoney() {
    return coinCount * CONFIG.coinValue;
  }


  /* =====================================================
     MEMBUNGKUS FUNGSI GAME
  ===================================================== */

  function wrap(name, handler) {

    const original = window[name];

    if (typeof original !== "function") {
      console.warn("[coins] Fungsi tidak ditemukan, dilewati:", name);
      return;
    }

    window[name] = function () {
      return handler(original, this, arguments);
    };

  }


  /* =====================================================
     MODEL KOIN (dibuat sekali)
     Memakai InstancedMesh: 1 model digambar berkali-kali
     dalam 1 perintah ke GPU.
  ===================================================== */

  function ensureMeshes() {

    if (typeof THREE === "undefined" || typeof scene === "undefined" || !scene) {
      return false;
    }

    if (typeof THREE.InstancedMesh !== "function") {

      if (!warned) {
        warned = true;
        console.warn("[coins] Versi THREE.js terlalu lama (tidak ada InstancedMesh). Koin dimatikan.");
      }

      return false;

    }

    if (!outerMesh) {

      /* Silinder tipis, diputar supaya menghadap ke depan */

      const outerGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.2, 16);
      outerGeo.rotateX(Math.PI / 2);

      const innerGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.26, 16);
      innerGeo.rotateX(Math.PI / 2);

      const outerMat = new THREE.MeshBasicMaterial({ color: 0xffb300 });
      const innerMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8 });

      outerMesh = new THREE.InstancedMesh(outerGeo, outerMat, CONFIG.maxCoins);
      innerMesh = new THREE.InstancedMesh(innerGeo, innerMat, CONFIG.maxCoins);

      /* Posisi koin terus berubah, jadi jangan dipotong oleh frustum culling */

      outerMesh.frustumCulled = false;
      innerMesh.frustumCulled = false;

      outerMesh.count = 0;
      innerMesh.count = 0;

      dummy = new THREE.Object3D();

    }

    /* Pasang ke scene (dan pasang lagi kalau scene sempat dibersihkan) */

    if (outerMesh.parent !== scene) scene.add(outerMesh);
    if (innerMesh.parent !== scene) scene.add(innerMesh);

    return true;

  }

  function clearCoins() {

    coins.length = 0;

    if (outerMesh) outerMesh.count = 0;
    if (innerMesh) innerMesh.count = 0;

  }


  /* =====================================================
     MEMUNCULKAN KELOMPOK KOIN
     "line"     = lurus di satu jalur
     "diagonal" = berpindah jalur perlahan (harus menyetir)
  ===================================================== */

  function spawnPattern() {

    const lanes = getLanes();

    const count = randInt(CONFIG.patternSize[0], CONFIG.patternSize[1]);

    if (coins.length + count > CONFIG.maxCoins) return;

    const mode = Math.random() < 0.4 ? "diagonal" : "line";

    let laneIndex = Math.floor(Math.random() * lanes.length);

    let dir = 1;
    if (laneIndex >= lanes.length - 1) dir = -1;
    else if (laneIndex > 0 && Math.random() < 0.5) dir = -1;

    for (let k = 0; k < count; k++) {

      if (mode === "diagonal" && k > 0 && k % 2 === 0) {
        laneIndex = clamp(laneIndex + dir, 0, lanes.length - 1);
      }

      coins.push({
        x: lanes[laneIndex],
        z: CONFIG.spawnZ - k * CONFIG.coinSpacing,
        rot: 0
      });

    }

  }


  /* =====================================================
     KOIN TERAMBIL
  ===================================================== */

  function collectCoin() {

    coinCount++;
    combo++;
    comboTimer = 0.6;

    if (window.GameAudio) window.GameAudio.play("coin", combo - 1);

    refreshCoinHud();

  }


  /* =====================================================
     UPDATE KOIN (dipanggil tiap frame lewat updateHUD)
  ===================================================== */

  function updateCoins(speed) {

    if (!isRunning() || speed <= 0) return;
    if (typeof playerCar === "undefined" || !playerCar) return;
    if (!ensureMeshes()) return;

    /* Hitung selisih waktu antar frame */

    const now = performance.now();
    const dt = clamp((now - lastTime) / 1000, 0, 0.05);
    lastTime = now;

    /* Munculkan kelompok koin berdasarkan jarak tempuh */

    distSinceSpawn += speed * dt;

    if (distSinceSpawn >= nextGap) {
      spawnPattern();
      distSinceSpawn = 0;
      nextGap = randBetween(CONFIG.coinGap[0], CONFIG.coinGap[1]);
    }

    /* Timer untuk koin beruntun */

    if (combo > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) combo = 0;
    }

    /* Gerakkan koin, cek terambil, buang yang sudah lewat */

    const carX = playerCar.position.x;
    const move = speed * dt;

    let w = 0;

    for (let i = 0; i < coins.length; i++) {

      const c = coins[i];

      const prevZ = c.z;

      c.z += move;
      c.rot += dt * 4;

      /* Sudah lewat di belakang mobil -> buang */

      if (c.z > CONFIG.removeZ) continue;

      /* Cek dengan "melompati" supaya koin tidak terlewat saat ngebut */

      const hitZ = Math.abs(c.z) < 3 || (prevZ < -3 && c.z > 3);

      if (hitZ && Math.abs(c.x - carX) < 1.9) {
        collectCoin();
        continue;
      }

      coins[w++] = c;

    }

    coins.length = w;

    /* Kirim posisi semua koin ke GPU sekaligus */

    for (let i = 0; i < w; i++) {

      const c = coins[i];

      dummy.position.set(c.x, 1.1, c.z);
      dummy.rotation.set(0, c.rot, 0);
      dummy.updateMatrix();

      outerMesh.setMatrixAt(i, dummy.matrix);
      innerMesh.setMatrixAt(i, dummy.matrix);

    }

    outerMesh.count = w;
    innerMesh.count = w;

    if (w > 0) {
      outerMesh.instanceMatrix.needsUpdate = true;
      innerMesh.instanceMatrix.needsUpdate = true;
    }

  }


  /* =====================================================
     TAMPILAN JUMLAH KOIN DI LAYAR
  ===================================================== */

  function createCoinHud() {

    coinHud = document.createElement("div");
    coinHud.id = "coinHud";

    coinHud.style.cssText =
      "position:fixed;" +
      "left:8px;" +
      "top:90px;" +
      "z-index:50;" +
      "display:none;" +
      "padding:6px 12px;" +
      "border-radius:12px;" +
      "background:rgba(15,23,42,.88);" +
      "border:2px solid rgba(255,255,255,.25);" +
      "color:#facc15;" +
      "font:bold 15px Arial,sans-serif;" +
      "pointer-events:none;";

    document.body.appendChild(coinHud);

    refreshCoinHud();

  }

  function refreshCoinHud() {

    if (!coinHud) return;

    /* Ikon koin dibuat dari CSS (emoji koin tidak tampil di Windows lama) */

    coinHud.innerHTML =
      '<span style="display:inline-block;width:13px;height:13px;' +
      'border-radius:50%;background:#ffb300;border:2px solid #fff1a8;' +
      'vertical-align:-2px;box-sizing:border-box;"></span> ' +
      coinCount + "  ·  💰 " + coinMoney();

  }

  /*
    Tampil hanya saat balapan, posisinya di bawah kotak HUD.
    Style hanya ditulis kalau nilainya berubah.
  */

  function updateCoinHudPosition() {

    if (!coinHud) return;

    const game = document.getElementById("game");

    const show =
      isRunning() &&
      game &&
      game.classList.contains("active");

    let left = 8;
    let top = 90;

    if (show) {

      const hud = document.getElementById("hud");

      if (hud) {
        const r = hud.getBoundingClientRect();
        left = Math.round(Math.max(8, r.left));
        top = Math.round(r.bottom + 8);
      }

    }

    const key = (show ? "1" : "0") + "|" + left + "|" + top;

    if (key === hudKey) return;

    hudKey = key;

    coinHud.style.display = show ? "block" : "none";
    coinHud.style.left = left + "px";
    coinHud.style.top = top + "px";

  }


  /* =====================================================
     UANG & LAYAR HASIL
  ===================================================== */

  function payMoney(amount) {

    if (amount <= 0) return;

    if (typeof save !== "undefined") {
      save.money += amount;
    }

    if (typeof saveGame === "function") saveGame();

  }

  function showReward(total, detailText) {

    const rewardEl = document.getElementById("rewardMoney");

    if (rewardEl) rewardEl.textContent = total;

    let detail = document.getElementById("rewardDetail");

    if (!detail && rewardEl) {

      const box = rewardEl.closest(".reward") || rewardEl.parentElement;

      detail = document.createElement("div");
      detail.id = "rewardDetail";

      detail.style.cssText =
        "color:#94a3b8;" +
        "font-size:14px;" +
        "margin:6px 0 16px;" +
        "line-height:1.6;" +
        "white-space:pre-line;";

      box.insertAdjacentElement("afterend", detail);

    }

    if (detail) detail.textContent = detailText;

  }

  function resetRound() {

    clearCoins();

    coinCount = 0;
    combo = 0;
    comboTimer = 0;

    nextGap = randBetween(CONFIG.coinGap[0], CONFIG.coinGap[1]);
    distSinceSpawn = nextGap;   // kelompok koin pertama muncul segera

    lastTime = performance.now();

    refreshCoinHud();

  }


  /* =====================================================
     HUBUNGKAN KE GAME
  ===================================================== */

  /* Mulai balapan -> reset koin */

  wrap("startGame", function (original, self, args) {

    clearCoins();

    const result = original.apply(self, args);

    if (isRunning()) resetRound();

    return result;

  });

  /* updateHUD dipanggil tiap frame -> kita pakai untuk menggerakkan koin */

  wrap("updateHUD", function (original, self, args) {

    const result = original.apply(self, args);

    try {
      updateCoins(Number(args[0]) || 0);
    } catch (error) {
      console.warn("[coins] updateCoins gagal:", error);
    }

    return result;

  });

  /* Game over -> tetap dapat uang koin + bonus jarak */

  wrap("crash", function (original, self, args) {

    const wasRunning = isRunning();

    const result = original.apply(self, args);

    if (wasRunning && !isRunning()) {

      const dist = (typeof score !== "undefined") ? score : 0;

      const distanceBonus = Math.floor(dist / CONFIG.crashDivisor);
      const coinBonus = coinMoney();
      const total = coinBonus + distanceBonus;

      payMoney(total);

      showReward(
        total,
        "Koin " + coinCount + " (+" + coinBonus + ")  ·  " +
        "Jarak (+" + distanceBonus + ")\n" +
        "Capai finish untuk JACKPOT +" + CONFIG.jackpot + "!"
      );

      clearCoins();

    }

    return result;

  });

  /* Finish -> hadiah finish (dari game) + JACKPOT + uang koin */

  wrap("finishRace", function (original, self, args) {

    const wasRunning = isRunning();

    const result = original.apply(self, args);

    if (wasRunning && !isRunning()) {

      const rewardEl = document.getElementById("rewardMoney");
      const base = rewardEl ? (Number(rewardEl.textContent) || 0) : 0;

      const coinBonus = coinMoney();
      const extra = CONFIG.jackpot + coinBonus;

      payMoney(extra);

      showReward(
        base + extra,
        "Hadiah finish +" + base + "\n" +
        "🎰 JACKPOT +" + CONFIG.jackpot + "\n" +
        "Koin " + coinCount + " (+" + coinBonus + ")"
      );

      clearCoins();

    }

    return result;

  });

  /* Keluar lewat tombol "Kembali ke Home" -> koin yang sudah diambil tetap disimpan */

  wrap("backToHome", function (original, self, args) {

    const wasRunning = isRunning();

    const result = original.apply(self, args);

    if (wasRunning) {

      const coinBonus = coinMoney();

      payMoney(coinBonus);
      clearCoins();

      if (coinBonus > 0 && typeof showGameModal === "function") {
        showGameModal(
          "KOIN DISIMPAN",
          "Kamu membawa pulang 💰 " + coinBonus + " dari koin yang diambil.",
          "⭐"
        );
      }

      coinCount = 0;
      refreshCoinHud();

    }

    return result;

  });


  /* =====================================================
     MULAI
  ===================================================== */

  createCoinHud();

  setInterval(updateCoinHudPosition, 500);

  console.log("Coins.js berhasil dimuat.");

})();
