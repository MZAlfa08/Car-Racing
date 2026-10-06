/* =====================================================
   COINS.JS - Street Racer 3D
   -----------------------------------------------------
   Fitur:
   1. Koin emas tersebar di jalan, ambil dengan menabraknya
   2. Uang tetap didapat walau game over
      (uang koin + bonus jarak)
   3. Jackpot besar kalau sampai finish
   4. Penghitung koin di layar saat balapan
   5. Rincian hadiah di layar hasil

   File ini TIDAK mengubah file game lain. Ia "membungkus"
   fungsi yang sudah ada (startGame, updateHUD, crash,
   finishRace, backToHome) lalu menambah fitur koin.

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
    jackpot: 5000           // bonus besar kalau sampai finish

  };


  /* =====================================================
     VARIABEL
  ===================================================== */

  let coins = [];            // koin yang sedang ada di jalan
  let coinCount = 0;         // jumlah koin yang sudah diambil
  let combo = 0;             // koin beruntun (untuk nada suara)
  let comboTimer = 0;

  let distSinceSpawn = 0;
  let nextGap = 0;
  let lastTime = 0;

  let outerGeo = null;
  let innerGeo = null;
  let outerMat = null;
  let innerMat = null;

  let coinHud = null;


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

  function isPaused() {
    return typeof gamePaused !== "undefined" && gamePaused === true;
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
     MODEL KOIN (dibuat sekali, dipakai ulang)
  ===================================================== */

  function buildAssets() {

    if (outerGeo) return true;

    if (typeof THREE === "undefined") {
      console.warn("[coins] THREE.js tidak ditemukan.");
      return false;
    }

    /* Silinder tipis, diputar supaya menghadap ke depan */

    outerGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.18, 20);
    outerGeo.rotateX(Math.PI / 2);

    innerGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.24, 20);
    innerGeo.rotateX(Math.PI / 2);

    outerMat = new THREE.MeshBasicMaterial({ color: 0xffb300 });
    innerMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8 });

    return true;

  }

  function addCoin(x, z) {

    const coin = new THREE.Group();

    coin.add(new THREE.Mesh(outerGeo, outerMat));
    coin.add(new THREE.Mesh(innerGeo, innerMat));

    coin.position.set(x, 1.1, z);

    scene.add(coin);
    coins.push(coin);

  }

  function clearCoins() {

    coins.forEach(function (coin) {
      if (typeof scene !== "undefined" && scene) scene.remove(coin);
    });

    coins = [];

  }


  /* =====================================================
     MEMUNCULKAN KELOMPOK KOIN
     "line"     = lurus di satu jalur
     "diagonal" = berpindah jalur perlahan (harus menyetir)
  ===================================================== */

  function spawnPattern() {

    const lanes = getLanes();

    const count = randInt(CONFIG.patternSize[0], CONFIG.patternSize[1]);
    const mode = Math.random() < 0.4 ? "diagonal" : "line";

    let laneIndex = Math.floor(Math.random() * lanes.length);

    let dir = 1;
    if (laneIndex >= lanes.length - 1) dir = -1;
    else if (laneIndex > 0 && Math.random() < 0.5) dir = -1;

    for (let k = 0; k < count; k++) {

      if (mode === "diagonal" && k > 0 && k % 2 === 0) {
        laneIndex = clamp(laneIndex + dir, 0, lanes.length - 1);
      }

      addCoin(lanes[laneIndex], CONFIG.spawnZ - k * CONFIG.coinSpacing);

    }

  }


  /* =====================================================
     UPDATE KOIN (dipanggil tiap frame lewat updateHUD)
  ===================================================== */

  function updateCoins(speed) {

    if (!isRunning() || speed <= 0) return;
    if (typeof scene === "undefined" || !scene) return;
    if (typeof playerCar === "undefined" || !playerCar) return;
    if (!buildAssets()) return;

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

    /* Gerakkan koin & cek apakah terambil */

    const carX = playerCar.position.x;

    for (let i = coins.length - 1; i >= 0; i--) {

      const coin = coins[i];

      const prevZ = coin.position.z;

      coin.position.z += speed * dt;
      coin.rotation.y += dt * 4;

      const z = coin.position.z;

      /* Sudah lewat di belakang mobil -> hapus */

      if (z > CONFIG.removeZ) {
        scene.remove(coin);
        coins.splice(i, 1);
        continue;
      }

      const dx = Math.abs(coin.position.x - carX);

      /* Cek dengan "melompati" supaya koin tidak terlewat saat ngebut */

      const hitZ = Math.abs(z) < 3 || (prevZ < -3 && z > 3);

      if (dx < 1.9 && hitZ) {

        scene.remove(coin);
        coins.splice(i, 1);

        coinCount++;
        combo++;
        comboTimer = 0.6;

        if (window.GameAudio) window.GameAudio.play("coin", combo - 1);

        refreshCoinHud();

      }

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

    coinHud.textContent = "🪙 " + coinCount + "  ·  💰 " + coinMoney();

  }

  /* Tampil hanya saat balapan, posisinya di bawah kotak HUD */

  function updateCoinHudPosition() {

    if (!coinHud) return;

    const game = document.getElementById("game");

    const show =
      isRunning() &&
      game &&
      game.classList.contains("active");

    coinHud.style.display = show ? "block" : "none";

    if (!show) return;

    const hud = document.getElementById("hud");

    if (hud) {

      const r = hud.getBoundingClientRect();

      coinHud.style.left = Math.max(8, r.left) + "px";
      coinHud.style.top = (r.bottom + 8) + "px";

    }

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
          "🪙"
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

  setInterval(updateCoinHudPosition, 250);

  console.log("Coins.js berhasil dimuat.");

})();
