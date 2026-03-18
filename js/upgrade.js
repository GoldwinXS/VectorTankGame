// tag: 'firepower' | 'defense' | 'speed' | 'utility'
const UPGRADE_POOL = [
  // ── Originals ────────────────────────────────────────────────────────────
  { id: 'repair',    tag: 'defense',   label: 'HULL REPAIR',      desc: 'Restore 80 hull points',               apply: p => { p.hp = Math.min(p.maxHp, p.hp + 80); } },
  { id: 'maxhp',     tag: 'defense',   label: 'REINFORCE HULL',   desc: '+25 max hull points',                  apply: p => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); } },
  { id: 'speed',     tag: 'speed',     label: 'DRIVE OVERDRIVE',  desc: '+20% move speed',                      apply: p => { p.speedMult    = Math.min(2.5, p.speedMult    * 1.20); } },
  { id: 'damage',    tag: 'firepower', label: 'ORDNANCE +',       desc: '+25% bullet damage',                   apply: p => { p.damageMult   = Math.min(4.0, p.damageMult   * 1.25); } },
  { id: 'life',      tag: 'utility',   label: 'RESERVE HULL',     desc: '+1 extra life',                        apply: p => { p.lives++; } },
  { id: 'armor',     tag: 'defense',   label: 'REACTIVE ARMOR',   desc: '-20% damage taken',                    apply: p => { p.armorMult   = Math.max(0.15, p.armorMult   * 0.80); } },
  { id: 'traverse',  tag: 'firepower', label: 'TURRET DRIVE',     desc: '+35% turret traverse speed',           apply: p => { p.traverseMult = Math.min(3.0, p.traverseMult * 1.35); } },
  { id: 'reload',    tag: 'firepower', label: 'AUTO-LOADER',      desc: '-25% reload time',                     apply: p => { p.reloadMult  = Math.max(0.3, p.reloadMult  * 0.75); } },
  { id: 'burst',     tag: 'firepower', label: 'BURST FIRE',       desc: 'Fire one extra round per shot',        apply: p => { if (p.multiShot < 3) p.multiShot++; } },
  { id: 'barrel',    tag: 'firepower', label: 'EXTENDED BARREL',  desc: '+25% projectile speed',                apply: p => { p.bulletSpeedMult = Math.min(2.0, p.bulletSpeedMult * 1.25); } },

  // ── Builds ────────────────────────────────────────────────────────────────
  { id: 'regen',     tag: 'defense',   label: 'HULL REGEN',       desc: '+3 HP/sec passive regeneration',       apply: p => { p.regenRate = Math.min(15, (p.regenRate || 0) + 3); } },
  { id: 'glass',     tag: 'firepower', label: 'GLASS CANNON',     desc: '+60% damage — +35% dmg taken',         apply: p => { p.damageMult = Math.min(5.0, p.damageMult * 1.60); p.armorMult = Math.min(2.0, p.armorMult * 1.35); } },
  { id: 'fortress',  tag: 'defense',   label: 'FORTRESS',         desc: '-35% dmg taken, -20% move speed',      apply: p => { p.armorMult = Math.max(0.10, p.armorMult * 0.65); p.speedMult = Math.max(0.4, p.speedMult * 0.80); } },
  { id: 'sniper',    tag: 'firepower', label: 'SNIPER PROTOCOL',  desc: '+50% projectile speed, +40% traverse', apply: p => { p.bulletSpeedMult = Math.min(2.0, p.bulletSpeedMult * 1.50); p.traverseMult = Math.min(3.0, p.traverseMult * 1.40); } },
  { id: 'rampage',   tag: 'utility',   label: 'RAMPAGE',          desc: '+25% speed and +25% damage',           apply: p => { p.speedMult = Math.min(2.5, p.speedMult * 1.25); p.damageMult = Math.min(4.0, p.damageMult * 1.25); } },
  { id: 'overclock', tag: 'firepower', label: 'OVERCLOCK',        desc: '+40% traverse, -20% reload time',      apply: p => { p.traverseMult = Math.min(3.0, p.traverseMult * 1.40); p.reloadMult = Math.max(0.3, p.reloadMult * 0.80); } },
  { id: 'sprint',    tag: 'speed',     label: 'NITRO DRIVE',      desc: '+40% move speed',                      apply: p => { p.speedMult = Math.min(2.5, p.speedMult * 1.40); } },
  { id: 'lifesteal', tag: 'utility',   label: 'VAMPIRE ROUND',    desc: '+5 HP per enemy destroyed',            apply: p => { p.hpPerKill = Math.min(30, (p.hpPerKill || 0) + 5); } },
  { id: 'bounty',    tag: 'utility',   label: 'KILL BOUNTY',      desc: '+50% score per kill',                  apply: p => { p.scoreMult = (p.scoreMult || 1) * 1.50; } },
  { id: 'wide',      tag: 'firepower', label: 'WIDE PATTERN',     desc: 'Minimum 2 rounds per shot',            apply: p => { if (p.multiShot < 2) p.multiShot = 2; } },

  // ── MG upgrades ───────────────────────────────────────────────────────────
  { id: 'mg_drum',      tag: 'firepower', label: 'DRUM MAGAZINE',   desc: '+15 MG rounds per magazine',           apply: p => { p.mgMaxAmmo += 15; p.mgAmmo = p.mgMaxAmmo; } },
  { id: 'mg_reload',    tag: 'firepower', label: 'MG AUTO-LOADER',  desc: '-30% MG reload time',                  apply: p => { p.mgReloadMult = Math.max(0.3, (p.mgReloadMult ?? 1) * 0.70); } },
  { id: 'mg_ap',        tag: 'firepower', label: 'AP ROUNDS',       desc: '+60% MG bullet damage',                apply: p => { p.mgDamageMult = Math.min(5.0, (p.mgDamageMult ?? 1) * 1.60); } },
  { id: 'mg_precision', tag: 'firepower', label: 'MG PRECISION',    desc: '-40% MG spread — tighter burst',       apply: p => { p.mgSpreadMult = Math.max(0.1, (p.mgSpreadMult ?? 1) * 0.60); } },
];

const TAG_COLORS = {
  firepower: '#ff8800',
  defense:   '#8844ff',
  speed:     '#00ffff',
  utility:   '#00ff88',
};

export class UpgradePicker {
  constructor() {
    this._el        = document.getElementById('upgrade-screen');
    this._choicesEl = document.getElementById('upgrade-choices');
    this._resolve   = null;
    this._offered   = new Set(); // IDs already offered this run
  }

  resetRun() { this._offered.clear(); }

  open(player, waveNum, stats) {
    this._player = player;
    this._renderStats(waveNum, stats);
    this._renderChoices();
    this._el.classList.remove('hidden');
    return new Promise(res => { this._resolve = res; });
  }

  _close(upgrade) {
    if (upgrade) {
      upgrade.apply(this._player);
      this._offered.add(upgrade.id);
    }
    this._el.classList.add('hidden');
    if (this._resolve) { this._resolve(upgrade); this._resolve = null; }
  }

  _renderStats(waveNum, stats) {
    const acc = stats.shotsFired > 0
      ? Math.round((stats.shotsHit / stats.shotsFired) * 100) : 0;
    document.getElementById('upg-wave').textContent     = `WAVE  ${waveNum}  CLEARED`;
    document.getElementById('upg-score').textContent    = stats.score;
    document.getElementById('upg-accuracy').textContent = acc + '%';
    document.getElementById('upg-hp').textContent       = `${stats.hpRemaining} / ${stats.maxHp}`;
  }

  _renderChoices() {
    // Prefer upgrades not yet offered; fall back to full pool if exhausted
    const available = UPGRADE_POOL.filter(u => !this._offered.has(u.id));
    const pool = available.length >= 3 ? available : [...UPGRADE_POOL];

    // Shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    this._choicesEl.innerHTML = '';
    for (const upg of pool.slice(0, 3)) {
      const tagColor = TAG_COLORS[upg.tag] || '#336677';
      const card = document.createElement('div');
      card.className = 'upg-card';
      card.innerHTML = `
        <div class="upg-tag" style="color:${tagColor};border-color:${tagColor}">${upg.tag.toUpperCase()}</div>
        <div class="upg-name">${upg.label}</div>
        <div class="upg-desc">${upg.desc}</div>`;
      card.addEventListener('click', () => this._close(upg));
      this._choicesEl.appendChild(card);
    }
  }
}
