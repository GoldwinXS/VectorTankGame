import * as THREE from 'three';

export const INITIAL_HALF = 18;
export const ZONE_SIZE    = 16;

const OBS_H = 1.5; // default obstacle height

// ── Terrain height function — multi-octave rolling hills ─────────────────────
// Pure math, no side effects — safe to import anywhere
export function terrainH(x, z) {
  return (
    0.9  * Math.sin(x * 0.10)        * Math.cos(z * 0.13)        +
    0.45 * Math.sin(x * 0.23 + 0.9)  * Math.sin(z * 0.20 + 1.4)  +
    0.22 * Math.cos(x * 0.41 + 0.5)  * Math.cos(z * 0.37 + 2.1)
  );
}

// Analytical partial derivatives of terrainH — used for tank pitch/roll
export function terrainSlope(x, z) {
  const dHdx = (
    0.9  * 0.10 * Math.cos(x * 0.10)       * Math.cos(z * 0.13)       +
    0.45 * 0.23 * Math.cos(x * 0.23 + 0.9) * Math.sin(z * 0.20 + 1.4) -
    0.22 * 0.41 * Math.sin(x * 0.41 + 0.5) * Math.cos(z * 0.37 + 2.1)
  );
  const dHdz = (
   -0.9  * 0.13 * Math.sin(x * 0.10)       * Math.sin(z * 0.13)       +
    0.45 * 0.20 * Math.sin(x * 0.23 + 0.9) * Math.cos(z * 0.20 + 1.4) -
    0.22 * 0.37 * Math.cos(x * 0.41 + 0.5) * Math.sin(z * 0.37 + 2.1)
  );
  return { dHdx, dHdz };
}

// Rectangular obstacles — height field controls vertical size
// Low barriers (height ~0.85) can be shot over with barrel elevation
export const OBSTACLES = [
  // Corner covers — full height (medium cover)
  { x:  9, z:  9, w: 3, h: 2, height: 1.5 },
  { x: -9, z:  9, w: 2, h: 3, height: 1.5 },
  { x:  9, z: -9, w: 2, h: 3, height: 1.5 },
  { x: -9, z: -9, w: 3, h: 2, height: 1.5 },
  // Side ridges — low barriers (shoot over with barrel elevation)
  { x: 14, z:  0, w: 2, h: 7, height: 0.85 },
  { x:-14, z:  0, w: 2, h: 7, height: 0.85 },
  { x:  0, z: 14, w: 7, h: 2, height: 0.85 },
  { x:  0, z:-14, w: 7, h: 2, height: 0.85 },
];

// Cylindrical pillars and cones — line-of-sight blockers, distance-based collision
// shape: 'cylinder' (default) | 'cone'
const CYLINDER_OBSTACLES = [
  { x:  5, z:  5, r: 0.9, height: 3.8 },
  { x: -5, z:  5, r: 0.9, height: 3.8 },
  { x:  5, z: -5, r: 0.9, height: 3.8 },
  { x: -5, z: -5, r: 0.9, height: 3.8 },
  // Cone spires — add visual variety; collision uses radius
  { x: 11, z:  7, r: 1.0, height: 3.5, shape: 'cone' },
  { x:-11, z: -7, r: 1.0, height: 3.5, shape: 'cone' },
  { x:  7, z:-11, r: 1.0, height: 3.0, shape: 'cone' },
  { x: -7, z: 11, r: 1.0, height: 3.0, shape: 'cone' },
];

// Zone obstacles revealed on arena expansion — varied heights
export const ZONE_OBSTACLES = {
  east:  [
    { x: 28, z: -7, w: 2, h: 6, height: 1.5  },
    { x: 28, z:  7, w: 2, h: 6, height: 0.85 },
    { x: 23, z:  0, w: 3, h: 2, height: 2.8  },
  ],
  south: [
    { x: -7, z: 28, w: 6, h: 2, height: 1.5  },
    { x:  7, z: 28, w: 6, h: 2, height: 0.85 },
    { x:  0, z: 23, w: 2, h: 3, height: 2.8  },
  ],
  west:  [
    { x:-28, z: -7, w: 2, h: 6, height: 1.5  },
    { x:-28, z:  7, w: 2, h: 6, height: 0.85 },
    { x:-23, z:  0, w: 3, h: 2, height: 2.8  },
  ],
  north: [
    { x: -7, z:-28, w: 6, h: 2, height: 1.5  },
    { x:  7, z:-28, w: 6, h: 2, height: 0.85 },
    { x:  0, z:-23, w: 2, h: 3, height: 2.8  },
  ],
};

// ── Collision ─────────────────────────────────────────────────────────────────

export function resolveObstacles(pos, radius) {
  // Rectangular AABB (entities always collide regardless of obstacle height)
  for (const obs of OBSTACLES) {
    const cx = Math.max(obs.x - obs.w / 2, Math.min(pos.x, obs.x + obs.w / 2));
    const cz = Math.max(obs.z - obs.h / 2, Math.min(pos.z, obs.z + obs.h / 2));
    const dx = pos.x - cx, dz = pos.z - cz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < radius) {
      if (dist < 0.001) { pos.x += radius; continue; }
      pos.x += (dx / dist) * (radius - dist);
      pos.z += (dz / dist) * (radius - dist);
    }
  }
  // Cylinder obstacles
  for (const cyl of CYLINDER_OBSTACLES) {
    const dx   = pos.x - cyl.x;
    const dz   = pos.z - cyl.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const min  = radius + cyl.r;
    if (dist < min) {
      if (dist < 0.001) { pos.x += min; continue; }
      pos.x += (dx / dist) * (min - dist);
      pos.z += (dz / dist) * (min - dist);
    }
  }
}

export function hitsObstacle(pos) {
  // Rectangular — height-aware: top of obstacle is terrain height + obstacle height
  for (const obs of OBSTACLES) {
    const obsTop = terrainH(obs.x, obs.z) + (obs.height ?? OBS_H);
    if (pos.y >= obsTop) continue; // projectile clears the top
    if (pos.x > obs.x - obs.w / 2 && pos.x < obs.x + obs.w / 2 &&
        pos.z > obs.z - obs.h / 2 && pos.z < obs.z + obs.h / 2) return true;
  }
  // Cylinders — height-aware
  for (const cyl of CYLINDER_OBSTACLES) {
    if (pos.y >= terrainH(cyl.x, cyl.z) + cyl.height) continue;
    const dx = pos.x - cyl.x;
    const dz = pos.z - cyl.z;
    if (Math.sqrt(dx * dx + dz * dz) < cyl.r) return true;
  }
  return false;
}

// ── Mesh builders ─────────────────────────────────────────────────────────────

const _obsMat  = new THREE.MeshStandardMaterial({ color: 0x001122, emissive: 0x003355, emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.9 });
const _edgeMat = new THREE.LineBasicMaterial({ color: 0x0088cc, opacity: 0.8, transparent: true });

export function buildObstacleMeshes(scene, defs) {
  const out = [];
  for (const obs of defs) {
    const meshH = obs.height ?? OBS_H;
    // Sample min terrain height across all four corners + center to avoid hovering
    const hw = obs.w / 2, hd = obs.h / 2;
    const groundY = Math.min(
      terrainH(obs.x - hw, obs.z - hd), terrainH(obs.x + hw, obs.z - hd),
      terrainH(obs.x - hw, obs.z + hd), terrainH(obs.x + hw, obs.z + hd),
      terrainH(obs.x, obs.z)
    );
    const geo  = new THREE.BoxGeometry(obs.w, meshH, obs.h);
    const mesh = new THREE.Mesh(geo, _obsMat.clone());
    mesh.position.set(obs.x, groundY + meshH / 2, obs.z);
    mesh.castShadow = true;
    scene.add(mesh);

    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), _edgeMat.clone());
    edges.position.copy(mesh.position);
    scene.add(edges);
    out.push(mesh, edges);
  }
  return out;
}

function buildCylinderMeshes(scene, defs) {
  const cylMat  = new THREE.MeshStandardMaterial({ color: 0x001525, emissive: 0x004466, emissiveIntensity: 0.5, roughness: 0.25, metalness: 0.95 });
  const coneMat = new THREE.MeshStandardMaterial({ color: 0x001a22, emissive: 0x003355, emissiveIntensity: 0.6, roughness: 0.2,  metalness: 0.9  });
  const cylEdge = new THREE.LineBasicMaterial({ color: 0x00aadd, opacity: 0.9, transparent: true });
  for (const cyl of defs) {
    // Sample min terrain under the obstacle footprint to prevent hovering
    const groundY = Math.min(
      terrainH(cyl.x - cyl.r, cyl.z - cyl.r), terrainH(cyl.x + cyl.r, cyl.z - cyl.r),
      terrainH(cyl.x - cyl.r, cyl.z + cyl.r), terrainH(cyl.x + cyl.r, cyl.z + cyl.r),
      terrainH(cyl.x, cyl.z)
    );
    const isCone = cyl.shape === 'cone';
    const geo = isCone
      ? new THREE.ConeGeometry(cyl.r * 1.5, cyl.height, 8)
      : new THREE.CylinderGeometry(cyl.r, cyl.r, cyl.height, 14);
    const mesh = new THREE.Mesh(geo, (isCone ? coneMat : cylMat).clone());
    mesh.position.set(cyl.x, groundY + cyl.height / 2, cyl.z);
    mesh.castShadow = true;
    scene.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), cylEdge.clone());
    edges.position.copy(mesh.position);
    scene.add(edges);
  }
}

export function activateZone(direction, scene) {
  const defs = ZONE_OBSTACLES[direction];
  OBSTACLES.push(...defs);
  return buildObstacleMeshes(scene, defs);
}

export function updateBoundary(geo, bounds) {
  const { minX, maxX, minZ, maxZ } = bounds;
  const yAt = (x, z) => terrainH(x, z) + 0.55;
  const N = 20;
  const pts = [];
  // South edge (minZ), West→East
  for (let i = 0; i <= N; i++) {
    const x = minX + (maxX - minX) * i / N;
    pts.push(new THREE.Vector3(x, yAt(x, minZ), minZ));
  }
  // East edge (maxX), South→North
  for (let i = 1; i <= N; i++) {
    const z = minZ + (maxZ - minZ) * i / N;
    pts.push(new THREE.Vector3(maxX, yAt(maxX, z), z));
  }
  // North edge (maxZ), East→West
  for (let i = N - 1; i >= 0; i--) {
    const x = minX + (maxX - minX) * i / N;
    pts.push(new THREE.Vector3(x, yAt(x, maxZ), maxZ));
  }
  // West edge (minX), North→South
  for (let i = N - 1; i >= 0; i--) {
    const z = minZ + (maxZ - minZ) * i / N;
    pts.push(new THREE.Vector3(minX, yAt(minX, z), z));
  }
  pts.push(pts[0].clone()); // close the loop
  geo.setFromPoints(pts);
}

// ── Terrain mesh ──────────────────────────────────────────────────────────────

function buildTerrainMesh(scene) {
  const geo = new THREE.PlaneGeometry(250, 250, 120, 120);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, terrainH(pos.getX(i), pos.getZ(i)));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0x010a16, roughness: 1, metalness: 0,
  }));
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// ── Wireframe overlay — triangle mesh follows terrain surface ─────────────────

function buildTerrainGrid(scene) {
  // Lower-resolution displaced mesh used purely for wireframe drawing.
  // WireframeGeometry shows every triangle edge, giving the classic
  // sci-fi 3D-terrain wireframe look that reveals the hill shapes.
  const wGeo = new THREE.PlaneGeometry(250, 250, 100, 100);
  wGeo.rotateX(-Math.PI / 2);
  const wPos = wGeo.attributes.position;
  for (let i = 0; i < wPos.count; i++) {
    wPos.setY(i, terrainH(wPos.getX(i), wPos.getZ(i)) + 0.03);
  }
  wPos.needsUpdate = true;

  scene.add(new THREE.LineSegments(
    new THREE.WireframeGeometry(wGeo),
    new THREE.LineBasicMaterial({ color: 0x005577, transparent: true, opacity: 0.55 })
  ));
}

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020b18);
  const fog = new THREE.FogExp2(0x020b18, 0.04);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.position.set(0, 12, -10);
  camera.lookAt(0, 0, 5);

  const ambientLight = new THREE.AmbientLight(0x112244, 6);
  scene.add(ambientLight);
  const dir = new THREE.DirectionalLight(0x4488ff, 3);
  dir.position.set(10, 25, 15);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.near   =  1;
  dir.shadow.camera.far    = 150;
  dir.shadow.camera.left   = -60;
  dir.shadow.camera.right  =  60;
  dir.shadow.camera.top    =  60;
  dir.shadow.camera.bottom = -60;
  scene.add(dir);

  // Terrain mesh + displaced grid lines (replaces flat floor + GridHelpers)
  buildTerrainMesh(scene);
  buildTerrainGrid(scene);

  // Dynamic boundary line
  const boundaryGeo  = new THREE.BufferGeometry();
  const boundaryLine = new THREE.Line(
    boundaryGeo,
    new THREE.LineBasicMaterial({ color: 0x00ffff, opacity: 0.70, transparent: true })
  );
  scene.add(boundaryLine);

  // Build initial obstacles
  buildObstacleMeshes(scene, OBSTACLES);
  buildCylinderMeshes(scene, CYLINDER_OBSTACLES);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, camera, renderer, boundaryGeo, fog, ambientLight, dirLight: dir };
}
