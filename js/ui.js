const $ = id => document.getElementById(id);

const COMP_LABELS = {
  track:  'TRACK DAMAGED — IMMOBILISED',
  engine: 'ENGINE HIT — SPEED -62%',
  turret: 'TURRET LOCKED — TRAVERSE BLOCKED',
};

const TACTIC_COLORS = {
  RUSH:     '#ff3300',
  FLANK:    '#ff8800',
  SUPPRESS: '#ffdd00',
  ENCIRCLE: '#cc44ff',
  '—':      '#336677',
};
const TACTIC_DESCS = {
  RUSH:     'Units converge directly on your position',
  FLANK:    'Units split to attack from multiple angles',
  SUPPRESS: 'Long-range fire to pin you in place',
  ENCIRCLE: 'Units spread to surround you',
  '—':      'Threat assessment in progress',
};

export class UI {
  constructor() {
    this.healthBar      = $('health-bar');
    this.scoreEl        = $('score');
    this.waveNumEl      = $('wave-num');
    this.livesEl        = $('lives-val');
    this.waveMsg        = $('wave-msg');
    this.damageFlash    = $('damage-flash');
    this.startScreen    = $('start-screen');
    this.gameOverScreen = $('game-over-screen');
    this.finalScore     = $('final-score');
    this.wavesSurvived  = $('waves-survived');
    this.aiInsightText  = $('ai-insight-text');
    this.activeTactic   = $('active-tactic');
    this.hitMarker      = $('hit-marker');
    this.mgAmmoEl       = $('mg-ammo-val');
    this._flashTimeout  = null;
    this._hitTimeout    = null;
  }

  updateHUD(hp, maxHp, score, waveNum, lives) {
    const pct = Math.max(0, (hp / maxHp) * 100);
    const hpColor = pct > 50 ? '#00ffff' : pct > 25 ? '#ffaa00' : '#ff3333';
    this.healthBar.style.width      = pct + '%';
    this.healthBar.style.background = hpColor;
    this.scoreEl.textContent   = score;
    this.waveNumEl.textContent = waveNum || '—';
    if (this.livesEl) this.livesEl.textContent = lives ?? 0;
    // Top status bar (desktop + mobile)
    const mhb = $('mob-hp-bar');
    if (mhb) {
      mhb.style.width      = pct + '%';
      mhb.style.background = hpColor;
      const msv = $('mob-score-val'); if (msv) msv.textContent = score;
      const mwv = $('mob-wave-val');  if (mwv) mwv.textContent = waveNum || '—';
      const mld = $('mob-lives-disp'); if (mld) mld.textContent = lives ?? 0;
    }
  }

  updateProtocol(tactic, probs) {
    const color = TACTIC_COLORS[tactic] || '#336677';
    this.activeTactic.textContent  = tactic;
    this.activeTactic.style.color  = color;
    const descEl = $('tactic-desc');
    if (descEl) descEl.textContent = TACTIC_DESCS[tactic] ?? '';

    const ids = ['rush', 'flank', 'suppress', 'encircle'];
    ids.forEach((id, i) => {
      const bar = $(`bar-${id}`);
      if (!bar) return;
      bar.style.width      = Math.round((probs[i] ?? 0.25) * 100) + '%';
      bar.style.background = Object.values(TACTIC_COLORS)[i];
      bar.style.boxShadow  = `0 0 6px ${Object.values(TACTIC_COLORS)[i]}`;
    });
  }

  flashDamage() {
    this.damageFlash.classList.add('active');
    clearTimeout(this._flashTimeout);
    this._flashTimeout = setTimeout(() => this.damageFlash.classList.remove('active'), 120);
  }

  flashHit() {
    if (!this.hitMarker) return;
    this.hitMarker.classList.add('active');
    clearTimeout(this._hitTimeout);
    this._hitTimeout = setTimeout(() => this.hitMarker.classList.remove('active'), 80);
  }

  updateAmmo(ammo, maxAmmo, reloading) {
    if (!this.mgAmmoEl) return;
    const txt = reloading ? 'LOADING...' : `${ammo} / ${maxAmmo}`;
    const col = reloading ? '#ffaa00' : ammo > 8 ? 'var(--cyan)' : '#ff5555';
    this.mgAmmoEl.textContent = txt;
    this.mgAmmoEl.style.color = col;
    // Also update desk-only top-bar MG display
    const mgd = $('mob-mg-disp');
    if (mgd) { mgd.textContent = txt; mgd.style.color = col; }
  }

  setFpv(_active) {
    // FPV indicator removed — no-op kept for call-site compatibility
  }

  showWaveMessage(text, ms = 1200) {
    this.waveMsg.textContent = text;
    this.waveMsg.classList.remove('hidden');
    return new Promise(res => setTimeout(() => {
      this.waveMsg.classList.add('hidden');
      res();
    }, ms));
  }

  showPause(player, onResume) {
    const screen = $('pause-screen');
    if (!screen) return;
    this._renderPauseStats(player);
    screen.classList.remove('hidden');
    $('btn-resume').onclick = () => { screen.classList.add('hidden'); onResume?.(); };
  }

  hidePause() { $('pause-screen')?.classList.add('hidden'); }

  _renderPauseStats(p) {
    const el = $('pause-stats');
    if (!el) return;
    const hpPct    = Math.round((p.hp / p.maxHp) * 100);
    const armorPct = Math.round((1 - p.armorMult) * 100);
    const hpCol    = p.hp > p.maxHp * 0.5 ? 'var(--cyan)' : p.hp > p.maxHp * 0.25 ? '#ffaa00' : '#ff5555';
    el.innerHTML = `
      <div class="sstat-row">
        <span class="sstat-label">HULL</span>
        <div class="sstat-bar-track"><div class="sstat-bar" style="width:${hpPct}%;background:${hpCol};box-shadow:0 0 6px ${hpCol}"></div></div>
        <span class="sstat-val" style="color:${hpCol}">${Math.ceil(p.hp)} / ${p.maxHp}</span>
      </div>
      <div class="sstat-row"><span class="sstat-label">LIVES</span><span class="sstat-val">${p.lives}</span></div>
      <div class="sstat-row"><span class="sstat-label">SPEED</span><span class="sstat-val">${Math.round(p.speedMult * 100)}%</span></div>
      <div class="sstat-row"><span class="sstat-label">DAMAGE</span><span class="sstat-val">${Math.round(p.damageMult * 100)}%</span></div>
      <div class="sstat-row"><span class="sstat-label">RELOAD</span><span class="sstat-val">${Math.round((1 / p.reloadMult) * 100)}%</span></div>
      <div class="sstat-row"><span class="sstat-label">ARMOR</span><span class="sstat-val">${armorPct > 0 ? '−' : '+'}${Math.abs(armorPct)}%</span></div>
      <div class="sstat-row"><span class="sstat-label">TRV SPD</span><span class="sstat-val">${Math.round((p.traverseMult ?? 1) * 100)}%</span></div>
      <div class="sstat-row"><span class="sstat-label">MG AMMO</span><span class="sstat-val">${p.mgAmmo} / ${p.mgMaxAmmo}</span></div>
      <div class="sstat-row"><span class="sstat-label">MG DMG</span><span class="sstat-val">${Math.round((p.mgDamageMult ?? 1) * 100)}%</span></div>
    `;
  }

  // Show brief directional-hit text (e.g. "REAR HIT ×1.5")
  showHitFeedback(text, color = '#ff8800') {
    const el = $('hit-feedback');
    if (!el) return;
    el.textContent  = text;
    el.style.color  = color;
    el.style.opacity = '1';
    clearTimeout(this._hitFbTimeout);
    this._hitFbTimeout = setTimeout(() => { el.style.opacity = '0'; }, 900);
  }

  // Called when a component gets damaged; updates the component panel
  showComponentDamage(comp) {
    const el = $('component-panel');
    if (!el) return;
    el.style.display = '';
    const label = COMP_LABELS[comp] ?? comp.toUpperCase();
    const row = document.createElement('div');
    row.id        = `comp-${comp}`;
    row.className = 'comp-row';
    row.textContent = label;
    // Replace existing row for same component (no duplicates)
    const existing = $(`comp-${comp}`);
    if (existing) existing.replaceWith(row);
    else el.appendChild(row);
  }

  // Tick component UI — remove cleared rows, hide panel when empty
  updateComponentPanel(compDmg) {
    const el = $('component-panel');
    if (!el) return;
    for (const comp of ['track', 'engine', 'turret']) {
      const row = $(`comp-${comp}`);
      if (row && compDmg[comp] <= 0) row.remove();
    }
    const hasActive = Object.values(compDmg).some(v => v > 0);
    el.style.display = hasActive ? '' : 'none';
  }

  // Boss names keyed by enemy type — shown in the boss bar label
  static BOSS_NAMES = {
    tanky: 'DREADNOUGHT',
    fast:  'PHANTOM',
    stug:  'SIEGE ENGINE',
    hover: 'WRAITH',
    swarm: 'HIVEMIND',
  };

  updateBossBar(boss) {
    const el = $('boss-bar-container');
    if (!el) return;
    if (!boss) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const pct = Math.max(0, (boss.hp / boss._maxHp) * 100);
    $('boss-bar-fill').style.width = pct + '%';
    el.classList.toggle('boss-critical', pct < 25);
    const name = UI.BOSS_NAMES[boss.type] ?? boss.type.toUpperCase();
    $('boss-bar-label').textContent = `⚠  ${name}  ⚠`;
    const hpEl = $('boss-bar-hp-text');
    if (hpEl) hpEl.textContent = `${Math.ceil(boss.hp).toLocaleString()} / ${boss._maxHp.toLocaleString()}`;
  }

  showStartScreen()  { this.startScreen.classList.remove('hidden'); }
  hideStartScreen()  { this.startScreen.classList.add('hidden'); }

  showGameOver(score, waves, summary, onRestart) {
    this.finalScore.textContent    = score;
    this.wavesSurvived.textContent = waves;
    this.aiInsightText.textContent = summary;
    this.gameOverScreen.classList.remove('hidden');
    $('btn-restart').onclick = () => {
      this.gameOverScreen.classList.add('hidden');
      onRestart();
    };
  }
}
