// TacticSelector — 3 inputs → 2 hidden → 4 outputs
// Learns which combat tactic stresses this specific player the most.
//
// Inputs:  [healthLostRatio, inaccuracy, mobilityScore]      (all 0–1)
// Outputs: [P_RUSH, P_FLANK, P_SUPPRESS, P_ENCIRCLE]        (softmax)
//
// Training: REINFORCE — after each wave, reinforce the tactic that was used
// in proportion to how much it challenged the player.

export const TACTICS = ['RUSH', 'FLANK', 'SUPPRESS', 'ENCIRCLE'];

export class TacticSelector {
  constructor() {
    const r = () => (Math.random() - 0.5) * 0.5;
    // 2 hidden neurons — intentionally tiny
    this.W1 = [[r(),r(),r()], [r(),r(),r()]];           // 2×3
    this.W2 = [[r(),r()],[r(),r()],[r(),r()],[r(),r()]]; // 4×2
    this.b1 = [0, 0];
    this.b2 = [0, 0, 0, 0];
    this.lr = 0.18;

    this._lastX    = null;
    this._lastH    = null;
    this._probs    = [0.25, 0.25, 0.25, 0.25];
  }

  _sig(x) { return 1 / (1 + Math.exp(-Math.max(-15, Math.min(15, x)))); }

  _softmax(arr) {
    const max = Math.max(...arr);
    const ex  = arr.map(v => Math.exp(v - max));
    const sum = ex.reduce((a, b) => a + b, 0);
    return ex.map(v => v / sum);
  }

  _forward(x) {
    this._lastX = x;
    this._lastH = this.W1.map((row, i) =>
      this._sig(row.reduce((s, w, j) => s + w * x[j], 0) + this.b1[i])
    );
    const logits = this.W2.map((row, i) =>
      row.reduce((s, w, j) => s + w * this._lastH[j], 0) + this.b2[i]
    );
    this._probs = this._softmax(logits);
    return this._probs;
  }

  // Run forward pass, return the highest-probability tactic
  selectTactic(healthLostRatio, inaccuracy, mobilityScore) {
    const probs = this._forward([healthLostRatio, inaccuracy, mobilityScore]);
    const idx   = probs.indexOf(Math.max(...probs));
    return { tactic: TACTICS[idx], idx };
  }

  // REINFORCE: push probability of chosenIdx up if challenge was high
  train(chosenIdx, challengeScore) {
    if (!this._lastX || challengeScore < 0.03) return;
    const s = this.lr * challengeScore;

    // Output gradient: (one_hot - probs) * scale
    const dOut = this._probs.map((p, i) => s * ((i === chosenIdx ? 1 : 0) - p));

    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 2; j++) this.W2[i][j] += dOut[i] * this._lastH[j];
      this.b2[i] += dOut[i];
    }

    const dH = this._lastH.map((h, j) => {
      const d = this.W2.reduce((s, row, i) => s + row[j] * dOut[i], 0);
      return d * h * (1 - h);
    });
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 3; j++) this.W1[i][j] += dH[i] * this._lastX[j];
      this.b1[i] += dH[i];
    }
  }

  get probs() { return [...this._probs]; }

  summary(waveCount) {
    if (waveCount < 2) return 'Not enough data yet.';
    const idx = this._probs.indexOf(Math.max(...this._probs));
    const pct = Math.round(this._probs[idx] * 100);
    return `After ${waveCount} waves the AI favoured ${TACTICS[idx]} (${pct}% weight) — that was your weak point.`;
  }
}
