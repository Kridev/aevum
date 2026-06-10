/* Sidereum — the sound of space, synthesized live (no audio files).
   Layers: 🌑 Drone (sub-bass bed, DRY only) · 🎹 Pad (slow original chords)
   · ✨ Chimes (stars ignite) · 📡 Events (supernovae, black holes, pulsars).
   Routing rule (learned the hard way): continuous beds go to the dry master
   ONLY; just melodic + transient material feeds the reverb send, so the
   cathedral-of-space tail always has silence to decay into. */
(() => {
'use strict';
const SIM = window.SIDEREUM;
const $ = id => document.getElementById(id);

let actx = null, out = null, send = null, padBus = null, started = false;
const layers = { drone:{on:false}, pad:{on:false}, chimes:{on:false}, events:{on:false} };

// ---- deep-space impulse response: long, dark, cavernous ----
function impulse(seconds, decay){
  const rate = actx.sampleRate, len = Math.max(1, Math.floor(rate*seconds));
  const buf = actx.createBuffer(2, len, rate);
  for (let ch=0; ch<2; ch++){
    const d = buf.getChannelData(ch);
    let lastv = 0;
    for (let i=0;i<len;i++){
      const t = i/len;
      let v = (Math.random()*2-1) * Math.pow(1-t, decay);
      lastv = lastv + 0.25*(v - lastv);   // heavy lowpass → dark tail
      d[i] = lastv;
    }
  }
  return buf;
}

function ensure(){
  if (actx) return;
  actx = new (window.AudioContext || window.webkitAudioContext)();
  out = actx.createGain(); out.gain.value = 0;
  out.connect(actx.destination);

  // FX send → convolver → tone lowpass → wet out
  send = actx.createGain(); send.gain.value = 1;
  const conv = actx.createConvolver(); conv.buffer = impulse(4.5, 1.8);
  const tone = actx.createBiquadFilter(); tone.type='lowpass'; tone.frequency.value = 3400;
  const wet = actx.createGain(); wet.gain.value = 0.5;
  send.connect(conv); conv.connect(tone); tone.connect(wet); wet.connect(actx.destination);

  // pad bus: one gentle non-resonant lowpass over all pad notes
  padBus = actx.createGain(); padBus.gain.value = 0.8;
  const padLP = actx.createBiquadFilter(); padLP.type='lowpass'; padLP.frequency.value = 1500; padLP.Q.value = 0.5;
  padBus.connect(padLP); toMix(padLP);

  buildDrone();
  out.gain.linearRampToValueAtTime(0.7, actx.currentTime + 0.8);
}
function toMix(node){ node.connect(out); if (send) node.connect(send); }

// ---- 🌑 drone: two deep sines + slow-breathing filtered noise, all DRY ----
let droneG = null, droneLP = null;
function buildDrone(){
  droneG = actx.createGain(); droneG.gain.value = 0;
  droneLP = actx.createBiquadFilter(); droneLP.type='lowpass'; droneLP.frequency.value = 160; droneLP.Q.value = 0.4;
  const o1 = actx.createOscillator(); o1.type='sine'; o1.frequency.value = 36.71;  // D1
  const o2 = actx.createOscillator(); o2.type='sine'; o2.frequency.value = 55.0;   // A1
  const o3 = actx.createOscillator(); o3.type='triangle'; o3.frequency.value = 73.6; // D2, a shade sharp → slow beating
  const g3 = actx.createGain(); g3.gain.value = 0.25;
  o1.connect(droneLP); o2.connect(droneLP); o3.connect(g3); g3.connect(droneLP);
  droneLP.connect(droneG); droneG.connect(out);   // dry ONLY — never the reverb
  o1.start(); o2.start(); o3.start();
}

// ---- 🎹 pad: an original, slow ambient progression (D minor, wide voicings) ----
const PAD_PROG = [
  [38, 53, 57, 60, 64],   // Dm9
  [34, 50, 53, 57, 65],   // B♭maj7
  [41, 53, 60, 64, 67],   // Fmaj9
  [43, 50, 58, 62, 65],   // Gm7
];
const mfreq = m => 440 * Math.pow(2, (m-69)/12);
let padIdx = 0, padNext = 0;
function padNote(freq, t, len, pan, peak){
  const o = actx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
  const lp = actx.createBiquadFilter(); lp.type='lowpass'; lp.Q.value = 0.55;     // non-resonant, keep it mellow
  lp.frequency.setValueAtTime(freq*1.4 + 100, t);
  lp.frequency.linearRampToValueAtTime(freq*2.1 + 240, t + len*0.5);
  lp.frequency.linearRampToValueAtTime(freq*1.2 + 100, t + len);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + len*0.3);        // very slow bloom
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(lp); lp.connect(g);
  const p = actx.createStereoPanner ? actx.createStereoPanner() : null;
  if (p){ p.pan.value = pan; g.connect(p); p.connect(padBus); } else g.connect(padBus);
  o.start(t); o.stop(t + len + 0.1);
}
function schedulePad(now){
  if (padNext < now) padNext = now + 0.1;
  while (padNext < now + 1.5){
    const chord = PAD_PROG[padIdx];
    const len = 11 + Math.random()*3;
    for (const m of chord)
      padNote(mfreq(m), padNext + Math.random()*1.2, len, ((m%7)-3)/5, m < 48 ? 0.018 : 0.012);
    padIdx = (padIdx + 1) % PAD_PROG.length;
    padNext += len * 0.82;   // overlap the seams so it never breathes out fully
  }
}

// ---- ✨ chimes: a star ignites → a little bell, pitched by its mass ----
let lastChime = 0;
function chime(m, pan){
  const now = actx.currentTime;
  if (now - lastChime < 0.13) return;   // big-bang baby-boom protection
  lastChime = now;
  const f = Math.min(2100, 320 + 1500/Math.sqrt(m + 0.4));
  const o = actx.createOscillator(); o.type='sine'; o.frequency.value = f;
  const o2 = actx.createOscillator(); o2.type='sine'; o2.frequency.value = f*2.76;  // inharmonic partial → bell
  const g2 = actx.createGain(); g2.gain.value = 0.3;
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.035, now + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
  o.connect(g); o2.connect(g2); g2.connect(g);
  const p = actx.createStereoPanner ? actx.createStereoPanner() : null;
  if (p){ p.pan.value = pan; g.connect(p); toMix(p); } else toMix(g);
  o.start(now); o.stop(now+1.7); o2.start(now); o2.stop(now+1.7);
}

// ---- 📡 events ----
function noiseBurst(t, len, f0, f1, peak, type){
  const rate = actx.sampleRate, buf = actx.createBuffer(1, rate*len, rate);
  const d = buf.getChannelData(0);
  for (let i=0;i<d.length;i++) d[i] = Math.random()*2-1;
  const s = actx.createBufferSource(); s.buffer = buf;
  const lp = actx.createBiquadFilter(); lp.type = type||'lowpass'; lp.Q.value = 0.6;
  lp.frequency.setValueAtTime(f0, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(30,f1), t+len);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t+0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t+len);
  s.connect(lp); lp.connect(g); toMix(g);
  s.start(t); s.stop(t+len+0.05);
}
function subDrop(t, f0, f1, len, peak){
  const o = actx.createOscillator(); o.type='sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t+len);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t+0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t+len);
  o.connect(g); g.connect(out);   // sub stays dry — reverbed sub = mud
  o.start(t); o.stop(t+len+0.05);
}
function boom(m){
  const t = actx.currentTime;
  noiseBurst(t, 1.8, 900 + m*20, 60, Math.min(0.4, 0.16 + m*0.008));
  subDrop(t, 70, 27, 1.4, 0.22);
}
function growl(big){
  const t = actx.currentTime;
  noiseBurst(t, big?1.1:0.7, 110, 40, big?0.2:0.12);
  subDrop(t, 44, 30, big?1:0.6, big?0.14:0.08);
}
function kilonova(){
  const t = actx.currentTime;
  noiseBurst(t, 2.2, 2600, 200, 0.18, 'bandpass');   // golden shimmer
  noiseBurst(t, 1.6, 700, 50, 0.22);
  subDrop(t, 80, 30, 1.6, 0.2);
}
// the gravitational-wave chirp: a rising sweep that cuts off at the merger
function gwChirp(){
  const t = actx.currentTime;
  const o = actx.createOscillator(); o.type='sine';
  o.frequency.setValueAtTime(26, t);
  o.frequency.exponentialRampToValueAtTime(440, t + 1.15);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.13, t + 1.0);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.22);
  o.connect(g); toMix(g);
  o.start(t); o.stop(t + 1.3);
  subDrop(t + 1.15, 60, 24, 1.2, 0.22);   // the ringdown thud
}
// a bright falling sweep — GRBs, novae and magnetar flares at different speeds
function zap(f0, f1, len, peak){
  const t = actx.currentTime;
  const o = actx.createOscillator(); o.type='sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t+len);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t+0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t+len);
  o.connect(g); toMix(g);
  o.start(t); o.stop(t+len+0.05);
}
function pulseTick(pan){
  const t = actx.currentTime;
  const o = actx.createOscillator(); o.type='square'; o.frequency.value = 880;
  const bp = actx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value = 1800; bp.Q.value = 6;
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.03, t+0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t+0.06);
  o.connect(bp); bp.connect(g);
  const p = actx.createStereoPanner ? actx.createStereoPanner() : null;
  if (p){ p.pan.value = pan; g.connect(p); toMix(p); } else toMix(g);
  o.start(t); o.stop(t+0.1);
}

// pan an event by where it sits on screen; mute it if it's far off-screen
function screenPan(x, y){
  const cam = SIM.cam; if (!cam) return 0;
  const cvW = innerWidth * (window.devicePixelRatio||1);
  const sx = (x - cam.x) * cam.z + cvW*0.5;
  const rel = (sx/cvW)*2 - 1;
  return Math.max(-1, Math.min(1, rel));
}

// ---- subscribe to the sim's event stream (render.js forwards it) ----
SIM.onEvent(e => {
  if (!started || !actx) return;
  if (e.t === 'birth' && layers.chimes.on) chime(e.m, screenPan(e.x, e.y)*0.8);
  if (!layers.events.on) return;
  if (e.t === 'sn') boom(e.m);
  else if (e.t === 'eat') growl(!!e.star);
  else if (e.t === 'kilonova') kilonova();
  else if (e.t === 'bhmerge') gwChirp();
  else if (e.t === 'bhborn'){ subDrop(actx.currentTime, 90, 24, 2.2, 0.26); }
  else if (e.t === 'grb') zap(3400, 180, 0.45, 0.1);
  else if (e.t === 'nova') zap(1500, 700, 0.5, 0.05);
  else if (e.t === 'flare') zap(2400, 900, 0.22, 0.045);
  else if (e.t === 'xray'){ zap(3000, 2400, 0.06, 0.04); setTimeout(() => zap(3000, 2400, 0.06, 0.04), 90); }
});

// ---- update loop: drone breathing + pad scheduling + pulsar ticking ----
let phase = 0, prevBeam = 0;
setInterval(() => {
  if (!started || !actx) return;
  const now = actx.currentTime;
  phase += 0.2;
  const D = layers.drone;
  if (droneG){
    const breathe = 0.5 + 0.5*Math.sin(phase*0.05);
    droneG.gain.setTargetAtTime(D.on ? 0.05 + 0.04*breathe : 0, now, 0.8);   // exactly 0 when off
    droneLP.frequency.setTargetAtTime(110 + 90*breathe, now, 1.2);
  }
  if (layers.pad.on) schedulePad(now);
  // pulsar metronome: the first spinning remnant in view ticks each half-turn
  if (layers.events.on){
    const P = SIM.P, n = SIM.N;
    for (let i=0;i<n;i++){
      if (P.type[i] !== SIM.NS && P.type[i] !== SIM.MAGNETAR) continue;
      const beam = Math.floor(P.hue[i] / Math.PI);
      if (beam !== prevBeam){ prevBeam = beam; pulseTick(screenPan(P.x[i], P.y[i])*0.6); }
      break;
    }
  }
}, 200);

// ---- toggles ----
function toggle(name, btn){
  ensure(); actx.resume(); started = true;
  layers[name].on = !layers[name].on;
  btn.classList.toggle('active', layers[name].on);
}
[['drone','bDrone'],['pad','bPad'],['chimes','bChimes'],['events','bEvents']]
  .forEach(([name,id]) => { const b = $(id); if (b) b.onclick = () => toggle(name, b); });

window.SIDEREUM_AUDIO = { layers, get started(){ return started; } };
})();
