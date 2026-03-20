// Shop items are incremental improvements — weaker than wave upgrades, bought with score.
// Costs are high; benefits are small to create meaningful spend decisions.
const ITEMS = [
  { id: "repair", label: "HULL REPAIR", desc: "Restore 35 HP", cost: 200 },
  {
    id: "maxhp",
    label: "HULL REINFORCE",
    desc: "+5 max hull points",
    cost: 500,
  },
  { id: "speed", label: "DRIVE SYSTEM", desc: "+12% move speed", cost: 500 },
  { id: "damage", label: "ORDNANCE +", desc: "+15% cannon damage", cost: 550 },
  { id: "life", label: "RESERVE HULL", desc: "+1 extra life", cost: 950 },
  {
    id: "armor",
    label: "REACTIVE ARMOR",
    desc: "-5% damage taken",
    cost: 650,
  },
  {
    id: "reload",
    label: "QUICK LOADER",
    desc: "-12% cannon reload time",
    cost: 420,
  },
  {
    id: "barrel",
    label: "BARREL COAT",
    desc: "+15% projectile speed",
    cost: 280,
  },
  {
    id: "mg_drum",
    label: "MG DRUM MAG",
    desc: "+8 MG rounds per magazine",
    cost: 280,
  },
  {
    id: "mg_ap",
    label: "MG AP ROUNDS",
    desc: "+10% MG bullet damage",
    cost: 350,
  },
  {
    id: "traverse",
    label: "TURRET SERVO",
    desc: "+20% turret traverse speed",
    cost: 300,
  },
  {
    id: "stabilizer",
    label: "GYRO STABILIZER",
    desc: "−25% aim penalty while moving",
    cost: 480,
  },
  {
    id: "regen",
    label: "HULL REGEN CELL",
    desc: "+1 HP/sec passive regeneration",
    cost: 420,
  },
];

export class Shop {
  constructor() {
    this._el = document.getElementById("shop-screen");
    this._scoreEl = document.getElementById("shop-score");
    this._livesEl = document.getElementById("shop-lives");
    this._itemsEl = document.getElementById("shop-items");
    this._resolve = null;
    this._history = []; // {label, count} for each item bought across the run

    document
      .getElementById("btn-shop-skip")
      .addEventListener("click", () => this._close());
  }

  resetHistory() { this._history = []; }

  // Returns ordered purchase log: [{label, count}]
  getHistory() { return this._history; }

  open(player, scoreRef) {
    this._player = player;
    this._scoreRef = scoreRef;
    this._render();
    this._el.classList.remove("hidden");
    return new Promise((res) => {
      this._resolve = res;
    });
  }

  _close() {
    this._el.classList.add("hidden");
    if (!("ontouchstart" in window))
      document.getElementById("canvas").requestPointerLock();
    if (this._resolve) {
      this._resolve();
      this._resolve = null;
    }
  }

  _applyItem(item) {
    const p = this._player;
    switch (item.id) {
      case "repair":
        p.hp = Math.min(p.maxHp, p.hp + 35);
        break;
      case "maxhp":
        p.maxHp += 5;
        p.hp = Math.min(p.maxHp, p.hp + 5);
        break;
      case "speed":
        p.speedMult = Math.min(2.5, p.speedMult * 1.12);
        break;
      case "damage":
        p.damageMult = Math.min(4.0, p.damageMult * 1.15);
        break;
      case "life":
        p.lives++;
        break;
      case "armor":
        p.armorMult = Math.max(0.2, p.armorMult * 0.95);
        break;
      case "reload":
        p.reloadMult = Math.max(0.4, p.reloadMult * 0.88);
        break;
      case "barrel":
        p.bulletSpeedMult = Math.min(2.0, p.bulletSpeedMult * 1.15);
        break;
      case "mg_drum":
        p.mgMaxAmmo += 8;
        p.mgAmmo = Math.min(p.mgAmmo + 8, p.mgMaxAmmo);
        break;
      case "mg_ap":
        p.mgDamageMult = Math.min(5.0, (p.mgDamageMult ?? 1) * 1.1);
        break;
      case "traverse":
        p.traverseMult = Math.min(3.0, p.traverseMult * 1.2);
        break;
      case "stabilizer":
        p.movementSpreadMult = Math.max(0.0, (p.movementSpreadMult ?? 1) * 0.75);
        break;
      case "regen":
        p.regenRate = Math.min(8, (p.regenRate || 0) + 1);
        break;
    }
    // Track for upgrade log
    const existing = this._history.find((h) => h.label === item.label);
    if (existing) existing.count++;
    else this._history.push({ label: item.label, count: 1 });
    this._scoreRef.value -= item.cost;
  }

  _render() {
    const p = this._player;
    this._scoreEl.textContent = this._scoreRef.value;
    this._livesEl.textContent = p.lives;

    // ── Player stats panel ─────────────────────────────────────────────────
    const hpPct = Math.round((p.hp / p.maxHp) * 100);
    document.getElementById("sstat-hp-bar").style.width = hpPct + "%";
    document.getElementById("sstat-hp-val").textContent =
      `${Math.ceil(p.hp)} / ${p.maxHp}`;
    document.getElementById("sstat-speed").textContent =
      `${Math.round(p.speedMult * 100)}%`;
    document.getElementById("sstat-damage").textContent =
      `${Math.round(p.damageMult * 100)}%`;
    document.getElementById("sstat-reload").textContent =
      `${Math.round((1 / p.reloadMult) * 100)}%`;
    document.getElementById("sstat-armor").textContent =
      `−${Math.round((1 - p.armorMult) * 100)}%`;
    document.getElementById("sstat-traverse").textContent =
      `${Math.round((p.traverseMult ?? 1) * 100)}%`;

    // ── Shop items ─────────────────────────────────────────────────────────
    this._itemsEl.innerHTML = "";
    for (const item of ITEMS) {
      const canAfford = this._scoreRef.value >= item.cost;
      const btn = document.createElement("div");
      btn.className = "shop-item" + (canAfford ? "" : " shop-item--disabled");
      btn.innerHTML = `
        <span class="shop-name">${item.label}</span>
        <span class="shop-desc">${item.desc}</span>
        <span class="shop-cost">${item.cost} PTS</span>`;
      if (canAfford) {
        btn.addEventListener("click", () => {
          this._applyItem(item);
          this._render();
        });
      }
      this._itemsEl.appendChild(btn);
    }
  }
}
