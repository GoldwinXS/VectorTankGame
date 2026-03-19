// Tiered upgrade system
// Each upgrade has a maxTier (1 = single-use, 2-3 = offered again with increasing power).
// label/desc may be functions (tier) => string or plain strings.
// apply receives (player, tier) where tier is 1-indexed.
// Per-tier power is computed from base + (tier-1)*step — no hardcoded value arrays.

const ROMAN = ["I", "II", "III", "IV", "V"];

const UPGRADE_POOL = [
  // ── Core / consumable ────────────────────────────────────────────────────
  {
    id: "repair",
    tag: "defense",
    maxTier: 1,
    label: () => "HULL REPAIR",
    desc: () => "Restore 40 hull points",
    apply: (p) => {
      p.hp = Math.min(p.maxHp, p.hp + 40);
    },
  },

  {
    id: "maxhp",
    tag: "defense",
    maxTier: 2,
    label: (t) => `HULL REINFORCE ${ROMAN[t - 1]}`,
    desc: (t) => `+${t === 1 ? 30 : 45} max hull points`,
    apply: (p, t) => {
      const v = t === 1 ? 30 : 45;
      p.maxHp += v;
      p.hp = Math.min(p.maxHp, p.hp + v);
    },
  },

  {
    id: "life",
    tag: "utility",
    maxTier: 2,
    label: () => "RESERVE HULL",
    desc: () => "+1 extra life — −15 max hull",
    apply: (p) => {
      p.lives++;
      p.maxHp = Math.max(30, p.maxHp - 15);
      p.hp = Math.min(p.hp, p.maxHp);
    },
  },

  // ── Firepower (tiered — each tier gives a larger individual boost) ────────
  {
    id: "damage",
    tag: "firepower",
    maxTier: 3,
    label: (t) => `ORDNANCE ${ROMAN[t - 1]}`,
    desc: (t) => `+${Math.round((0.18 + (t - 1) * 0.06) * 100)}% cannon damage`,
    apply: (p, t) => {
      p.damageMult = Math.min(5.0, p.damageMult * (1.18 + (t - 1) * 0.06));
    },
  },

  {
    id: "reload",
    tag: "firepower",
    maxTier: 3,
    label: (t) => `AUTO-LOADER ${ROMAN[t - 1]}`,
    desc: (t) => `-${Math.round((0.18 + (t - 1) * 0.08) * 100)}% cannon reload`,
    apply: (p, t) => {
      p.reloadMult = Math.max(
        0.25,
        p.reloadMult * (1 - (0.18 + (t - 1) * 0.08)),
      );
    },
  },

  {
    id: "traverse",
    tag: "firepower",
    maxTier: 2,
    label: (t) => `TURRET DRIVE ${ROMAN[t - 1]}`,
    desc: (t) =>
      `+${Math.round((0.35 + (t - 1) * 0.2) * 100)}% turret traverse`,
    apply: (p, t) => {
      p.traverseMult = Math.min(3.0, p.traverseMult * (1.35 + (t - 1) * 0.2));
    },
  },

  {
    id: "barrel",
    tag: "firepower",
    maxTier: 2,
    label: (t) => `EXTENDED BARREL ${ROMAN[t - 1]}`,
    desc: (t) =>
      `+${Math.round((0.2 + (t - 1) * 0.1) * 100)}% projectile speed`,
    apply: (p, t) => {
      p.bulletSpeedMult = Math.min(
        2.5,
        p.bulletSpeedMult * (1.2 + (t - 1) * 0.1),
      );
    },
  },

  {
    id: "burst",
    tag: "firepower",
    maxTier: 2,
    label: (t) => `BURST FIRE ${ROMAN[t - 1]}`,
    desc: (t) => `Fire ${t + 1} rounds per shot (total)`,
    apply: (p, t) => {
      if (p.multiShot < t + 1) p.multiShot = t + 1;
    },
  },

  // ── Defense (tiered) ─────────────────────────────────────────────────────
  {
    id: "armor",
    tag: "defense",
    maxTier: 3,
    label: (t) => `REACTIVE ARMOR ${ROMAN[t - 1]}`,
    desc: (t) => `-${Math.round((0.14 + (t - 1) * 0.08) * 100)}% damage taken`,
    apply: (p, t) => {
      p.armorMult = Math.max(0.1, p.armorMult * (1 - (0.14 + (t - 1) * 0.08)));
    },
  },

  {
    id: "regen",
    tag: "defense",
    maxTier: 2,
    label: (t) => `HULL REGEN ${ROMAN[t - 1]}`,
    desc: (t) => `+${t === 1 ? 2 : 4} HP/sec passive regen`,
    apply: (p, t) => {
      p.regenRate = Math.min(8, (p.regenRate || 0) + (t === 1 ? 2 : 4));
    },
  },

  {
    id: "stabilizer",
    tag: "firepower",
    maxTier: 3,
    label: (t) => `GYRO-STABILIZER ${ROMAN[t - 1]}`,
    desc: (t) => [`-40% accuracy penalty while moving`, `-70% penalty while moving`, `No accuracy penalty while moving`][t - 1],
    apply: (p, t) => {
      p.movementSpreadMult = [0.60, 0.30, 0.0][t - 1];
    },
  },

  // ── Speed (tiered) ───────────────────────────────────────────────────────
  {
    id: "speed",
    tag: "speed",
    maxTier: 3,
    label: (t) => `DRIVE OVERDRIVE ${ROMAN[t - 1]}`,
    desc: (t) => `+${Math.round((0.16 + (t - 1) * 0.08) * 100)}% move speed`,
    apply: (p, t) => {
      p.speedMult = Math.min(2.5, p.speedMult * (1.16 + (t - 1) * 0.08));
    },
  },

  // ── Utility (tiered) ─────────────────────────────────────────────────────
  {
    id: "lifesteal",
    tag: "utility",
    maxTier: 3,
    label: (t) => `VAMPIRE ROUND ${ROMAN[t - 1]}`,
    desc: (t) => `+${[4, 8, 12][t - 1]} HP per enemy destroyed`,
    apply: (p, t) => {
      p.hpPerKill = Math.min(40, (p.hpPerKill || 0) + [4, 8, 12][t - 1]);
    },
  },

  {
    id: "bounty",
    tag: "utility",
    maxTier: 2,
    label: (t) => `KILL BOUNTY ${ROMAN[t - 1]}`,
    desc: (t) => `+${t === 1 ? 10 : 20}% score per kill`,
    apply: (p, t) => {
      p.scoreMult = (p.scoreMult || 1) * (t === 1 ? 1.1 : 1.2);
    },
  },

  {
    id: "field_repair",
    tag: "utility",
    maxTier: 2,
    label: (t) => `FIELD REPAIR ${ROMAN[t - 1]}`,
    desc: (t) => `Component damage clears ${t === 1 ? "3×" : "8×"} faster`,
    apply: (p, t) => {
      p.repairRate = Math.min(10, (p.repairRate || 1) * (t === 1 ? 3.0 : 8.0));
    },
  },

  // ── Build archetypes (single-use — strong by design) ─────────────────────
  {
    id: "glass",
    tag: "firepower",
    maxTier: 1,
    label: () => "GLASS CANNON",
    desc: () => "+55% damage — +32% damage taken",
    apply: (p) => {
      p.damageMult = Math.min(6.0, p.damageMult * 1.55);
      p.armorMult = Math.min(2.0, p.armorMult * 1.32);
    },
  },

  {
    id: "fortress",
    tag: "defense",
    maxTier: 1,
    label: () => "FORTRESS",
    desc: () => "-40% dmg taken, -22% move speed",
    apply: (p) => {
      p.armorMult = Math.max(0.08, p.armorMult * 0.6);
      p.speedMult = Math.max(0.4, p.speedMult * 0.78);
    },
  },

  {
    id: "sniper",
    tag: "firepower",
    maxTier: 1,
    label: () => "SNIPER PROTOCOL",
    desc: () => "+40% proj speed, +35% traverse",
    apply: (p) => {
      p.bulletSpeedMult = Math.min(2.5, p.bulletSpeedMult * 1.4);
      p.traverseMult = Math.min(3.0, p.traverseMult * 1.35);
    },
  },

  {
    id: "rampage",
    tag: "utility",
    maxTier: 1,
    label: () => "RAMPAGE",
    desc: () => "+25% speed and +25% damage",
    apply: (p) => {
      p.speedMult = Math.min(2.5, p.speedMult * 1.25);
      p.damageMult = Math.min(5.0, p.damageMult * 1.25);
    },
  },

  {
    id: "overclock",
    tag: "firepower",
    maxTier: 1,
    label: () => "OVERCLOCK",
    desc: () => "+40% traverse, -22% reload",
    apply: (p) => {
      p.traverseMult = Math.min(3.0, p.traverseMult * 1.4);
      p.reloadMult = Math.max(0.25, p.reloadMult * 0.78);
    },
  },

  {
    id: "sprint",
    tag: "speed",
    maxTier: 1,
    label: () => "NITRO DRIVE",
    desc: () => "+30% move speed",
    apply: (p) => {
      p.speedMult = Math.min(2.5, p.speedMult * 1.3);
    },
  },

  {
    id: "wide",
    tag: "firepower",
    maxTier: 1,
    label: () => "WIDE PATTERN",
    desc: () => "Always 3 rounds per shot — −15% damage per shell",
    apply: (p) => {
      p.multiShot = Math.max(p.multiShot, 3);
      p.damageMult = Math.max(0.3, p.damageMult * 0.85);
    },
  },

  // ── MG upgrades (tiered) ─────────────────────────────────────────────────
  {
    id: "mg_drum",
    tag: "firepower",
    maxTier: 3,
    label: (t) => `EXTENDED FEED ${ROMAN[t - 1]}`,
    desc: (t) => `+${[10, 16, 22][t - 1]} MG rounds per magazine`,
    apply: (p, t) => {
      const v = [10, 16, 22][t - 1];
      p.mgMaxAmmo += v;
      p.mgAmmo = Math.min(p.mgAmmo + v, p.mgMaxAmmo);
    },
  },

  {
    id: "mg_reload",
    tag: "firepower",
    maxTier: 2,
    label: (t) => `MG RAPID CYCLE ${ROMAN[t - 1]}`,
    desc: (t) => `-${t === 1 ? 30 : 45}% MG reload time`,
    apply: (p, t) => {
      p.mgReloadMult = Math.max(
        0.25,
        (p.mgReloadMult ?? 1) * (t === 1 ? 0.7 : 0.55),
      );
    },
  },

  {
    id: "mg_ap",
    tag: "firepower",
    maxTier: 4,
    label: (t) => `ARMOUR-PIERCING ${ROMAN[t - 1]}`,
    desc: (t) =>
      `+${Math.round((0.1 + (t - 1) * 0.1) * 100)}% MG bullet damage`,
    apply: (p, t) => {
      p.mgDamageMult = Math.min(
        6.0,
        (p.mgDamageMult ?? 1) * (1.1 + (t - 1) * 0.1),
      );
    },
  },

  {
    id: "mg_precision",
    tag: "firepower",
    maxTier: 5,
    label: (t) => `RANGEFINDER ${ROMAN[t - 1]}`,
    desc: (t) => `-${Math.round((0.3 + (t - 1) * 0.2) * 100)}% MG spread`,
    apply: (p, t) => {
      p.mgSpreadMult = Math.max(
        0.08,
        (p.mgSpreadMult ?? 1) * (1.3 + (t - 1) * 0.2),
      );
    },
  },
];

const TAG_COLORS = {
  firepower: "#ff8800",
  defense: "#8844ff",
  speed: "#00ffff",
  utility: "#00ff88",
};

const resolveStr = (v, tier) => (typeof v === "function" ? v(tier) : v);

export class UpgradePicker {
  constructor() {
    this._el = document.getElementById("upgrade-screen");
    this._choicesEl = document.getElementById("upgrade-choices");
    this._resolve = null;
    this._taken = new Map(); // id → tier count taken this run
  }

  resetRun() {
    this._taken.clear();
  }

  open(player, waveNum, stats) {
    this._player = player;
    this._renderStats(waveNum, stats);
    this._renderChoices();
    this._el.classList.remove("hidden");
    return new Promise((res) => {
      this._resolve = res;
    });
  }

  _close(upgrade) {
    if (upgrade) {
      const tier = (this._taken.get(upgrade.id) ?? 0) + 1;
      upgrade.apply(this._player, tier);
      this._taken.set(upgrade.id, tier);
    }
    this._el.classList.add("hidden");
    if (this._resolve) {
      this._resolve(upgrade);
      this._resolve = null;
    }
  }

  _renderStats(waveNum, stats) {
    const acc =
      stats.shotsFired > 0
        ? Math.round((stats.shotsHit / stats.shotsFired) * 100)
        : 0;
    document.getElementById("upg-wave").textContent =
      `WAVE  ${waveNum}  CLEARED`;
    document.getElementById("upg-score").textContent = stats.score;
    document.getElementById("upg-accuracy").textContent = acc + "%";
    document.getElementById("upg-hp").textContent =
      `${Math.ceil(stats.hpRemaining)} / ${stats.maxHp}`;
  }

  _renderChoices() {
    // Available = not yet at max tier
    const available = UPGRADE_POOL.filter(
      (u) => (this._taken.get(u.id) ?? 0) < u.maxTier,
    );
    const pool =
      available.length >= 3
        ? available
        : UPGRADE_POOL.filter(
            (u) => (this._taken.get(u.id) ?? 0) < u.maxTier || u.maxTier === 1,
          );

    // Shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    this._choicesEl.innerHTML = "";
    for (const upg of pool.slice(0, 3)) {
      const tier = (this._taken.get(upg.id) ?? 0) + 1; // tier if picked now
      const tagColor = TAG_COLORS[upg.tag] || "#336677";
      const label = resolveStr(upg.label, tier);
      const desc = resolveStr(upg.desc, tier);
      // Show tier progress for multi-tier upgrades
      const tierBadge =
        upg.maxTier > 1
          ? `<div class="upg-tier">${tier} / ${upg.maxTier}</div>`
          : "";
      const card = document.createElement("div");
      card.className = "upg-card";
      card.innerHTML = `
        <div class="upg-tag" style="color:${tagColor};border-color:${tagColor}">${upg.tag.toUpperCase()}</div>
        <div class="upg-name">${label}</div>
        ${tierBadge}
        <div class="upg-desc">${desc}</div>`;
      card.addEventListener("click", () => this._close(upg));
      this._choicesEl.appendChild(card);
    }
  }
}
