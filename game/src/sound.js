// sound.js — tiny WebAudio blips, no files, no network. Every effect is a couple of oscillators.

let ctx = null;
let muted = false;

function audio() {
  if (ctx === null) {
    const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** One enveloped tone; `type` is an oscillator waveform, `slide` bends the pitch over its life. */
function tone(freq, durMs, { type = 'square', gain = 0.05, slide = 0, delay = 0 } = {}) {
  if (muted) return;
  const ac = audio();
  if (ac === null) return;
  const t0 = ac.currentTime + delay / 1000;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide !== 0) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + durMs / 1000);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + durMs / 1000 + 0.02);
}

/** A short noise burst, for chopping and the sizzle. */
function noise(durMs, { gain = 0.05, freq = 1200, q = 1, delay = 0 } = {}) {
  if (muted) return;
  const ac = audio();
  if (ac === null) return;
  const t0 = ac.currentTime + delay / 1000;
  const len = Math.max(1, Math.floor(ac.sampleRate * durMs / 1000));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const amp = ac.createGain();
  amp.gain.value = gain;
  src.connect(filter).connect(amp).connect(ac.destination);
  src.start(t0);
}

export const Sound = {
  get muted() { return muted; },
  toggle() { muted = !muted; return muted; },

  pickup() { tone(520, 70, { type: 'triangle', gain: 0.06 }); },
  place() { tone(340, 80, { type: 'triangle', gain: 0.06, slide: -90 }); },
  chop() { noise(70, { gain: 0.07, freq: 2200, q: 2 }); },
  done() { tone(660, 90, { type: 'sine', gain: 0.07 }); tone(880, 110, { type: 'sine', gain: 0.06, delay: 80 }); },
  serve() {
    tone(700, 90, { type: 'square', gain: 0.05 });
    tone(1050, 120, { type: 'square', gain: .05, delay: 70 });
    tone(1400, 160, { type: 'sine', gain: 0.05, delay: 150 });
  },
  trash() { tone(220, 160, { type: 'sawtooth', gain: 0.05, slide: -120 }); },
  miss() { tone(180, 260, { type: 'sawtooth', gain: 0.06, slide: -70 }); },
  warn() { tone(440, 120, { type: 'square', gain: 0.045 }); },
  rush() { tone(300, 140, { type: 'square', gain: 0.06 }); tone(460, 140, { type: 'square', gain: 0.06, delay: 140 }); },
  over() { [520, 420, 330, 240].forEach((f, i) => tone(f, 220, { type: 'triangle', gain: 0.07, delay: i * 170 })); },
  win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 180, { type: 'triangle', gain: 0.07, delay: i * 130 })); },
};
