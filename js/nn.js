// Contextual bandit RL for tactic selection.
//
// State: player HP bracket — 3 buckets (healthy >60%, hurt 30-60%, critical <30%).
// Action: one of 4 tactics (RUSH, FLANK, SUPPRESS, ENCIRCLE).
// Weights: w[state][action] — how effective each tactic has been in each HP context.
//
// Each "session" is one 22-second window (driven by NN_ADAPT_INTERVAL in main.js).
// After each session: reward = damage dealt to player as fraction of max HP.
// Effective tactic weights grow; ineffective ones decay slowly.
// Weights persist in localStorage so the AI keeps improving across runs.
//
// After playing and training the AI, you can export the current weights by running
// this in the browser console:  localStorage.getItem('vec_nn_q')
// Paste the result into DEFAULT_WEIGHTS below to ship a warm-started AI.

export const TACTICS = ['RUSH', 'FLANK', 'SUPPRESS', 'ENCIRCLE'];

// State labels (informational only)
export const STATES = ['HEALTHY', 'HURT', 'CRITICAL'];

// ── Default starting weights (rows = HP states, cols = tactics) ───────────────
// Replace with trained values after a play session to give players a warm start.
// Format: [[healthy_R, healthy_F, healthy_S, healthy_E],
//          [hurt_R,    hurt_F,    hurt_S,    hurt_E   ],
//          [critical_R,critical_F,critical_S,critical_E]]
const DEFAULT_WEIGHTS = [
  [1.0, 1.0, 1.0, 1.0],
  [1.0, 1.0, 1.0, 1.0],
  [1.0, 1.0, 1.0, 1.0],
];

function _stateOf(hpRatio) {
  return hpRatio > 0.6 ? 0 : hpRatio > 0.3 ? 1 : 2;
}

export class TacticSelector {
  constructor() {
    const saved = localStorage.getItem('vec_nn_q');
    // w[state][action] — additive weights, grow with reward, decay without use
    this._w = saved ? JSON.parse(saved) : DEFAULT_WEIGHTS.map(row => [...row]);

    // Current session tracking
    this._state  = 0;   // HP state bucket at session start
    this._action = 0;   // tactic index active this session
    this._hpSnap = 1.0; // player HP ratio when session started
  }

  // Call once when a wave starts (or when the first tactic is assigned).
  // Records the starting conditions for the first session of the wave.
  beginSession(hpRatio, tacticIdx) {
    this._state  = _stateOf(hpRatio);
    this._action = tacticIdx;
    this._hpSnap = hpRatio;
  }

  // Call at each adapt interval (every 22 s). Records outcome of the just-finished
  // session, updates weights, then picks the next tactic.
  // Returns { tactic, idx }.
  selectNext(hpRatio) {
    // ── Record outcome of the session that just ended ─────────────────────────
    const damage = Math.max(0, this._hpSnap - hpRatio);
    // Amplify so 15% damage = reward 0.375, 40% = 1.0 (capped)
    const reward = Math.min(damage * 2.5, 1.0);

    if (reward > 0.02) {
      const s = this._state, a = this._action;
      this._w[s][a] = Math.min(8.0, this._w[s][a] + reward);
      for (let i = 0; i < 4; i++) {
        if (i !== a) this._w[s][i] = Math.max(0.3, this._w[s][i] * 0.93);
      }
      localStorage.setItem('vec_nn_q', JSON.stringify(this._w));
    }

    // ── Pick next tactic for the new state ────────────────────────────────────
    const ns  = _stateOf(hpRatio);
    const row = this._w[ns];
    const sum = row.reduce((a, b) => a + b, 0);
    const probs = row.map(w => w / sum);

    let idx;
    if (Math.random() < 0.12) {
      // Epsilon-greedy exploration — try something unexpected
      idx = Math.floor(Math.random() * 4);
    } else {
      let r = Math.random(), cum = 0;
      idx = 3;
      for (let i = 0; i < 4; i++) {
        cum += probs[i];
        if (r <= cum) { idx = i; break; }
      }
    }

    // Begin tracking the new session
    this._state  = ns;
    this._action = idx;
    this._hpSnap = hpRatio;
    return { tactic: TACTICS[idx], idx };
  }

  // End-of-wave bonus reinforcement on top of session rewards.
  // challengeScore (0-1): how much the overall wave challenged the player.
  train(chosenIdx, challengeScore) {
    if (challengeScore < 0.05) return;
    this._w[this._state][chosenIdx] =
      Math.min(8.0, this._w[this._state][chosenIdx] + challengeScore * 0.5);
    localStorage.setItem('vec_nn_q', JSON.stringify(this._w));
  }

  // Reset to default weights (clears learned data)
  resetWeights() {
    this._w = DEFAULT_WEIGHTS.map(row => [...row]);
    localStorage.removeItem('vec_nn_q');
    // Also clear old weight key from previous versions
    localStorage.removeItem('vec_nn_weights');
  }

  // Probabilities for the current HP state (for HUD display)
  get probs() {
    const row = this._w[this._state];
    const sum = row.reduce((a, b) => a + b, 0);
    return row.map(w => w / sum);
  }

  // Export weights as a JSON string (paste into DEFAULT_WEIGHTS above)
  getWeightsJSON() {
    return JSON.stringify(this._w);
  }

  // Returns an HTML string for the game-over AI analysis panel.
  summary(waveCount) {
    if (waveCount < 2) return '<p class="ai-note">Not enough combat data yet — the AI is still calibrating.</p>';

    const stateLabels = ['WHEN HEALTHY', 'WHEN HURT', 'WHEN CRITICAL'];
    const stateRows = this._w.map((row, s) => {
      const sum  = row.reduce((a, b) => a + b, 0);
      const best = row.indexOf(Math.max(...row));
      const pct  = Math.round((row[best] / sum) * 100);
      return `<div class="ai-state-row">
        <span class="ai-state-label">${stateLabels[s]}</span>
        <span class="ai-tactic-pill">${TACTICS[best]}</span>
        <span class="ai-tactic-pct">${pct}%</span>
      </div>`;
    }).join('');

    // Overall best tactic by average weight
    const avg  = TACTICS.map((_, a) => this._w.reduce((s, row) => s + row[a], 0) / 3);
    const asum = avg.reduce((a, b) => a + b, 0);
    const top  = avg.indexOf(Math.max(...avg));
    const topPct = Math.round((avg[top] / asum) * 100);

    return `${stateRows}
      <p class="ai-note">After ${waveCount} waves the AI concluded <strong>${TACTICS[top]}</strong> was your greatest weakness (${topPct}% overall weight). Reset AI memory in Settings for a fresh start.</p>`;
  }
}
