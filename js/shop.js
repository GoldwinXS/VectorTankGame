const ITEMS = [
  { id: 'repair',  label: 'HULL REPAIR',    desc: 'Restore 60 HP',       cost: 150 },
  { id: 'speed',   label: 'DRIVE SYSTEM',   desc: '+20% move speed',      cost: 300 },
  { id: 'damage',  label: 'ORDNANCE +',     desc: '+30% bullet damage',   cost: 350 },
  { id: 'life',    label: 'RESERVE HULL',   desc: '+1 extra life',        cost: 500 },
  { id: 'armor',   label: 'REACTIVE ARMOR', desc: '-15% damage taken',    cost: 400 },
];

export class Shop {
  constructor() {
    this._el      = document.getElementById('shop-screen');
    this._scoreEl = document.getElementById('shop-score');
    this._livesEl = document.getElementById('shop-lives');
    this._itemsEl = document.getElementById('shop-items');
    this._resolve = null;

    document.getElementById('btn-shop-skip').addEventListener('click', () => this._close());
  }

  open(player, scoreRef) {
    this._player   = player;
    this._scoreRef = scoreRef;
    this._render();
    this._el.classList.remove('hidden');
    return new Promise(res => { this._resolve = res; });
  }

  _close() {
    this._el.classList.add('hidden');
    document.getElementById('canvas').requestPointerLock();
    if (this._resolve) { this._resolve(); this._resolve = null; }
  }

  _applyItem(item) {
    switch (item.id) {
      case 'repair': this._player.hp = Math.min(this._player.maxHp, this._player.hp + 60); break;
      case 'speed':  this._player.speedMult  = Math.min(2.2, this._player.speedMult  * 1.20); break;
      case 'damage': this._player.damageMult = Math.min(3.5, this._player.damageMult * 1.30); break;
      case 'life':   this._player.lives++; break;
      case 'armor':  this._player.armorMult  = Math.max(0.25, this._player.armorMult * 0.85); break;
    }
    this._scoreRef.value -= item.cost;
  }

  _render() {
    const p = this._player;
    this._scoreEl.textContent = this._scoreRef.value;
    this._livesEl.textContent = p.lives;

    // ── Player stats panel ─────────────────────────────────────────────────
    const hpPct = Math.round((p.hp / p.maxHp) * 100);
    document.getElementById('sstat-hp-bar').style.width     = hpPct + '%';
    document.getElementById('sstat-hp-val').textContent     = `${p.hp} / ${p.maxHp}`;
    document.getElementById('sstat-speed').textContent      = `${Math.round(p.speedMult * 100)}%`;
    document.getElementById('sstat-damage').textContent     = `${Math.round(p.damageMult * 100)}%`;
    document.getElementById('sstat-armor').textContent      = `−${Math.round((1 - p.armorMult) * 100)}%`;

    // ── Shop items ─────────────────────────────────────────────────────────
    this._itemsEl.innerHTML = '';
    for (const item of ITEMS) {
      const canAfford = this._scoreRef.value >= item.cost;
      const btn = document.createElement('div');
      btn.className = 'shop-item' + (canAfford ? '' : ' shop-item--disabled');
      btn.innerHTML = `
        <span class="shop-name">${item.label}</span>
        <span class="shop-desc">${item.desc}</span>
        <span class="shop-cost">${item.cost} PTS</span>`;
      if (canAfford) {
        btn.addEventListener('click', () => { this._applyItem(item); this._render(); });
      }
      this._itemsEl.appendChild(btn);
    }
  }
}
