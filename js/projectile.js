import * as THREE from "three";
import { terrainH } from "./scene.js";

const CANNON_GEO = new THREE.SphereGeometry(0.18, 6, 6);
const MG_GEO     = new THREE.BoxGeometry(0.05, 0.05, 0.3);
const KILL_RANGE = 70;

export const GRAVITY = 4.5;

export class Projectile {
  // isMG (9th param): uses elongated tracer geometry + spark-only impact
  constructor(scene, pos, dir, speed, damage, isPlayer, typeColor, hasGravity, isMG = false) {
    this.scene    = scene;
    this.damage   = damage;
    this.isPlayer = isPlayer;
    this.isMG     = isMG;
    this.radius   = isMG ? 0.07 : 0.1;
    this.alive    = true;
    this.hasGravity = hasGravity !== undefined ? hasGravity : isPlayer;

    const color = isPlayer ? (isMG ? 0xffee44 : 0xffffff) : typeColor;
    this.mesh = new THREE.Mesh(
      isMG ? MG_GEO : CANNON_GEO,
      new THREE.MeshBasicMaterial({ color })
    );
    this.mesh.position.copy(pos);

    if (isMG) {
      // Orient elongated tracer box along direction of travel
      this.mesh.lookAt(pos.clone().add(dir));
    }

    // Only cannon shells carry an in-flight point light.
    // MG tracers (too many active at once) rely solely on impact flashes.
    if (!isMG) {
      const light = new THREE.PointLight(color, 2, 4);
      this.mesh.add(light);
    }

    this.vel = dir.clone().multiplyScalar(speed);
    scene.add(this.mesh);
  }

  update(delta) {
    if (this.hasGravity) this.vel.y -= GRAVITY * delta;
    this.mesh.position.addScaledVector(this.vel, delta);
    const p = this.mesh.position;
    if (p.y < terrainH(p.x, p.z)) {
      this.destroy();
      return;
    }
    if (Math.abs(p.x) > KILL_RANGE || Math.abs(p.z) > KILL_RANGE)
      this.destroy(false); // silent — off-screen
  }

  // boom=false for silent out-of-range removal
  destroy(boom = true) {
    if (!this.alive) return;
    this.alive = false;
    const pos = this.mesh.position.clone();
    this.mesh.parent?.remove(this.mesh);
    if (boom) this._boom(pos);
  }

  _boom(pos) {
    const col       = this.isPlayer ? (this.isMG ? 0xffcc44 : 0xffffff) : 0xff5511;
    const intensity = this.isMG ? 5 : 14;
    const range     = this.isMG ? 4  : 10;

    const light = new THREE.PointLight(col, intensity, range);
    light.position.copy(pos);
    this.scene.add(light);

    if (this.isMG) {
      // Spark flash — just fade the light quickly
      let f = intensity;
      const iv = setInterval(() => {
        f *= 0.55;
        light.intensity = f;
        if (f < 0.15) { clearInterval(iv); this.scene.remove(light); }
      }, 16);
      return;
    }

    // Shell impact: expanding ground ring + debris sparks
    const rGeo = new THREE.RingGeometry(0.05, 0.3, 10);
    rGeo.rotateX(-Math.PI / 2);
    const rMat = new THREE.MeshBasicMaterial({
      color: 0xff8833, transparent: true, opacity: 0.92, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(rGeo, rMat);
    ring.position.copy(pos);
    this.scene.add(ring);

    const sparks = [];
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0xffdd00, transparent: true }),
      );
      sp.position.copy(pos);
      sp._v = new THREE.Vector3(
        (Math.random() - 0.5) * 7,
        Math.random() * 5 + 2,
        (Math.random() - 0.5) * 7,
      );
      this.scene.add(sp);
      sparks.push(sp);
    }

    let t = 0;
    const iv = setInterval(() => {
      t += 18;
      const pct = Math.min(t / 400, 1);
      ring.scale.setScalar(1 + pct * 5);
      rMat.opacity = 0.92 * (1 - pct);
      light.intensity = intensity * Math.max(0, 1 - pct * 1.8);
      for (const sp of sparks) {
        sp.position.addScaledVector(sp._v, 0.018);
        sp._v.y -= 9 * 0.018;
        sp.material.opacity = 1 - pct;
      }
      if (pct >= 1) {
        clearInterval(iv);
        this.scene.remove(ring);
        this.scene.remove(light);
        rGeo.dispose(); rMat.dispose();
        for (const sp of sparks) {
          this.scene.remove(sp);
          sp.geometry.dispose();
          sp.material.dispose();
        }
      }
    }, 18);
  }
}
