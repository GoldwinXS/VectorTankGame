import * as THREE from "three";
import { terrainH } from "./scene.js";

// Permanent pickups restore a resource (hp, lives).
// Temporary pickups apply a timed buff via player.applyBuff(key, mult, seconds).
export const PICKUP_DEFS = {
  health: {
    color: 0x00ff88,
    emissive: 0x00ff44,
    label: "HULL REPAIR",
    effect: (p) => {
      p.hp = Math.min(p.maxHp, p.hp + 40);
    },
    temp: false,
  },
  speed: {
    color: 0x00ccff,
    emissive: 0x0088ff,
    label: "SPEED BOOST (-TRV) 12s",
    effect: (p) => {
      p.applyBuff("speed", 1.3, 12);
      p.applyBuff("traverse", 0.65, 12);
    },
    temp: true,
  },
  damage: {
    color: 0xff8800,
    emissive: 0xff4400,
    label: "FIREPOWER (+DMG TKN) 10s",
    effect: (p) => {
      p.applyBuff("damage", 1.45, 10);
      p.applyBuff("armor", 1.28, 10);
    },
    temp: true,
  },
  armor: {
    color: 0xcc44ff,
    emissive: 0x8800cc,
    label: "ARMOR SHELL (-SPD) 15s",
    effect: (p) => {
      p.applyBuff("armor", 0.62, 15);
      p.applyBuff("speed", 0.78, 15);
    },
    temp: true,
  },
};

const _geo = new THREE.OctahedronGeometry(0.55, 0);

export class Pickup {
  constructor(scene, type, x, z) {
    this.scene = scene;
    this.type = type;
    this.alive = true;
    this.radius = 1.2;
    this._age = 0;

    const def = PICKUP_DEFS[type];
    this.mesh = new THREE.Mesh(
      _geo,
      new THREE.MeshStandardMaterial({
        color: def.color,
        emissive: def.emissive,
        emissiveIntensity: 0.9,
        roughness: 0.2,
        metalness: 0.8,
        transparent: true,
        opacity: 0.55,
      }),
    );
    this._baseY = terrainH(x, z);
    this.mesh.position.set(x, this._baseY + 0.9, z);
    scene.add(this.mesh);

    const light = new THREE.PointLight(def.color, 4, 4);
    this.mesh.add(light);
  }

  update(delta) {
    if (!this.alive) return;
    this._age += delta;
    this.mesh.position.y = this._baseY + 0.9 + Math.sin(this._age * 2.8) * 0.3;
    this.mesh.rotation.y += delta * 2.2;
  }

  applyTo(player) {
    PICKUP_DEFS[this.type].effect(player);
  }

  collect() {
    if (!this.alive) return;
    this.alive = false;
    this.mesh.parent?.remove(this.mesh);
  }

  get label() {
    return PICKUP_DEFS[this.type].label;
  }
  get position() {
    return this.mesh.position;
  }
}

export function spawnPickups(scene, bounds, count) {
  const types = Object.keys(PICKUP_DEFS);
  const pickups = [];
  // Guarantee at least one health pickup
  const typeList = ["health"];
  while (typeList.length < count)
    typeList.push(types[Math.floor(Math.random() * types.length)]);

  for (const type of typeList) {
    const margin = 3;
    const x =
      bounds.minX +
      margin +
      Math.random() * (bounds.maxX - bounds.minX - margin * 2);
    const z =
      bounds.minZ +
      margin +
      Math.random() * (bounds.maxZ - bounds.minZ - margin * 2);
    pickups.push(new Pickup(scene, type, x, z));
  }
  return pickups;
}

// Spawn pickups at a specific world position (e.g. boss death drops), scattered in a small radius
export function spawnPickupsAt(scene, types, cx, cz) {
  return types.map((type, i) => {
    const angle = (i / types.length) * Math.PI * 2;
    const r = 2.5 + Math.random() * 2;
    return new Pickup(
      scene,
      type,
      cx + Math.cos(angle) * r,
      cz + Math.sin(angle) * r,
    );
  });
}
