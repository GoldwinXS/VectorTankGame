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
    this._recoilT = 0; // barrel recoil animation (0–1, decays to 0)

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
      vanguard: {
        body: 0x003344,
        body2: 0x002233,
        emissive: 0x00ffff,
        edge: 0x00ffff,
        barrel: 0x00ffff,
        glow: 0x00ffff,
      },
      blitzer: {
        body: 0x1a3300,
        body2: 0x0d1a00,
        emissive: 0x88ff00,
        edge: 0x88ff00,
        barrel: 0x88ff00,
        glow: 0x88ff00,
      },
      bastion: {
        body: 0x331100,
        body2: 0x1a0a00,
        emissive: 0xff5500,
        edge: 0xff6600,
        barrel: 0xff5500,
        glow: 0xff4400,
      },
    };
    const c = PALETTES[this.hullType] ?? PALETTES.vanguard;

    const hullMat = new THREE.MeshStandardMaterial({
      color: c.body,
      emissive: c.emissive,
      emissiveIntensity: 0.15,
      roughness: 0.4,
      metalness: 0.8,
    });
    const hullGeo = new THREE.BoxGeometry(1.4, 0.9, 2.0);
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.castShadow = true;
    this.group.add(hull);

    const edgeMat = new THREE.LineBasicMaterial({
      color: c.edge,
      opacity: 0.7,
      transparent: true,
    });
    this.group.add(
      new THREE.LineSegments(new THREE.EdgesGeometry(hullGeo), edgeMat),
    );

    // Glacis plate — angled front armour
    const glacis = new THREE.Mesh(
      new THREE.BoxGeometry(1.35, 0.38, 0.42),
      hullMat,
    );
    glacis.position.set(0, 0.25, 0.9);
    glacis.rotation.x = -0.3;
    this.group.add(glacis);

    // Engine hatch — rear indicator
    const hatchMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x88ffff,
      emissiveIntensity: 1.0,
      roughness: 0.2,
      metalness: 0.5,
    });
    const hatch = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.12, 0.42),
      hatchMat,
    );
    hatch.position.set(0, 0.56, -0.5);
    this.group.add(hatch);

    this.turret = new THREE.Group();
    this.turret.position.y = 0.75;
    this.group.add(this.turret);

    const turretMat = new THREE.MeshStandardMaterial({
      color: c.body2,
      emissive: c.emissive,
      emissiveIntensity: 0.2,
      roughness: 0.3,
      metalness: 0.9,
    });
    this.turret.add(
      new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.38, 1.05), turretMat),
    );

    // Mantlet (gun shield on turret front)
    const mantlet = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.3, 0.16),
      turretMat,
    );
    mantlet.position.set(0, 0, 0.58);
    this.turret.add(mantlet);

    // Commander's cupola (small hatch on turret top-left)
    const cupola = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.19, 0.2, 8),
      turretMat,
    );
    cupola.position.set(-0.25, 0.28, -0.12);
    this.turret.add(cupola);

    // Stowage box on turret rear
    const stowMat = new THREE.MeshStandardMaterial({
      color: 0x002233,
      roughness: 0.8,
      metalness: 0.3,
    });
    const stowBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 0.18, 0.32),
      stowMat,
    );
    stowBox.position.set(0, 0.2, -0.58);
    this.turret.add(stowBox);

    // Barrel pivot — child of turret, rotates on X for elevation
    this.barrelPivot = new THREE.Group();
    this.turret.add(this.barrelPivot);

    // Cannon barrel — cylinder aligned along Z for recoil animation
    const cannonGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.1, 8);
    this.cannonBarrel = new THREE.Mesh(
      cannonGeo,
      new THREE.MeshStandardMaterial({
        color: c.barrel,
        emissive: c.barrel,
        emissiveIntensity: 0.5,
      }),
    );
    this.cannonBarrel.rotation.x = Math.PI / 2; // align cylinder along Z axis
    this.cannonBarrel.position.z = 0.9;
    this.barrelPivot.add(this.cannonBarrel);

    // Coaxial MG barrel — thin, offset to the right of main barrel
    const mgBarrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.07, 0.85),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xaaffff,
        emissiveIntensity: 0.4,
      }),
    );
    mgBarrel.position.set(0.22, -0.04, 0.72);
    this.barrelPivot.add(mgBarrel);

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

    // Aim charge — builds when barrel is horizontally aligned with target
    if (aimDelta < AIM_LOCK_THRESH) {
      this.aimCharge = Math.min(1, this.aimCharge + delta * AIM_CHARGE_RATE);
    } else {
      this.aimCharge = Math.max(0, this.aimCharge - delta * AIM_DECAY_RATE);
    }

    // Cannon — left click, arcing, high damage
    this.shootCd -= delta;
    if (!freeLook && mouseDown && this.shootCd <= 0) {
      this._shoot();
      this.shootCd = SHOOT_CD * this.reloadMult;
    }

    // Barrel recoil decay — only moves cannon barrel, not MG
    this._recoilT = Math.max(0, this._recoilT - delta * 7);
    this.cannonBarrel.position.z = 0.9 - 0.35 * this._recoilT;

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

    const spread = MAX_SPREAD * (1 - this.aimCharge);
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
    const spread = MG_SPREAD * (this.mgSpreadMult ?? 1);
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
    const reduced = Math.max(
      1,
      Math.round(amount * this.armorMult * (this._buffs.armor?.mult ?? 1)),
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
}
