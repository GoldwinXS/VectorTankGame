// Synthesized audio engine — no external files required.
// Techno beat generated with Web Audio API oscillators + noise buffers.
// All settings persist to localStorage.

class AudioEngine {
  constructor() {
    this.ctx        = null;
    this._master    = null;
    this._musicBus  = null;
    this._sfxBus    = null;
    this._started   = false;
    this._beatCount = 0;
    this._nextBeat  = 0;
    this._BPM       = 140;

    // Persisted settings
    this.masterVol = parseFloat(localStorage.getItem('vec_vol_master') ?? '0.5');
    this.musicVol  = parseFloat(localStorage.getItem('vec_vol_music')  ?? '0.35');
    this.sfxVol    = parseFloat(localStorage.getItem('vec_vol_sfx')    ?? '0.65');
    this.muted     = localStorage.getItem('vec_muted') === 'true';

    // SFX throttle
    this._lastMG        = -1;
    this._lastCannon    = -1;
  }

  // Call once from a user-gesture handler (btn-start click)
  start() {
    if (this._started) return;
    this._started = true;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this._master = this.ctx.createGain();
    this._master.gain.value = this.muted ? 0 : this.masterVol;
    this._master.connect(this.ctx.destination);

    this._musicBus = this.ctx.createGain();
    this._musicBus.gain.value = this.musicVol;
    this._musicBus.connect(this._master);

    this._sfxBus = this.ctx.createGain();
    this._sfxBus.gain.value = this.sfxVol;
    this._sfxBus.connect(this._master);

    // Compressor to keep mix clean
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value     = 4;
    this._master.disconnect();
    this._master.connect(comp);
    comp.connect(this.ctx.destination);

    this._nextBeat = this.ctx.currentTime + 0.1;
    this._scheduleTick();
  }

  // ── Scheduling loop ────────────────────────────────────────────────────────
  _scheduleTick() {
    if (!this.ctx) return;
    const beatDur = 60 / this._BPM;
    while (this._nextBeat < this.ctx.currentTime + 0.3) {
      this._scheduleBeat(this._nextBeat, this._beatCount % 16);
      this._nextBeat  += beatDur;
      this._beatCount += 1;
    }
    setTimeout(() => this._scheduleTick(), 80);
  }

  _scheduleBeat(t, step) {
    // Kick: beats 0, 4, 8, 12
    if (step % 4 === 0)               this._kick(t);
    // Snare: beats 4, 12
    if (step === 4 || step === 12)    this._snare(t);
    // Open hi-hat: off-beats 2,6,10,14
    if (step % 4 === 2)               this._hihat(t, true);
    // Closed hi-hat: every other step
    if (step % 2 === 0)               this._hihat(t, false);
    // Bass line
    this._bass(t, step);
    // Synth pad chord every 8 beats
    if (step === 0 || step === 8)     this._pad(t, step);
    // Acid lead every 4 beats (delayed)
    if (step % 4 === 2)               this._acid(t, step);
  }

  // ── Drum machines ─────────────────────────────────────────────────────────
  _kick(t) {
    const osc = this.ctx.createOscillator();
    const g   = this.ctx.createGain();
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    g.gain.setValueAtTime(1.0, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    osc.connect(g); g.connect(this._musicBus);
    osc.start(t); osc.stop(t + 0.35);
  }

  _snare(t) {
    const dur = 0.18;
    // Noise body
    const buf  = this._noiseBuffer(dur);
    const src  = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = 1400; filt.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this._musicBus);
    src.start(t); src.stop(t + dur);
    // Tonal body
    const osc = this.ctx.createOscillator();
    const og  = this.ctx.createGain();
    osc.frequency.value = 200;
    og.gain.setValueAtTime(0.25, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(og); og.connect(this._musicBus);
    osc.start(t); osc.stop(t + 0.12);
  }

  _hihat(t, open) {
    const dur  = open ? 0.09 : 0.03;
    const buf  = this._noiseBuffer(dur);
    const src  = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'highpass'; filt.frequency.value = 9000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(open ? 0.18 : 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this._musicBus);
    src.start(t); src.stop(t + dur);
  }

  // ── Synth voices ──────────────────────────────────────────────────────────
  // Minor pentatonic bass riff (E minor feel)
  _BASS = [40, 40, 43, 47, 40, 38, 40, 43, 40, 40, 45, 47, 38, 38, 43, 45];

  _bass(t, step) {
    const midi = this._BASS[step % this._BASS.length];
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const osc  = this.ctx.createOscillator();
    osc.type   = 'sawtooth';
    osc.frequency.value = freq;
    const filt = this.ctx.createBiquadFilter();
    filt.type  = 'lowpass';
    filt.frequency.setValueAtTime(900, t);
    filt.frequency.exponentialRampToValueAtTime(180, t + 0.12);
    filt.Q.value = 4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(filt); filt.connect(g); g.connect(this._musicBus);
    osc.start(t); osc.stop(t + 0.16);
  }

  // Synth pad — minor chord
  _CHORDS = [
    [220, 262, 330],   // Am
    [196, 233, 294],   // G
    [175, 220, 277],   // F
    [208, 247, 311],   // Ab
  ];

  _pad(t, step) {
    const chord = this._CHORDS[(step / 8) % this._CHORDS.length];
    const beatDur = 60 / this._BPM;
    const dur = beatDur * 7.5;
    for (const freq of chord) {
      const osc = this.ctx.createOscillator();
      osc.type  = 'square';
      osc.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.04, t + 0.08);
      g.gain.setValueAtTime(0.04, t + dur - 0.12);
      g.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(g); g.connect(this._musicBus);
      osc.start(t); osc.stop(t + dur);
    }
  }

  // Acid lead — 303-style
  _ACID_NOTES = [52, 55, 52, 57, 50, 52, 55, 50];

  _acid(t, step) {
    const midi = this._ACID_NOTES[(step / 2) % this._ACID_NOTES.length];
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const osc  = this.ctx.createOscillator();
    osc.type   = 'sawtooth';
    osc.frequency.value = freq;
    const filt = this.ctx.createBiquadFilter();
    filt.type  = 'lowpass'; filt.Q.value = 12;
    filt.frequency.setValueAtTime(300, t);
    filt.frequency.exponentialRampToValueAtTime(2400, t + 0.06);
    filt.frequency.exponentialRampToValueAtTime(400, t + 0.14);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(filt); filt.connect(g); g.connect(this._musicBus);
    osc.start(t); osc.stop(t + 0.2);
  }

  // ── SFX ───────────────────────────────────────────────────────────────────
  playCannon() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this._lastCannon < 0.08) return;
    this._lastCannon = now;
    // Low thud
    const osc = this.ctx.createOscillator();
    osc.type  = 'sawtooth';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(22, now + 0.28);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.9, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc.connect(g); g.connect(this._sfxBus);
    osc.start(now); osc.stop(now + 0.35);
    // Noise crack
    this._playSfxNoise(now, 0.2, 500, 'lowpass', 0.6);
  }

  playMG() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this._lastMG < 0.07) return; // throttle to ~14/s max
    this._lastMG = now;
    this._playSfxNoise(now, 0.04, 2200, 'bandpass', 0.35);
  }

  playHit() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this._playSfxNoise(now, 0.12, 600, 'bandpass', 0.55);
  }

  playExplosion() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this._playSfxNoise(now, 0.7, 380, 'lowpass', 1.0);
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(60, now);
    osc.frequency.exponentialRampToValueAtTime(15, now + 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.7, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc.connect(g); g.connect(this._sfxBus);
    osc.start(now); osc.stop(now + 0.6);
  }

  playComponentHit() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // Metal clang — two detuned oscillators
    for (const freq of [320, 340]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.4, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(g); g.connect(this._sfxBus);
      osc.start(now); osc.stop(now + 0.4);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  _noiseBuffer(dur) {
    const n   = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _playSfxNoise(t, dur, freq, filtType, gain) {
    const buf  = this._noiseBuffer(dur);
    const src  = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type  = filtType; filt.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this._sfxBus);
    src.start(t); src.stop(t + dur);
  }

  // ── Volume controls ───────────────────────────────────────────────────────
  setMasterVol(v) {
    this.masterVol = v;
    if (this._master && !this.muted) this._master.gain.value = v;
    localStorage.setItem('vec_vol_master', v);
  }
  setMusicVol(v) {
    this.musicVol = v;
    if (this._musicBus) this._musicBus.gain.value = v;
    localStorage.setItem('vec_vol_music', v);
  }
  setSfxVol(v) {
    this.sfxVol = v;
    if (this._sfxBus) this._sfxBus.gain.value = v;
    localStorage.setItem('vec_vol_sfx', v);
  }
  setMuted(m) {
    this.muted = m;
    if (this._master) this._master.gain.value = m ? 0 : this.masterVol;
    localStorage.setItem('vec_muted', String(m));
  }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }
}

export const audio = new AudioEngine();
