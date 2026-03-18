import { Enemy } from './enemy.js';
import { TACTICS } from './nn.js';

const TARGET_CLEAR_TIME = 25;

export class WaveManager {
  constructor(scene, projectiles, nn) {
    this.scene       = scene;
    this.projectiles = projectiles;
    this.nn          = nn;
    this.enemies     = [];
    this.waveNum     = 0;
    this._bossNum    = 0;
    this._pendingBoss = false;

    this._tactic        = 'RUSH';
    this._tacticIdx     = 0;
    this._waveStartTime = 0;
    this._waveStartHp   = 100;
  }

  initTactic() {
    this._tactic    = 'RUSH';
    this._tacticIdx = 0;
    this._bossNum   = 0;
  }

  get isBossWave() { return this.waveNum > 0 && this.waveNum % 5 === 0; }

  // tacticProbs: [p_rush, p_flank, p_suppress, p_encircle] from nn.probs
  startWave(waveNum, bounds, playerHp, tacticProbs) {
    this.waveNum         = waveNum;
    this._waveStartTime  = performance.now() / 1000;
    this._waveStartHp    = playerHp;
    this.enemies         = [];
    this._pendingBoss    = false;

    // Difficulty: starts gentle, ramps hard — 0.5 at wave 1, ~2.4 at wave 20
    const difficulty = 0.5 + (waveNum - 1) * 0.10;
    const probs      = tacticProbs || [0.7, 0.1, 0.1, 0.1];

    if (this.isBossWave) {
      this._bossNum++;
      this._pendingBoss = true;
      // Fewer normal enemies on boss waves
      const normalCount = 2 + Math.min(this._bossNum - 1, 3);
      const composition = this._buildComposition(normalCount, waveNum);
      this._spawnWave(composition, probs, bounds, difficulty);
      // Boss arrives last with dramatic delay
      const delay = normalCount * 250 + 900;
      setTimeout(() => {
        this._spawnBoss(bounds, difficulty);
        this._pendingBoss = false;
      }, delay);
    } else {
      // Slower ramp: wave 1=2, 2=2, 3=3, 4=4, 6=5 ... capped at 14
      const count = Math.min(2 + Math.floor((waveNum - 1) * 0.65), 14);
      const composition = this._buildComposition(count, waveNum);
      this._spawnWave(composition, probs, bounds, difficulty);
    }
  }

  _spawnBoss(bounds, difficulty) {
    const maxR = Math.max(
      Math.abs(bounds.maxX), Math.abs(bounds.minX),
      Math.abs(bounds.maxZ), Math.abs(bounds.minZ)
    ) + 8;
    const spawnAngle = Math.random() * Math.PI * 2;
    const pos = { x: Math.cos(spawnAngle) * maxR, y: 0, z: Math.sin(spawnAngle) * maxR };

    // Boss scales harder each encounter
    const bossDiff = difficulty * (1 + (this._bossNum - 1) * 0.35);
    const boss = new Enemy(this.scene, this.projectiles, 'boss', pos, bossDiff);
    boss.setTactic('RUSH');
    this.enemies.push(boss);
  }

  _buildComposition(total, waveNum) {
    // Gate enemy types by wave — introduce gradually
    const hasTanky  = waveNum >= 3;
    const hasScout  = waveNum >= 4;
    const hasSwarm  = waveNum >= 5;
    const hasGunner = waveNum >= 6;
    const hasStug   = waveNum >= 8;

    const p   = Math.min((waveNum - 1) / 10, 1);
    const wF  = 1 - p * 0.25;
    const wT  = hasTanky  ? (0.2 + p * 0.35) : 0;
    const wSc = hasScout  ? (0.15 + p * 0.1)  : 0;
    const wSw = hasSwarm  ? (0.2 + p * 0.25)  : 0;
    const wG  = hasGunner ? (0.1 + p * 0.2)   : 0;
    const wSt = hasStug   ? (0.08 + p * 0.12) : 0;
    const sum = wF + wT + wSc + wSw + wG + wSt;

    const nFast   = Math.max(1, Math.round((wF / sum) * total));
    const nScout  = hasScout  ? Math.max(0, Math.round((wSc / sum) * total)) : 0;
    const nGunner = hasGunner ? Math.max(0, Math.round((wG / sum) * total)) : 0;
    const nSwarm  = hasSwarm  ? Math.max(0, Math.round((wSw * 1.2 / sum) * total)) : 0;
    const nStug   = hasStug   ? Math.max(0, Math.min(2, Math.round((wSt / sum) * total))) : 0;
    const nTanky  = hasTanky  ? Math.max(0, total - nFast - nScout - nSwarm - nGunner - nStug) : 0;

    const types = [
      ...Array(nFast).fill('fast'),
      ...Array(nTanky).fill('tanky'),
      ...Array(nScout).fill('scout'),
      ...Array(nSwarm).fill('swarm'),
      ...Array(nGunner).fill('gunner'),
      ...Array(nStug).fill('stug'),
    ];
    // Shuffle
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }
    return types;
  }

  // Each enemy independently draws a tactic from the probability distribution
  _spawnWave(composition, tacticProbs, bounds, difficulty) {
    const maxR = Math.max(
      Math.abs(bounds.maxX), Math.abs(bounds.minX),
      Math.abs(bounds.maxZ), Math.abs(bounds.minZ)
    ) + 6;

    // Build cumulative distribution for sampling
    const cumProbs = [];
    let sum = 0;
    for (const p of tacticProbs) { sum += p; cumProbs.push(Math.min(1, sum)); }

    composition.forEach((type, i) => {
      // Draw tactic for this individual enemy
      const roll = Math.random();
      let tactic = TACTICS[TACTICS.length - 1]; // fallback = last tactic
      for (let j = 0; j < cumProbs.length; j++) {
        if (roll <= cumProbs[j]) { tactic = TACTICS[j]; break; }
      }

      // Spawn position
      const spawnAngle = Math.random() * Math.PI * 2;
      const r = maxR + Math.random() * 4;
      const pos = { x: Math.cos(spawnAngle) * r, y: 0, z: Math.sin(spawnAngle) * r };

      // Formation data (encircle orbit angle is unique per enemy)
      const formationData = {};
      if (tactic === 'ENCIRCLE') {
        formationData.angle = (i / composition.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      }

      const fn = () => {
        const e = new Enemy(this.scene, this.projectiles, type, pos, difficulty);
        e.setTactic(tactic, formationData);
        this.enemies.push(e);
      };
      if (i === 0) fn();
      else setTimeout(fn, i * 200);
    });
  }

  chooseNextTactic(playerHp, playerMaxHp, shotsFired, shotsHit, distanceTraveled) {
    const clearTime  = performance.now() / 1000 - this._waveStartTime;
    const healthLost = this._waveStartHp - playerHp;

    const healthRatio = Math.min(healthLost / playerMaxHp, 1);
    const inaccuracy  = shotsFired > 0 ? Math.max(0, 1 - shotsHit / shotsFired) : 0.5;
    const mobility    = Math.min(distanceTraveled / (clearTime * 6 * 0.4), 1);
    const challenge   = 0.5 * healthRatio + 0.3 * inaccuracy + 0.2 * Math.min(clearTime / TARGET_CLEAR_TIME, 1);

    this.nn.train(this._tacticIdx, challenge);

    const { tactic, idx } = this.nn.selectTactic(healthRatio, inaccuracy, mobility);
    this._tactic    = tactic;
    this._tacticIdx = idx;
    return tactic;
  }

  isWaveComplete() {
    if (this._pendingBoss) return false;
    return this.enemies.length > 0 && this.enemies.every(e => !e.alive);
  }

  clearEnemies() {
    this._pendingBoss = false;
    this.enemies.forEach(e => { e.alive = false; e.group.parent?.remove(e.group); });
    this.enemies = [];
  }

  update(delta, playerPos, bounds) {
    for (const e of this.enemies) {
      if (e.alive) e.update(delta, playerPos, this.enemies, bounds);
    }
  }

  get currentTactic() { return this._tactic; }
}
