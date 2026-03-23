import * as THREE from "three";
import { Projectile } from "./projectile.js";
import { audio } from "./audio.js";

const BASE_SPEED = 2;
const TURN_SPEED = 1.0;
const SHOOT_CD = 1.8;
const BULLET_SPEED = 32;
const BASE_DAMAGE = 25;
const MAX_HP = 100;
const MAX_PITCH = 0.5; // ~31° max barrel elevation
const MIN_PITCH = 0.4;

const TURRET_TRAVERSE = 0.6; // rad/s horizontal
const AIM_LOCK_THRESH = 0.1; // rad — "on target"
const AIM_CHARGE_RATE = 1 / 2.0;
const AIM_DECAY_RATE = 2.0;
const MAX_SPREAD = 0.45;
const POST_FIRE_CHARGE = 0.25;

const MG_CD = 0.085; // ~12 rounds/sec
const MG_BULLET_SPEED = 26;
const MG_DAMAGE = 3; // nerfed — upgrades raise this
const MG_AMMO = 30;
const MG_RELOAD = 2.2; // seconds
const MG_SPREAD = 0.16; // nerfed — less accurate by default

export class Player {
  constructor(scene, projectiles, hullType = "vanguard") {
    this.scene = scene;
    this.projectiles = projectiles;
    this.hullType = hullType;
    this.hp = MAX_HP;
    this.maxHp = MAX_HP;
    this.alive = true;
    this.shootCd = 0;
    this.radius = 0.9;
    this.lives = 0;

    this.speedMult = 1;
    this.damageMult = 1;
    this.armorMult = 1;
    this.traverseMult = 1;
    this.reloadMult = 1;
    this.multiShot = 1;
    this.bulletSpeedMult = 1;

    // Rogue build stats (set by upgrades)
    this.regenRate = 0; // HP per second passive regen
    this.hpPerKill = 0; // HP gained on enemy kill
    this.scoreMult = 1; // score multiplier for kills

    // Temporary buffs (from map pickups) — key: { mult, timer }
    this._buffs = {};

    // Component damage — temporary debuffs (seconds remaining)
    this._compDmg = { track: 0, engine: 0, turret: 0 };
    this.repairRate = 1; // multiplier for debuff recovery speed (upgrades raise this)
    this._compCb = null; // callback set by main.js to show component damage UI

    this._invincTimer = 0; // seconds of post-respawn invincibility remaining
    this._recoilT = 0;              // barrel recoil animation (0–1, decays to 0)
    this._velMag = 0;               // hull movement speed this frame (units/sec)
    this._turretVelMag = 0;         // world-space turret angular speed (rad/sec)
    this._prevTurretWorldAngle = 0; // previous frame world turret angle
    this.movementSpreadMult = 1.0;  // 0 = no penalty, 1 = full penalty (upgrade reduces)
    this.aimChargeMult = 1.0;       // multiplier on how fast aim charge builds when stationary

    this.aimCharge = 0;
    this.barrelPitch = 0; // current barrel elevation in radians (0 = flat)

    this.shotsFired = 0;
    this.shotsHit = 0;
    this._totalAimChargeOnFire = 0;
    this._justRespawned = false;

    // Machine gun state
    this.mgAmmo = MG_AMMO;
    this.mgMaxAmmo = MG_AMMO;
    this.mgCd = 0;
    this.mgReloading = false;
    this.mgReloadTimer = 0;
    // MG upgrade multipliers
    this.mgDamageMult = 1;
    this.mgSpreadMult = 1;
    this.mgReloadMult = 1;

    this._buildMesh();
    scene.add(this.group);
  }

  _buildMesh() {
    this.group = new THREE.Group();
    this.group.rotation.order = "YXZ"; // YXZ = yaw first, then local pitch/roll

    // Hull-type colour palette
    const PALETTES = {
      vanguard: { body: 0x003344, body2: 0x002233, emissive: 0x00ffff, edge: 0x00ffff, barrel: 0x00ffff, glow: 0x00ffff },
      blitzer:  { body: 0x1a3300, body2: 0x0d1a00, emissive: 0x88ff00, edge: 0x88ff00, barrel: 0x88ff00, glow: 0x88ff00 },
      bastion:  { body: 0x331100, body2: 0x1a0a00, emissive: 0xff5500, edge: 0xff6600, barrel: 0xff5500, glow: 0xff4400 },
      phantom:  { body: 0x1a0033, body2: 0x0d001a, emissive: 0xcc44ff, edge: 0xcc44ff, barrel: 0xcc44ff, glow: 0xaa33ee },
      ironclad: { body: 0x2a1a00, body2: 0x1a0f00, emissive: 0xffcc00, edge: 0xffcc00, barrel: 0xffcc00, glow: 0xffaa00 },
      reaper:   { body: 0x220011, body2: 0x110008, emissive: 0xdd0033, edge: 0xee0044, barrel: 0xff0033, glow: 0xcc0022 },
      viper:    { body: 0x002211, body2: 0x001108, emissive: 0x00ffaa, edge: 0x00ffaa, barrel: 0x00ffaa, glow: 0x00ddaa },
      specter:  { body: 0x001133, body2: 0x000d22, emissive: 0x4488ff, edge: 0x5599ff, barrel: 0x6699ff, glow: 0x3366ff },
      colossus: { body: 0x221500, body2: 0x150d00, emissive: 0xff9900, edge: 0xffaa00, barrel: 0xff9900, glow: 0xff8800 },
    };
    const c = PALETTES[this.hullType] ?? PALETTES.vanguard;
    const ht = this.hullType;

    // ── Hull dimensions — one lookup per hull type ────────────────────────────
    const HULL_DIMS = {
      vanguard: { hullW:1.40, hullH:0.90, hullL:2.0, tW:0.95, tH:0.38, tL:1.05, barrelR:0.090, barrelLen:1.1, wheelCount:5 },
      blitzer:  { hullW:1.20, hullH:0.70, hullL:2.2, tW:0.78, tH:0.30, tL:0.88, barrelR:0.090, barrelLen:1.1, wheelCount:5 },
      bastion:  { hullW:1.65, hullH:1.00, hullL:2.0, tW:1.10, tH:0.48, tL:1.15, barrelR:0.110, barrelLen:1.3, wheelCount:5 },
      phantom:  { hullW:1.05, hullH:0.55, hullL:2.5, tW:0.62, tH:0.22, tL:0.72, barrelR:0.065, barrelLen:1.4, wheelCount:6 },
      ironclad: { hullW:1.80, hullH:1.00, hullL:2.0, tW:1.35, tH:0.52, tL:1.10, barrelR:0.100, barrelLen:1.1, wheelCount:5 },
      reaper:   { hullW:1.00, hullH:0.68, hullL:3.0, tW:0.72, tH:0.28, tL:0.85, barrelR:0.075, barrelLen:2.2, wheelCount:7 },
      viper:    { hullW:1.50, hullH:0.88, hullL:2.1, tW:1.05, tH:0.42, tL:1.10, barrelR:0.095, barrelLen:1.2, wheelCount:5 },
      specter:  { hullW:1.15, hullH:0.62, hullL:2.3, tW:0.58, tH:0.24, tL:0.78, barrelR:0.070, barrelLen:1.2, wheelCount:6 },
      colossus: { hullW:2.00, hullH:1.10, hullL:2.3, tW:1.55, tH:0.62, tL:1.25, barrelR:0.135, barrelLen:1.5, wheelCount:6 },
    };
    const { hullW, hullH, hullL, tW, tH, tL, barrelR, barrelLen, wheelCount } = HULL_DIMS[ht] ?? HULL_DIMS.vanguard;

    const hullMat = new THREE.MeshStandardMaterial({
      color: c.body, emissive: c.emissive, emissiveIntensity: 0.15, roughness: 0.4, metalness: 0.8,
    });
    const hullGeo = new THREE.BoxGeometry(hullW, hullH, hullL);
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.castShadow = true;
    this.group.add(hull);

    const edgeMat = new THREE.LineBasicMaterial({ color: c.edge, opacity: 0.7, transparent: true });
    this.group.add(new THREE.LineSegments(new THREE.EdgesGeometry(hullGeo), edgeMat));

    // ── Road wheels — all hulls ───────────────────────────────────────────────
    const wGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.10, 7);
    wGeo.rotateZ(Math.PI / 2);
    const wMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0.4 });
    const wXOff = hullW / 2 + 0.06;
    [-wXOff, wXOff].forEach(xOff => {
      for (let i = 0; i < wheelCount; i++) {
        const w = new THREE.Mesh(wGeo, wMat);
        w.position.set(xOff, -hullH / 2 + 0.12, -hullL / 2 + 0.2 + i * ((hullL - 0.4) / (wheelCount - 1)));
        this.group.add(w);
      }
    });

    // ── Hull-specific decorations ─────────────────────────────────────────────
    if (ht === 'bastion' || ht === 'ironclad') {
      // Heavy side skirts
      [-hullW / 2 - 0.12, hullW / 2 + 0.12].forEach(xOff => {
        const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.22, hullH * 0.58, hullL + 0.1), hullMat.clone());
        skirt.position.set(xOff, -hullH * 0.18, 0);
        this.group.add(skirt);
      });
    }

    if (ht === 'blitzer') {
      // Rear spoiler fins — aerodynamic look
      [-0.48, 0.48].forEach(xOff => {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.35, 0.44), hullMat.clone());
        fin.position.set(xOff, hullH * 0.1, -hullL / 2 + 0.22);
        fin.rotation.z = xOff > 0 ? 0.2 : -0.2;
        this.group.add(fin);
      });
      // Low wedge front skid plate
      const skid = new THREE.Mesh(new THREE.BoxGeometry(hullW, 0.18, 0.48), hullMat.clone());
      skid.position.set(0, -hullH * 0.28, hullL / 2 - 0.24);
      skid.rotation.x = 0.5;
      this.group.add(skid);
    }

    if (ht === 'phantom') {
      // Swept-back stealth fins — wing-like sponsons
      [-0.62, 0.62].forEach(xOff => {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.07, 1.1), hullMat.clone());
        wing.position.set(xOff, 0, -0.2);
        wing.rotation.z = xOff > 0 ? 0.08 : -0.08;
        this.group.add(wing);
      });
    }

    if (ht === 'ironclad') {
      // Rear engine block — heavy and square
      const eng = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.58), hullMat.clone());
      eng.position.set(0, 0.24, -hullL / 2 + 0.29);
      this.group.add(eng);
      // Twin exhaust stacks
      [-0.38, 0.38].forEach(xOff => {
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.65, 6), hullMat.clone());
        stack.position.set(xOff, hullH / 2 + 0.33, -hullL / 2 + 0.38);
        this.group.add(stack);
      });
    }

    if (ht === 'reaper') {
      // Sloped casemate superstructure — tank-destroyer look
      const casemate = new THREE.Mesh(new THREE.BoxGeometry(hullW - 0.05, 0.3, hullL * 0.55), hullMat.clone());
      casemate.position.set(0, hullH * 0.5, 0.15);
      casemate.rotation.x = 0.07;
      this.group.add(casemate);
      // Side exhaust vents
      [-hullW / 2 + 0.05, hullW / 2 - 0.05].forEach(xOff => {
        const vent = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.52), hullMat.clone());
        vent.position.set(xOff, hullH * 0.3, -hullL / 2 + 0.38);
        this.group.add(vent);
      });
    }

    if (ht === 'viper') {
      // Double-layered skirts — aggressive armour plating
      [-hullW / 2 - 0.10, hullW / 2 + 0.10].forEach(xOff => {
        const skirt1 = new THREE.Mesh(new THREE.BoxGeometry(0.18, hullH * 0.50, hullL + 0.05), hullMat.clone());
        skirt1.position.set(xOff, -hullH * 0.22, 0);
        this.group.add(skirt1);
        const skirt2 = new THREE.Mesh(new THREE.BoxGeometry(0.10, hullH * 0.30, hullL * 0.70), hullMat.clone());
        skirt2.position.set(xOff + (xOff > 0 ? 0.14 : -0.14), -hullH * 0.28, 0);
        this.group.add(skirt2);
      });
      // Front chin fangs
      [-0.42, 0.42].forEach(xOff => {
        const fang = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.24, 0.32), hullMat.clone());
        fang.position.set(xOff, -hullH * 0.15, hullL / 2 + 0.05);
        fang.rotation.x = -0.3;
        this.group.add(fang);
      });
    }

    if (ht === 'specter') {
      // Angled stealth side panels — like a stealth aircraft's facets
      [-hullW / 2 - 0.06, hullW / 2 + 0.06].forEach(xOff => {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.14, hullH * 0.60, hullL * 0.72), hullMat.clone());
        panel.position.set(xOff, 0, 0.1);
        panel.rotation.z = xOff > 0 ? -0.25 : 0.25;
        this.group.add(panel);
      });
      // Glowing hull strip (emissive accent)
      const stripMat = new THREE.MeshStandardMaterial({ color: c.emissive, emissive: c.emissive, emissiveIntensity: 0.9, roughness: 0.2 });
      const strip = new THREE.Mesh(new THREE.BoxGeometry(hullW * 0.85, 0.055, hullL * 0.78), stripMat);
      strip.position.set(0, hullH / 2 + 0.01, 0.05);
      this.group.add(strip);
    }

    if (ht === 'colossus') {
      // Massive side armour plates
      [-hullW / 2 - 0.20, hullW / 2 + 0.20].forEach(xOff => {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.32, hullH * 0.80, hullL + 0.15), hullMat.clone());
        plate.position.set(xOff, -hullH * 0.08, 0);
        this.group.add(plate);
      });
      // Huge rear engine block
      const eng = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.68, 0.70), hullMat.clone());
      eng.position.set(0, 0.30, -hullL / 2 + 0.35);
      this.group.add(eng);
      // Triple exhaust stacks
      [-0.55, 0, 0.55].forEach(xOff => {
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.85, 6), hullMat.clone());
        stack.position.set(xOff, hullH / 2 + 0.46, -hullL / 2 + 0.42);
        this.group.add(stack);
      });
    }

    // Glacis plate — angled front armour (size scaled to hull width)
    const glacis = new THREE.Mesh(new THREE.BoxGeometry(hullW - 0.06, 0.38, 0.42), hullMat);
    glacis.position.set(0, hullH * 0.28, hullL / 2 - 0.1);
    glacis.rotation.x = -0.3;
    this.group.add(glacis);

    // Engine hatch — rear indicator light
    const hatchMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: c.emissive, emissiveIntensity: 1.0, roughness: 0.2, metalness: 0.5 });
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.12, 0.38), hatchMat);
    hatch.position.set(0, hullH / 2 + 0.06, -hullL / 2 + 0.22);
    this.group.add(hatch);

    // ── Turret ────────────────────────────────────────────────────────────────
    this.turret = new THREE.Group();
    this.turret.position.y = hullH / 2 + 0.3;
    this.group.add(this.turret);

    const turretMat = new THREE.MeshStandardMaterial({
      color: c.body2, emissive: c.emissive, emissiveIntensity: 0.2, roughness: 0.3, metalness: 0.9,
    });

    const tGeo = new THREE.BoxGeometry(tW, tH, tL);
    this.turret.add(new THREE.Mesh(tGeo, turretMat));

    // Mantlet
    const mantletW = ht === 'colossus' ? 0.85 : ht === 'ironclad' ? 0.65 : 0.5;
    const mantlet = new THREE.Mesh(new THREE.BoxGeometry(mantletW, tH + 0.08, 0.16), turretMat);
    mantlet.position.set(0, 0, tL / 2 + 0.04);
    this.turret.add(mantlet);

    // Commander's cupola — not on stealth/low-profile hulls
    const noCupola = ht === 'phantom' || ht === 'reaper' || ht === 'specter';
    if (!noCupola) {
      const cupola = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.2, 8), turretMat);
      cupola.position.set(-0.25, tH / 2 + 0.1, -0.12);
      this.turret.add(cupola);
    }

    // Stowage box on turret rear
    const stowMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8, metalness: 0.3 });
    const noStow = ht === 'phantom' || ht === 'reaper' || ht === 'specter';
    if (!noStow) {
      const stowBox = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.18, 0.32), stowMat);
      stowBox.position.set(0, tH * 0.4, -tL / 2 - 0.16);
      this.turret.add(stowBox);
    }

    // Reaper: tactical scope on turret left
    if (ht === 'reaper') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.50, 6), turretMat);
      scope.rotation.z = Math.PI / 2;
      scope.position.set(-tW / 2 - 0.02, 0.06, tL / 2 - 0.18);
      this.turret.add(scope);
    }

    // Bastion: extra armour blocks on turret sides
    if (ht === 'bastion') {
      [-tW / 2 - 0.08, tW / 2 + 0.08].forEach(xOff => {
        const block = new THREE.Mesh(new THREE.BoxGeometry(0.18, tH * 0.75, tL * 0.6), turretMat.clone());
        block.position.set(xOff, 0, 0);
        this.turret.add(block);
      });
    }

    // ── Barrel pivot ──────────────────────────────────────────────────────────
    this.barrelPivot = new THREE.Group();
    this.turret.add(this.barrelPivot);

    const barrelMat = new THREE.MeshStandardMaterial({ color: c.barrel, emissive: c.barrel, emissiveIntensity: 0.5 });

    this._barrelBaseZ = tL / 2 + barrelLen / 2 - 0.05;

    if (ht === 'ironclad' || ht === 'colossus') {
      // Twin side-by-side barrels
      const bThick = ht === 'colossus' ? 0.18 : 0.13;
      const bOffset = ht === 'colossus' ? 0.30 : 0.22;
      const bL = new THREE.Mesh(new THREE.BoxGeometry(bThick, bThick, barrelLen), barrelMat.clone());
      const bR = new THREE.Mesh(new THREE.BoxGeometry(bThick, bThick, barrelLen), barrelMat.clone());
      bL.position.set(-bOffset, 0, this._barrelBaseZ);
      bR.position.set( bOffset, 0, this._barrelBaseZ);
      this.barrelPivot.add(bL, bR);
      this.cannonBarrel  = bL;
      this._ironBarRight = bR;
    } else {
      const cannonGeo = new THREE.CylinderGeometry(barrelR, barrelR, barrelLen, 8);
      this.cannonBarrel = new THREE.Mesh(cannonGeo, barrelMat);
      this.cannonBarrel.rotation.x = Math.PI / 2;
      this.cannonBarrel.position.z = this._barrelBaseZ;
      this.barrelPivot.add(this.cannonBarrel);
    }

    // Coaxial MG — not on twin-barrel hulls
    if (ht !== 'ironclad' && ht !== 'colossus') {
      const mgBarrel = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.07, 0.85),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xaaffff, emissiveIntensity: 0.4 }),
      );
      mgBarrel.position.set(0.22, -0.04, tL / 2 + 0.28);
      this.barrelPivot.add(mgBarrel);
    }

    const glow = new THREE.PointLight(c.glow, 3, 5);
    glow.position.y = -0.5;
    this.group.add(glow);
  }

  applyBuff(key, mult, duration) {
    this._buffs[key] = { mult, timer: duration };
  }

  get activeBuffs() {
    return this._buffs;
  }

  update(
    delta,
    keys,
    aimTarget,
    mouseDown,
    rightMouseDown,
    bounds,
    freeLook = false,
    pitchDelta = 0,
  ) {
    if (!this.alive) return;

    // Tick down post-respawn invincibility
    if (this._invincTimer > 0) this._invincTimer -= delta;

    // Tick temporary buffs
    for (const key of Object.keys(this._buffs)) {
      this._buffs[key].timer -= delta;
      if (this._buffs[key].timer <= 0) delete this._buffs[key];
    }

    // Passive HP regen
    if (this.regenRate > 0 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.regenRate * delta);
    }

    // MG reload timer
    if (this.mgReloading) {
      this.mgReloadTimer -= delta;
      if (this.mgReloadTimer <= 0) {
        this.mgReloading = false;
        this.mgAmmo = this.mgMaxAmmo;
      }
    }

    // Tick down component damage debuffs
    for (const k of Object.keys(this._compDmg)) {
      if (this._compDmg[k] > 0) {
        this._compDmg[k] = Math.max(
          0,
          this._compDmg[k] - delta * this.repairRate,
        );
      }
    }

    const trackOut = this._compDmg.track > 0;
    const engineOut = this._compDmg.engine > 0;

    // Hull rotation (A/D) — blocked if track is out
    // Turret is counter-rotated to stay world-stable while hull turns
    if (!trackOut) {
      const prevYaw = this.group.rotation.y;
      if (keys["KeyA"] || keys["ArrowLeft"])
        this.group.rotation.y += TURN_SPEED * delta;
      if (keys["KeyD"] || keys["ArrowRight"])
        this.group.rotation.y -= TURN_SPEED * delta;
      this.turret.rotation.y -= this.group.rotation.y - prevYaw;
    }

    // Drive (W/S) — blocked if track out; halved if engine damaged
    const angle = this.group.rotation.y;
    const engMult = engineOut ? 0.38 : 1;
    const spd =
      BASE_SPEED * this.speedMult * (this._buffs.speed?.mult ?? 1) * engMult;
    const _px0 = this.group.position.x, _pz0 = this.group.position.z;
    if (!trackOut) {
      if (keys["KeyW"] || keys["ArrowUp"]) {
        this.group.position.x += Math.sin(angle) * spd * delta;
        this.group.position.z += Math.cos(angle) * spd * delta;
      }
      if (keys["KeyS"] || keys["ArrowDown"]) {
        this.group.position.x -= Math.sin(angle) * spd * 0.55 * delta;
        this.group.position.z -= Math.cos(angle) * spd * 0.55 * delta;
      }
    }
    // Velocity magnitude (units/sec) used for movement-spread penalty
    const _dx = this.group.position.x - _px0, _dz = this.group.position.z - _pz0;
    this._velMag = Math.sqrt(_dx * _dx + _dz * _dz) / Math.max(delta, 0.001);

    // Clamp to arena
    const p = this.group.position;
    const r = this.radius;
    p.x = Math.max(bounds.minX + r, Math.min(bounds.maxX - r, p.x));
    p.z = Math.max(bounds.minZ + r, Math.min(bounds.maxZ - r, p.z));

    // Barrel pitch from mouse Y (frozen during free-look)
    if (!freeLook) {
      this.barrelPitch = Math.max(
        -MIN_PITCH,
        Math.min(MAX_PITCH, this.barrelPitch + pitchDelta),
      );
      this.barrelPivot.rotation.x = -this.barrelPitch; // negative = barrel goes up
    }

    // Turret horizontal traverse toward aimTarget — locked if turret is damaged
    const turretOut = this._compDmg.turret > 0;
    let aimDelta = Math.PI;
    if (!turretOut && !freeLook && aimTarget) {
      const dir = new THREE.Vector3().subVectors(
        aimTarget,
        this.group.position,
      );
      dir.y = 0;
      if (dir.lengthSq() > 0.01) {
        const desiredLocal = Math.atan2(dir.x, dir.z) - this.group.rotation.y;
        let diff = desiredLocal - this.turret.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        const maxStep =
          TURRET_TRAVERSE *
          this.traverseMult *
          (this._buffs.traverse?.mult ?? 1) *
          delta;
        this.turret.rotation.y +=
          Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
        aimDelta = Math.abs(diff);
      }
    }

    // Track world-space turret angular velocity (for spread penalty)
    {
      const worldAngle = this.group.rotation.y + this.turret.rotation.y;
      let dAngle = worldAngle - this._prevTurretWorldAngle;
      if (dAngle > Math.PI) dAngle -= Math.PI * 2;
      if (dAngle < -Math.PI) dAngle += Math.PI * 2;
      this._turretVelMag = Math.abs(dAngle) / Math.max(delta, 0.001);
      this._prevTurretWorldAngle = worldAngle;
    }

    // Aim charge — builds when barrel is horizontally aligned with target
    if (aimDelta < AIM_LOCK_THRESH) {
      this.aimCharge = Math.min(1, this.aimCharge + delta * AIM_CHARGE_RATE * (this.aimChargeMult ?? 1));
    } else {
      this.aimCharge = Math.max(0, this.aimCharge - delta * AIM_DECAY_RATE);
    }

    // Cannon — left click, arcing, high damage
    this.shootCd -= delta;
    if (!freeLook && mouseDown && this.shootCd <= 0) {
      this._shoot();
      this.shootCd = SHOOT_CD * this.reloadMult * (this.lastStand && this.hp < this.maxHp * 0.3 ? 0.65 : 1);
    }

    // Barrel recoil decay — only moves cannon barrel, not MG
    this._recoilT = Math.max(0, this._recoilT - delta * 7);
    this.cannonBarrel.position.z = this._barrelBaseZ - 0.35 * this._recoilT;
    if (this._ironBarRight) this._ironBarRight.position.z = this.cannonBarrel.position.z;

    // R key — manual MG reload
    if (keys["KeyR"] && !this.mgReloading && this.mgAmmo < this.mgMaxAmmo) {
      this.mgReloading = true;
      this.mgReloadTimer = MG_RELOAD * (this.mgReloadMult ?? 1);
    }

    // Machine gun — right click, flat, low damage, limited ammo
    this.mgCd -= delta;
    if (
      !freeLook &&
      rightMouseDown &&
      !this.mgReloading &&
      this.mgAmmo > 0 &&
      this.mgCd <= 0
    ) {
      this._shootMG();
      this.mgAmmo--;
      this.mgCd = MG_CD;
      if (this.mgAmmo <= 0) {
        this.mgReloading = true;
        this.mgReloadTimer = MG_RELOAD * (this.mgReloadMult ?? 1);
      }
    }
  }

  _shoot() {
    const barrelAngle = this.group.rotation.y + this.turret.rotation.y;
    const pitch = this.barrelPitch;
    const cp = Math.cos(pitch),
      sp = Math.sin(pitch);

    // Base direction includes pitch (3D direction)
    const baseDir = new THREE.Vector3(
      Math.sin(barrelAngle) * cp,
      sp,
      Math.cos(barrelAngle) * cp,
    );

    // Movement accuracy penalty: moving at full speed adds significant spread.
    // Upgrade (movementSpreadMult) scales this down toward 0.
    const moveNorm = Math.min(1, this._velMag / BASE_SPEED);
    const movePenalty = 0.5 * moveNorm * this.movementSpreadMult;
    const turretNorm = Math.min(1, this._turretVelMag / TURRET_TRAVERSE);
    const turretPenalty = 0.32 * turretNorm * this.movementSpreadMult;
    const spread = MAX_SPREAD * (1 - this.aimCharge) + movePenalty + turretPenalty;
    const speed = BULLET_SPEED * this.bulletSpeedMult;
    const totalDmgMult = this.damageMult * (this._buffs.damage?.mult ?? 1);
    const dmg = Math.round(BASE_DAMAGE * totalDmgMult);

    // Shell colour: warm orange (slow) → white → cool blue (fast)
    const ct = Math.min(1, (this.bulletSpeedMult - 1.0) / 1.5);
    let shellR, shellG, shellB;
    if (ct < 0.5) {
      const tt = ct * 2;
      shellR = 255;
      shellG = Math.round(120 + 135 * tt);
      shellB = Math.round(30 + 225 * tt);
    } else {
      const tt = (ct - 0.5) * 2;
      shellR = Math.round(255 - 155 * tt);
      shellG = Math.round(255 - 75 * tt);
      shellB = 255;
    }
    const shellColor = (shellR << 16) | (shellG << 8) | shellB;

    // Shell size: larger with higher damage multiplier
    const visualScale = Math.min(2.0, 0.7 + totalDmgMult * 0.3);

    for (let i = 0; i < this.multiShot; i++) {
      const dir = baseDir.clone();
      dir.x += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();

      const spawnPos = this.group.position.clone().addScaledVector(dir, 1.5);
      spawnPos.y = this.group.position.y + 0.75; // barrel height above terrain
      this.projectiles.push(
        new Projectile(
          this.scene,
          spawnPos,
          dir,
          speed,
          dmg,
          true,
          shellColor,
          undefined,
          false,
          visualScale,
        ),
      );
    }

    this._recoilT = 1.0;
    this._muzzleFlash(shellColor);
    audio.playCannon();
    this.shotsFired++;
    this._totalAimChargeOnFire += this.aimCharge;
    this.aimCharge *= POST_FIRE_CHARGE;
  }

  _shootMG() {
    const barrelAngle = this.group.rotation.y + this.turret.rotation.y;
    const pitch = this.barrelPitch;
    const cp = Math.cos(pitch),
      sp = Math.sin(pitch);
    const dir = new THREE.Vector3(
      Math.sin(barrelAngle) * cp,
      sp,
      Math.cos(barrelAngle) * cp,
    );
    const moveNorm = Math.min(1, this._velMag / BASE_SPEED);
    const turretNorm = Math.min(1, this._turretVelMag / TURRET_TRAVERSE);
    const spread = MG_SPREAD * (this.mgSpreadMult ?? 1)
      + 0.25 * moveNorm * this.movementSpreadMult
      + 0.18 * turretNorm * this.movementSpreadMult;
    dir.x += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    // Spawn at MG barrel tip (offset right of main barrel)
    const spawnPos = this.group.position.clone();
    spawnPos.y = this.group.position.y + 0.65;
    spawnPos.x += Math.sin(barrelAngle) * 1.2 + Math.cos(barrelAngle) * 0.22;
    spawnPos.z += Math.cos(barrelAngle) * 1.2 - Math.sin(barrelAngle) * 0.22;

    const dmg = Math.round(MG_DAMAGE * (this.mgDamageMult ?? 1));
    this._muzzleFlash(0xffee44);
    audio.playMG();
    // hasGravity=false, isMG=true — flat tracer visual
    this.projectiles.push(
      new Projectile(
        this.scene,
        spawnPos,
        dir,
        MG_BULLET_SPEED,
        dmg,
        true,
        0xffee44,
        false,
        true,
      ),
    );
  }

  _muzzleFlash(color = 0xffffff) {
    const barrelAngle = this.group.rotation.y + this.turret.rotation.y;
    const pitch = this.barrelPitch;
    const dist = 1.9;
    const pos = this.group.position.clone();
    pos.x += Math.sin(barrelAngle) * Math.cos(pitch) * dist;
    pos.y += 0.7 + Math.sin(pitch) * dist;
    pos.z += Math.cos(barrelAngle) * Math.cos(pitch) * dist;
    const flash = new THREE.PointLight(color, 18, 7);
    flash.position.copy(pos);
    this.scene.add(flash);
    setTimeout(() => this.scene.remove(flash), 55);
  }

  takeDamage(amount) {
    const lastStandMult = (this.lastStand && this.hp < this.maxHp * 0.3) ? 0.65 : 1;
    const reduced = Math.max(
      1,
      Math.round(amount * this.armorMult * (this._buffs.armor?.mult ?? 1) * lastStandMult),
    );
    this.hp = Math.max(0, this.hp - reduced);

    // 18% chance of component damage per hit (harder hits slightly more likely)
    if (reduced >= 4 && Math.random() < 0.18) {
      const roll = Math.random();
      let comp, dur;
      if (roll < 0.38) {
        comp = "track";
        dur = 4.2;
      } else if (roll < 0.72) {
        comp = "engine";
        dur = 5.8 + Math.random() * 3;
      } else {
        comp = "turret";
        dur = 3.8;
      }
      // Only apply if the component isn't already damaged (avoid stacking)
      if (this._compDmg[comp] <= 0) {
        this._compDmg[comp] = dur;
        audio.playComponentHit();
        this._compCb?.(comp, dur);
      }
    }
    if (this.hp <= 0) {
      if (this.lives > 0) {
        this.lives--;
        this.hp = Math.ceil(this.maxHp * 0.4);
        this._justRespawned = true;
        this._invincTimer = 2.5; // 2.5s invincibility after reserve hull activates
        this.mgAmmo = this.mgMaxAmmo;
        this.mgReloading = false;
      } else {
        this.alive = false;
      }
    }
  }

  recordHit() {
    this.shotsHit++;
  }

  get avgAimCharge() {
    return this.shotsFired > 0
      ? this._totalAimChargeOnFire / this.shotsFired
      : 0.5;
  }

  get barrelWorldAngle() {
    return this.group.rotation.y + this.turret.rotation.y;
  }
  get bulletSpeed() {
    return BULLET_SPEED * this.bulletSpeedMult;
  }

  resetWaveStats() {
    this.shotsFired = 0;
    this.shotsHit = 0;
    this._totalAimChargeOnFire = 0;
  }

  get position() {
    return this.group.position;
  }

  triggerReload() {
    if (!this.mgReloading && this.mgAmmo < this.mgMaxAmmo) {
      this.mgReloading = true;
      this.mgReloadTimer = MG_RELOAD * (this.mgReloadMult ?? 1);
    }
  }
}
