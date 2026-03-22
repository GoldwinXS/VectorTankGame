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
    this._waveLayer = 0;   // 0=drums only, 1=+pad, 2=+acid, 3=+clap/crash, 4=+arp

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

    // iOS AudioContext unlock — play silent buffer within user gesture
    const _unlock = () => {
      const buf = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.connect(this.ctx.destination); src.start(0);
    };
    _unlock();

    // iOS Safari creates AudioContext in 'suspended' state even during a
    // user-gesture click. Resume it, then start the scheduler once running.
    const _startScheduler = () => {
      this._nextBeat = this.ctx.currentTime + 0.1;
      this._scheduleTick();
    };
    if (this.ctx.state === 'running') {
      _startScheduler();
    } else {
      this.ctx.resume().then(_startScheduler);
    }

    // Re-resume if iOS suspends the context on page-blur / screen-lock
    document.addEventListener('touchstart', () => {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      if (this.ctx && document.visibilityState === 'visible' && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    });
  }

  // ── Scheduling loop ────────────────────────────────────────────────────────
  _scheduleTick() {
    if (!this.ctx) return;
    // Auto-resume if context was suspended (tab switch, phone lock, iOS interruption)
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const beatDur = 60 / this._BPM;
    while (this._nextBeat < this.ctx.currentTime + 0.3) {
      this._scheduleBeat(this._nextBeat, this._beatCount % 16);
      this._nextBeat  += beatDur;
      this._beatCount += 1;
    }
    setTimeout(() => this._scheduleTick(), 80);
  }

  _scheduleBeat(t, step) {
    const phaseStep = this._beatCount % 64; // 4-bar super-cycle
    const isBreak   = phaseStep >= 56;      // last 8 steps: stripped break
    const bar       = Math.floor(this._beatCount / 16);
    const swing     = (step % 4 === 2) ? 0.014 : 0; // swing the off-beats

    // Layer 0+: percussion + bass (always present)
    if (step % 4 === 0 && !isBreak) this._kick(t);
    else if (step === 0)             this._kick(t);   // keep beat 1 in break
    if (step === 4 || step === 12)   this._snare(t);  // snare always for pulse

    // Hi-hats with swing; suppressed during break
    if (!isBreak) {
      if (step % 4 === 2) this._hihat(t + swing, true);
      if (step % 2 === 0) this._hihat(t + swing, false);
    }

    // Bass — silent in break
    if (!isBreak) this._bass(t, step);

    // Layer 1+: pad — sound changes per track so the run stays fresh
    // Track 0 → triangle (warm/organ, keep for early game)
    // Track 1 & 3 → string ensemble (darker, more ominous)
    // Track 2 & 4 → pulse synth (aggressive, high-intensity)
    if (this._waveLayer >= 1 && (step === 0 || step === 8)) {
      if      (this._trackIdx === 0)                       this._pad(t, bar);
      else if (this._trackIdx === 1 || this._trackIdx === 3) this._strPad(t, bar);
      else                                                   this._pulsePad(t, bar);
    }
    // Layer 2+: gentle soft arp (half density, skip break)
    if (this._waveLayer >= 2 && step % 4 === 0 && !isBreak) this._gentleArp(t, step);
    // Layer 3+: clap + crash
    if (this._waveLayer >= 3) {
      if ((step === 4 || step === 12) && !isBreak) this._clap(t);
      if (step === 0 && !isBreak) this._crash(t);
    }
    // Layer 4+: acid lead (now later in game, less frequent)
    if (this._waveLayer >= 4 && step % 8 === 2 && !isBreak) this._acid(t, step);
    // Layer 5+: dense arp (was layer 4)
    if (this._waveLayer >= 5 && step % 2 === 0 && !isBreak) this._arp(t, step);
  }

  // Unlock a new music layer each time a wave threshold is crossed.
  // Also nudges BPM upward at high waves.
  // Layers unlock gradually — each wave number threshold is easily editable
  setWave(n) {
    this._waveLayer = n < 3  ? 0   // drums + bass only
                    : n < 5  ? 1   // + warm pad chords
                    : n < 8  ? 2   // + gentle arpeggio (soft lead)
                    : n < 12 ? 3   // + clap + crash
                    : n < 17 ? 4   // + acid 303 lead
                    : 5;           // + dense high arp
    if      (n >= 17) this._BPM = Math.min(158, 140 + (n - 16));
    else if (n >= 12) this._BPM = 143;
    else              this._BPM = 140;

    // Track is fixed per-run (set by startRun()); only layers build here
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // MUSIC CONFIG — edit these to customize the soundtrack
  // BPM: starts at 140, increases after wave 12+
  // Bass riff (MIDI note numbers): 40=E2, 43=G2, 47=B2, 38=D2, 45=A2
  // Pad chords: frequencies in Hz — Am, G, F, Ab
  // Acid notes (MIDI): 52=E3, 55=G3, 57=A3, 50=D3
  // Gentle arp (MIDI): 60=C4, 64=E4, 67=G4, 71=B4 — soft melodic layer
  // Dense arp (MIDI): original _ARP_NOTES array below
  // Volume levels: _GENTLE_ARP_VOL controls soft arp loudness
  // ══════════════════════════════════════════════════════════════════════════════

  // ── Multi-track definitions (swap at wave milestones) ─────────────────────
  // Track 0: E minor (waves 1-5) — current default
  // Track 1: D minor (waves 6-11) — down a tone, more ominous
  // Track 2: F minor (waves 12+)  — up a semitone from E, most intense
  // 5 tracks — one per boss kill. Boss 1 → track 1, boss 2 → track 2, etc.
  // Each is a distinct musical key so the run feels fresh throughout.
  // ── Music theory notes ──────────────────────────────────────────────────────
  // All 5 tracks use the same i–VI–III–VII minor progression with smooth voice
  // leading: two voices are held as common tones, one moves by half or whole step.
  // Chord voicings are in first or second inversion so the bass note isn't always
  // the root — this gives a characteristic minor key "floating" quality.
  //
  // Chord frequencies (Hz) per track:
  //   Track 0  Em → C(2nd inv) → G → D(1st inv)   [E min]
  //   Track 1  Dm → Bb(2nd)    → F → C(1st)        [D min]
  //   Track 2  Fm → Db(2nd)    → Ab → Eb(1st)      [F min]
  //   Track 3  Gm → Eb(2nd)    → Bb → F(1st)       [G min]
  //   Track 4  Bbm → Gb(2nd)   → Db → Ab(1st)      [Bb min]
  //
  // Gentle arp outlines the tonic minor-7 arpeggio (root–m3–5–m7) then descends
  // through scale degrees 6 and 5 back to root — a classic melodic minor gesture.
  _TRACKS = [
    { // Track 0 — E minor
      bass:      [40, 40, 43, 47, 40, 38, 40, 43, 40, 40, 45, 47, 38, 38, 43, 45],
      //          Em(G3,B3,E4)  C(G3,C4,E4) G(G3,B3,D4)  D(F#3,A3,D4)
      chords:    [[196, 247, 330], [196, 262, 330], [196, 247, 294], [185, 220, 294]],
      gentleArp: [64, 67, 71, 74, 71, 69, 67, 64], // E4 G4 B4 D5 B4 A4 G4 E4
      acid:      [52, 55, 52, 57, 50, 52, 55, 50],
      arp:       [64, 67, 71, 74, 67, 71, 76, 74, 72, 69, 67, 64, 67, 71, 72, 74],
    },
    { // Track 1 — D minor (boss 1 — down a tone, darker)
      bass:      [38, 38, 41, 45, 38, 36, 38, 41, 38, 38, 43, 45, 36, 36, 41, 43],
      //          Dm(F3,A3,D4)  Bb(F3,Bb3,D4) F(F3,A3,C4)  C(E3,G3,C4)
      chords:    [[175, 220, 294], [175, 233, 294], [175, 220, 262], [165, 196, 262]],
      gentleArp: [62, 65, 69, 72, 69, 67, 65, 62], // D4 F4 A4 C5 A4 G4 F4 D4
      acid:      [50, 53, 50, 55, 48, 50, 53, 48],
      arp:       [62, 65, 69, 72, 65, 69, 74, 72, 70, 67, 65, 62, 65, 69, 70, 72],
    },
    { // Track 2 — F minor (boss 2 — up a minor 3rd, tenser)
      bass:      [41, 41, 44, 48, 41, 39, 41, 44, 41, 41, 46, 48, 39, 39, 44, 46],
      //          Fm(Ab3,C4,F4)  Db(Ab3,Db4,F4) Ab(Ab3,C4,Eb4) Eb(G3,Bb3,Eb4)
      chords:    [[208, 262, 349], [208, 277, 349], [208, 262, 311], [196, 233, 311]],
      gentleArp: [65, 68, 72, 75, 72, 70, 68, 65], // F4 Ab4 C5 Eb5 C5 Bb4 Ab4 F4
      acid:      [53, 56, 53, 58, 51, 53, 56, 51],
      arp:       [65, 68, 72, 75, 68, 72, 77, 75, 73, 70, 68, 65, 68, 72, 73, 75],
    },
    { // Track 3 — G minor (boss 3 — higher, more urgent)
      bass:      [43, 43, 46, 50, 43, 41, 43, 46, 43, 43, 48, 50, 41, 41, 46, 48],
      //          Gm(Bb3,D4,G4)  Eb(Bb3,Eb4,G4) Bb(Bb3,D4,F4) F(A3,C4,F4)
      chords:    [[233, 294, 392], [233, 311, 392], [233, 294, 349], [220, 262, 349]],
      gentleArp: [67, 70, 74, 77, 74, 72, 70, 67], // G4 Bb4 D5 F5 D5 C5 Bb4 G4
      acid:      [55, 58, 55, 60, 53, 55, 58, 53],
      arp:       [67, 70, 74, 77, 70, 74, 79, 77, 75, 72, 70, 67, 70, 74, 75, 77],
    },
    { // Track 4 — Bb minor (boss 4+ — full danger zone)
      bass:      [46, 46, 49, 53, 46, 44, 46, 49, 46, 46, 51, 53, 44, 44, 49, 51],
      //          Bbm(Db4,F4,Bb4)  Gb(Db4,Gb4,Bb4) Db(Db4,F4,Ab4) Ab(C4,Eb4,Ab4)
      chords:    [[277, 349, 466], [277, 370, 466], [277, 349, 415], [262, 311, 415]],
      gentleArp: [70, 73, 77, 80, 77, 75, 73, 70], // Bb4 Db5 F5 Ab5 F5 Eb5 Db5 Bb4
      acid:      [58, 61, 58, 63, 56, 58, 61, 56],
      arp:       [70, 73, 77, 80, 73, 77, 82, 80, 78, 75, 73, 70, 73, 77, 78, 80],
    },
  ];
  _trackIdx = 0; // current track within a run (advances on each boss kill)

  _applyTrack(idx) {
    const t = this._TRACKS[idx];
    this._BASS        = t.bass;
    this._CHORDS      = t.chords;
    this._GENTLE_ARP  = t.gentleArp;
    this._ACID_NOTES  = t.acid;
    this._ARP_NOTES   = t.arp;
  }

  // Reset to track 0 at the start of each new run
  startRun() {
    this._trackIdx = 0;
    this._applyTrack(0);
    this._waveLayer = 0;
    this._BPM       = 140;
  }

  // Advance to the next track — called on each boss kill
  nextTrack() {
    this._trackIdx = Math.min(this._trackIdx + 1, this._TRACKS.length - 1);
    this._applyTrack(this._trackIdx);
  }

  // Cycle to next track manually (skip button in pause menu)
  skipTrack() {
    this._trackIdx = (this._trackIdx + 1) % this._TRACKS.length;
    this._applyTrack(this._trackIdx);
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

  _pad(t, bar) {
    const chord   = this._CHORDS[bar % this._CHORDS.length];
    const beatDur = 60 / this._BPM;
    const dur     = beatDur * 7.5;
    for (const freq of chord) {
      // Two slightly detuned triangle oscillators per note — creates a warm
      // chorus/beating effect that makes the pad sound much fuller than sine.
      for (const detuneCents of [0, 6]) {
        const osc = this.ctx.createOscillator();
        osc.type  = 'triangle';
        osc.frequency.value = freq;
        osc.detune.value    = detuneCents;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.022, t + 0.15); // slow attack — pad swell
        g.gain.setValueAtTime(0.022, t + dur - 0.18);
        g.gain.linearRampToValueAtTime(0, t + dur);
        osc.connect(g); g.connect(this._musicBus);
        osc.start(t); osc.stop(t + dur);
      }
    }
  }

  // String ensemble pad — detuned sawtooth trio + lowpass (tracks 1 & 3)
  _strPad(t, bar) {
    const chord   = this._CHORDS[bar % this._CHORDS.length];
    const beatDur = 60 / this._BPM;
    const dur     = beatDur * 7.5;
    for (const freq of chord) {
      for (const detune of [-10, 0, 10]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        osc.detune.value    = detune;
        const filt = this.ctx.createBiquadFilter();
        filt.type = 'lowpass'; filt.frequency.value = 1600; filt.Q.value = 0.4;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.012, t + 0.3);  // slow string attack
        g.gain.setValueAtTime(0.012, t + dur - 0.25);
        g.gain.linearRampToValueAtTime(0, t + dur);
        osc.connect(filt); filt.connect(g); g.connect(this._musicBus);
        osc.start(t); osc.stop(t + dur);
      }
    }
  }

  // Pulse synth pad — square wave + filter sweep (tracks 2 & 4, high intensity)
  _pulsePad(t, bar) {
    const chord   = this._CHORDS[bar % this._CHORDS.length];
    const beatDur = 60 / this._BPM;
    const dur     = beatDur * 7.5;
    for (const freq of chord) {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq * 0.5; // octave down — squarewaves are bright
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'lowpass'; filt.Q.value = 1.5;
      filt.frequency.setValueAtTime(900, t);
      filt.frequency.linearRampToValueAtTime(500, t + 0.5);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.009, t + 0.08);
      g.gain.setValueAtTime(0.009, t + dur - 0.2);
      g.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(filt); filt.connect(g); g.connect(this._musicBus);
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
    filt.frequency.exponentialRampToValueAtTime(1600, t + 0.06);
    filt.frequency.exponentialRampToValueAtTime(400, t + 0.14);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(filt); filt.connect(g); g.connect(this._musicBus);
    osc.start(t); osc.stop(t + 0.2);
  }

  // Clap — tight noise burst, higher than snare (layer 3)
  _clap(t) {
    const dur = 0.06;
    const buf = this._noiseBuffer(dur);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = 2200; filt.Q.value = 2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this._musicBus);
    src.start(t); src.stop(t + dur);
  }

  // Crash cymbal — long filtered noise on beat 1 every 16 steps (layer 3)
  _crash(t) {
    const dur = 0.55;
    const buf = this._noiseBuffer(dur);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'highpass'; filt.frequency.value = 5500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this._musicBus);
    src.start(t); src.stop(t + dur);
  }

  // High arpeggio melody — two 16th notes per step (layer 5)
  _ARP_NOTES = [64, 67, 71, 74, 67, 71, 76, 74, 72, 69, 67, 64, 67, 71, 72, 74];

  _arp(t, step) {
    const beatDur = 60 / this._BPM;
    for (let sub = 0; sub < 2; sub++) {
      const nt   = t + sub * beatDur * 0.5;
      const idx  = (step * 2 + sub) % this._ARP_NOTES.length;
      const freq = 440 * Math.pow(2, (this._ARP_NOTES[idx] - 69) / 12);
      const osc  = this.ctx.createOscillator();
      osc.type   = 'triangle';
      osc.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.05, nt);
      g.gain.exponentialRampToValueAtTime(0.001, nt + beatDur * 0.45);
      osc.connect(g); g.connect(this._musicBus);
      osc.start(nt); osc.stop(nt + beatDur * 0.5);
    }
  }

  // ── Easily editable music config ─────────────────────────────────────────────
  // Gentle arp notes (MIDI) — plays in layer 2. Edit to taste.
  _GENTLE_ARP = [60, 64, 67, 71, 69, 65, 62, 60];
  // Gentle arp volume (0-1)
  _GENTLE_ARP_VOL = 0.04;

  _gentleArp(t, step) {
    const beatDur = 60 / this._BPM;
    const idx  = Math.floor(step / 1) % this._GENTLE_ARP.length; // one per call
    const freq = 440 * Math.pow(2, (this._GENTLE_ARP[idx] - 69) / 12);
    const osc  = this.ctx.createOscillator();
    osc.type   = 'triangle'; // warm, non-harsh
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(this._GENTLE_ARP_VOL, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + beatDur * 2.0);
    osc.connect(g); g.connect(this._musicBus);
    osc.start(t); osc.stop(t + beatDur * 2.1);
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

  playCannonImpact() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // Heavy thud + metal crack
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(24, now + 0.22);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.7, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    osc.connect(g); g.connect(this._sfxBus);
    osc.start(now); osc.stop(now + 0.28);
    this._playSfxNoise(now, 0.22, 380, 'bandpass', 0.85);
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

  playRespawn() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // Rising alert tone — signals emergency activation
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(720, now + 0.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(g); g.connect(this._sfxBus);
    osc.start(now); osc.stop(now + 0.5);
    // White noise surge underneath
    this._playSfxNoise(now, 0.35, 900, 'bandpass', 0.55);
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
