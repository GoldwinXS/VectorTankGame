import * as THREE from "three";
import {
  createScene,
  resolveObstacles,
  hitsObstacle,
  updateBoundary,
  activateZone,
  INITIAL_HALF,
  ZONE_SIZE,
  terrainH,
  terrainSlope,
  setTerrainColors,
  setStarColor,
  setCrystalEmissive,
  buildDecorForZone,
} from "./scene.js";
import { GRAVITY } from "./projectile.js";
import { Player } from "./player.js";
import { WaveManager } from "./wave.js";
import { TacticSelector } from "./nn.js";
import { UI } from "./ui.js";
import { Shop } from "./shop.js";
import { UpgradePicker } from "./upgrade.js";
import { spawnPickups, spawnPickupsAt } from "./pickup.js";
import { audio } from "./audio.js";

// Shared soft circular sprite for smoke particles
let _smokeTexMain = null;
function _getSmokeTex() {
  if (_smokeTexMain) return _smokeTexMain;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.4, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  _smokeTexMain = new THREE.CanvasTexture(c);
  return _smokeTexMain;
}

function safeExitPointerLock() {
  try {
    document.exitPointerLock?.();
  } catch (_) {}
}

// ── Leaderboard (localStorage) ────────────────────────────────────────────────
const LS_KEY = "vector_highscores_v1";

function loadScores() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) ?? [];
  } catch {
    return [];
  }
}

function saveScore(score, waves, hull) {
  const scores = loadScores();
  scores.push({
    score,
    waves,
    hull: hull ?? "vanguard",
    date: new Date().toLocaleDateString(),
  });
  scores.sort((a, b) => b.score - a.score);
  scores.splice(10);
  localStorage.setItem(LS_KEY, JSON.stringify(scores));
}

function renderLeaderboard() {
  const el = document.getElementById("leaderboard-entries");
  const scores = loadScores();
  if (scores.length === 0) {
    el.innerHTML = '<div class="lb-empty">No scores recorded yet.</div>';
    return;
  }
  el.innerHTML = scores
    .slice(0, 10)
    .map(
      (e, i) => `
    <div class="lb-row${i === 0 ? " lb-top" : ""}">
      <span class="lb-rank">#${i + 1}</span>
      <span class="lb-score">${e.score.toLocaleString()}</span>
      <span class="lb-detail">${(e.hull ?? "—").toUpperCase()} · WV ${e.waves}</span>
      <span class="lb-date">${e.date ?? ""}</span>
    </div>`,
    )
    .join("");
}

// ── Menu helpers ──────────────────────────────────────────────────────────────
function showMenuPanel(name) {
  document
    .getElementById("settings-screen")
    .classList.toggle("hidden", name !== "settings");
  document
    .getElementById("leaderboard-screen")
    .classList.toggle("hidden", name !== "leaderboard");
  document
    .getElementById("howto-screen")
    .classList.toggle("hidden", name !== "howto");
}

function showMainMenu() {
  safeExitPointerLock();
  // Clean up game-over cinematic
  if (_smokeParticles) {
    scene.remove(_smokeParticles);
    _smokeParticles.geometry.dispose();
    _smokeParticles.material.dispose();
    _smokeParticles = null;
    _smokeData = null;
  }
  _gameOverOrbit = null;
  // Tear down any running game
  if (player) scene.remove(player.group);
  if (waveManager) waveManager.clearEnemies();
  projectiles.forEach((p) => p.destroy());
  projectiles = [];
  clearPickups();
  player = null;
  waveManager = null;
  score = 0;
  scoreRef.value = 0;
  waveNum = 0;
  chosenHull = "vanguard";
  document
    .querySelectorAll(".hull-choice")
    .forEach((b) => b.classList.remove("selected"));
  document
    .querySelector('.hull-choice[data-hull="vanguard"]')
    ?.classList.add("selected");
  ui.hidePause();
  _introCam = null;
  viewMode = 1;
  document.getElementById("game-over-screen")?.classList.add("hidden");
  document.getElementById("controls-hint")?.classList.add("hidden");
  document.getElementById("training-banner")?.classList.add("hidden");
  document.getElementById("hull-select-screen").classList.add("hidden");
  document.getElementById("start-screen").classList.add("hidden");
  document.getElementById("main-menu-screen").classList.remove("hidden");
  showMenuPanel("main");
  trainingMode = false;
  state = STATE.IDLE;
  paused = false;
}

// ── State ─────────────────────────────────────────────────────────────────────
const STATE = { IDLE: 0, PLAYING: 1, WAVE_TRANSITION: 2, GAME_OVER: 3 };
let state = STATE.IDLE;

// ── Mobile detection ──────────────────────────────────────────────────────────
const forceMobile = localStorage.getItem("vec_force_mobile") === "true";
const isMobile = "ontouchstart" in window || forceMobile;

// ── Scene ─────────────────────────────────────────────────────────────────────
const canvas = document.getElementById("canvas");
const { scene, camera, renderer, boundaryGeo, fog, ambientLight, dirLight } =
  createScene(canvas);

// ── Stage vibe system (advances at start of each boss wave: 5, 10, 15, 20…) ──
// Each stage shifts fog, sky, ambient light, and directional light for a full
// scene transformation. Stages 0–4 cover the full run.
const STAGE_VIBES = [
  {
    // Stage 0 — standard ops (waves 1-4)
    fogColor: 0x020b18,
    clearColor: 0x010810,
    ambientHex: 0x112244,
    ambientInt: 6,
    dirHex: 0x4488ff,
    dirInt: 3,
    fogDensity: 0.04,
    terrainHex: 0x004466,
    wireHex: 0x005577,
    starHex: 0x88bbff,
    crystalHex: 0x00aadd,
  },
  {
    // Stage 1 — deep navy (boss wave 5)
    fogColor: 0x020e22,
    clearColor: 0x010a1c,
    ambientHex: 0x0a1840,
    ambientInt: 5,
    dirHex: 0x1166cc,
    dirInt: 2.5,
    fogDensity: 0.046,
    terrainHex: 0x002255,
    wireHex: 0x003388,
    starHex: 0x5588cc,
    crystalHex: 0x0066ff,
  },
  {
    // Stage 2 — purple void (boss wave 10)
    fogColor: 0x0d0230,
    clearColor: 0x080120,
    ambientHex: 0x1e0850,
    ambientInt: 4.5,
    dirHex: 0x9933cc,
    dirInt: 2.2,
    fogDensity: 0.054,
    terrainHex: 0x1a0055,
    wireHex: 0x660099,
    starHex: 0xaa44ff,
    crystalHex: 0x8833ff,
  },
  {
    // Stage 3 — blood ember (boss wave 15)
    fogColor: 0x300808,
    clearColor: 0x1e0404,
    ambientHex: 0x420c0c,
    ambientInt: 4,
    dirHex: 0xdd3322,
    dirInt: 2.0,
    fogDensity: 0.062,
    terrainHex: 0x440800,
    wireHex: 0x991100,
    starHex: 0xff7733,
    crystalHex: 0xff4400,
  },
  {
    // Stage 4 — crimson endgame (boss wave 20+)
    fogColor: 0x3d0404,
    clearColor: 0x220101,
    ambientHex: 0x440606,
    ambientInt: 3.5,
    dirHex: 0xff2200,
    dirInt: 1.8,
    fogDensity: 0.072,
    terrainHex: 0x5c0500,
    wireHex: 0xbb1100,
    starHex: 0xff2200,
    crystalHex: 0xff1100,
  },
];
let _currentStage = 0;

function applyStageVibe(stage, showFlash = true) {
  const v = STAGE_VIBES[Math.min(stage, STAGE_VIBES.length - 1)];
  fog.color.setHex(v.fogColor);
  fog.density = v.fogDensity;
  renderer.setClearColor(v.clearColor);
  ambientLight.color.setHex(v.ambientHex);
  ambientLight.intensity = v.ambientInt;
  dirLight.color.setHex(v.dirHex);
  dirLight.intensity = v.dirInt;
  setTerrainColors(v.terrainHex, v.wireHex);
  setStarColor(v.starHex);
  setCrystalEmissive(v.crystalHex);
  if (showFlash) {
    const el = document.getElementById("damage-flash");
    if (el) {
      el.style.background = "rgba(255,200,0,0.30)";
      setTimeout(() => {
        el.style.background = "";
      }, 650);
    }
  }
}
const ui = new UI();
const nn = new TacticSelector();
const shop = new Shop();
const upgrades = new UpgradePicker();

// ── Hull selection ────────────────────────────────────────────────────────────
let chosenHull = "vanguard";

function _applyHullChoice(p) {
  if (chosenHull === "blitzer") {
    p.maxHp = 70;
    p.hp = 70;
    p.speedMult = 1.35;
    p.damageMult = 0.85;
    p.reloadMult = 0.8;
    p.traverseMult = 1.4; // fast light turret
    p.movementSpreadMult = 1.4; // harder to stabilize — reward stopping to fire
    p.aimChargeMult = 1.6; // but charges aim fast when stationary
  } else if (chosenHull === "bastion") {
    p.maxHp = 145;
    p.hp = 145;
    p.speedMult = 0.72;
    p.damageMult = 1.3;
    p.reloadMult = 1.25;
    p.armorMult = 0.85;
    p.traverseMult = 0.65; // heavy slow turret
    p.movementSpreadMult = 0.65; // heavier chassis = better stabilizer
    p.aimChargeMult = 0.75; // but sluggish mechanisms mean slower aim charge
  }
  // vanguard = defaults (movementSpreadMult 1.0, aimChargeMult 1.0)
}

// ── Game objects ──────────────────────────────────────────────────────────────
let projectiles = [],
  pickups = [],
  player,
  waveManager;
let score = 0,
  waveNum = 0,
  lastTime = 0;
let shakeIntensity = 0;
const scoreRef = { value: 0 };
let _nnAdaptTimer = 0;
const NN_ADAPT_INTERVAL = 22; // seconds between mid-wave tactic re-evaluations

// ── Dynamic arena bounds ──────────────────────────────────────────────────────
const EXPANSION_ORDER = ["east", "south", "west", "north"];
let expansionStep = 0;
let gameBounds = {
  minX: -INITIAL_HALF,
  maxX: INITIAL_HALF,
  minZ: -INITIAL_HALF,
  maxZ: INITIAL_HALF,
};
let revealAnim = null;

function lerpBounds(a, b, t) {
  return {
    minX: a.minX + (b.minX - a.minX) * t,
    maxX: a.maxX + (b.maxX - a.maxX) * t,
    minZ: a.minZ + (b.minZ - a.minZ) * t,
    maxZ: a.maxZ + (b.maxZ - a.maxZ) * t,
  };
}

function tickReveal(delta) {
  if (!revealAnim) return;
  revealAnim.progress = Math.min(
    1,
    revealAnim.progress + delta / revealAnim.dur,
  );
  const t = revealAnim.progress;
  const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  updateBoundary(boundaryGeo, lerpBounds(revealAnim.from, revealAnim.to, ease));
  revealAnim.meshes.forEach((m) => {
    if (!m.isMesh || !m.material.emissive) return;
    m.material.emissiveIntensity = 1.0 - 0.6 * t;
    if (t > 0.3) m.material.color.setHex(0x001122);
  });
  if (t >= 1) {
    gameBounds = { ...revealAnim.to };
    updateBoundary(boundaryGeo, gameBounds);
    revealAnim = null;
  }
}

function startZoneReveal(direction) {
  const to = { ...gameBounds };
  if (direction === "east") to.maxX += ZONE_SIZE;
  if (direction === "south") to.maxZ += ZONE_SIZE;
  if (direction === "west") to.minX -= ZONE_SIZE;
  if (direction === "north") to.minZ -= ZONE_SIZE;
  const meshes = activateZone(direction, scene);
  buildDecorForZone(scene, direction);
  meshes.forEach((m) => {
    if (m.isMesh && m.material) {
      m.material.color.setHex(0xaaffff);
      m.material.emissiveIntensity = 1.0;
    }
  });
  // Lift fog as arena grows
  fog.density = Math.max(0.008, fog.density - 0.007);
  revealAnim = { progress: 0, dur: 2.2, from: { ...gameBounds }, to, meshes };
}

// ── Player mobility ───────────────────────────────────────────────────────────
let distanceTraveled = 0;
const _lastPlayerPos = new THREE.Vector3();

// ── Camera orbit (mouse-controlled) ──────────────────────────────────────────
let camYaw = 0; // world angle camera orbits at
let camMouseDelta = 0; // accumulated from mousemove this frame
const CAM_SENSITIVITY = 0.0025;
const PITCH_SENSITIVITY = 0.0012;
const CAM_DIST = 12;
const CAM_H = 5.5;
const CAM_DIST_MID = 3.5;
const CAM_H_MID = 1.5;

// ── Input ─────────────────────────────────────────────────────────────────────
const keys = {};
let mouseDown = false;
let rightMouseDown = false;
let freeLook = false;
let viewMode = 1; // 0 = FPV, 1 = mid (over-shoulder), 2 = far
let paused = false;
let pitchDelta = 0;
let _introCam = null; // intro fly-in sequence state

// ── Graphics / app settings ───────────────────────────────────────────────────
let _gfxQuality = localStorage.getItem("vec_gfx_quality");
if (!_gfxQuality) {
  const mem = navigator.deviceMemory ?? 4;
  _gfxQuality = mem < 2 ? "low" : mem < 4 ? "med" : "high";
}
let _shakeEnabled = localStorage.getItem("vec_shake") !== "0";

function applyGraphicsQuality(q) {
  _gfxQuality = q;
  localStorage.setItem("vec_gfx_quality", q);
  if (q === "low") {
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = false;
  } else if (q === "med") {
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
  } else {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
  }
  renderer.setSize(window.innerWidth, window.innerHeight);
  ["low", "med", "high"].forEach((k) =>
    document
      .getElementById(`btn-gfx-${k}`)
      ?.classList.toggle("active", k === q),
  );
}
applyGraphicsQuality(_gfxQuality);

const aimTarget = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const TAG_COLORS_LOG = {
  firepower: "#ff8800",
  defense: "#8844ff",
  speed: "#00ffff",
  utility: "#00ff88",
};

function _renderUpgradeLog() {
  const el = document.getElementById("upgrade-log");
  if (!el) return;
  const waveHistory = upgrades.getHistory(); // [{label, tag}]
  const shopHistory = shop.getHistory(); // [{label, count}]
  const total =
    waveHistory.length + shopHistory.reduce((s, h) => s + h.count, 0);
  if (total === 0) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  const rows = [
    ...waveHistory.map((h) => {
      const col = TAG_COLORS_LOG[h.tag] || "#aaa";
      return `<div class="upgrade-log-row"><span class="upgrade-log-src">WAVE</span><span style="color:${col};flex:1">${h.label}</span><span class="upgrade-log-tag">${h.tag.toUpperCase()}</span></div>`;
    }),
    ...shopHistory.map(
      (h) =>
        `<div class="upgrade-log-row"><span class="upgrade-log-src">SHOP</span><span style="flex:1">${h.label}</span>${h.count > 1 ? `<span class="upgrade-log-tag">×${h.count}</span>` : ""}</div>`,
    ),
  ];
  el.innerHTML =
    `<div class="upgrade-log-title">UPGRADES (${total})</div>` + rows.join("");
}

window.addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (e.code === "KeyC") freeLook = true;
  if (e.code === "KeyV" && !_introCam) {
    viewMode = (viewMode + 1) % 3;
  }
  if (e.code === "KeyH" && !isMobile) {
    document.getElementById("hud")?.classList.toggle("hud-hidden");
  }
  if (e.code === "KeyP" && state === STATE.PLAYING) {
    paused = !paused;
    if (paused) {
      _renderUpgradeLog();
      safeExitPointerLock();
      // Sync pause-screen audio controls to current state
      const pv = document.getElementById("pause-vol-master");
      if (pv) pv.value = String(audio.masterVol);
      const pmv = document.getElementById("pause-vol-music");
      if (pmv) pmv.value = String(audio.musicVol);
      const psv = document.getElementById("pause-vol-sfx");
      if (psv) psv.value = String(audio.sfxVol);
      _syncMuteBtns();
      ui.showPause(player, () => {
        paused = false;
        lockPointer();
      });
    } else {
      ui.hidePause();
      lockPointer();
    }
  }
});
window.addEventListener("keyup", (e) => {
  keys[e.code] = false;
  if (e.code === "KeyC") freeLook = false;
});

window.addEventListener("mousemove", (e) => {
  if (state === STATE.PLAYING) {
    camMouseDelta -= e.movementX * CAM_SENSITIVITY; // negative = standard orbit direction
    if (!freeLook) pitchDelta -= e.movementY * PITCH_SENSITIVITY; // up = negative movementY
  }
});

window.addEventListener("mousedown", (e) => {
  if (e.button === 0) mouseDown = true;
  if (e.button === 2) rightMouseDown = true;
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) rightMouseDown = false;
});
window.addEventListener("contextmenu", (e) => e.preventDefault());

// ── Crosshair / Heading / Buffs ───────────────────────────────────────────────
const crosshairEl = document.getElementById("crosshair");
const lowHpVignetteEl = document.getElementById("low-hp-vignette");
const waveStandbyEl = document.getElementById("wave-standby");
const headingCanvas = document.getElementById("heading-canvas");
const headingCtx = headingCanvas?.getContext("2d") ?? null;
const buffPanelEl = document.getElementById("buff-panel");
const buffListEl = document.getElementById("buff-list");

function _drawMiniTank(ctx, W, H) {
  ctx.clearRect(0, 0, W, H);
  if (!player || state !== STATE.PLAYING) return;

  const cx = W / 2,
    cy = H / 2;
  const hullAngle = player.group.rotation.y - camYaw;
  const turretTotal = hullAngle + player.turret.rotation.y;

  ctx.strokeStyle = "rgba(0,120,140,0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(0,200,200,0.5)";
  ctx.beginPath();
  ctx.moveTo(cx, cy - 30);
  ctx.lineTo(cx, cy - 24);
  ctx.stroke();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-hullAngle);
  ctx.fillStyle = "rgba(0,180,200,0.22)";
  ctx.strokeStyle = "#00ccee";
  ctx.lineWidth = 1;
  ctx.fillRect(-6, -11, 12, 22);
  ctx.strokeRect(-6, -11, 12, 22);
  ctx.fillStyle = "#00ffff";
  ctx.fillRect(3, 10, -6, -5);
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-turretTotal);
  ctx.fillStyle = "rgba(0,220,255,0.5)";
  ctx.strokeStyle = "#00ffff";
  ctx.lineWidth = 1;
  ctx.fillRect(-4, -3, 8, 7);
  ctx.strokeRect(-4, -3, 8, 7);
  ctx.strokeStyle = "#00ffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -3);
  ctx.lineTo(0, -15);
  ctx.stroke();
  ctx.restore();
}

function updateHeadingArrow() {
  if (headingCtx && headingCanvas) {
    _drawMiniTank(headingCtx, headingCanvas.width, headingCanvas.height);
  }
}

const BUFF_NAMES = {
  speed: "SPD",
  damage: "DMG",
  armor: "ARM",
  traverse: "TRV",
};
function updateBuffDisplay() {
  if (!player || state !== STATE.PLAYING) {
    buffPanelEl.style.display = "none";
    return;
  }
  const buffs = player.activeBuffs;
  const keys = Object.keys(buffs);
  if (keys.length === 0) {
    buffPanelEl.style.display = "none";
    return;
  }
  buffPanelEl.style.display = "";
  buffListEl.innerHTML = keys
    .map(
      (k) =>
        `<div class="buff-row"><span class="buff-name">${BUFF_NAMES[k] ?? k.toUpperCase()}</span><span class="buff-timer">${Math.ceil(buffs[k].timer)}s</span></div>`,
    )
    .join("");
  // Also update top-bar buff chip
  const chipEl = document.getElementById("mob-buff-chip");
  if (chipEl) {
    if (keys.length === 0) {
      chipEl.classList.add("hidden");
    } else {
      const k = keys[0];
      const name = BUFF_NAMES[k] ?? k.toUpperCase();
      const timer = Math.ceil(buffs[k].timer);
      chipEl.textContent =
        keys.length > 1
          ? `${name} ${timer}s +${keys.length - 1}`
          : `${name} ${timer}s`;
      chipEl.classList.remove("hidden");
    }
  }
}

const _landingPt = new THREE.Vector3();
function updateCrosshair() {
  if (!player || state !== STATE.PLAYING) {
    crosshairEl.style.opacity = "0";
    return;
  }

  // All views: floating reticle at the ballistic landing point of a shell fired right now
  {
    const barrelAngle = player.barrelWorldAngle;
    const pitch = player.barrelPitch;
    const speed = player.bulletSpeed;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const vx = Math.sin(barrelAngle) * cp * speed;
    const vy = sp * speed;
    const vz = Math.cos(barrelAngle) * cp * speed;

    // Shell starts at terrain height + turret offset (~0.75 above hull base)
    const startY = player.position.y + 0.75;
    // Solve 0 = startY + vy·t – ½g·t²
    const disc = vy * vy + 2 * GRAVITY * startY;
    if (disc < 0) { crosshairEl.style.opacity = "0"; return; }
    const t = (vy + Math.sqrt(disc)) / GRAVITY;

    const lx = player.position.x + vx * t;
    const lz = player.position.z + vz * t;
    _landingPt.set(lx, terrainH(lx, lz), lz);

    const projected = _landingPt.clone().project(camera);
    if (projected.z > 1) { crosshairEl.style.opacity = "0"; return; }
    crosshairEl.style.left = (projected.x *  0.5 + 0.5) * window.innerWidth  + "px";
    crosshairEl.style.top  = (projected.y * -0.5 + 0.5) * window.innerHeight + "px";
  }

  const charge = player.aimCharge;
  const movePenVis =
    Math.min(1, player._velMag / 2) * (player.movementSpreadMult ?? 1);
  const turretPenVis =
    Math.min(1, player._turretVelMag / 0.6) * (player.movementSpreadMult ?? 1);
  const size = Math.round(
    44 - charge * 32 + (movePenVis + turretPenVis * 0.7) * 22,
  );
  const r = Math.round(charge * 255);
  crosshairEl.style.width = size + "px";
  crosshairEl.style.height = size + "px";
  crosshairEl.style.borderColor = `rgb(${r},255,255)`;
  crosshairEl.style.opacity = String(0.55 + charge * 0.45);
}

// ── Score popup ───────────────────────────────────────────────────────────────
function showScorePopup(points, worldPos) {
  const v = worldPos.clone().project(camera);
  if (v.z > 1) return; // behind camera
  const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
  const el = document.createElement("div");
  el.className = "score-popup";
  el.textContent = "+" + points;
  el.style.left = sx + "px";
  el.style.top = sy + "px";
  document.getElementById("ui").appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

// ── Pickups ───────────────────────────────────────────────────────────────────
function clearPickups() {
  pickups.forEach((pk) => pk.collect());
  pickups = [];
}

function checkPickupCollisions() {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const pk = pickups[i];
    if (!pk.alive) {
      pickups.splice(i, 1);
      continue;
    }
    const dx = player.position.x - pk.position.x;
    const dz = player.position.z - pk.position.z;
    if (Math.sqrt(dx * dx + dz * dz) < pk.radius + player.radius) {
      pk.applyTo(player);
      pk.collect();
      pickups.splice(i, 1);
      ui.showWaveMessage(`+ ${pk.label}`, 700);
    }
  }
}

// ── Init / Restart ────────────────────────────────────────────────────────────
function init() {
  if (player) scene.remove(player.group);
  if (waveManager) waveManager.clearEnemies();
  projectiles.forEach((p) => p.destroy());
  clearPickups();

  projectiles = [];
  score = 0;
  scoreRef.value = 0;
  waveNum = 0;
  shakeIntensity = 0;
  distanceTraveled = 0;
  expansionStep = 0;
  camYaw = 0;
  camMouseDelta = 0;
  _currentStage = 0;
  _introCam = null;
  viewMode = 1;
  applyStageVibe(0, false);

  gameBounds = {
    minX: -INITIAL_HALF,
    maxX: INITIAL_HALF,
    minZ: -INITIAL_HALF,
    maxZ: INITIAL_HALF,
  };
  updateBoundary(boundaryGeo, gameBounds);

  upgrades.resetRun();
  shop.resetHistory();
  audio.startRun();
  player = new Player(scene, projectiles, chosenHull);
  _applyHullChoice(player);
  // Wire component damage notifications back to UI (visible feedback on all devices)
  const COMP_ALERTS = {
    track: "TRACK DAMAGED — TURNING BLOCKED",
    engine: "ENGINE HIT — SPEED REDUCED",
    turret: "TURRET LOCKED — AIM BLOCKED",
  };
  player._compCb = (comp) => {
    ui.showComponentDamage(comp);
    ui.showHitFeedback(COMP_ALERTS[comp] ?? "COMPONENT DAMAGED", "#ff4444");
  };
  waveManager = new WaveManager(scene, projectiles, nn);
  waveManager.initTactic();

  _lastPlayerPos.copy(player.position);
  ui.updateHUD(player.hp, player.maxHp, score, "—", player.lives);
  ui.updateProtocol("—", [0.25, 0.25, 0.25, 0.25]);
}

// ── Training mode ─────────────────────────────────────────────────────────────
let trainingMode = false;

async function _restartTrainingWave() {
  if (!trainingMode) return;
  state = STATE.WAVE_TRANSITION;
  waveManager.clearEnemies();
  clearPickups();
  await ui.showWaveMessage("WAVE CLEARED", 600);
  player.hp = player.maxHp;
  player.resetWaveStats();
  audio.setWave(1);
  waveManager.startWave(
    1,
    gameBounds,
    player.hp,
    player.maxHp,
    [0.7, 0.1, 0.1, 0.1],
    player.position,
  );
  state = STATE.PLAYING;
}

// ── Wave flow ─────────────────────────────────────────────────────────────────
async function startNextWave() {
  state = STATE.WAVE_TRANSITION;
  waveNum++;

  if (waveNum > 1) {
    const nextTactic = waveManager.chooseNextTactic(
      player.hp,
      player.maxHp,
      player.shotsFired,
      player.shotsHit,
      distanceTraveled,
    );
    ui.updateProtocol(nextTactic, nn.probs);

    const prevWasBoss = (waveNum - 1) % 5 === 0;
    await ui.showWaveMessage(
      prevWasBoss ? "BOSS ELIMINATED" : `WAVE ${waveNum - 1} CLEARED`,
      900,
    );

    clearPickups();
    pickups = spawnPickups(scene, gameBounds, 3 + Math.floor(waveNum / 2));

    // Roguelike upgrade pick
    safeExitPointerLock();
    await upgrades.open(player, waveNum - 1, {
      score,
      shotsHit: player.shotsHit,
      shotsFired: player.shotsFired,
      hpRemaining: player.hp,
      maxHp: player.maxHp,
    });

    // Shop
    safeExitPointerLock();
    scoreRef.value = score;
    await shop.open(player, scoreRef);
    score = scoreRef.value;

    if (expansionStep < EXPANSION_ORDER.length) {
      const dir = EXPANSION_ORDER[expansionStep++];
      startZoneReveal(dir);
      await ui.showWaveMessage("SECTOR ONLINE", 2300);
    }
  }

  // Boss wave: advance atmosphere BEFORE the wave begins — darkness arrives first
  if (waveNum % 5 === 0) {
    _currentStage = Math.min(_currentStage + 1, STAGE_VIBES.length - 1);
    applyStageVibe(_currentStage, false); // no gold flash yet — save that for the kill
    await ui.showWaveMessage("!! BOSS WAVE !!", 1400);
  }

  distanceTraveled = 0;
  _nnAdaptTimer = 0;
  _lastPlayerPos.copy(player.position);
  player.resetWaveStats();
  audio.setWave(waveNum);
  // Pass nn.probs so each enemy draws its own tactic from the distribution
  waveManager.startWave(
    waveNum,
    gameBounds,
    player.hp,
    player.maxHp,
    nn.probs,
    player.position,
  );
  // Start intro fly-in BEFORE the wave message await so camera transitions
  // smoothly from wherever the idle orbit left it — no jarring snap.
  if (waveNum === 1) _startIntroShot();
  await ui.showWaveMessage(`WAVE  ${waveNum}`, 800);
  state = STATE.PLAYING;
  if (waveNum === 1 && !localStorage.getItem("vec_hint_shown")) {
    const hintEl = document.getElementById("controls-hint");
    if (hintEl) {
      if (isMobile) {
        // Replace hint content with touch controls
        const rows = [
          ["JOYSTICK", "Move / steer hull"],
          ["DRAG RIGHT", "Aim camera / orbit"],
          ["CANNON", "Main gun — hold still to improve aim"],
          ["MG", "Coax MG — limited ammo, auto-reload"],
          ["FPV", "Toggle first-person view"],
          ["≡ HUD", "Toggle stats panel"],
        ];
        hintEl.innerHTML =
          `<div class="hint-header">CONTROLS <span class="hint-close" id="btn-hint-close">✕</span></div>` +
          rows
            .map(
              ([k, d]) =>
                `<div class="hint-row"><span class="hint-key">${k}</span><span>${d}</span></div>`,
            )
            .join("");
      }
      hintEl.classList.remove("hidden");
      setTimeout(() => hintEl.classList.add("hidden"), isMobile ? 12000 : 8000);
    }
  }
}

// ── Collision ─────────────────────────────────────────────────────────────────
function checkCollisions() {
  const enemies = waveManager.enemies;
  for (let pi = projectiles.length - 1; pi >= 0; pi--) {
    const proj = projectiles[pi];
    if (!proj.alive) {
      // Mortar splash damage
      if (proj._splashPos && proj.splashRadius > 0 && player?.alive) {
        const sd = proj._splashPos.distanceTo(player.position);
        if (sd < proj.splashRadius && player._invincTimer <= 0) {
          const falloff = 1 - sd / proj.splashRadius;
          player.takeDamage(Math.round(proj.damage * falloff));
          ui.flashDamage();
          shakeIntensity = Math.max(shakeIntensity, 0.6 * falloff);
          // Splash visual
          _spawnSplashExplosion(scene, proj._splashPos.clone());
        } else if (sd < proj.splashRadius + 1) {
          _spawnSplashExplosion(scene, proj._splashPos.clone());
        }
        proj._splashPos = null;
      }
      projectiles.splice(pi, 1);
      continue;
    }

    if (hitsObstacle(proj.mesh.position)) {
      proj.destroy();
      projectiles.splice(pi, 1);
      continue;
    }

    if (proj.isPlayer) {
      for (const e of enemies) {
        if (!e.alive) continue;
        if (
          proj.mesh.position.distanceTo(e.position) <
          proj.radius + e.radius
        ) {
          // Directional armour: front 0.65×, flank 1.2×, rear 1.5×
          const projDir = proj.vel.clone().normalize();
          const eFwd = new THREE.Vector3(
            Math.sin(e.group.rotation.y),
            0,
            Math.cos(e.group.rotation.y),
          );
          const dot = projDir.dot(eFwd);
          const dirMult = dot > 0.5 ? 1.5 : dot < -0.5 ? 0.65 : 1.2;
          e.takeDamage(Math.round(proj.damage * dirMult));
          if (dot > 0.5) ui.showHitFeedback("REAR HIT  ×1.5", "#ff8800");
          else if (dot < -0.5)
            ui.showHitFeedback("FRONT ARMOR  ×0.65", "#44aaff");
          else ui.showHitFeedback("FLANK HIT  ×1.2", "#ffcc44");
          if (proj.isMG) audio.playHit();
          else audio.playCannonImpact();
          if (!e.alive) {
            audio.playExplosion();
            const baseScore = e.isBoss ? 2000 : 100;
            score += Math.round(baseScore * player.scoreMult);
            showScorePopup(
              Math.round(baseScore * player.scoreMult),
              e.position.clone(),
            );
            player.hp = Math.min(player.maxHp, player.hp + player.hpPerKill);
            if (e.isBoss) {
              shakeIntensity = 1.8;
              audio.nextTrack();
              // Gold kill flash — vibe already shifted at wave start
              const _flashEl = document.getElementById("damage-flash");
              if (_flashEl) {
                _flashEl.style.background = "rgba(255,200,0,0.30)";
                setTimeout(() => {
                  _flashEl.style.background = "";
                }, 650);
              }
              const drops = spawnPickupsAt(
                scene,
                ["health", "damage", "speed", "armor"],
                e.position.x,
                e.position.z,
              );
              pickups.push(...drops);
            }
          }
          player.recordHit();
          ui.flashHit();
          proj.destroy();
          projectiles.splice(pi, 1);
          break;
        }
      }
    } else {
      if (!player.alive) continue;
      if (
        proj.mesh.position.distanceTo(player.position) <
        proj.radius + player.radius
      ) {
        if (player._invincTimer <= 0) {
          player.takeDamage(proj.damage);
          ui.flashDamage();
          shakeIntensity = 0.3;
          if (proj.isMG) audio.playHit();
          else audio.playCannonImpact();
        }
        proj.destroy();
        projectiles.splice(pi, 1);
      }
    }
  }
}

function _spawnSplashExplosion(scene, pos) {
  const rGeo = new THREE.RingGeometry(0.1, 0.6, 16);
  rGeo.rotateX(-Math.PI / 2);
  const rMat = new THREE.MeshBasicMaterial({
    color: 0xff6600,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(rGeo, rMat);
  ring.position.copy(pos);
  scene.add(ring);

  const glow = new THREE.PointLight(0xff4400, 20, 12);
  glow.position.copy(pos);
  glow.position.y += 0.5;
  scene.add(glow);

  let t = 0;
  const iv = setInterval(() => {
    t += 18;
    const pct = Math.min(t / 550, 1);
    ring.scale.setScalar(1 + pct * 10);
    rMat.opacity = 0.9 * (1 - pct);
    glow.intensity = 20 * Math.max(0, 1 - pct * 1.6);
    if (pct >= 1) {
      clearInterval(iv);
      scene.remove(ring);
      scene.remove(glow);
      rGeo.dispose();
      rMat.dispose();
    }
  }, 18);
}

// ── Intro camera fly-in ───────────────────────────────────────────────────────
function _easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function _startIntroShot() {
  const px = player.position.x,
    py = player.position.y,
    pz = player.position.z;
  _introCam = {
    progress: 0,
    dur: 3.8,
    fromPos: camera.position.clone(), // capture current idle orbit position — no jarring cut
    // Land directly above the tank — avoids clipping through turret geometry
    // When the intro ends the camera snaps down ~1.8 units into FPV, barely noticeable
    toPos: new THREE.Vector3(px, py + 3.0, pz),
    fromLook: new THREE.Vector3(0, 0, 0), // idle orbit always looks at origin
    toLook: new THREE.Vector3(
      px + Math.sin(camYaw) * 20,
      py + 1.2,
      pz + Math.cos(camYaw) * 20,
    ),
  };
}

// ── Camera ─────────────────────────────────────────────────────────────────────
const _camPos = new THREE.Vector3();
const _camLook = new THREE.Vector3();

let _idleOrbitAngle = 0;

// ── Game-over cinematic state ──────────────────────────────────────────────────
let _gameOverOrbit = null; // { angle, cx, cz, radius, height }
let _smokeParticles = null;
let _smokeData = null;
const _SMOKE_N = 90;

function _startGameOverCinematic(playerPos) {
  _gameOverOrbit = {
    angle: camYaw + Math.PI,
    cx: playerPos.x,
    cz: playerPos.z,
    radius: 14,
    height: 6,
  };

  const N = _SMOKE_N;
  const positions = new Float32Array(N * 3);
  const colors = new Float32Array(N * 3);
  const ages = new Float32Array(N);
  const lifetimes = new Float32Array(N);
  const vx = new Float32Array(N),
    vy = new Float32Array(N),
    vz = new Float32Array(N);
  const ox = new Float32Array(N),
    oy = new Float32Array(N),
    oz = new Float32Array(N);
  const baseY = terrainH(playerPos.x, playerPos.z);

  for (let i = 0; i < N; i++) {
    const lt = 3 + Math.random() * 4;
    lifetimes[i] = lt;
    ages[i] = Math.random() * lt; // stagger so particles don't all appear at once
    const ang = Math.random() * Math.PI * 2;
    const r = Math.random() * 1.8;
    ox[i] = playerPos.x + Math.cos(ang) * r;
    oy[i] = baseY + 0.5 + Math.random() * 1.0;
    oz[i] = playerPos.z + Math.sin(ang) * r;
    vx[i] = (Math.random() - 0.5) * 0.9;
    vy[i] = 0.7 + Math.random() * 1.6;
    vz[i] = (Math.random() - 0.5) * 0.9;
    const t = ages[i] / lt;
    positions[i * 3 + 0] = ox[i] + vx[i] * ages[i];
    positions[i * 3 + 1] = oy[i] + vy[i] * ages[i];
    positions[i * 3 + 2] = oz[i] + vz[i] * ages[i];
    const b = 0.65 * Math.pow(1 - t, 1.5);
    colors[i * 3] = b;
    colors[i * 3 + 1] = b;
    colors[i * 3 + 2] = b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.1,
    map: _getSmokeTex(),
    alphaTest: 0.01,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  _smokeParticles = new THREE.Points(geo, mat);
  scene.add(_smokeParticles);
  _smokeData = { ages, lifetimes, vx, vy, vz, ox, oy, oz, positions, colors };
}

function _updateSmoke(delta) {
  if (!_smokeParticles || !_smokeData || !_gameOverOrbit) return;
  const { ages, lifetimes, vx, vy, vz, ox, oy, oz, positions, colors } =
    _smokeData;
  const N = _SMOKE_N;
  const baseY = terrainH(_gameOverOrbit.cx, _gameOverOrbit.cz);
  for (let i = 0; i < N; i++) {
    ages[i] += delta;
    if (ages[i] >= lifetimes[i]) {
      ages[i] = 0;
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.8;
      ox[i] = _gameOverOrbit.cx + Math.cos(ang) * r;
      oy[i] = baseY + 0.5 + Math.random() * 1.0;
      oz[i] = _gameOverOrbit.cz + Math.sin(ang) * r;
      vx[i] = (Math.random() - 0.5) * 0.9;
      vy[i] = 0.7 + Math.random() * 1.6;
      vz[i] = (Math.random() - 0.5) * 0.9;
      lifetimes[i] = 3 + Math.random() * 4;
    }
    const t = ages[i] / lifetimes[i];
    positions[i * 3 + 0] = ox[i] + vx[i] * ages[i];
    positions[i * 3 + 1] = oy[i] + vy[i] * ages[i];
    positions[i * 3 + 2] = oz[i] + vz[i] * ages[i];
    const b = 0.65 * Math.pow(1 - t, 1.5);
    colors[i * 3] = b;
    colors[i * 3 + 1] = b;
    colors[i * 3 + 2] = b;
  }
  _smokeParticles.geometry.attributes.position.needsUpdate = true;
  _smokeParticles.geometry.attributes.color.needsUpdate = true;
}

function updateCamera(delta) {
  // Idle: slow orbit over terrain for main menu background
  if (state === STATE.IDLE) {
    _idleOrbitAngle += delta * 0.08;
    const r = 28;
    camera.position.set(
      Math.sin(_idleOrbitAngle) * r,
      14,
      Math.cos(_idleOrbitAngle) * r,
    );
    camera.lookAt(0, 0, 0);
    return;
  }

  // Game-over cinematic: slow orbit around the destroyed tank
  if (state === STATE.GAME_OVER && _gameOverOrbit) {
    _gameOverOrbit.angle += delta * 0.22;
    camera.position.set(
      _gameOverOrbit.cx +
        Math.sin(_gameOverOrbit.angle) * _gameOverOrbit.radius,
      _gameOverOrbit.height,
      _gameOverOrbit.cz +
        Math.cos(_gameOverOrbit.angle) * _gameOverOrbit.radius,
    );
    camera.lookAt(_gameOverOrbit.cx, 1.5, _gameOverOrbit.cz);
    return;
  }

  if (!player) return;

  // Intro fly-in — overrides all other camera logic
  if (_introCam) {
    _introCam.progress = Math.min(
      1,
      _introCam.progress + delta / _introCam.dur,
    );
    const t = _easeInOutCubic(_introCam.progress);
    camera.position.lerpVectors(_introCam.fromPos, _introCam.toPos, t);
    camera.lookAt(
      _introCam.fromLook.x + (_introCam.toLook.x - _introCam.fromLook.x) * t,
      _introCam.fromLook.y + (_introCam.toLook.y - _introCam.fromLook.y) * t,
      _introCam.fromLook.z + (_introCam.toLook.z - _introCam.fromLook.z) * t,
    );
    camMouseDelta = 0;
    if (_introCam.progress >= 1) {
      _introCam = null;
      viewMode = 1; // start in mid view after intro
    }
    return;
  }

  // Apply mouse delta, then clear it
  camYaw += camMouseDelta;
  camMouseDelta = 0;

  if (viewMode === 0) {
    // FPV: camera sits above player center, looks along camYaw+pitch
    const pitch = player.barrelPitch;
    camera.position.set(
      player.position.x,
      player.position.y + 1.2,
      player.position.z,
    );
    camera.lookAt(
      player.position.x + Math.sin(camYaw) * Math.cos(pitch) * 20,
      player.position.y + 1.2 + Math.sin(pitch) * 20,
      player.position.z + Math.cos(camYaw) * Math.cos(pitch) * 20,
    );
    if (shakeIntensity > 0) {
      if (_shakeEnabled) {
        camera.position.x += (Math.random() - 0.5) * shakeIntensity;
        camera.position.y += (Math.random() - 0.5) * shakeIntensity;
      }
      shakeIntensity = Math.max(0, shakeIntensity - delta * 4);
    }
    return;
  }

  if (viewMode === 1) {
    // Mid view: close over-the-shoulder — shows tank orientation clearly
    _camPos.set(
      player.position.x - Math.sin(camYaw) * CAM_DIST_MID,
      player.position.y + CAM_H_MID,
      player.position.z - Math.cos(camYaw) * CAM_DIST_MID,
    );
    camera.position.lerp(_camPos, Math.min(1, delta * 5));
    _camLook.set(
      player.position.x + Math.sin(camYaw) * 5,
      0.5,
      player.position.z + Math.cos(camYaw) * 5,
    );
    camera.lookAt(_camLook);
    if (shakeIntensity > 0) {
      if (_shakeEnabled) {
        camera.position.x += (Math.random() - 0.5) * shakeIntensity;
        camera.position.y += (Math.random() - 0.5) * shakeIntensity;
      }
      shakeIntensity = Math.max(0, shakeIntensity - delta * 4);
    }
    return;
  }

  _camPos.set(
    player.position.x - Math.sin(camYaw) * CAM_DIST,
    player.position.y + CAM_H,
    player.position.z - Math.cos(camYaw) * CAM_DIST,
  );
  camera.position.lerp(_camPos, Math.min(1, delta * 4.5));

  // Look toward the camera's facing direction (camYaw) for correct screen-center aim
  _camLook.set(
    player.position.x + Math.sin(camYaw) * 5,
    0.5,
    player.position.z + Math.cos(camYaw) * 5,
  );
  camera.lookAt(_camLook);

  if (shakeIntensity > 0) {
    if (_shakeEnabled) {
      camera.position.x += (Math.random() - 0.5) * shakeIntensity;
      camera.position.y += (Math.random() - 0.5) * shakeIntensity;
    }
    shakeIntensity = Math.max(0, shakeIntensity - delta * 4);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────
function loop(ts) {
  requestAnimationFrame(loop);
  const delta = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;

  tickReveal(delta);
  pickups.forEach((pk) => pk.update(delta));

  // Update camera first so aimTarget is derived from this frame's camera position
  updateCamera(delta);

  // Raycast from screen center to get world aim target (frozen during free-look)
  if (player && !freeLook) {
    if (viewMode === 0) {
      // In FPV, aim target is directly ahead along camYaw on the ground plane
      aimTarget.set(
        player.position.x + Math.sin(camYaw) * 30,
        0,
        player.position.z + Math.cos(camYaw) * 30,
      );
    } else {
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      raycaster.ray.intersectPlane(groundPlane, aimTarget);
    }
  }

  // Wave standby — blinking indicator during transitions
  waveStandbyEl?.classList.toggle("hidden", state !== STATE.WAVE_TRANSITION);

  if (state === STATE.PLAYING && !paused) {
    const _locked = !!_introCam; // block input during intro fly-in
    player.update(
      delta,
      _locked ? {} : keys,
      aimTarget,
      _locked ? false : mouseDown,
      _locked ? false : rightMouseDown,
      gameBounds,
      _locked ? false : freeLook,
      _locked ? 0 : pitchDelta,
    );
    pitchDelta = 0;

    // Reserve hull activation — fires once immediately when a life is consumed
    if (player._justRespawned) {
      player._justRespawned = false;
      shakeIntensity = 1.2;
      audio.playRespawn();
      ui.showWaveMessage("RESERVE HULL ACTIVATED", 1100);
    }
    player.group.position.y = terrainH(
      player.group.position.x,
      player.group.position.z,
    );

    // Tilt player tank to follow terrain slope (YXZ Euler: rotation.x/z are local pitch/roll)
    {
      const { dHdx, dHdz } = terrainSlope(
        player.group.position.x,
        player.group.position.z,
      );
      const ry = player.group.rotation.y;
      const fwdSlope = dHdx * Math.sin(ry) + dHdz * Math.cos(ry);
      const rightSlope = dHdx * Math.cos(ry) - dHdz * Math.sin(ry);
      const tPitch = Math.max(-0.28, Math.min(0.28, -fwdSlope));
      const tRoll = Math.max(-0.28, Math.min(0.28, rightSlope)); // positive = right side up
      player.group.rotation.x +=
        (tPitch - player.group.rotation.x) * Math.min(1, delta * 5);
      player.group.rotation.z +=
        (tRoll - player.group.rotation.z) * Math.min(1, delta * 5);
    }

    distanceTraveled += player.position.distanceTo(_lastPlayerPos);
    _lastPlayerPos.copy(player.position);

    resolveObstacles(player.position, player.radius);

    // Skip enemy simulation during intro fly-in — unfair to take damage before having control
    if (!_introCam) waveManager.update(delta, player.position, gameBounds);
    for (const e of waveManager.enemies) {
      if (e.alive) {
        resolveObstacles(e.group.position, e.radius);
        e.group.position.y =
          terrainH(e.group.position.x, e.group.position.z) + e.hoverOffset;
        if (!e.isHover) {
          const { dHdx, dHdz } = terrainSlope(
            e.group.position.x,
            e.group.position.z,
          );
          const ry = e.group.rotation.y;
          const fwdSlope = dHdx * Math.sin(ry) + dHdz * Math.cos(ry);
          const rightSlope = dHdx * Math.cos(ry) - dHdz * Math.sin(ry);
          const tPitch = Math.max(-0.28, Math.min(0.28, -fwdSlope));
          const tRoll = Math.max(-0.28, Math.min(0.28, rightSlope)); // positive = right side up
          e.group.rotation.x +=
            (tPitch - e.group.rotation.x) * Math.min(1, delta * 4);
          e.group.rotation.z +=
            (tRoll - e.group.rotation.z) * Math.min(1, delta * 4);
        }
      }
    }

    for (const p of projectiles) p.update(delta);

    // Cap total enemy projectiles to prevent late-wave lag
    if (projectiles.filter((p) => !p.isPlayer).length > 75) {
      for (let i = 0; i < projectiles.length; i++) {
        if (!projectiles[i].isPlayer) {
          projectiles[i].destroy(false);
          projectiles.splice(i--, 1);
          break;
        }
      }
    }

    checkCollisions();
    checkPickupCollisions();

    ui.updateHUD(player.hp, player.maxHp, score, waveNum, player.lives);
    ui.updateAmmo(player.mgAmmo, player.mgMaxAmmo, player.mgReloading);

    // Mid-wave NN adaptation — periodically re-evaluate and potentially switch tactics
    _nnAdaptTimer += delta;
    if (_nnAdaptTimer >= NN_ADAPT_INTERVAL) {
      _nnAdaptTimer = 0;
      const newTactic = waveManager.adaptMidWave(
        player.hp,
        player.maxHp,
        player.shotsHit,
        player.shotsFired,
      );
      if (newTactic) ui.updateProtocol(newTactic, nn.probs);
    }

    if (waveManager.isWaveComplete()) {
      if (trainingMode) _restartTrainingWave();
      else startNextWave();
    }

    if (!player.alive) {
      if (trainingMode) {
        // In training: respawn instead of game over
        player.hp = player.maxHp;
        player.alive = true;
        player._invincTimer = 3.0;
      } else {
        state = STATE.GAME_OVER;
        safeExitPointerLock();
        saveScore(score, waveNum - 1, chosenHull);
        document.getElementById("controls-hint")?.classList.add("hidden");
        _startGameOverCinematic(player.position.clone());
        setTimeout(() => {
          ui.showGameOver(
            score,
            waveNum - 1,
            nn.summary(waveNum - 1),
            showMainMenu,
          );
        }, 1400);
      }
    }
  }

  if (state === STATE.GAME_OVER) _updateSmoke(delta);

  updateCrosshair();
  updateHeadingArrow();
  updateBuffDisplay();
  if (player && state === STATE.PLAYING)
    ui.updateComponentPanel(player._compDmg);

  // Boss HP bar — show during boss fights, hide otherwise
  const _activeBoss =
    state === STATE.PLAYING && waveManager
      ? (waveManager.enemies.find((e) => e.isBoss && e.alive) ?? null)
      : null;
  ui.updateBossBar(_activeBoss);

  // Low-HP vignette — heartbeat pulse at <25%, frantic at <12%
  {
    const _hpRatio =
      state === STATE.PLAYING && player ? player.hp / player.maxHp : 1;
    lowHpVignetteEl?.classList.toggle("active", _hpRatio < 0.25);
    lowHpVignetteEl?.classList.toggle("lhp-critical", _hpRatio < 0.12);
  }

  renderer.render(scene, camera);
}

// ── Pointer lock ──────────────────────────────────────────────────────────────
function lockPointer() {
  if (!isMobile) canvas.requestPointerLock();
}

document.addEventListener("pointerlockchange", () => {
  // If lock is lost unexpectedly during play (e.g. user pressed Esc), re-show cursor
  if (!document.pointerLockElement && state === STATE.PLAYING) {
    // Let the player re-click to re-lock
    canvas.addEventListener("click", lockPointer, { once: true });
  }
});

// ── Mobile touch controls ─────────────────────────────────────────────────────
// ── Desktop HUD toggle ────────────────────────────────────────────────────────
const _hudEl = document.getElementById("hud");
if (!isMobile) {
  // Hide sidebar HUD by default — press H to toggle
  _hudEl.classList.add("hud-hidden");
  document.getElementById("hud-key-hint")?.classList.remove("hidden");
} else {
  // On mobile: hide HUD sidebar by default (heading overlay repositioned via CSS)
  _hudEl.classList.add("hud-hidden");
}

if (isMobile) {
  document.getElementById("mobile-controls").classList.remove("hidden");

  // ── FPV toggle ────────────────────────────────────────────────────────────
  const btnFpvMob = document.getElementById("btn-fpv-mob");
  btnFpvMob.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      viewMode = (viewMode + 1) % 3;
      btnFpvMob.classList.toggle("mob-btn-active", viewMode === 0);
    },
    { passive: false },
  );

  // ── HUD toggle ────────────────────────────────────────────────────────────
  let _hudMobVis = false;
  const btnHudMob = document.getElementById("btn-hud-mob");
  btnHudMob.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      _hudMobVis = !_hudMobVis;
      _hudEl.classList.toggle("hud-hidden", !_hudMobVis);
      btnHudMob.classList.toggle("mob-btn-active", _hudMobVis);
    },
    { passive: false },
  );

  // ── Joystick ──────────────────────────────────────────────────────────────
  let _joyId = -1,
    _joyOx = 0,
    _joyOy = 0;
  const joyZone = document.getElementById("joy-zone");
  const joyThumb = document.getElementById("joy-thumb");
  const MAX_JOY = 46;

  function _applyJoy(nx, ny) {
    const d = 0.25; // deadzone
    keys.KeyW = ny < -d;
    keys.KeyS = ny > d;
    keys.KeyA = nx < -d;
    keys.KeyD = nx > d;
  }

  joyZone.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      _joyId = t.identifier;
      const r = joyZone.getBoundingClientRect();
      _joyOx = r.left + r.width / 2;
      _joyOy = r.top + r.height / 2;
    },
    { passive: false },
  );

  joyZone.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== _joyId) continue;
        const dx = t.clientX - _joyOx;
        const dy = t.clientY - _joyOy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const cl = Math.min(dist, MAX_JOY);
        const nx = dx / dist,
          ny = dy / dist;
        joyThumb.style.transform = `translate(calc(-50% + ${nx * cl}px), calc(-50% + ${ny * cl}px))`;
        _applyJoy(nx * (cl / MAX_JOY), ny * (cl / MAX_JOY));
      }
    },
    { passive: false },
  );

  ["touchend", "touchcancel"].forEach((ev) => {
    joyZone.addEventListener(
      ev,
      (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier !== _joyId) continue;
          _joyId = -1;
          joyThumb.style.transform = "translate(-50%, -50%)";
          _applyJoy(0, 0);
        }
      },
      { passive: true },
    );
  });

  // ── Right-side unified touch zone: first touch = cam pan, extra touches = fire ─
  // Left portion of right zone (< 75% of screen width) = cannon, right = MG.
  const _rTouches = new Map(); // identifier → 'cam' | 'cannon' | 'mg'
  let _rCamLx = 0,
    _rCamLy = 0;
  const rightZone = document.getElementById("right-touch-zone");

  rightZone.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const hasCam = [..._rTouches.values()].includes("cam");
        if (!hasCam) {
          _rTouches.set(t.identifier, "cam");
          _rCamLx = t.clientX;
          _rCamLy = t.clientY;
        } else {
          const role = t.clientX < window.innerWidth * 0.75 ? "cannon" : "mg";
          _rTouches.set(t.identifier, role);
          if (role === "cannon") mouseDown = true;
          else rightMouseDown = true;
        }
      }
    },
    { passive: false },
  );

  rightZone.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (_rTouches.get(t.identifier) !== "cam") continue;
        camMouseDelta -= (t.clientX - _rCamLx) * 0.005;
        if (!freeLook) pitchDelta -= (t.clientY - _rCamLy) * 0.002;
        _rCamLx = t.clientX;
        _rCamLy = t.clientY;
      }
    },
    { passive: false },
  );

  ["touchend", "touchcancel"].forEach((ev) => {
    rightZone.addEventListener(
      ev,
      (e) => {
        for (const t of e.changedTouches) {
          const role = _rTouches.get(t.identifier);
          if (role === "cannon") mouseDown = false;
          else if (role === "mg") rightMouseDown = false;
          _rTouches.delete(t.identifier);
        }
      },
      { passive: true },
    );
  });

  // ── Left-side fire buttons (above joystick — left-thumb firing) ───────────
  const btnCannonL = document.getElementById("btn-fire-cannon-l");
  const btnMgL = document.getElementById("btn-fire-mg-l");
  if (btnCannonL) {
    btnCannonL.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        mouseDown = true;
      },
      { passive: false },
    );
    ["touchend", "touchcancel"].forEach((ev) =>
      btnCannonL.addEventListener(
        ev,
        () => {
          mouseDown = false;
        },
        { passive: true },
      ),
    );
  }
  if (btnMgL) {
    btnMgL.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        rightMouseDown = true;
      },
      { passive: false },
    );
    ["touchend", "touchcancel"].forEach((ev) =>
      btnMgL.addEventListener(
        ev,
        () => {
          rightMouseDown = false;
        },
        { passive: true },
      ),
    );
  }

  const btnReloadMob = document.getElementById("btn-reload-mob");
  if (btnReloadMob) {
    btnReloadMob.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        if (player) player.triggerReload();
      },
      { passive: false },
    );
  }

  const btnPauseMob = document.getElementById("btn-pause-mob");
  if (btnPauseMob) {
    btnPauseMob.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        if (state !== STATE.PLAYING) return;
        paused = !paused;
        if (paused) {
          _renderUpgradeLog();
          safeExitPointerLock();
          const pv = document.getElementById("pause-vol-master");
          if (pv) pv.value = String(audio.masterVol);
          _syncMuteBtns();
          ui.showPause(player, () => {
            paused = false;
          });
        } else {
          ui.hidePause();
        }
        btnPauseMob.classList.toggle("mob-btn-active", paused);
      },
      { passive: false },
    );
  }
}

// ── Audio controls (start screen + pause screen) ──────────────────────────────
function _syncMuteBtns() {
  document.querySelectorAll(".inline-mute").forEach((b) => {
    b.textContent = audio.muted ? "🔇" : "♪";
  });
}
function _wireAudio(muteId, volId) {
  const btn = document.getElementById(muteId);
  const vol = document.getElementById(volId);
  if (!btn) return;
  btn.textContent = audio.muted ? "🔇" : "♪";
  if (vol) vol.value = String(audio.masterVol);
  btn.addEventListener("click", () => {
    audio.toggleMute();
    _syncMuteBtns();
  });
  vol?.addEventListener("input", (e) =>
    audio.setMasterVol(parseFloat(e.target.value)),
  );
}
_wireAudio("start-btn-mute", "start-vol-master");
_wireAudio("pause-btn-mute", "pause-vol-master");

// Wire music + sfx volume sliders for both start and pause screens
["start", "pause"].forEach((screen) => {
  const mv = document.getElementById(`${screen}-vol-music`);
  const sv = document.getElementById(`${screen}-vol-sfx`);
  if (mv) {
    mv.value = String(audio.musicVol);
    mv.addEventListener("input", (e) =>
      audio.setMusicVol(parseFloat(e.target.value)),
    );
  }
  if (sv) {
    sv.value = String(audio.sfxVol);
    sv.addEventListener("input", (e) =>
      audio.setSfxVol(parseFloat(e.target.value)),
    );
  }
});

// ── Hull selection ────────────────────────────────────────────────────────────
document.querySelectorAll(".hull-choice").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".hull-choice")
      .forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    chosenHull = btn.dataset.hull;
  });
});

document.getElementById("btn-hull-confirm")?.addEventListener("click", () => {
  document.getElementById("hull-select-screen").classList.add("hidden");
  document.getElementById("start-screen").classList.remove("hidden");
});

// ── Main menu button wiring ───────────────────────────────────────────────────
document.getElementById("btn-menu-engage")?.addEventListener("click", () => {
  document.getElementById("main-menu-screen").classList.add("hidden");
  document.getElementById("hull-select-screen").classList.remove("hidden");
});

document.getElementById("btn-menu-training")?.addEventListener("click", () => {
  trainingMode = true;
  chosenHull = "vanguard";
  document.getElementById("main-menu-screen").classList.add("hidden");
  document.getElementById("training-banner")?.classList.remove("hidden");
  audio.start();
  lockPointer();
  init();
  startNextWave();
});

document.getElementById("btn-menu-howto")?.addEventListener("click", () => {
  showMenuPanel("howto");
});
document
  .getElementById("btn-menu-howto-back")
  ?.addEventListener("click", () => {
    showMenuPanel("main");
  });

document.getElementById("btn-menu-settings")?.addEventListener("click", () => {
  // Sync current audio state to sliders before showing
  const mmv = document.getElementById("menu-vol-master");
  const mmm = document.getElementById("menu-vol-music");
  const mms = document.getElementById("menu-vol-sfx");
  if (mmv) mmv.value = String(audio.masterVol);
  if (mmm) mmm.value = String(audio.musicVol);
  if (mms) mms.value = String(audio.sfxVol);
  _syncMuteBtns();
  showMenuPanel("settings");
});

document
  .getElementById("btn-menu-leaderboard")
  ?.addEventListener("click", () => {
    renderLeaderboard();
    showMenuPanel("leaderboard");
  });

document
  .getElementById("btn-menu-settings-back")
  ?.addEventListener("click", () => {
    showMenuPanel("main");
  });

document
  .getElementById("btn-menu-leaderboard-back")
  ?.addEventListener("click", () => {
    showMenuPanel("main");
  });

// Wire audio controls in the main menu settings panel
_wireAudio("menu-btn-mute", "menu-vol-master");
["menu"].forEach((screen) => {
  const mv = document.getElementById(`${screen}-vol-music`);
  const sv = document.getElementById(`${screen}-vol-sfx`);
  if (mv) {
    mv.value = String(audio.musicVol);
    mv.addEventListener("input", (e) =>
      audio.setMusicVol(parseFloat(e.target.value)),
    );
  }
  if (sv) {
    sv.value = String(audio.sfxVol);
    sv.addEventListener("input", (e) =>
      audio.setSfxVol(parseFloat(e.target.value)),
    );
  }
});

document.getElementById("btn-skip-track")?.addEventListener("click", () => {
  audio.skipTrack();
});

// Pause → main menu
document.getElementById("btn-pause-menu")?.addEventListener("click", () => {
  ui.hidePause();
  showMainMenu();
});

// Controls hint close — event delegation so it survives mobile innerHTML replacement
document.getElementById("controls-hint")?.addEventListener("click", (e) => {
  if (e.target.closest(".hint-close")) {
    document.getElementById("controls-hint")?.classList.add("hidden");
    localStorage.setItem("vec_hint_shown", "1");
  }
});

// ── Settings button wiring ────────────────────────────────────────────────────
// Graphics quality presets
["low", "med", "high"].forEach((q) =>
  document
    .getElementById(`btn-gfx-${q}`)
    ?.addEventListener("click", () => applyGraphicsQuality(q)),
);

// Screen shake toggle
{
  const shakeBtn = document.getElementById("btn-settings-shake");
  if (shakeBtn) {
    const _syncShake = () => {
      shakeBtn.textContent = _shakeEnabled ? "ON" : "OFF";
      shakeBtn.classList.toggle("active", _shakeEnabled);
    };
    _syncShake();
    shakeBtn.addEventListener("click", () => {
      _shakeEnabled = !_shakeEnabled;
      localStorage.setItem("vec_shake", _shakeEnabled ? "1" : "0");
      _syncShake();
    });
  }
}

// Fullscreen toggle
document
  .getElementById("btn-settings-fullscreen")
  ?.addEventListener("click", () => {
    if (!document.fullscreenElement)
      document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  });

// Mobile UI mode toggle — reloads to apply
{
  const mobBtn = document.getElementById("btn-settings-mobile");
  if (mobBtn) {
    mobBtn.textContent = isMobile ? "MOBILE" : "DESKTOP";
    mobBtn.classList.toggle("active", forceMobile);
    mobBtn.title = forceMobile
      ? "Click to use desktop UI"
      : "Click to force mobile UI";
    mobBtn.addEventListener("click", () => {
      localStorage.setItem("vec_force_mobile", String(!forceMobile));
      location.reload();
    });
  }

  const resetAiBtn = document.getElementById("btn-settings-reset-ai");
  if (resetAiBtn) {
    resetAiBtn.addEventListener("click", () => {
      nn.resetWeights();
      resetAiBtn.textContent = "DONE";
      setTimeout(() => {
        resetAiBtn.textContent = "RESET";
      }, 1500);
    });
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.getElementById("btn-start").addEventListener(
  "touchstart",
  () => {
    audio.start(); // iOS: prime AudioContext on touchstart before click fires
  },
  { passive: true },
);

document.getElementById("btn-start").addEventListener("click", () => {
  audio.start(); // must be called from a user gesture
  ui.hideStartScreen();
  lockPointer();
  init();
  startNextWave();
});

requestAnimationFrame(loop);
