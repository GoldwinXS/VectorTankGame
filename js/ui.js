const $ = id => document.getElementById(id);

const TACTIC_COLORS = {
  RUSH:     '#ff3300',
  FLANK:    '#ff8800',
  SUPPRESS: '#ffdd00',
  ENCIRCLE: '#cc44ff',
  '—':      '#336677',
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
    this.fpvEl          = $('fpv-indicator');
    this._flashTimeout  = null;
    this._hitTimeout    = null;
  }

  updateHUD(hp, maxHp, score, waveNum, lives) {
    const pct = Math.max(0, (hp / maxHp) * 100);
    this.healthBar.style.width      = pct + '%';
    this.healthBar.style.background = pct > 50 ? '#00ffff' : pct > 25 ? '#ffaa00' : '#ff3333';
    this.scoreEl.textContent   = score;
    this.waveNumEl.textContent = waveNum || '—';
    if (this.livesEl) this.livesEl.textContent = lives ?? 0;
  }

  updateProtocol(tactic, probs) {
    const color = TACTIC_COLORS[tactic] || '#336677';
    this.activeTactic.textContent  = tactic;
    this.activeTactic.style.color  = color;

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
    this.mgAmmoEl.textContent = reloading ? 'LOADING...' : `${ammo} / ${maxAmmo}`;
    this.mgAmmoEl.style.color = reloading ? '#ffaa00' : ammo > 8 ? 'var(--cyan)' : '#ff5555';
  }

  setFpv(active) {
    if (!this.fpvEl) return;
    this.fpvEl.classList.toggle('hidden', !active);
  }

  showWaveMessage(text, ms = 1200) {
    this.waveMsg.textContent = text;
    this.waveMsg.classList.remove('hidden');
    return new Promise(res => setTimeout(() => {
      this.waveMsg.classList.add('hidden');
      res();
    }, ms));
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
