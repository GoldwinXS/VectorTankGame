// AdaptiveTactics — replaces the original NN with a simple weighted-history system.
// Each tactic has a weight that increases when it successfully challenges the player.
// After each wave, the tactic weight is reinforced by the challenge score (0-1).
// This achieves the same "AI learns your weakness" narrative far more reliably
// than REINFORCE on a tiny noisy dataset, and the probability bars work identically.

export const TACTICS = ['RUSH', 'FLANK', 'SUPPRESS', 'ENCIRCLE'];

export class TacticSelector {
  constructor() {
    // Persist weights across sessions so the AI keeps learning the player
    const saved = localStorage.getItem('vec_nn_weights');
    this._weights = saved ? JSON.parse(saved) : [1.0, 1.0, 1.0, 1.0];
    this._probs   = [0.25, 0.25, 0.25, 0.25];
    this._lastIdx = 0;
    this._refreshProbs();
  }

  resetWeights() {
    this._weights = [1.0, 1.0, 1.0, 1.0];
    this._refreshProbs();
    localStorage.removeItem('vec_nn_weights');
  }

  _refreshProbs() {
    const sum = this._weights.reduce((a, b) => a + b, 0);
    this._probs = this._weights.map(w => w / sum);
  }

  // API-compatible with the previous NN version (args unused — weight-based selection).
  // 15% epsilon-greedy so no tactic is ever fully abandoned.
  selectTactic(_healthLostRatio, _inaccuracy, _mobilityScore) {
    this._refreshProbs();
    if (Math.random() < 0.15) {
      const idx = Math.floor(Math.random() * TACTICS.length);
      this._lastIdx = idx;
      return { tactic: TACTICS[idx], idx };
    }
    let r = Math.random(), cum = 0;
    for (let i = 0; i < this._probs.length; i++) {
      cum += this._probs[i];
      if (r <= cum) { this._lastIdx = i; return { tactic: TACTICS[i], idx: i }; }
    }
    this._lastIdx = this._probs.length - 1;
    return { tactic: TACTICS[this._lastIdx], idx: this._lastIdx };
  }

  // Reinforce the chosen tactic proportional to how much it challenged the player.
  // Gentle decay on all others prevents permanent single-tactic dominance.
  train(chosenIdx, challengeScore) {
    if (challengeScore < 0.05) return;
    this._weights[chosenIdx] = Math.min(8.0, this._weights[chosenIdx] + challengeScore * 1.0);
    for (let i = 0; i < this._weights.length; i++) {
      if (i !== chosenIdx) this._weights[i] = Math.max(0.4, this._weights[i] * 0.92);
    }
    this._refreshProbs();
    localStorage.setItem('vec_nn_weights', JSON.stringify(this._weights));
  }

  get probs() { return [...this._probs]; }

  summary(waveCount) {
    if (waveCount < 2) return 'Not enough combat data yet.';
    const idx = this._probs.indexOf(Math.max(...this._probs));
    const pct = Math.round(this._probs[idx] * 100);
    return `After ${waveCount} waves the AI adapted towards ${TACTICS[idx]} tactics (${pct}% weight). That approach exploited your weaknesses most effectively.`;
  }
}
