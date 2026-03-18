import * as THREE from 'three';
import { createScene, resolveObstacles, hitsObstacle, updateBoundary,
         activateZone, INITIAL_HALF, ZONE_SIZE, terrainH } from './scene.js';
import { GRAVITY } from './projectile.js';
import { Player }         from './player.js';
import { WaveManager }    from './wave.js';
import { TacticSelector } from './nn.js';
import { UI }             from './ui.js';
import { Shop }           from './shop.js';
import { UpgradePicker }  from './upgrade.js';
import { spawnPickups, spawnPickupsAt } from './pickup.js';

// ── State ─────────────────────────────────────────────────────────────────────
const STATE = { IDLE: 0, PLAYING: 1, WAVE_TRANSITION: 2, GAME_OVER: 3 };
let state = STATE.IDLE;

// ── Scene ─────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const { scene, camera, renderer, boundaryGeo, fog } = createScene(canvas);
const ui      = new UI();
const nn      = new TacticSelector();
const shop    = new Shop();
const upgrades = new UpgradePicker();

// ── Game objects ──────────────────────────────────────────────────────────────
let projectiles = [], pickups = [], player, waveManager;
let score = 0, waveNum = 0, lastTime = 0;
let shakeIntensity = 0;
const scoreRef = { value: 0 };

// ── Dynamic arena bounds ──────────────────────────────────────────────────────
const EXPANSION_ORDER = ['east', 'south', 'west', 'north'];
let expansionStep = 0;
let gameBounds = {
  minX: -INITIAL_HALF, maxX: INITIAL_HALF,
  minZ: -INITIAL_HALF, maxZ: INITIAL_HALF,
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
  revealAnim.progress = Math.min(1, revealAnim.progress + delta / revealAnim.dur);
  const t    = revealAnim.progress;
  const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  updateBoundary(boundaryGeo, lerpBounds(revealAnim.from, revealAnim.to, ease));
  revealAnim.meshes.forEach(m => {
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
  if (direction === 'east')  to.maxX += ZONE_SIZE;
  if (direction === 'south') to.maxZ += ZONE_SIZE;
  if (direction === 'west')  to.minX -= ZONE_SIZE;
  if (direction === 'north') to.minZ -= ZONE_SIZE;
  const meshes = activateZone(direction, scene);
  meshes.forEach(m => {
    if (m.isMesh && m.material) { m.material.color.setHex(0xaaffff); m.material.emissiveIntensity = 1.0; }
  });
  // Lift fog as arena grows
  fog.density = Math.max(0.008, fog.density - 0.007);
  revealAnim = { progress: 0, dur: 2.2, from: { ...gameBounds }, to, meshes };
}

// ── Player mobility ───────────────────────────────────────────────────────────
let distanceTraveled = 0;
const _lastPlayerPos = new THREE.Vector3();

// ── Camera orbit (mouse-controlled) ──────────────────────────────────────────
let camYaw       = 0;      // world angle camera orbits at
let camMouseDelta = 0;     // accumulated from mousemove this frame
const CAM_SENSITIVITY   = 0.0025;
const PITCH_SENSITIVITY = 0.0012;
const CAM_DIST  = 12;
const CAM_H     = 5.5;

// ── Input ─────────────────────────────────────────────────────────────────────
const keys = {};
let mouseDown      = false;
let rightMouseDown = false;
let freeLook       = false;
let fpvMode        = false;
let paused         = false;
let pitchDelta     = 0;

const aimTarget   = new THREE.Vector3();
const raycaster   = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyC') freeLook = true;
  if (e.code === 'KeyV') { fpvMode = !fpvMode; ui.setFpv(fpvMode); }
  if (e.code === 'KeyP' && state === STATE.PLAYING) {
    paused = !paused;
    if (paused) { document.exitPointerLock(); ui.showPause(player, () => { paused = false; lockPointer(); }); }
    else        { ui.hidePause(); lockPointer(); }
  }
});
window.addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'KeyC') freeLook = false;
});

window.addEventListener('mousemove', e => {
  if (state === STATE.PLAYING) {
    camMouseDelta += e.movementX * CAM_SENSITIVITY;
    if (!freeLook) pitchDelta -= e.movementY * PITCH_SENSITIVITY; // up = negative movementY
  }
});

window.addEventListener('mousedown', e => {
  if (e.button === 0) mouseDown = true;
  if (e.button === 2) rightMouseDown = true;
});
window.addEventListener('mouseup', e => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) rightMouseDown = false;
});
window.addEventListener('contextmenu', e => e.preventDefault());

// ── Crosshair / Heading / Buffs ───────────────────────────────────────────────
const crosshairEl  = document.getElementById('crosshair');
const headingEl    = document.getElementById('heading-arrow');
const buffPanelEl  = document.getElementById('buff-panel');
const buffListEl   = document.getElementById('buff-list');

function updateHeadingArrow() {
  if (!player || state !== STATE.PLAYING) {
    headingEl.style.opacity = '0';
    return;
  }
  headingEl.style.opacity = '1';
  headingEl.style.transform = `rotate(${player.group.rotation.y - camYaw}rad)`;
}

const BUFF_NAMES = { speed: 'SPD', damage: 'DMG', armor: 'ARM' };
function updateBuffDisplay() {
  if (!player || state !== STATE.PLAYING) { buffPanelEl.style.display = 'none'; return; }
  const buffs = player.activeBuffs;
  const keys  = Object.keys(buffs);
  if (keys.length === 0) { buffPanelEl.style.display = 'none'; return; }
  buffPanelEl.style.display = '';
  buffListEl.innerHTML = keys.map(k =>
    `<div class="buff-row"><span class="buff-name">${BUFF_NAMES[k] ?? k.toUpperCase()}</span><span class="buff-timer">${Math.ceil(buffs[k].timer)}s</span></div>`
  ).join('');
}

const _landingPt = new THREE.Vector3();
function updateCrosshair() {
  if (!player || state !== STATE.PLAYING) {
    crosshairEl.style.opacity = '0';
    return;
  }

  // In FPV mode: crosshair stays at screen center
  if (fpvMode) {
    crosshairEl.style.left = '50%';
    crosshairEl.style.top  = '50%';
    const charge = player.aimCharge;
    const size   = Math.round(44 - charge * 32);
    const r      = Math.round(charge * 255);
    crosshairEl.style.width       = size + 'px';
    crosshairEl.style.height      = size + 'px';
    crosshairEl.style.borderColor = `rgb(${r},255,255)`;
    crosshairEl.style.opacity     = String(0.55 + charge * 0.45);
    return;
  }

  // Compute ballistic landing spot of a shell fired right now
  const barrelAngle = player.barrelWorldAngle;
  const pitch       = player.barrelPitch;
  const speed       = player.bulletSpeed;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const vx = Math.sin(barrelAngle) * cp * speed;
  const vy = sp * speed;
  const vz = Math.cos(barrelAngle) * cp * speed;
  const oy = 0.75; // barrel spawn height

  // Solve 0 = oy + vy*t - 0.5*GRAVITY*t²  →  t = (vy + sqrt(vy²+2·g·oy)) / g
  const t = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * oy)) / GRAVITY;
  _landingPt.set(
    player.position.x + vx * t,
    0,
    player.position.z + vz * t
  );

  // Project landing spot to screen
  _landingPt.project(camera);
  const sx = ( _landingPt.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-_landingPt.y * 0.5 + 0.5) * window.innerHeight;
  crosshairEl.style.left = sx + 'px';
  crosshairEl.style.top  = sy + 'px';

  const charge = player.aimCharge;
  const size   = Math.round(44 - charge * 32);
  const r      = Math.round(charge * 255);
  crosshairEl.style.width       = size + 'px';
  crosshairEl.style.height      = size + 'px';
  crosshairEl.style.borderColor = `rgb(${r},255,255)`;
  crosshairEl.style.opacity     = String(0.55 + charge * 0.45);
}

// ── Pickups ───────────────────────────────────────────────────────────────────
function clearPickups() {
  pickups.forEach(pk => pk.collect());
  pickups = [];
}

function checkPickupCollisions() {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const pk = pickups[i];
    if (!pk.alive) { pickups.splice(i, 1); continue; }
    const dx = player.position.x - pk.position.x;
    const dz = player.position.z - pk.position.z;
    if (Math.sqrt(dx*dx + dz*dz) < pk.radius + player.radius) {
      pk.applyTo(player);
      pk.collect();
      pickups.splice(i, 1);
      ui.showWaveMessage(`+ ${pk.label}`, 700);
    }
  }
}

// ── Init / Restart ────────────────────────────────────────────────────────────
function init() {
  if (player)      scene.remove(player.group);
  if (waveManager) waveManager.clearEnemies();
  projectiles.forEach(p => p.destroy());
  clearPickups();

  projectiles      = [];
  score            = 0;
  scoreRef.value   = 0;
  waveNum          = 0;
  shakeIntensity   = 0;
  distanceTraveled = 0;
  expansionStep    = 0;
  camYaw           = 0;
  camMouseDelta    = 0;

  gameBounds = { minX: -INITIAL_HALF, maxX: INITIAL_HALF, minZ: -INITIAL_HALF, maxZ: INITIAL_HALF };
  updateBoundary(boundaryGeo, gameBounds);

  upgrades.resetRun();
  player      = new Player(scene, projectiles);
  waveManager = new WaveManager(scene, projectiles, nn);
  waveManager.initTactic();

  _lastPlayerPos.copy(player.position);
  ui.updateHUD(player.hp, player.maxHp, score, '—', player.lives);
  ui.updateProtocol('—', [0.25, 0.25, 0.25, 0.25]);
}

// ── Wave flow ─────────────────────────────────────────────────────────────────
async function startNextWave() {
  state = STATE.WAVE_TRANSITION;
  waveNum++;

  if (waveNum > 1) {
    const nextTactic = waveManager.chooseNextTactic(
      player.hp, player.maxHp, player.shotsFired, player.shotsHit, distanceTraveled
    );
    ui.updateProtocol(nextTactic, nn.probs);

    const prevWasBoss = (waveNum - 1) % 5 === 0;
    await ui.showWaveMessage(prevWasBoss ? 'BOSS ELIMINATED' : `WAVE ${waveNum - 1} CLEARED`, 900);

    clearPickups();
    pickups = spawnPickups(scene, gameBounds, 3 + Math.floor(waveNum / 2));

    // Roguelike upgrade pick
    document.exitPointerLock();
    await upgrades.open(player, waveNum - 1, {
      score,
      shotsHit:    player.shotsHit,
      shotsFired:  player.shotsFired,
      hpRemaining: player.hp,
      maxHp:       player.maxHp,
    });

    // Shop
    document.exitPointerLock();
    scoreRef.value = score;
    await shop.open(player, scoreRef);
    score = scoreRef.value;

    if (expansionStep < EXPANSION_ORDER.length) {
      const dir = EXPANSION_ORDER[expansionStep++];
      startZoneReveal(dir);
      await ui.showWaveMessage('SECTOR ONLINE', 2300);
    }

    await ui.showWaveMessage(`PROTOCOL: ${waveManager.currentTactic}`, 1100);
  }

  // Warn before boss waves
  if (waveNum % 5 === 0) {
    await ui.showWaveMessage('!! BOSS WAVE !!', 1400);
  }

  distanceTraveled = 0;
  _lastPlayerPos.copy(player.position);
  player.resetWaveStats();
  // Pass nn.probs so each enemy draws its own tactic from the distribution
  waveManager.startWave(waveNum, gameBounds, player.hp, nn.probs);
  await ui.showWaveMessage(`WAVE  ${waveNum}`, 800);
  state = STATE.PLAYING;
}

// ── Collision ─────────────────────────────────────────────────────────────────
function checkCollisions() {
  const enemies = waveManager.enemies;
  for (let pi = projectiles.length - 1; pi >= 0; pi--) {
    const proj = projectiles[pi];
    if (!proj.alive) { projectiles.splice(pi, 1); continue; }

    if (hitsObstacle(proj.mesh.position)) { proj.destroy(); projectiles.splice(pi, 1); continue; }

    if (proj.isPlayer) {
      for (const e of enemies) {
        if (!e.alive) continue;
        if (proj.mesh.position.distanceTo(e.position) < proj.radius + e.radius) {
          // Directional armour: front 0.65x, side 1.0x, rear 1.5x
          const projDir = proj.vel.clone().normalize();
          const eFwd = new THREE.Vector3(Math.sin(e.group.rotation.y), 0, Math.cos(e.group.rotation.y));
          const dot = projDir.dot(eFwd);
          const dirMult = dot > 0.5 ? 1.5 : dot < -0.5 ? 0.65 : 1.0;
          e.takeDamage(Math.round(proj.damage * dirMult));
          if (!e.alive) {
            const baseScore = e.isBoss ? 1000 + waveNum * 50 : 100 + waveNum * 10;
            score += Math.round(baseScore * player.scoreMult);
            player.hp = Math.min(player.maxHp, player.hp + player.hpPerKill);
            if (e.isBoss) {
              shakeIntensity = 1.8;
              const drops = spawnPickupsAt(scene, ['health', 'damage', 'speed', 'armor'], e.position.x, e.position.z);
              pickups.push(...drops);
            }
          }
          player.recordHit();
          ui.flashHit();
          proj.destroy(); projectiles.splice(pi, 1); break;
        }
      }
    } else {
      if (!player.alive) continue;
      if (proj.mesh.position.distanceTo(player.position) < proj.radius + player.radius) {
        player.takeDamage(proj.damage);
        if (player._justRespawned) {
          player._justRespawned = false;
          shakeIntensity = 1.0;
          ui.showWaveMessage('RESERVE HULL ACTIVATED', 1000);
        } else {
          ui.flashDamage();
          shakeIntensity = 0.3;
        }
        proj.destroy(); projectiles.splice(pi, 1);
      }
    }
  }
}

// ── Camera ─────────────────────────────────────────────────────────────────────
const _camPos  = new THREE.Vector3();
const _camLook = new THREE.Vector3();

function updateCamera(delta) {
  if (!player) return;

  // Apply mouse delta, then clear it
  camYaw += camMouseDelta;
  camMouseDelta = 0;

  if (fpvMode) {
    // First-person: camera sits above player center, looks along camYaw+pitch
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
      camera.position.x += (Math.random() - 0.5) * shakeIntensity;
      camera.position.y += (Math.random() - 0.5) * shakeIntensity;
      shakeIntensity = Math.max(0, shakeIntensity - delta * 4);
    }
    return;
  }

  _camPos.set(
    player.position.x - Math.sin(camYaw) * CAM_DIST,
    player.position.y + CAM_H,
    player.position.z - Math.cos(camYaw) * CAM_DIST
  );
  camera.position.lerp(_camPos, Math.min(1, delta * 4.5));

  // Look toward the camera's facing direction (camYaw) for correct screen-center aim
  _camLook.set(
    player.position.x + Math.sin(camYaw) * 5,
    0.5,
    player.position.z + Math.cos(camYaw) * 5
  );
  camera.lookAt(_camLook);

  if (shakeIntensity > 0) {
    camera.position.x += (Math.random() - 0.5) * shakeIntensity;
    camera.position.y += (Math.random() - 0.5) * shakeIntensity;
    shakeIntensity = Math.max(0, shakeIntensity - delta * 4);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────
function loop(ts) {
  requestAnimationFrame(loop);
  const delta = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;

  tickReveal(delta);
  pickups.forEach(pk => pk.update(delta));

  // Update camera first so aimTarget is derived from this frame's camera position
  updateCamera(delta);

  // Raycast from screen center to get world aim target (frozen during free-look)
  if (player && !freeLook) {
    if (fpvMode) {
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

  if (state === STATE.PLAYING && !paused) {
    player.update(delta, keys, aimTarget, mouseDown, rightMouseDown, gameBounds, freeLook, pitchDelta);
    pitchDelta = 0;
    player.group.position.y = terrainH(player.group.position.x, player.group.position.z);

    distanceTraveled += player.position.distanceTo(_lastPlayerPos);
    _lastPlayerPos.copy(player.position);

    resolveObstacles(player.position, player.radius);

    waveManager.update(delta, player.position, gameBounds);
    for (const e of waveManager.enemies) {
      if (e.alive) {
        resolveObstacles(e.group.position, e.radius);
        e.group.position.y = terrainH(e.group.position.x, e.group.position.z);
      }
    }

    for (const p of projectiles) p.update(delta);
    checkCollisions();
    checkPickupCollisions();

    ui.updateHUD(player.hp, player.maxHp, score, waveNum, player.lives);
    ui.updateAmmo(player.mgAmmo, player.mgMaxAmmo, player.mgReloading);

    if (waveManager.isWaveComplete()) startNextWave();

    if (!player.alive) {
      state = STATE.GAME_OVER;
      document.exitPointerLock();
      setTimeout(() => {
        ui.showGameOver(score, waveNum - 1, nn.summary(waveNum - 1), () => {
          lockPointer();
          init();
          startNextWave();
        });
      }, 600);
    }
  }

  updateCrosshair();
  updateHeadingArrow();
  updateBuffDisplay();
  renderer.render(scene, camera);
}

// ── Pointer lock ──────────────────────────────────────────────────────────────
function lockPointer() { canvas.requestPointerLock(); }

document.addEventListener('pointerlockchange', () => {
  // If lock is lost unexpectedly during play (e.g. user pressed Esc), re-show cursor
  if (!document.pointerLockElement && state === STATE.PLAYING) {
    // Let the player re-click to re-lock
    canvas.addEventListener('click', lockPointer, { once: true });
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', () => {
  ui.hideStartScreen();
  lockPointer();
  init();
  startNextWave();
});

requestAnimationFrame(loop);
