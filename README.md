# VECTOR

> **A browser-based 3D tank combat game with adaptive AI enemies**

**Author:** Goldwin Stewart

---

## Play

Live demo: [goldwinxs.github.io/VectorTankGame](https://goldwinxs.github.io/VectorTankGame)

No installation required — runs entirely in the browser.

---

## About

VECTOR is a top-down / third-person tank shooter built with Three.js. You command an armored vehicle across rolling terrain, fighting off waves of AI-controlled enemies that adapt their tactics in real time using a neural-network tactic selector. Each wave you survive unlocks upgrades and a resupply shop, pushing you to build a loadout that can outlast increasingly aggressive enemy compositions.

---

## Features

- **Third-person & first-person camera** — orbit freely with the mouse, or toggle first-person view (V) to aim precisely from the turret
- **Dual weapon system** — coaxial machine gun (left click, 30 rounds, auto-reload) and high-damage arcing main cannon (right click)
- **Ballistic aiming** — barrel elevation controlled by mouse Y; cannon shells arc under gravity; aim circle projects the landing spot
- **Aim charge mechanic** — hold the crosshair on target to tighten spread and increase cannon accuracy
- **Height-aware cover** — low barriers can be shot over; tall pillars provide hard cover; all objects sit on procedural terrain
- **Procedural rolling terrain** — 3-octave heightmap with wireframe overlay
- **Roguelike progression** — upgrade picker after each wave, resupply shop between waves, player buff system
- **Adaptive AI** — TacticSelector neural network assigns RUSH / FLANK / SUPPRESS / ENCIRCLE tactics per enemy; live readout in HUD
- **Gradual enemy introduction**
  - Wave 1–2: Fast scouts only
  - Wave 3+: Tanky heavies join
  - Wave 5+: Swarm units join
  - Wave 6+: Gunner units (rapid-fire MG, lime green) join
  - Boss every 5th wave
- **Hit marker** — white cross flashes on every confirmed enemy hit

---

## Controls

| Input       | Action                                          |
| ----------- | ----------------------------------------------- |
| W / S       | Drive forward / reverse                         |
| A / D       | Rotate hull                                     |
| Mouse X     | Camera orbit / turret traverse                  |
| Mouse Y     | Barrel elevation                                |
| Left click  | Coaxial MG — rapid fire, 30 rounds, auto-reload |
| Right click | Main cannon — high damage, arcing shell         |
| C (hold)    | Free-look — camera orbits, gun stays locked     |
| V           | Toggle first-person view                        |

---

## Tech Stack

- **Three.js r169** — 3D rendering (loaded via CDN importmap, no bundler)
- **Vanilla ES modules** — no framework, no build step
- **GitHub Actions** — auto-deploys to GitHub Pages on push to `master`

---

## Project Structure

```
index.html
style.css
js/
  main.js        — game loop, input, camera
  player.js      — player tank, dual weapons, aim system
  enemy.js       — enemy types and AI behaviour
  wave.js        — wave composition and spawning
  nn.js          — TacticSelector neural network
  scene.js       — terrain, lighting, obstacles
  projectile.js  — ballistic / flat projectile physics
  pickup.js      — map pickup drops
  upgrade.js     — roguelike upgrade definitions
  shop.js        — resupply shop logic
  ui.js          — HUD, screens, hit marker, ammo display
```

---

## License

MIT
