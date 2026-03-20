// Contextual bandit RL for tactic selection.
//
// State: 2 HP buckets × 2 composition buckets = 4 states.
//   HP:   0 = nominal (>40%), 1 = low (≤40%)
//   Comp: 0 = mobile-heavy (fast/scout/swarm/lancer dominate)
//         1 = firepower-heavy (tanky/stug/gunner/mortar/hover/drone dominate)
//   State index = compBucket * 2 + hpBucket
//
// Weights: w[4][4] — how effective each tactic has been in each state.
// Each session = one NN_ADAPT_INTERVAL window (~22 s). After each session:
//   reward = damage dealt to player as fraction of max HP.
//   Effective tactics grow; unused ones decay slowly.
//
// To export trained weights, run in the browser console:
//   localStorage.getItem('vec_nn_q')
// Paste the JSON into DEFAULT_WEIGHTS below to ship a warm-started AI.

export const TACTICS = ['RUSH', 'FLANK', 'SUPPRESS', 'ENCIRCLE'];

// State labels (rows correspond to DEFAULT_WEIGHTS rows)
export const STATE_LABELS = [
  'MOBILE + NOMINAL HP',
  'MOBILE + LOW HP',
  'FIREPOWER + NOMINAL HP',
  'FIREPOWER + LOW HP',
];

// ── Starting weights ───────────────────────────────────────────────────────────
// Rows = states (0=mobile/nominal, 1=mobile/low, 2=fp/nominal, 3=fp/low)
// Cols = tactics (RUSH, FLANK, SUPPRESS, ENCIRCLE)
// Replace with values from localStorage.getItem('vec_nn_q') after training.
const DEFAULT_WEIGHTS = [
  [1.0, 1.0, 1.0, 1.0],
  [1.0, 1.0, 1.0, 1.0],
  [1.0, 1.0, 1.0, 1.0],
  [1.0, 1.0, 1.0, 1.0],
];

export function compBucketOf(composition) {
  const mobile = new Set(['fast', 'scout', 'swarm', 'lancer']);
  const mobileCount = composition.filter(t => mobile.has(t)).length;
  return mobileCount > composition.length / 2 ? 0 : 1;
}

function _stateOf(hpRatio, compBucket) {
  const hpBucket = hpRatio > 0.4 ? 0 : 1;
  return compBucket * 2 + hpBucket;
}

export class TacticSelector {
  constructor() {
    const saved = localStorage.getItem('vec_nn_q');
    // Validate saved data: must be 4×4, otherwise reset to default
    let loaded = saved ? JSON.parse(saved) : null;
    if (!loaded || loaded.length !== 4 || loaded[0].length !== 4) loaded = null;
    this._w = loaded ? loaded : DEFAULT_WEIGHTS.map(row => [...row]);

    // Current session tracking
    this._state     = 0;
    this._compBucket = 0;
    this._action    = 0;
    this._hpSnap    = 1.0;
  }

  // Called at wave start, and internally after each selectNext().
  beginSession(hpRatio, compBucket, tacticIdx) {
    this._compBucket = compBucket;
    this._state      = _stateOf(hpRatio, compBucket);
    this._action     = tacticIdx;
    this._hpSnap     = hpRatio;
  }

  // Record outcome of the just-finished session, then pick the next tactic.
  selectNext(hpRatio, compBucket) {
    // ── Reward: damage dealt this session ─────────────────────────────────────
    const damage = Math.max(0, this._hpSnap - hpRatio);
    const reward = Math.min(damage * 2.5, 1.0); // 40% damage = full reward

    if (reward > 0.02) {
      const s = this._state, a = this._action;
      this._w[s][a] = Math.min(8.0, this._w[s][a] + reward);
      for (let i = 0; i < 4; i++) {
        if (i !== a) this._w[s][i] = Math.max(0.3, this._w[s][i] * 0.93);
      }
      localStorage.setItem('vec_nn_q', JSON.stringify(this._w));
    }

    // ── Pick next tactic ──────────────────────────────────────────────────────
    const ns  = _stateOf(hpRatio, compBucket);
    const row = this._w[ns];
    const sum = row.reduce((a, b) => a + b, 0);
    const probs = row.map(w => w / sum);

    let idx;
    if (Math.random() < 0.12) {
      idx = Math.floor(Math.random() * 4);
    } else {
      let r = Math.random(), cum = 0;
      idx = 3;
      for (let i = 0; i < 4; i++) { cum += probs[i]; if (r <= cum) { idx = i; break; } }
    }

    this.beginSession(hpRatio, compBucket, idx);
    return { tactic: TACTICS[idx], idx };
  }

  // End-of-wave bonus reinforcement on top of per-session rewards.
  train(chosenIdx, challengeScore) {
    if (challengeScore < 0.05) return;
    this._w[this._state][chosenIdx] =
      Math.min(8.0, this._w[this._state][chosenIdx] + challengeScore * 0.5);
    localStorage.setItem('vec_nn_q', JSON.stringify(this._w));
  }

  resetWeights() {
    this._w = DEFAULT_WEIGHTS.map(row => [...row]);
    localStorage.removeItem('vec_nn_q');
    localStorage.removeItem('vec_nn_weights'); // clear old key
  }

  // Probabilities for the current state (for HUD display)
  get probs() {
    const row = this._w[this._state];
    const sum = row.reduce((a, b) => a + b, 0);
    return row.map(w => w / sum);
  }

  // Returns HTML for the game-over AI analysis panel.
  summary(waveCount) {
    if (waveCount < 2) {
      return '<p class="ai-note">Not enough combat data yet — the AI is still calibrating.</p>';
    }

    const compLabels = ['VS MOBILE FORCES', 'VS FIREPOWER'];
    const hpLabels   = ['NOMINAL HP', 'LOW HP'];
    let rows = '';
    for (let comp = 0; comp < 2; comp++) {
      for (let hp = 0; hp < 2; hp++) {
        const s   = comp * 2 + hp;
        const row = this._w[s];
        const sum = row.reduce((a, b) => a + b, 0);
        const best = row.indexOf(Math.max(...row));
        const pct  = Math.round((row[best] / sum) * 100);
        rows += `<div class="ai-state-row">
          <span class="ai-state-label">${compLabels[comp]} · ${hpLabels[hp]}</span>
          <span class="ai-tactic-pill">${TACTICS[best]}</span>
          <span class="ai-tactic-pct">${pct}%</span>
        </div>`;
      }
    }

    // Overall best tactic by average weight
    const avg  = TACTICS.map((_, a) => this._w.reduce((s, row) => s + row[a], 0) / 4);
    const asum = avg.reduce((a, b) => a + b, 0);
    const top  = avg.indexOf(Math.max(...avg));
    const topPct = Math.round((avg[top] / asum) * 100);

    return `${rows}<p class="ai-note">After ${waveCount} waves the AI concluded <strong>${TACTICS[top]}</strong> was your greatest weakness overall (${topPct}% weight).</p>`;
  }
}
