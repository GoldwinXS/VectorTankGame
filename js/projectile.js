import * as THREE from "three";
import { terrainH } from "./scene.js";

const GEO = new THREE.SphereGeometry(0.18, 6, 6);
const KILL_RANGE = 70;

export const GRAVITY = 4.5; // m/s² — gentle ballistic arc for player shells

export class Projectile {
  constructor(scene, pos, dir, speed, damage, isPlayer, typeColor, hasGravity) {
    this.damage = damage;
    this.isPlayer = isPlayer;
    this.radius = 0.1;
    this.alive = true;
    this.hasGravity = hasGravity !== undefined ? hasGravity : isPlayer;

    const color = isPlayer ? 0xffffff : typeColor;
    this.mesh = new THREE.Mesh(GEO, new THREE.MeshBasicMaterial({ color }));
    this.mesh.position.copy(pos);

    const light = new THREE.PointLight(color, 2, 4);
    this.mesh.add(light);

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
      this.destroy();
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    this.mesh.parent?.remove(this.mesh);
  }
}
