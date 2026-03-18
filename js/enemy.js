import * as THREE from "three";
import { Projectile } from "./projectile.js";

export const TYPES = {
  fast: {
    color: 0x00ff88,
    emissive: 0x00ff88,
    scale: 0.75,
    speed: 1.5,
    hp: 40,
    damage: 12,
    shootRange: 30,
    shootCd: 1.6,
    bulletSpeed: 16,
    preferDist: 10,
    traverseSpeed: 2.5,
    baseSpread: 0.22,
  },
  tanky: {
    color: 0xff3300,
    emissive: 0xff2200,
    scale: 1.3,
    speed: 1.8,
    hp: 160,
    damage: 30,
    shootRange: 40,
    shootCd: 3.0,
    bulletSpeed: 10,
    preferDist: 15,
    traverseSpeed: 0.7,
    baseSpread: 0.1,
  },
  swarm: {
    color: 0xff00ff,
    emissive: 0xcc00cc,
    scale: 0.5,
    speed: 1.5,
    hp: 18,
    damage: 8,
    shootRange: 20,
    shootCd: 1.8,
    bulletSpeed: 17,
    preferDist: 7,
    traverseSpeed: 3.5,
    baseSpread: 0.28,
  },
  boss: {
    color: 0xff5500,
    emissive: 0xff3300,
    scale: 2.8,
    speed: 1.4,
    hp: 600,
    damage: 50,
    shootRange: 50,
    shootCd: 1.8,
    bulletSpeed: 11,
    preferDist: 18,
    traverseSpeed: 0.9,
    baseSpread: 0.05,
  },
  gunner: {
    color: 0x88ff00,
    emissive: 0x44bb00,
    scale: 0.9,
    speed: 1.4,
    hp: 55,
    damage: 6,
    shootRange: 30,
    shootCd: 0.1,
    bulletSpeed: 24,
    preferDist: 16,
    traverseSpeed: 2.2,
    baseSpread: 0.12,
    isMG: true,
  },
  // Light scout — MG only, very fast, fragile
  scout: {
    color: 0x44ffaa,
    emissive: 0x22cc77,
    scale: 0.6,
    speed: 2.5,
    hp: 22,
    damage: 3,
    shootRange: 22,
    shootCd: 0.12,
    bulletSpeed: 26,
    preferDist: 10,
    traverseSpeed: 3.5,
    baseSpread: 0.20,
    isMG: true,
  },
  // Tank destroyer — hull-aims, fixed gun, high damage, long range
  stug: {
    color: 0xaa8855,
    emissive: 0x775533,
    scale: 1.1,
    speed: 1.0,
    hp: 130,
    damage: 45,
    shootRange: 45,
    shootCd: 3.2,
    bulletSpeed: 28,
    preferDist: 28,
    traverseSpeed: 0,
    turnSpeed: 0.65,
    baseSpread: 0.04,
  },
};

const PLAYER_RADIUS = 1.0;
const AIM_CHARGE_RATE = 0.45; // slightly slower than player
const AIM_DECAY_RATE = 1.5;
const AIM_LOCK_THRESH = 0.12; // rad

export class Enemy {
  constructor(scene, projectiles, type, spawnPos, difficulty = 1) {
    this.scene = scene;
    this.projectiles = projectiles;
    this.type = type;
    this.def = TYPES[type];
    this.hp     = Math.round(this.def.hp * difficulty);
    // Damage also scales — slowly at first, meaningfully at high waves
    this.damage = Math.round(this.def.damage * (0.7 + difficulty * 0.3));
    this.alive  = true;
    this.shootTimer = Math.random() * this.def.shootCd;
    this.isBoss = type === "boss";
    this.radius = this.def.scale * (this.isBoss ? 1.4 : 0.9);

    this.aimCharge = 0;
    this._aimDelta = Math.PI;

    this._tactic = "RUSH";
    this._encircleAngle = 0;
    this._encircleElapsed = 0;
    this._strafeDir = Math.random() > 0.5 ? 1 : -1;
    this._jitterTimer = 0;
    this.fixedGun = (type === 'stug'); // hull-aims instead of turret

    // Burst fire for MG enemies — fire N rounds then pause for reload
    if (this.def.isMG) {
      this._burstMax      = this.type === 'scout' ? 10 : 16;
      this._burstLeft     = this._burstMax;
      this._burstCooldown = 0;
    }

    this._buildMesh();
    this.group.position.set(spawnPos.x, 0, spawnPos.z);
    scene.add(this.group);
  }

  setTactic(tactic, formationData = {}) {
    this._tactic = tactic;
    this._encircleAngle = formationData.angle ?? Math.random() * Math.PI * 2;
    this._encircleElapsed = 0;
  }

  _buildMesh() {
    if (this.type === 'stug') { this._buildStugMesh(); return; }
    this.group = new THREE.Group();
    this.group.scale.setScalar(this.def.scale);

    const hullMat = new THREE.MeshStandardMaterial({
      color: this.def.color,
      emissive: this.def.emissive,
      emissiveIntensity: 0.15,
      roughness: 0.4,
      metalness: 0.7,
    });
    const hullGeo = new THREE.BoxGeometry(1.4, 0.9, 2.0);
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.castShadow = true;
    this.group.add(hull);
    this.group.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(hullGeo),
        new THREE.LineBasicMaterial({
          color: this.def.color,
          opacity: 0.7,
          transparent: true,
        }),
      ),
    );

    this.turretGroup = new THREE.Group();
    this.turretGroup.position.y = 0.65;
    this.group.add(this.turretGroup);

    const turretMat = new THREE.MeshStandardMaterial({
      color: this.def.color,
      emissive: this.def.emissive,
      emissiveIntensity: 0.25,
      roughness: 0.3,
      metalness: 0.85,
    });
    this.turretGroup.add(
      new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.4, 0.85), turretMat),
    );

    const barrelMat = new THREE.MeshStandardMaterial({
      color: this.def.color,
      emissive: this.def.emissive,
      emissiveIntensity: 0.6,
    });
    const barrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, 1.1),
      barrelMat,
    );
    barrel.position.z = 0.75;
    this.turretGroup.add(barrel);

    const glow = new THREE.PointLight(this.def.color, 2.5, 4);
    glow.position.y = 0.5;
    this.group.add(glow);

    if (this.isBoss) this._buildBossExtras();
  }

  _buildStugMesh() {
    this.group = new THREE.Group();
    this.group.scale.setScalar(this.def.scale);

    const mat = new THREE.MeshStandardMaterial({
      color: this.def.color, emissive: this.def.emissive,
      emissiveIntensity: 0.15, roughness: 0.5, metalness: 0.65,
    });
    const edgeMat = new THREE.LineBasicMaterial({ color: this.def.color, opacity: 0.6, transparent: true });

    // Wide low hull
    const hullGeo = new THREE.BoxGeometry(1.6, 0.65, 2.4);
    this.group.add(new THREE.Mesh(hullGeo, mat));
    this.group.add(new THREE.LineSegments(new THREE.EdgesGeometry(hullGeo), edgeMat));

    // Casemate / superstructure
    const caseGeo = new THREE.BoxGeometry(1.35, 0.55, 1.9);
    const caseM = new THREE.Mesh(caseGeo, mat);
    caseM.position.set(0, 0.6, 0.15);
    this.group.add(caseM);
    const caseEdge = new THREE.LineSegments(new THREE.EdgesGeometry(caseGeo), edgeMat.clone());
    caseEdge.position.copy(caseM.position);
    this.group.add(caseEdge);

    // Long fixed barrel from casemate front
    const barrelMat = new THREE.MeshStandardMaterial({ color: this.def.color, emissive: this.def.emissive, emissiveIntensity: 0.55 });
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2.1), barrelMat);
    barrel.position.set(0, 0.6, 1.5);
    this.group.add(barrel);

    // Track sponsons
    [-0.9, 0.9].forEach(xOff => {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 2.5), mat);
      sp.position.set(xOff, -0.26, 0);
      this.group.add(sp);
    });

    // Fixed turret group — rotation always stays 0, hull aims instead
    this.turretGroup = new THREE.Group();
    this.group.add(this.turretGroup);

    const glow = new THREE.PointLight(this.def.color, 2.5, 4);
    glow.position.y = 0.5;
    this.group.add(glow);
  }

  _buildBossExtras() {
    // Boss gets a distinctive ground ring indicator and extra glow
    if (this.isBoss) {
      const ringPts = [];
      for (let i = 0; i <= 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        ringPts.push(
          new THREE.Vector3(Math.cos(a) * 1.8, -0.44, Math.sin(a) * 1.8),
        );
      }
      const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
      this.group.add(
        new THREE.Line(
          ringGeo,
          new THREE.LineBasicMaterial({
            color: 0xff4400,
            opacity: 0.9,
            transparent: true,
          }),
        ),
      );

      const bossGlow = new THREE.PointLight(0xff4400, 4, 8);
      bossGlow.position.y = 1;
      this.group.add(bossGlow);
    }
  }

  update(delta, playerPos, enemies, bounds) {
    if (!this.alive) return;

    const toPlayer = new THREE.Vector3().subVectors(
      playerPos,
      this.group.position,
    );
    toPlayer.y = 0;
    const dist = toPlayer.length();
    const dir =
      dist > 0.01 ? toPlayer.clone().normalize() : new THREE.Vector3(1, 0, 0);

    // Turret traverses toward player (skipped for stug — hull aims instead)
    if (!this.fixedGun && dist > 0.1) {
      const worldToPlayer = Math.atan2(toPlayer.x, toPlayer.z);
      const desiredLocal = worldToPlayer - this.group.rotation.y;
      let diff = desiredLocal - this.turretGroup.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      const maxStep = this.def.traverseSpeed * delta;
      this.turretGroup.rotation.y +=
        Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
      this._aimDelta = Math.abs(diff);
    }

    // Stug: rotate entire hull toward player for aiming
    if (this.fixedGun && dist > 0.1) {
      const desired = Math.atan2(toPlayer.x, toPlayer.z);
      let diff = desired - this.group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turnRate = this.def.turnSpeed ?? 0.65;
      this.group.rotation.y += Math.sign(diff) * Math.min(Math.abs(diff), turnRate * delta);
      this.turretGroup.rotation.y = 0;
      this._aimDelta = Math.abs(diff);
    }

    // Aim charge — builds when barrel is aligned, decays when swinging
    if (this._aimDelta < AIM_LOCK_THRESH) {
      this.aimCharge = Math.min(1, this.aimCharge + delta * AIM_CHARGE_RATE);
    } else {
      this.aimCharge = Math.max(0, this.aimCharge - delta * AIM_DECAY_RATE);
    }

    // ── Tactic movement ──────────────────────────────────────────────────────
    let shootCdMult = 1.0;
    const minSep = this.radius + PLAYER_RADIUS + 0.3;
    const prevPos = this.group.position.clone();

    if (this._tactic === "RUSH") {
      if (dist > minSep) {
        this.group.position.addScaledVector(dir, this.def.speed * 1.3 * delta);
      }
    } else if (this._tactic === "SUPPRESS") {
      const hold = this.def.shootRange - 2;
      if (dist > hold + 1)
        this.group.position.addScaledVector(dir, this.def.speed * 0.7 * delta);
      else if (dist < hold - 1)
        this.group.position.addScaledVector(dir, -this.def.speed * 0.5 * delta);
      shootCdMult = 0.55;
    } else if (this._tactic === "ENCIRCLE") {
      this._encircleElapsed += delta;
      const radius = Math.max(6, 22 - this._encircleElapsed * 0.65);
      const tx = playerPos.x + Math.cos(this._encircleAngle) * radius;
      const tz = playerPos.z + Math.sin(this._encircleAngle) * radius;
      const toSlot = new THREE.Vector3(
        tx - this.group.position.x,
        0,
        tz - this.group.position.z,
      );
      if (toSlot.lengthSq() > 0.01) {
        this.group.position.addScaledVector(
          toSlot.normalize(),
          this.def.speed * 0.85 * delta,
        );
      }
    } else {
      // FLANK
      const pref = this.def.preferDist;
      if (dist > pref + 1.5) {
        let moveDir = dir.clone();
        if (this.type === "fast") {
          this._jitterTimer -= delta;
          if (this._jitterTimer <= 0) {
            this._strafeDir *= -1;
            this._jitterTimer = 0.8 + Math.random() * 0.8;
          }
          moveDir
            .addScaledVector(
              new THREE.Vector3(-dir.z, 0, dir.x),
              this._strafeDir * 0.5,
            )
            .normalize();
        }
        this.group.position.addScaledVector(moveDir, this.def.speed * delta);
      } else if (dist < pref - 2) {
        this.group.position.addScaledVector(dir, -this.def.speed * 0.4 * delta);
      } else if (this.type === "fast") {
        this._jitterTimer -= delta;
        if (this._jitterTimer <= 0) {
          this._strafeDir *= -1;
          this._jitterTimer = 0.8 + Math.random() * 0.8;
        }
        this.group.position.addScaledVector(
          new THREE.Vector3(-dir.z, 0, dir.x),
          this.def.speed * this._strafeDir * delta,
        );
      }
    }

    // Hull faces movement direction (stug hull is controlled by aim logic above)
    const moved = this.group.position.clone().sub(prevPos);
    moved.y = 0;
    if (!this.fixedGun && moved.lengthSq() > 0.0001) {
      this.group.rotation.y = Math.atan2(moved.x, moved.z);
    }

    // Stug: maintain standoff distance while hull-facing player
    if (this.fixedGun) {
      const pref = this.def.preferDist;
      if (dist > pref + 2)      this.group.position.addScaledVector(dir, this.def.speed * delta);
      else if (dist < pref - 2) this.group.position.addScaledVector(dir, -this.def.speed * 0.6 * delta);
    }

    // Hard min separation from player
    {
      const dx = this.group.position.x - playerPos.x;
      const dz = this.group.position.z - playerPos.z;
      const d2 = Math.sqrt(dx * dx + dz * dz);
      if (d2 < minSep && d2 > 0.001) {
        this.group.position.x = playerPos.x + (dx / d2) * minSep;
        this.group.position.z = playerPos.z + (dz / d2) * minSep;
      }
    }

    // Enemy separation
    for (const other of enemies) {
      if (other === this || !other.alive) continue;
      const away = new THREE.Vector3().subVectors(
        this.group.position,
        other.group.position,
      );
      away.y = 0;
      const d = away.length();
      const minD = (this.radius + other.radius) * 1.4;
      if (d < minD && d > 0.001)
        this.group.position.addScaledVector(away.normalize(), (minD - d) * 0.5);
    }

    // Clamp
    const pos = this.group.position;
    pos.x = Math.max(bounds.minX - 4, Math.min(bounds.maxX + 4, pos.x));
    pos.z = Math.max(bounds.minZ - 4, Math.min(bounds.maxZ + 4, pos.z));

    // Shoot — MG types use burst-fire with reload gap to limit projectile count
    this.shootTimer -= delta;
    if (this.def.isMG) {
      if (this._burstCooldown > 0) {
        this._burstCooldown -= delta;
      } else if (this.shootTimer <= 0 && dist <= this.def.shootRange) {
        this._shoot();
        this.shootTimer = this.def.shootCd * shootCdMult;
        this._burstLeft--;
        if (this._burstLeft <= 0) {
          const reloadTime = this.type === 'scout' ? 2.0 : 2.5;
          this._burstCooldown = reloadTime;
          this._burstLeft = this._burstMax;
        }
      }
    } else if (this.shootTimer <= 0 && dist <= this.def.shootRange) {
      this._shoot();
      this.shootTimer = this.def.shootCd * shootCdMult;
    }
  }

  _shoot() {
    const turretWorldAngle =
      this.group.rotation.y + this.turretGroup.rotation.y;
    const dir = new THREE.Vector3(
      Math.sin(turretWorldAngle),
      0,
      Math.cos(turretWorldAngle),
    );

    // Spread shrinks as aim charge builds (75% reduction at full charge)
    const spread = this.def.baseSpread * (1 - this.aimCharge * 0.75);
    dir.x += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    const barrelZ = this.type === 'stug' ? 2.4 : 1.5;
    const barrelLocal = new THREE.Vector3(0, 0.65, barrelZ);
    this.group.localToWorld(barrelLocal);
    barrelLocal.y = this.group.position.y + (this.type === 'stug' ? 0.6 * this.def.scale : 0.45);

    const proj = new Projectile(
      this.scene,
      barrelLocal,
      dir,
      this.def.bulletSpeed,
      this.damage,
      false,
      this.def.color,
      undefined,
      this.def.isMG ?? false,
    );
    proj._enemyType = this.type;
    this.projectiles.push(proj);
  }

  takeDamage(amount) {
    this.hp -= amount;
    if (this.hp <= 0) {
      this.alive = false;
      this._die();
    }
    return this.hp <= 0;
  }

  _die() {
    this.group.children.forEach((c) => {
      if (c.material?.emissive) {
        c.material.emissive.setHex(0xffffff);
        c.material.emissiveIntensity = 1;
      }
    });
    setTimeout(() => this.group.parent?.remove(this.group), 150);
  }

  get position() {
    return this.group.position;
  }
}
