import * as THREE from "three";
import { Projectile } from "./projectile.js";
import { OBSTACLES } from "./scene.js";

// ── Tank explosion effect ──────────────────────────────────────────────────
function _spawnTankExplosion(scene, pos, isBoss = false) {
  const s = isBoss ? 2.6 : 1.0; // scale multiplier for boss explosions

  // 1. Instant white flash
  const flash = new THREE.PointLight(0xffffff, 35 * s, 16 * s);
  flash.position.copy(pos);
  scene.add(flash);

  // 2. Shockwave ring (flat, expands outward)
  const rGeo = new THREE.RingGeometry(0.1, 0.55, 14);
  rGeo.rotateX(-Math.PI / 2);
  const rMat = new THREE.MeshBasicMaterial({ color: 0xff8833, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(rGeo, rMat);
  ring.position.copy(pos);
  scene.add(ring);

  // 3. Fireball sphere — expands and shifts orange → dark smoke
  const fbGeo = new THREE.SphereGeometry(0.55 * s, 8, 6);
  const fbMat = new THREE.MeshBasicMaterial({ color: 0xff5500, transparent: true, opacity: 0.94 });
  const fireball = new THREE.Mesh(fbGeo, fbMat);
  fireball.position.copy(pos);
  fireball.position.y += 0.3;
  scene.add(fireball);

  // 4. Debris chunks — boxes tumbling outward with gravity
  const debris = [];
  const debrisCount = isBoss ? 14 : 7;
  for (let i = 0; i < debrisCount; i++) {
    const dGeo = new THREE.BoxGeometry(
      (0.1 + Math.random() * 0.28) * s,
      (0.05 + Math.random() * 0.14) * s,
      (0.1 + Math.random() * 0.28) * s,
    );
    const col = i % 3 === 0 ? 0xff4400 : i % 3 === 1 ? 0x334455 : 0x886644;
    const dMat = new THREE.MeshBasicMaterial({ color: col });
    const chunk = new THREE.Mesh(dGeo, dMat);
    chunk.position.copy(pos);
    const angle = Math.random() * Math.PI * 2;
    const speed = (3 + Math.random() * 6) * (isBoss ? 1.5 : 1);
    chunk._v  = new THREE.Vector3(Math.cos(angle) * speed, 2.5 + Math.random() * 5, Math.sin(angle) * speed);
    chunk._rx = (Math.random() - 0.5) * 12;
    chunk._ry = (Math.random() - 0.5) * 12;
    chunk._rz = (Math.random() - 0.5) * 12;
    scene.add(chunk);
    debris.push(chunk);
  }

  // 5. Lingering orange glow
  const glow = new THREE.PointLight(0xff4400, 12 * s, 11 * s);
  glow.position.copy(pos);
  glow.position.y += 0.5;
  scene.add(glow);

  const DUR = isBoss ? 950 : 580;
  let t = 0;
  const iv = setInterval(() => {
    t += 18;
    const pct = Math.min(t / DUR, 1);

    flash.intensity = (35 * s) * Math.max(0, 1 - pct * 8);

    ring.scale.setScalar(1 + pct * 14 * s);
    rMat.opacity = 0.92 * Math.max(0, 1 - pct * 2.2);

    fireball.scale.setScalar(1 + pct * 5 * s);
    fbMat.opacity = 0.94 * Math.max(0, 1 - pct * 1.6);
    if      (pct < 0.35) fbMat.color.setHex(0xff5500);
    else if (pct < 0.65) fbMat.color.setHex(0x884400);
    else                 fbMat.color.setHex(0x221100);

    glow.intensity = (12 * s) * Math.max(0, 1 - pct * 1.3);

    const dt = 0.018;
    for (const c of debris) {
      c.position.addScaledVector(c._v, dt);
      c._v.y -= 14 * dt;
      c.rotation.x += c._rx * dt;
      c.rotation.y += c._ry * dt;
      c.rotation.z += c._rz * dt;
    }

    if (pct >= 1) {
      clearInterval(iv);
      scene.remove(flash); scene.remove(ring); scene.remove(fireball); scene.remove(glow);
      rGeo.dispose(); rMat.dispose(); fbGeo.dispose(); fbMat.dispose();
      for (const c of debris) { scene.remove(c); c.geometry.dispose(); c.material.dispose(); }
    }
  }, 18);
}

// ── Enemy type definitions ──────────────────────────────────────────────────
// leadFactor: 0 = no predictive aim, 1 = full ballistic intercept
export const TYPES = {
  fast: {
    color: 0x00ff88, emissive: 0x00ff88, scale: 0.75,
    speed: 1.5, hp: 40, damage: 12, shootRange: 42, shootCd: 1.6,
    bulletSpeed: 22, preferDist: 14, traverseSpeed: 2.5, baseSpread: 0.22,
    leadFactor: 0.3, turnRate: 3.5,
  },
  tanky: {
    color: 0xff3300, emissive: 0xff2200, scale: 1.3,
    speed: 1.8, hp: 160, damage: 30, shootRange: 55, shootCd: 3.0,
    bulletSpeed: 16, preferDist: 22, traverseSpeed: 0.7, baseSpread: 0.10,
    leadFactor: 0.6, turnRate: 1.2,
  },
  swarm: {
    color: 0xff00ff, emissive: 0xcc00cc, scale: 0.5,
    speed: 1.5, hp: 18, damage: 8, shootRange: 28, shootCd: 1.8,
    bulletSpeed: 22, preferDist: 10, traverseSpeed: 3.5, baseSpread: 0.28,
    leadFactor: 0.0, turnRate: 4.5,
  },
  boss: {
    color: 0xff5500, emissive: 0xff3300, scale: 2.8,
    speed: 1.4, hp: 600, damage: 50, shootRange: 65, shootCd: 1.8,
    bulletSpeed: 18, preferDist: 24, traverseSpeed: 0.9, baseSpread: 0.05,
    leadFactor: 0.9, turnRate: 0.9,
  },
  gunner: {
    color: 0x88ff00, emissive: 0x44bb00, scale: 0.9,
    speed: 1.4, hp: 55, damage: 6, shootRange: 42, shootCd: 0.1,
    bulletSpeed: 30, preferDist: 22, traverseSpeed: 2.2, baseSpread: 0.12,
    isMG: true, leadFactor: 0.0, turnRate: 2.2,
  },
  scout: {
    color: 0x44ffaa, emissive: 0x22cc77, scale: 0.6,
    speed: 2.5, hp: 22, damage: 3, shootRange: 32, shootCd: 0.12,
    bulletSpeed: 32, preferDist: 14, traverseSpeed: 3.5, baseSpread: 0.20,
    isMG: true, leadFactor: 0.0, turnRate: 5.0,
  },
  stug: {
    color: 0xaa8855, emissive: 0x775533, scale: 1.1,
    speed: 1.0, hp: 130, damage: 45, shootRange: 60, shootCd: 3.2,
    bulletSpeed: 36, preferDist: 36, traverseSpeed: 0, turnSpeed: 0.65,
    baseSpread: 0.04, leadFactor: 1.0, // stug uses turnSpeed for hull aiming separately
  },
  hover: {
    color: 0xcc33ff, emissive: 0xaa22dd, scale: 0.9,
    speed: 2.2, hp: 80, damage: 22, shootRange: 46, shootCd: 1.5,
    bulletSpeed: 28, preferDist: 20, traverseSpeed: 4.0, baseSpread: 0.17,
    isHover: true, leadFactor: 0.5, turnRate: 3.0,
  },
  lancer: {
    // Long-range artillery that fires arcing shells like the player.
    // High damage, very accurate, holds maximum range. Introduced at wave 7.
    color: 0x1a0033, emissive: 0xbb00ff, scale: 1.05,
    speed: 1.6, hp: 75, damage: 50, shootRange: 58, shootCd: 4.2,
    bulletSpeed: 22, preferDist: 34, traverseSpeed: 1.3, baseSpread: 0.05,
    leadFactor: 0.85, hasGravity: true, turnRate: 1.5,
  },
};

const PLAYER_RADIUS = 1.0;
const AIM_CHARGE_RATE = 0.45;
const AIM_DECAY_RATE  = 1.5;
const AIM_LOCK_THRESH = 0.12;

// ── Line-of-sight: segment vs AABB ─────────────────────────────────────────
function _segmentHitsBox(x1, z1, x2, z2, minX, maxX, minZ, maxZ) {
  const dx = x2 - x1, dz = z2 - z1;
  let tmin = 0, tmax = 1;
  if (Math.abs(dx) < 1e-8) { if (x1 < minX || x1 > maxX) return false; }
  else {
    const t1 = (minX - x1) / dx, t2 = (maxX - x1) / dx;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-8) { if (z1 < minZ || z1 > maxZ) return false; }
  else {
    const t1 = (minZ - z1) / dz, t2 = (maxZ - z1) / dz;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmin > tmax) return false;
  }
  return tmin < tmax;
}

export class Enemy {
  constructor(scene, projectiles, type, spawnPos, difficulty = 1, isBossOverride = false) {
    this.scene       = scene;
    this.projectiles = projectiles;
    this.type        = type;
    this.def         = TYPES[type];
    this._difficulty = difficulty;
    this._maxHp      = Math.round(this.def.hp * difficulty);
    this.hp          = this._maxHp;
    this.damage      = Math.round(this.def.damage * (0.7 + difficulty * 0.3));
    this.alive       = true;
    this.shootTimer  = Math.random() * this.def.shootCd;
    this.isBoss      = type === 'boss' || isBossOverride;
    this.radius      = this.def.scale * (this.isBoss ? 1.4 : 0.9);

    this.aimCharge   = 0;
    this._aimDelta   = Math.PI;
    this._tactic     = 'RUSH';
    this._encircleAngle   = 0;
    this._encircleElapsed = 0;
    this._strafeDir  = Math.random() > 0.5 ? 1 : -1;
    this._jitterTimer = 0;
    this.fixedGun    = (type === 'stug');
    this.isHover     = !!this.def.isHover;
    this.hoverOffset = 0;
    if (this.isHover) this._hoverTime = Math.random() * Math.PI * 2;

    if (this.def.isMG) {
      this._burstMax      = (type === 'scout') ? 10 : 16;
      this._burstLeft     = this._burstMax;
      this._burstCooldown = 0;
    }

    // Player velocity tracking for predictive aim
    this._prevPlayerPos = null;
    this._playerVel     = new THREE.Vector3();

    // Stuck detection
    this._stuckTimer    = 0;
    this._stuckCheckPos = null;

    // LOS state
    this._losBlocked    = false;
    this._losCheckTimer = 0;

    this._buildMesh();
    this.group.rotation.order = 'YXZ'; // YXZ = yaw first, then local pitch/roll
    this.group.position.set(spawnPos.x, 0, spawnPos.z);
    scene.add(this.group);
  }

  setTactic(tactic, formationData = {}) {
    this._tactic = tactic;
    this._encircleAngle = formationData.angle ?? Math.random() * Math.PI * 2;
    this._encircleElapsed = 0;
  }

  // ── Mesh builders ────────────────────────────────────────────────────────

  _buildMesh() {
    if (this.type === 'stug')   { this._buildStugMesh();   return; }
    if (this.type === 'hover')  { this._buildHoverMesh();  return; }
    if (this.type === 'lancer') { this._buildLancerMesh(); return; }

    this.group = new THREE.Group();
    this.group.scale.setScalar(this.def.scale);

    const hullMat = new THREE.MeshStandardMaterial({
      color: this.def.color, emissive: this.def.emissive,
      emissiveIntensity: 0.22, roughness: 0.4, metalness: 0.7,
    });
    const hullGeo = new THREE.BoxGeometry(1.4, 0.9, 2.0);
    const hull    = new THREE.Mesh(hullGeo, hullMat);
    hull.castShadow = true;
    this.group.add(hull);
    this.group.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(hullGeo),
      new THREE.LineBasicMaterial({ color: this.def.color, opacity: 0.7, transparent: true }),
    ));

    // ── Type-specific hull additions ──────────────────────────────────────
    if (this.type === 'tanky') {
      // Heavy side skirt armor plates
      [-0.88, 0.88].forEach(xOff => {
        const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.52, 2.1), hullMat.clone());
        skirt.position.set(xOff, -0.18, 0);
        this.group.add(skirt);
      });
      // Front angled armor plate
      const glacis = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.55, 0.22), hullMat.clone());
      glacis.position.set(0, 0.12, 1.0);
      glacis.rotation.x = 0.38;
      this.group.add(glacis);
    }

    if (this.type === 'fast') {
      // Rear spoiler fins — aerodynamic look
      [-0.6, 0.6].forEach(xOff => {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.38, 0.48), hullMat.clone());
        fin.position.set(xOff, 0.22, -0.9);
        fin.rotation.z = xOff > 0 ? 0.22 : -0.22;
        this.group.add(fin);
      });
      // Low wedge front plate
      const wedge = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.25, 0.55), hullMat.clone());
      wedge.position.set(0, -0.25, 0.9); wedge.rotation.x = 0.55;
      this.group.add(wedge);
    }

    if (this.type === 'scout') {
      // Sensor mast — tall thin post with dish
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 5), hullMat.clone());
      mast.position.set(0.3, 0.85, -0.3);
      this.group.add(mast);
      const dish = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 4, 0, Math.PI), hullMat.clone());
      dish.position.set(0.3, 1.35, -0.3); dish.rotation.z = Math.PI / 2;
      this.group.add(dish);
    }

    // ── Turret ────────────────────────────────────────────────────────────
    this.turretGroup = new THREE.Group();
    this.turretGroup.position.y = 0.65;
    this.group.add(this.turretGroup);

    let turretW = 0.75, turretD = 0.85;
    if (this.type === 'tanky') { turretW = 1.05; turretD = 1.0; }

    const turretMat = new THREE.MeshStandardMaterial({
      color: this.def.color, emissive: this.def.emissive,
      emissiveIntensity: 0.38, roughness: 0.3, metalness: 0.85,
    });
    this.turretGroup.add(new THREE.Mesh(new THREE.BoxGeometry(turretW, 0.4, turretD), turretMat));

    if (this.type === 'gunner') {
      // Radar/sensor disc on top of turret
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.26, 0.06, 8),
        new THREE.MeshStandardMaterial({ color: this.def.color, emissive: this.def.emissive, emissiveIntensity: 0.7, roughness: 0.1, metalness: 1.0 }),
      );
      disc.position.y = 0.28;
      this.turretGroup.add(disc);
    }

    // ── Barrel(s) ─────────────────────────────────────────────────────────
    const barrelMat = new THREE.MeshStandardMaterial({
      color: this.def.color, emissive: this.def.emissive, emissiveIntensity: 0.75,
    });

    if (this.type === 'swarm') {
      // Three-pronged multi-barrel cluster — distinctive bug/drone look
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.72, 5), barrelMat.clone());
        b.rotation.x = Math.PI / 2;
        b.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.56);
        this.turretGroup.add(b);
      }
    } else {
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.1), barrelMat);
      barrel.position.z = 0.75;
      this.turretGroup.add(barrel);
    }

    // No PointLight for standard enemies (performance: too many lights at wave 20)
    // Visual glow comes entirely from emissive materials

    if (this.isBoss) this._buildBossExtras();
  }

  _buildStugMesh() {
    this.group = new THREE.Group();
    this.group.scale.setScalar(this.def.scale);

    const mat = new THREE.MeshStandardMaterial({
      color: this.def.color, emissive: this.def.emissive,
      emissiveIntensity: 0.22, roughness: 0.5, metalness: 0.65,
    });
    const edgeMat = new THREE.LineBasicMaterial({ color: this.def.color, opacity: 0.6, transparent: true });

    const hullGeo = new THREE.BoxGeometry(1.6, 0.65, 2.4);
    this.group.add(new THREE.Mesh(hullGeo, mat));
    this.group.add(new THREE.LineSegments(new THREE.EdgesGeometry(hullGeo), edgeMat));

    const caseGeo = new THREE.BoxGeometry(1.35, 0.55, 1.9);
    const caseM   = new THREE.Mesh(caseGeo, mat); caseM.position.set(0, 0.6, 0.15);
    this.group.add(caseM);
    const caseEdge = new THREE.LineSegments(new THREE.EdgesGeometry(caseGeo), edgeMat.clone());
    caseEdge.position.copy(caseM.position); this.group.add(caseEdge);

    const barrelMat = new THREE.MeshStandardMaterial({ color: this.def.color, emissive: this.def.emissive, emissiveIntensity: 0.75 });
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2.1), barrelMat);
    barrel.position.set(0, 0.6, 1.5); this.group.add(barrel);

    [-0.9, 0.9].forEach(xOff => {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 2.5), mat);
      sp.position.set(xOff, -0.26, 0); this.group.add(sp);
    });

    this.turretGroup = new THREE.Group();
    this.group.add(this.turretGroup);

    if (this.isBoss) this._buildBossExtras();
  }

  _buildHoverMesh() {
    this.group = new THREE.Group();
    this.group.scale.setScalar(this.def.scale);

    const mat = new THREE.MeshStandardMaterial({
      color: this.def.color, emissive: this.def.emissive,
      emissiveIntensity: 0.38, roughness: 0.15, metalness: 0.95,
    });
    const edgeMat = new THREE.LineBasicMaterial({ color: this.def.color, opacity: 0.75, transparent: true });

    const discGeo = new THREE.CylinderGeometry(1.0, 1.25, 0.28, 10);
    this.group.add(new THREE.Mesh(discGeo, mat));
    this.group.add(new THREE.LineSegments(new THREE.EdgesGeometry(discGeo), edgeMat));

    const domeMat = new THREE.MeshStandardMaterial({
      color: this.def.color, emissive: this.def.emissive, emissiveIntensity: 0.6,
      roughness: 0.05, metalness: 1.0, transparent: true, opacity: 0.75,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.52, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    dome.position.y = 0.14; this.group.add(dome);

    const ringMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: this.def.color, emissiveIntensity: 2.2, roughness: 0, metalness: 1 });
    const ringGeo = new THREE.TorusGeometry(0.62, 0.07, 5, 16);
    ringGeo.rotateX(Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, ringMat); ring.position.y = -0.06;
    this.group.add(ring);

    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.38, 6), mat.clone());
      pod.position.set(Math.cos(a) * 0.78, -0.28, Math.sin(a) * 0.78);
      this.group.add(pod);
    }

    // Hover keeps ONE PointLight for its signature underside glow (small count type)
    const glow = new THREE.PointLight(this.def.color, 2.0, 4.5);
    glow.position.y = -0.5; this.group.add(glow);

    this.turretGroup = new THREE.Group();
    this.group.add(this.turretGroup);

    if (this.isBoss) this._buildBossExtras();
  }

  _buildLancerMesh() {
    this.group = new THREE.Group();
    this.group.scale.setScalar(this.def.scale);

    const mat = new THREE.MeshStandardMaterial({
      color: this.def.color, emissive: this.def.emissive,
      emissiveIntensity: 0.30, roughness: 0.3, metalness: 0.90,
    });
    const edgeMat = new THREE.LineBasicMaterial({ color: this.def.emissive, opacity: 0.65, transparent: true });

    // Long narrow hull — far more elongated than a standard tank
    const hullGeo = new THREE.BoxGeometry(0.95, 0.6, 2.8);
    this.group.add(new THREE.Mesh(hullGeo, mat));
    this.group.add(new THREE.LineSegments(new THREE.EdgesGeometry(hullGeo), edgeMat));

    // Swept-back side sponsons — wing-like, low and angular
    [-0.62, 0.62].forEach(xOff => {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 1.6), mat.clone());
      fin.position.set(xOff, -0.22, -0.3);
      this.group.add(fin);
    });

    // Angled glacis nose
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 0.55), mat.clone());
    nose.position.set(0, 0.04, 1.55);
    nose.rotation.x = -0.4;
    this.group.add(nose);

    // Rear exhaust vents — two small rectangular slots
    [-0.28, 0.28].forEach(xOff => {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.28),
        new THREE.MeshStandardMaterial({ color: this.def.emissive, emissive: this.def.emissive, emissiveIntensity: 1.2, roughness: 0.1, metalness: 1 }));
      vent.position.set(xOff, 0.25, -1.5);
      this.group.add(vent);
    });

    // Turret — narrow and low, optimised for the long barrel
    this.turretGroup = new THREE.Group();
    this.turretGroup.position.y = 0.45;
    this.group.add(this.turretGroup);

    const turretMat = new THREE.MeshStandardMaterial({
      color: this.def.color, emissive: this.def.emissive,
      emissiveIntensity: 0.45, roughness: 0.2, metalness: 0.95,
    });
    this.turretGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.32, 0.9), turretMat));

    // Very long barrel — the lancer's signature feature
    const barrelMat = new THREE.MeshStandardMaterial({
      color: this.def.emissive, emissive: this.def.emissive, emissiveIntensity: 1.0,
    });
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 2.0), barrelMat);
    barrel.position.z = 1.1;
    this.turretGroup.add(barrel);

    // Rangefinder prism — a small box offset to the right of the turret
    const prism = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.32), turretMat.clone());
    prism.position.set(0.44, 0.08, 0.1);
    this.turretGroup.add(prism);

    // Signature glow from barrel tip
    const barrelGlow = new THREE.PointLight(this.def.emissive, 2.5, 5);
    barrelGlow.position.set(0, 0.45, 2.15);
    this.turretGroup.add(barrelGlow);

    if (this.isBoss) this._buildBossExtras();
  }

  _buildBossExtras() {
    // Pulsing ground ring indicator — clearly marks the boss
    const ringPts = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a) * 2.1, -0.44, Math.sin(a) * 2.1));
    }
    this.group.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ringPts),
      new THREE.LineBasicMaterial({ color: 0xff4400, opacity: 0.95, transparent: true }),
    ));

    // Single strong glow light for the boss (only one per boss)
    const bossGlow = new THREE.PointLight(0xff4400, 6, 12);
    bossGlow.position.y = 1.2;
    this.group.add(bossGlow);
  }

  // ── Visual damage state — update material appearance based on HP ──────────
  _updateDamageVisuals() {
    const ratio = this.hp / this._maxHp;
    const mats  = this.group.children
      .filter(c => c.isMesh && c.material?.emissive)
      .map(c => c.material);

    for (const m of mats) {
      if (ratio > 0.6) {
        // Healthy — normal emissive
        m.emissiveIntensity = 0.22;
      } else if (ratio > 0.3) {
        // Damaged — yellowish tint
        m.emissive.setHex(0xffaa00);
        m.emissiveIntensity = 0.35;
      } else {
        // Critical — red flash
        m.emissive.setHex(0xff2200);
        m.emissiveIntensity = 0.55 + Math.sin(Date.now() * 0.01) * 0.2;
      }
    }
  }

  // ── LOS check ────────────────────────────────────────────────────────────
  _hasLineOfSight(playerPos) {
    const ex = this.group.position.x, ez = this.group.position.z;
    const px = playerPos.x, pz = playerPos.z;
    for (const obs of OBSTACLES) {
      if (_segmentHitsBox(ex, ez, px, pz,
        obs.x - obs.w / 2, obs.x + obs.w / 2,
        obs.z - obs.h / 2, obs.z + obs.h / 2)) {
        return false;
      }
    }
    return true;
  }

  // ── Main update ──────────────────────────────────────────────────────────
  update(delta, playerPos, enemies, bounds) {
    if (!this.alive) return;

    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.group.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    const dir  = dist > 0.01 ? toPlayer.clone().normalize() : new THREE.Vector3(1, 0, 0);

    // ── Player velocity tracking for predictive aim ──────────────────────
    if (!this._prevPlayerPos) this._prevPlayerPos = playerPos.clone();
    this._playerVel.subVectors(playerPos, this._prevPlayerPos).divideScalar(Math.max(delta, 0.001));
    if (this._playerVel.lengthSq() > 225) this._playerVel.setLength(15); // clamp spike
    this._prevPlayerPos.copy(playerPos);

    // ── Compute lead-adjusted aim target ────────────────────────────────
    let aimTarget = playerPos.clone();
    const leadFactor = this.def.leadFactor ?? 0;
    if (leadFactor > 0 && this._playerVel.lengthSq() > 0.04) {
      const tof  = dist / Math.max(this.def.bulletSpeed, 1);
      const lead = this._playerVel.clone().multiplyScalar(tof * leadFactor);
      lead.y = 0;
      aimTarget.add(lead);
    }

    const toAim = new THREE.Vector3().subVectors(aimTarget, this.group.position);
    toAim.y = 0;

    // ── Turret traversal ─────────────────────────────────────────────────
    if (!this.fixedGun && dist > 0.1) {
      const worldToTarget = Math.atan2(toAim.x, toAim.z);
      const desiredLocal  = worldToTarget - this.group.rotation.y;
      let diff = desiredLocal - this.turretGroup.rotation.y;
      while (diff > Math.PI)  diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const maxStep = this.def.traverseSpeed * delta;
      this.turretGroup.rotation.y += Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
      this._aimDelta = Math.abs(diff);
    }

    // ── Stug hull aiming ─────────────────────────────────────────────────
    if (this.fixedGun && dist > 0.1) {
      const desired = Math.atan2(toAim.x, toAim.z);
      let diff = desired - this.group.rotation.y;
      while (diff > Math.PI)  diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.group.rotation.y += Math.sign(diff) * Math.min(Math.abs(diff), (this.def.turnSpeed ?? 0.65) * delta);
      this.turretGroup.rotation.y = 0;
      this._aimDelta = Math.abs(diff);
    }

    // ── Aim charge ───────────────────────────────────────────────────────
    if (this._aimDelta < AIM_LOCK_THRESH) {
      this.aimCharge = Math.min(1, this.aimCharge + delta * AIM_CHARGE_RATE);
    } else {
      this.aimCharge = Math.max(0, this.aimCharge - delta * AIM_DECAY_RATE);
    }

    // ── LOS check (every 0.4s — not every frame) ─────────────────────────
    this._losCheckTimer -= delta;
    if (this._losCheckTimer <= 0) {
      this._losBlocked = !this._hasLineOfSight(playerPos);
      this._losCheckTimer = 0.4 + Math.random() * 0.2;
    }

    // ── Effective tactic — override when low HP or LOS blocked ───────────
    const hpRatio = this.hp / this._maxHp;
    let activeTactic = this._tactic;
    if (hpRatio < 0.25 && !this.fixedGun) activeTactic = 'SUPPRESS'; // retreat when critical

    // ── Movement ─────────────────────────────────────────────────────────
    let shootCdMult  = 1.0;
    const minSep     = this.radius + PLAYER_RADIUS + 0.3;
    const prevPos    = this.group.position.clone();

    // If LOS is blocked AND enemy is at range, move toward a flanking spot
    const wantsToFlankForLOS = this._losBlocked && dist > 8 && !this.fixedGun;

    if (wantsToFlankForLOS) {
      // Strafe perpendicular to player direction to find LOS
      const lateralDir = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(this._strafeDir);
      this.group.position.addScaledVector(lateralDir, this.def.speed * 0.9 * delta);
      this.group.position.addScaledVector(dir, this.def.speed * 0.4 * delta); // also close in
    } else if (activeTactic === 'RUSH') {
      if (dist > minSep) {
        this.group.position.addScaledVector(dir, this.def.speed * 1.3 * delta);
      }
    } else if (activeTactic === 'SUPPRESS') {
      const hold = this.def.shootRange - 2;
      if (dist > hold + 1)      this.group.position.addScaledVector(dir,  this.def.speed * 0.7 * delta);
      else if (dist < hold - 2) this.group.position.addScaledVector(dir, -this.def.speed * 0.7 * delta);
      else {
        // Lateral drift while suppressing — stops the static hovering
        const lat = new THREE.Vector3(-dir.z, 0, dir.x);
        this.group.position.addScaledVector(lat, this.def.speed * 0.35 * this._strafeDir * delta);
      }
      shootCdMult = 0.55;
    } else if (activeTactic === 'ENCIRCLE') {
      this._encircleElapsed += delta;
      const orbitR = Math.max(6, 22 - this._encircleElapsed * 0.65);
      this._encircleAngle += delta * 0.5; // advance orbit
      const tx = playerPos.x + Math.cos(this._encircleAngle) * orbitR;
      const tz = playerPos.z + Math.sin(this._encircleAngle) * orbitR;
      const toSlot = new THREE.Vector3(tx - this.group.position.x, 0, tz - this.group.position.z);
      if (toSlot.lengthSq() > 0.01) {
        this.group.position.addScaledVector(toSlot.normalize(), this.def.speed * 0.85 * delta);
      }
    } else {
      // FLANK — approach to preferred distance with strafing for fast/scout/hover
      const pref = this.def.preferDist;
      const strafe = this.type === 'fast' || this.type === 'scout' || this.type === 'hover';
      if (dist > pref + 1.5) {
        let moveDir = dir.clone();
        if (strafe) {
          this._jitterTimer -= delta;
          if (this._jitterTimer <= 0) { this._strafeDir *= -1; this._jitterTimer = 0.6 + Math.random() * 0.6; }
          moveDir.addScaledVector(new THREE.Vector3(-dir.z, 0, dir.x), this._strafeDir * 0.6).normalize();
        }
        this.group.position.addScaledVector(moveDir, this.def.speed * delta);
      } else if (dist < pref - 2) {
        this.group.position.addScaledVector(dir, -this.def.speed * 0.4 * delta);
      } else if (strafe) {
        this._jitterTimer -= delta;
        if (this._jitterTimer <= 0) { this._strafeDir *= -1; this._jitterTimer = 0.6 + Math.random() * 0.6; }
        this.group.position.addScaledVector(
          new THREE.Vector3(-dir.z, 0, dir.x),
          this.def.speed * this._strafeDir * delta,
        );
      }
    }

    // ── Hull smoothly rotates toward movement direction ──────────────────
    const moved = this.group.position.clone().sub(prevPos);
    moved.y = 0;
    if (!this.fixedGun && moved.lengthSq() > 0.0001) {
      const desired = Math.atan2(moved.x, moved.z);
      let diff = desired - this.group.rotation.y;
      while (diff >  Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const rate = (this.def.turnRate ?? 2.5) * delta;
      this.group.rotation.y += Math.sign(diff) * Math.min(Math.abs(diff), rate);
    }

    // ── Stug standoff ────────────────────────────────────────────────────
    if (this.fixedGun) {
      const pref = this.def.preferDist;
      if (dist > pref + 2)      this.group.position.addScaledVector(dir,  this.def.speed * delta);
      else if (dist < pref - 2) this.group.position.addScaledVector(dir, -this.def.speed * 0.6 * delta);
    }

    // ── Hover banking ────────────────────────────────────────────────────
    if (this.isHover) {
      this._hoverTime += delta;
      this.hoverOffset = 1.8 + Math.sin(this._hoverTime * 1.6) * 0.22;
      const bank = moved.lengthSq() > 0.0001 ? 0.18 : 0;
      this.group.rotation.x = Math.cos(this.group.rotation.y) * bank * -moved.z;
      this.group.rotation.z = Math.sin(this.group.rotation.y) * bank * moved.x;
    }

    // ── Hard min separation from player ──────────────────────────────────
    {
      const dx = this.group.position.x - playerPos.x;
      const dz = this.group.position.z - playerPos.z;
      const d2 = Math.sqrt(dx * dx + dz * dz);
      if (d2 < minSep && d2 > 0.001) {
        this.group.position.x = playerPos.x + (dx / d2) * minSep;
        this.group.position.z = playerPos.z + (dz / d2) * minSep;
      }
    }

    // ── Enemy separation ─────────────────────────────────────────────────
    for (const other of enemies) {
      if (other === this || !other.alive) continue;
      const away = new THREE.Vector3().subVectors(this.group.position, other.group.position);
      away.y = 0;
      const d = away.length();
      const minD = (this.radius + other.radius) * 1.4;
      if (d < minD && d > 0.001) this.group.position.addScaledVector(away.normalize(), (minD - d) * 0.5);
    }

    // ── Stuck detection — nudge if barely moved ───────────────────────────
    this._stuckTimer += delta;
    if (!this._stuckCheckPos) this._stuckCheckPos = this.group.position.clone();
    if (this._stuckTimer > 1.5) {
      if (this.group.position.distanceTo(this._stuckCheckPos) < 0.25 && dist > 3) {
        const escAngle = Math.random() * Math.PI * 2;
        this.group.position.x += Math.cos(escAngle) * 1.8;
        this.group.position.z += Math.sin(escAngle) * 1.8;
        this._strafeDir *= -1; // also flip strafe direction
      }
      this._stuckCheckPos.copy(this.group.position);
      this._stuckTimer = 0;
    }

    // ── Bounds clamp ─────────────────────────────────────────────────────
    const pos = this.group.position;
    pos.x = Math.max(bounds.minX - 4, Math.min(bounds.maxX + 4, pos.x));
    pos.z = Math.max(bounds.minZ - 4, Math.min(bounds.maxZ + 4, pos.z));

    // ── Shooting ─────────────────────────────────────────────────────────
    this.shootTimer -= delta;
    if (this.def.isMG) {
      if (this._burstCooldown > 0) {
        this._burstCooldown -= delta;
      } else if (this.shootTimer <= 0 && dist <= this.def.shootRange && !this._losBlocked) {
        this._shoot();
        this.shootTimer = this.def.shootCd * shootCdMult;
        if (--this._burstLeft <= 0) {
          this._burstCooldown = (this.type === 'scout') ? 2.0 : 2.5;
          this._burstLeft = this._burstMax;
        }
      }
    } else if (this.shootTimer <= 0 && dist <= this.def.shootRange && !this._losBlocked) {
      this._shoot();
      this.shootTimer = this.def.shootCd * shootCdMult;
    }

    // ── Visual damage update ──────────────────────────────────────────────
    this._updateDamageVisuals();
  }

  _shoot() {
    // Projectile cap — don't add more enemy projectiles if too many exist
    if (this.projectiles.filter(p => !p.isPlayer).length > 75) return;

    const turretWorldAngle = this.group.rotation.y + this.turretGroup.rotation.y;
    const dir = new THREE.Vector3(Math.sin(turretWorldAngle), 0, Math.cos(turretWorldAngle));
    // Accuracy improves with difficulty: wave 1 = full spread, wave 10+ = ~35% tighter
    const accuracyMult = Math.max(0.35, 1.0 - (this._difficulty - 0.5) * 0.32);
    const spread = this.def.baseSpread * (1 - this.aimCharge * 0.75) * accuracyMult;
    dir.x += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    const barrelZ    = this.type === 'stug' ? 2.4 : 1.5;
    const barrelLocal = new THREE.Vector3(0, 0.65, barrelZ);
    this.group.localToWorld(barrelLocal);
    barrelLocal.y = this.group.position.y + (this.type === 'stug' ? 0.6 * this.def.scale : 0.45);

    const proj = new Projectile(
      this.scene, barrelLocal, dir,
      this.def.bulletSpeed, this.damage, false,
      this.def.color, this.def.hasGravity ?? false, this.def.isMG ?? false,
    );
    proj._enemyType = this.type;
    this.projectiles.push(proj);
  }

  takeDamage(amount) {
    this.hp -= amount;
    if (this.hp <= 0) { this.alive = false; this._die(); }
    return this.hp <= 0;
  }

  _die() {
    _spawnTankExplosion(this.scene, this.group.position.clone(), this.isBoss);
    setTimeout(() => this.group.parent?.remove(this.group), 60);
  }

  get position() { return this.group.position; }
}
