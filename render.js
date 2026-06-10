/* Aevum — renderer: camera, glow sprites, lifecycle visuals, effects.
   Owns the rAF loop; physics (sim.js) is advanced from here. */
(() => {
'use strict';
const SIM = window.AEVUM;
const { S, P, events, GAS, STAR, GIANT, WD, NS, BH, BD, MAGNETAR } = SIM;

const cv = document.getElementById('stage');
const ctx = cv.getContext('2d', { alpha: false });
// gas is drawn to a half-resolution layer then scaled up — thousands of soft
// blobs cost 4× less fill, and the blur from upscaling actually helps the look
const gasCv = document.createElement('canvas');
const gctx = gasCv.getContext('2d');
// scratch canvas for the gravitational-lens trick around black holes
const lensCv = document.createElement('canvas'); lensCv.width = lensCv.height = 256;
const lctx = lensCv.getContext('2d');
// coarse screen-space starlight grid — how brightly lit is each patch of sky
const LG_C = 40, LG_R = 24;
const lightG = new Float32Array(LG_C * LG_R);
let W, H, DPR;
function resize(){
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = cv.width  = Math.floor(innerWidth  * DPR);
  H = cv.height = Math.floor(innerHeight * DPR);
  cv.style.width = innerWidth + 'px';
  cv.style.height = innerHeight + 'px';
  gasCv.width = Math.ceil(W/2); gasCv.height = Math.ceil(H/2);
}
addEventListener('resize', resize); resize();

// pause when the tab is hidden
let hiddenPause = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden){ if (!S.paused){ hiddenPause = true; S.paused = true; } }
  else if (hiddenPause){ hiddenPause = false; S.paused = false; }
});

// ---- camera ----
const cam = { x: 0, y: 0, z: 0.34 };
let camMoved = true;
function sx(x){ return (x - cam.x) * cam.z + W * 0.5; }
function sy(y){ return (y - cam.y) * cam.z + H * 0.5; }

// camera follow: ride along with a chosen body (click/tap to pick one)
let followId = 0, followIdx = -1;
function stopFollow(){ followId = 0; followIdx = -1; }
function applyFollow(){
  if (!followId) return;
  if (followIdx < 0 || followIdx >= SIM.N || P.id[followIdx] !== followId){
    followIdx = -1;
    for (let i=0;i<SIM.N;i++) if (P.id[i] === followId){ followIdx = i; break; }
    if (followIdx === -1){ stopFollow(); return; }   // it died / was devoured
  }
  cam.x = P.x[followIdx]; cam.y = P.y[followIdx]; camMoved = true;
}
function pickBody(mx, my){
  // nearest body under the cursor, biased toward the interesting ones
  const wx = (mx - W*0.5)/cam.z + cam.x, wy = (my - H*0.5)/cam.z + cam.y;
  const reach = 26*DPR/cam.z, r2 = reach*reach;
  let best = -1, bestScore = -1;
  for (let i=0;i<SIM.N;i++){
    if (P.type[i] === GAS) continue;
    const dx=P.x[i]-wx, dy=P.y[i]-wy, d2=dx*dx+dy*dy;
    if (d2 > r2) continue;
    const t = P.type[i];
    const score = (t===BH?4e6 : (t===NS||t===MAGNETAR)?3e6 : t===GIANT?2e6 : 1e6) + P.m[i]*1e3 - d2;
    if (score > bestScore){ bestScore = score; best = i; }
  }
  return best;
}

function zoomAt(mx, my, f){
  const wx = (mx - W*0.5)/cam.z + cam.x, wy = (my - H*0.5)/cam.z + cam.y;
  cam.z = Math.min(8, Math.max(0.05, cam.z * f));
  cam.x = wx - (mx - W*0.5)/cam.z;
  cam.y = wy - (my - H*0.5)/cam.z;
  camMoved = true;
}

// smooth zoom: inputs set a target; each frame eases toward it, anchored on
// the cursor — wheel notches glide instead of jumping
let zTarget = cam.z, anchorX = -1, anchorY = -1;
function requestZoom(mx, my, f){
  zTarget = Math.min(8, Math.max(0.05, zTarget * f));
  anchorX = mx; anchorY = my;
}
function easeZoom(){
  if (Math.abs(zTarget - cam.z) < 0.002*cam.z){ return; }
  const nz = cam.z + (zTarget - cam.z) * 0.22;
  zoomAt(anchorX < 0 ? W*0.5 : anchorX, anchorY < 0 ? H*0.5 : anchorY, nz/cam.z);
}

const pointers = new Map();   // active pointers, for drag + pinch
let pinchDist = 0, downX = 0, downY = 0, downAt = 0, dragged = false;
cv.addEventListener('pointerdown', e => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  downX = e.clientX; downY = e.clientY; downAt = performance.now(); dragged = false;
  if (pointers.size === 2){
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x-b.x, a.y-b.y);
  }
  cv.classList.add('dragging'); cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (pointers.size === 2){
    p.x = e.clientX; p.y = e.clientY;
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x-b.x, a.y-b.y);
    if (pinchDist > 0 && d > 0){
      zoomAt((a.x+b.x)*0.5*DPR, (a.y+b.y)*0.5*DPR, d/pinchDist);
      zTarget = cam.z;   // pinch is direct manipulation — don't ease-fight it
      stopFollow();
    }
    pinchDist = d; dragged = true;
    return;
  }
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  if (Math.abs(e.clientX-downX) + Math.abs(e.clientY-downY) > 6) dragged = true;
  if (dragged){
    cam.x -= dx * DPR / cam.z;
    cam.y -= dy * DPR / cam.z;
    camMoved = true; stopFollow();
  }
  p.x = e.clientX; p.y = e.clientY;
});
addEventListener('pointerup', e => {
  pointers.delete(e.pointerId);
  if (!pointers.size) cv.classList.remove('dragging');
  pinchDist = 0;
  // a quick, still tap = pick a body to follow (tap empty space to let go)
  if (!dragged && performance.now() - downAt < 350){
    const i = pickBody(e.clientX*DPR, e.clientY*DPR);
    if (i >= 0){ followId = P.id[i]; followIdx = i; }
    else stopFollow();
  }
});
cv.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); pinchDist = 0; });
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const dy = e.deltaMode === 1 ? e.deltaY*33 : e.deltaY;   // line-mode wheels (Firefox)
  requestZoom(e.clientX*DPR, e.clientY*DPR, Math.pow(1.0017, -dy));
}, { passive: false });
cv.addEventListener('dblclick', e => {
  const wx = (e.clientX*DPR - W*0.5)/cam.z + cam.x;
  const wy = (e.clientY*DPR - H*0.5)/cam.z + cam.y;
  SIM.spawnNebula(wx, wy, 420, 150);
});
cv.addEventListener('contextmenu', e => e.preventDefault());
function recenter(){ stopFollow(); cam.x = 0; cam.y = 0; cam.z = 0.34; zTarget = 0.34; anchorX = anchorY = -1; camMoved = true; }

// ---- glow sprites (cached radial gradients — the fast path for 10k glows) ----
function makeSprite(core, halo, sharp){
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  grad.addColorStop(0, core);
  grad.addColorStop(sharp ? 0.3 : 0.42, halo);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  return c;
}
// star colour by mass: red dwarf → orange → sun → white → blue giant
const STAR_RAMP = [
  { max: 0.45, spr: makeSprite('rgba(255,210,190,1)', 'rgba(255,92,60,0.55)', true) },
  { max: 0.9,  spr: makeSprite('rgba(255,235,210,1)', 'rgba(255,150,70,0.5)', true) },
  { max: 1.8,  spr: makeSprite('rgba(255,250,235,1)', 'rgba(255,214,130,0.5)', true) },
  { max: 4,    spr: makeSprite('rgba(255,255,255,1)', 'rgba(235,240,255,0.5)', true) },
  { max: 10,   spr: makeSprite('rgba(255,255,255,1)', 'rgba(150,190,255,0.55)', true) },
  { max: 1e9,  spr: makeSprite('rgba(245,250,255,1)', 'rgba(110,150,255,0.6)', true) },
];
function starSprite(m){ for (const r of STAR_RAMP){ if (m < r.max) return r.spr; } return STAR_RAMP[5].spr; }
const giantSpr  = makeSprite('rgba(255,170,120,1)', 'rgba(255,70,40,0.5)');
const wdSpr     = makeSprite('rgba(235,245,255,1)', 'rgba(160,200,255,0.45)', true);
const nsSpr     = makeSprite('rgba(255,255,255,1)', 'rgba(190,225,255,0.6)', true);
const accSpr    = makeSprite('rgba(255,225,170,0.9)', 'rgba(255,140,50,0.5)');
const bdSpr     = makeSprite('rgba(190,110,90,0.9)', 'rgba(120,50,40,0.4)', true);    // brown dwarf ember
const wrSpr     = makeSprite('rgba(255,255,255,1)', 'rgba(200,170,255,0.65)');        // Wolf-Rayet fury
const magSpr    = makeSprite('rgba(235,255,255,1)', 'rgba(120,235,255,0.65)', true);  // magnetar
const pwnSpr    = makeSprite('rgba(140,200,255,0.5)', 'rgba(70,110,220,0.22)');       // pulsar wind nebula
function makeDarkCloud(){   // dark nebula wisp — irregular, occludes the glow
  const s = 96, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  for (let k=0;k<7;k++){
    const x = s/2 + (Math.random()-0.5)*s*0.5, y = s/2 + (Math.random()-0.5)*s*0.5;
    const r = s*(0.14 + Math.random()*0.2);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(6,5,10,0.6)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }
  return c;
}
const DUST_SPRS = [makeDarkCloud(), makeDarkCloud(), makeDarkCloud()];
// gas wisps: irregular multi-blob clouds (not smooth balls), in nebula tints
function makeCloud(core, halo){
  const s = 96, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  g.globalCompositeOperation = 'lighter';
  const gr2 = g.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  gr2.addColorStop(0, halo); gr2.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr2; g.fillRect(0, 0, s, s);
  for (let k=0;k<7;k++){
    const x = s/2 + (Math.random()-0.5)*s*0.5, y = s/2 + (Math.random()-0.5)*s*0.5;
    const r = s*(0.13 + Math.random()*0.2);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, core); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }
  return c;
}
// a full palette wheel — the hue field in sim.js sweeps through these, so
// neighbouring clouds blend and distant regions contrast (crimson nebulae
// here, teal ones there, gold ejecta where stars have died)
const GAS_TINTS = [
  ['rgba(255,110,110,0.5)', 'rgba(170,40,60,0.22)'],    // crimson
  ['rgba(255,160,100,0.5)', 'rgba(170,80,40,0.22)'],    // rust
  ['rgba(255,210,120,0.5)', 'rgba(170,120,40,0.22)'],   // gold
  ['rgba(170,230,170,0.5)', 'rgba(60,140,90,0.22)'],    // sage
  ['rgba(120,225,235,0.5)', 'rgba(40,130,160,0.22)'],   // teal
  ['rgba(130,170,255,0.5)', 'rgba(60,90,200,0.22)'],    // blue
  ['rgba(190,130,255,0.5)', 'rgba(110,60,200,0.22)'],   // violet
  ['rgba(255,140,190,0.5)', 'rgba(180,50,110,0.22)'],   // magenta
];
const GAS_SPRS = GAS_TINTS.map(([c1, c2]) => makeCloud(c1, c2));
// an ionized HII region: gas lit white-pink by the hot young stars inside it
const emisSpr = makeCloud('rgba(255,205,215,0.6)', 'rgba(255,140,160,0.28)');

// diffraction spikes — the telescope signature of a bright point source.
// Four main axis-aligned arms plus faint diagonals, pre-rendered once.
const spikeSpr = (() => {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  g.globalCompositeOperation = 'lighter';
  const arm = (a, len, w, alpha) => {
    g.save(); g.translate(s/2, s/2); g.rotate(a);
    const gr = g.createLinearGradient(-len, 0, len, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(-len, -w/2, len*2, w);
    g.restore();
  };
  arm(0, 62, 2.6, 0.85); arm(Math.PI/2, 62, 2.6, 0.85);
  arm(Math.PI/4, 36, 1.8, 0.3); arm(-Math.PI/4, 36, 1.8, 0.3);
  return c;
})();

// a red giant resolved: limb-darkened disc, white-hot centre to deep red rim
const limbSpr = (() => {
  const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  gr.addColorStop(0,    'rgba(255,238,205,1)');
  gr.addColorStop(0.5,  'rgba(255,160,85,0.97)');
  gr.addColorStop(0.82, 'rgba(205,70,28,0.9)');
  gr.addColorStop(0.93, 'rgba(120,32,16,0.45)');
  gr.addColorStop(1,    'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  return c;
})();

// ---- the CMB: a mottled relic glow shown while the universe is still hot ----
const cmbCv = (() => {
  const s = 96, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  const img = g.createImageData(s, s);
  for (let i=0;i<s*s;i++){
    // smooth-ish anisotropies: sum of a couple of random-phase waves per pixel
    const x = i % s, y = (i / s)|0;
    const v = Math.sin(x*0.31+1.7)*Math.sin(y*0.27+0.4) + Math.sin((x+y)*0.19+3.1)
            + Math.sin(x*0.11-y*0.13+5.2);
    const t = 0.5 + v*0.16;
    img.data[i*4]   = 255*Math.min(1, t*1.15);
    img.data[i*4+1] = 255*Math.min(1, t*0.62);
    img.data[i*4+2] = 255*Math.min(1, t*0.45);
    img.data[i*4+3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
})();

// ---- distant starfield + faraway galaxies (static, layered parallax) ----
const FAR = [];
for (let i=0;i<420;i++) FAR.push({ x:(Math.random()-0.5)*9000, y:(Math.random()-0.5)*9000, s:Math.random() });
const smudgeSpr = (() => {   // an unresolved galaxy: a soft elliptical smudge
  const s = 48, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  gr.addColorStop(0, 'rgba(235,225,210,0.8)');
  gr.addColorStop(0.35, 'rgba(190,180,200,0.3)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  return c;
})();
const FARG = [];
for (let i=0;i<34;i++) FARG.push({
  x:(Math.random()-0.5)*16000, y:(Math.random()-0.5)*16000,
  a:Math.random()*Math.PI, sq:0.25+Math.random()*0.55,
  s:5+Math.random()*13, p:0.1+Math.random()*0.12,
});
function drawFar(){
  // island universes, almost motionless — depth for the void
  for (const g of FARG){
    const x = (g.x - cam.x*g.p) * cam.z*0.5 + W*0.5;
    const y = (g.y - cam.y*g.p) * cam.z*0.5 + H*0.5;
    if (x<-40||x>W+40||y<-40||y>H+40) continue;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(g.a); ctx.scale(1, g.sq);
    ctx.globalAlpha = 0.34;
    const r = g.s * DPR;
    ctx.drawImage(smudgeSpr, -r, -r, r*2, r*2);
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(180,195,230,0.5)';
  const px = 0.25;   // parallax: the far field barely moves
  for (const f of FAR){
    const x = (f.x - cam.x*px) * cam.z*0.5 + W*0.5;
    const y = (f.y - cam.y*px) * cam.z*0.5 + H*0.5;
    if (x<0||x>W||y<0||y>H) continue;
    const s = (0.5 + f.s) * DPR;
    ctx.globalAlpha = 0.2 + 0.5*f.s;
    ctx.fillRect(x, y, s, s);
  }
  ctx.globalAlpha = 1;
}

// ---- transient effects (supernova rings, ignition pings, …) ----
const fx = [];
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let shake = 0, flashA = 0;   // a nearby supernova rocks the camera and floods the sky
const listeners = [];        // audio / UI subscribe here
SIM.onEvent = fn => listeners.push(fn);
function drainEvents(){
  for (const e of events){
    for (const fn of listeners) fn(e);
    if (e.t === 'sn'){
      fx.push({ k:'sn', x:e.x, y:e.y, age:0, max:90, m:e.m });
      // …and a remnant: a tattered filamentary shell that lingers and expands
      const jit = new Float32Array(28);
      for (let j=0;j<28;j++) jit[j] = Math.random()*2 - 1;
      fx.push({ k:'snr', x:e.x, y:e.y, age:0, max:560, m:e.m, jit });
      if (!reduceMotion){
        // the closer (and more zoomed-in) the blast, the harder it hits
        const dx = sx(e.x)-W*0.5, dy = sy(e.y)-H*0.5;
        const prox = Math.max(0, 1 - Math.hypot(dx,dy)/(W*0.8));
        shake  = Math.min(13, shake + 9*prox*Math.min(1.6, cam.z+0.4));
        flashA = Math.min(0.4, flashA + 0.3*prox*prox);
      }
    }
    else if (e.t === 'birth') fx.push({ k:'ping', x:e.x, y:e.y, age:0, max:26, m:e.m });
    else if (e.t === 'bhborn')fx.push({ k:'bh',   x:e.x, y:e.y, age:0, max:70, m:e.m });
    else if (e.t === 'kilonova') fx.push({ k:'kn', x:e.x, y:e.y, age:0, max:110, m:e.m });
    else if (e.t === 'bhmerge')  fx.push({ k:'gw', x:e.x, y:e.y, age:0, max:80,  m:e.m });
    else if (e.t === 'grb')   fx.push({ k:'grb',  x:e.x, y:e.y, age:0, max:46, m:e.m, a:e.a });
    else if (e.t === 'nova')  fx.push({ k:'nova', x:e.x, y:e.y, age:0, max:34, m:e.m });
    else if (e.t === 'xray')  fx.push({ k:'flare',x:e.x, y:e.y, age:0, max:18, m:e.m });
    else if (e.t === 'flare') fx.push({ k:'flare',x:e.x, y:e.y, age:0, max:24, m:e.m });
  }
  events.length = 0;
  if (fx.length > 140) fx.splice(0, fx.length - 140);
}
function drawFx(){
  for (let i=fx.length-1;i>=0;i--){
    const f = fx[i];
    f.age++;
    if (f.age > f.max){ fx.splice(i,1); continue; }
    const t = f.age / f.max, x = sx(f.x), y = sy(f.y);
    if (f.k === 'sn'){
      // white-hot flash, then an expanding shock ring
      if (f.age < 12){
        const r = (10 + f.m) * cam.z * (1 + f.age*0.5);
        ctx.globalAlpha = 1 - f.age/12;
        ctx.drawImage(nsSpr, x-r, y-r, r*2, r*2);
      }
      const rr = (150 + f.m*4) * t * cam.z;
      ctx.globalAlpha = 0.55 * (1-t);
      ctx.strokeStyle = '#ffd9a0'; ctx.lineWidth = Math.max(1, 2.4*cam.z*(1-t)*DPR);
      ctx.beginPath(); ctx.arc(x, y, rr, 0, 6.2832); ctx.stroke();
    } else if (f.k === 'ping'){
      const rr = 14 * t * cam.z + 2;
      ctx.globalAlpha = 0.5 * (1-t);
      ctx.strokeStyle = '#cfe0ff'; ctx.lineWidth = DPR;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, 6.2832); ctx.stroke();
    } else if (f.k === 'bh'){
      const rr = 60 * t * cam.z + 2;
      ctx.globalAlpha = 0.6 * (1-t);
      ctx.strokeStyle = '#9d6bff'; ctx.lineWidth = 1.6*DPR;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, 6.2832); ctx.stroke();
    } else if (f.k === 'kn'){
      // kilonova: a golden flash, then a slow amber shell
      if (f.age < 18){
        const r = 26 * cam.z * (1 + f.age*0.4);
        ctx.globalAlpha = 0.9 * (1 - f.age/18);
        ctx.drawImage(accSpr, x-r, y-r, r*2, r*2);
      }
      const rr = 130 * t * cam.z + 2;
      ctx.globalAlpha = 0.6 * (1-t);
      ctx.strokeStyle = '#ffcf5e'; ctx.lineWidth = Math.max(1, 2*cam.z*DPR*(1-t));
      ctx.beginPath(); ctx.arc(x, y, rr, 0, 6.2832); ctx.stroke();
    } else if (f.k === 'gw'){
      // gravitational waves: concentric ripples racing outward
      ctx.strokeStyle = '#b9a8ff'; ctx.lineWidth = DPR;
      for (let w=0; w<3; w++){
        const tt = t - w*0.12; if (tt <= 0) continue;
        ctx.globalAlpha = 0.5 * (1-tt);
        ctx.beginPath(); ctx.arc(x, y, 220*tt*cam.z + 2, 0, 6.2832); ctx.stroke();
      }
    } else if (f.k === 'grb'){
      // gamma-ray burst: two razor beams stabbing out of the collapse
      const L = (90 + 600*t) * cam.z;
      const grad = ctx.createLinearGradient(
        x - Math.cos(f.a)*L, y - Math.sin(f.a)*L,
        x + Math.cos(f.a)*L, y + Math.sin(f.a)*L);
      grad.addColorStop(0, 'rgba(190,255,230,0)');
      grad.addColorStop(0.5, `rgba(230,255,245,${0.85*(1-t)})`);
      grad.addColorStop(1, 'rgba(190,255,230,0)');
      ctx.strokeStyle = grad; ctx.lineWidth = Math.max(1, 1.6*cam.z*DPR*(1-t));
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(f.a)*L, y - Math.sin(f.a)*L);
      ctx.lineTo(x + Math.cos(f.a)*L, y + Math.sin(f.a)*L);
      ctx.stroke();
    } else if (f.k === 'snr'){
      // supernova remnant: ragged arcs, cool blue filaments threaded with
      // shocked amber — expansion fast at first, then stalling (~sqrt t)
      const r0 = (130 + f.m*3.5) * Math.min(1, Math.sqrt(f.age/110)) * cam.z;
      if (r0 < 3) continue;
      const fade = (1-t)*(1-t);
      const segs = 28, J = f.jit;
      ctx.lineWidth = Math.max(0.8, 1.6*cam.z*DPR);
      for (let s=0;s<segs;s++){
        const a0 = s/segs*6.2832, a1 = (s+0.8)/segs*6.2832;
        const rr = r0 * (1 + J[s]*0.16 + 0.05*Math.sin(f.age*0.013 + s*2.4));
        ctx.globalAlpha = fade * (0.3 + 0.35*Math.abs(J[(s+7)%segs]));
        ctx.strokeStyle = J[s] > 0.15 ? 'rgba(150,210,255,1)' : 'rgba(255,170,100,1)';
        ctx.beginPath(); ctx.arc(x, y, rr, a0, a1); ctx.stroke();
      }
    } else if (f.k === 'nova'){
      const r = (4 + 26*t) * cam.z + 2;
      ctx.globalAlpha = 0.8 * (1-t);
      ctx.drawImage(wdSpr, x-r, y-r, r*2, r*2);
    } else if (f.k === 'flare'){
      const r = (6 + 40*t) * cam.z + 2;
      ctx.globalAlpha = 0.85 * (1-t);
      ctx.drawImage(magSpr, x-r, y-r, r*2, r*2);
    }
  }
  ctx.globalAlpha = 1;
}

// ---- main draw ----
function draw(){
  // trails smear badly while panning/zooming, so clear hard on camera motion
  if (S.trails && !camMoved){
    ctx.fillStyle = 'rgba(3,4,9,0.22)';
  } else {
    ctx.fillStyle = '#030409';
  }
  ctx.fillRect(0,0,W,H);
  camMoved = false;

  // shock of a nearby supernova: brief camera judder (drawn, not simulated)
  let shaken = false;
  if (shake > 0.3){
    ctx.save();
    ctx.translate((Math.random()-0.5)*shake*DPR, (Math.random()-0.5)*shake*DPR);
    shake *= 0.86; shaken = true;
  } else shake = 0;

  // right after a big bang the whole sky still glows — the CMB, cooling away
  const cmb = SIM.cmb;
  if (cmb > 0){
    ctx.globalAlpha = cmb*cmb * 0.5;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(cmbCv, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  drawFar();
  if (S.glow) ctx.globalCompositeOperation = 'lighter';

  const N = SIM.N, z = cam.z;
  const margin = 60;
  const x0 = cam.x - (W*0.5+margin)/z, x1 = cam.x + (W*0.5+margin)/z;
  const y0 = cam.y - (H*0.5+margin)/z, y1 = cam.y + (H*0.5+margin)/z;

  // gas first (wisps on the half-res layer), then stars on top at full res
  gctx.clearRect(0, 0, gasCv.width, gasCv.height);
  gctx.globalCompositeOperation = 'lighter';
  // ---- starlight grid: splat the hot stars so gas knows how lit it is.
  // Gas near young massive stars glows as a white-pink HII region; gas far
  // from any star stays a cold dim cloud — exactly how the sky works.
  lightG.fill(0);
  for (let i=0;i<N;i++){
    const t = P.type[i];
    if (t !== STAR || P.m[i] < 3) continue;
    const x = P.x[i]; if (x<x0||x>x1) continue;
    const y = P.y[i]; if (y<y0||y>y1) continue;
    const gx = (sx(x)/W*LG_C)|0, gy = (sy(y)/H*LG_R)|0;
    const lum = Math.min(2.2, P.m[i]*0.13);
    for (let oy=-1;oy<=1;oy++){
      const yy = gy+oy; if (yy<0||yy>=LG_R) continue;
      for (let ox=-1;ox<=1;ox++){
        const xx = gx+ox; if (xx<0||xx>=LG_C) continue;
        lightG[yy*LG_C+xx] += lum * (ox===0&&oy===0 ? 1 : 0.4);
      }
    }
  }

  // clouds grow sublinearly with zoom, so zooming in resolves nebulae into
  // wisps and filaments instead of inflating them into airbrushed balls
  const zCloud = z <= 1 ? z : Math.pow(z, 0.6);
  const gasA = Math.min(0.55, 0.34 + 0.07/z);
  const gasR0 = Math.max(4, 10*zCloud) * DPR;   // half-res radius
  for (let i=0;i<N;i++){
    if (P.type[i] !== GAS || P.spin[i] > 0) continue;
    const x = P.x[i]; if (x<x0||x>x1) continue;
    const y = P.y[i]; if (y<y0||y>y1) continue;
    const hx = sx(x), hy = sy(y);
    const hue = ((P.hue[i] % 360) + 360) % 360;
    const spr = GAS_SPRS[(hue/45)|0];
    const gasR = gasR0 * (0.7 + (hue%37)*0.016);   // varied wisp sizes
    const lit = lightG[Math.min(LG_R-1, (hy/H*LG_R)|0)*LG_C + Math.min(LG_C-1, (hx/W*LG_C)|0)];
    gctx.globalAlpha = gasA * Math.min(1.9, 0.85 + lit*0.8);
    gctx.drawImage(spr, hx*0.5-gasR, hy*0.5-gasR, gasR*2, gasR*2);
    if (lit > 0.35){   // ionization glow takes over near the hot stars
      gctx.globalAlpha = Math.min(0.75, (lit-0.35)*0.7);
      gctx.drawImage(emisSpr, hx*0.5-gasR, hy*0.5-gasR, gasR*2, gasR*2);
    }
  }
  ctx.drawImage(gasCv, 0, 0, W, H);

  // dark nebulae: dusty wisps drawn over the glow, carving lanes and globules
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.55;
  const dustR = Math.max(5, 12*zCloud) * DPR;
  for (let i=0;i<N;i++){
    if (P.type[i] !== GAS || P.spin[i] === 0) continue;
    const x = P.x[i]; if (x<x0||x>x1) continue;
    const y = P.y[i]; if (y<y0||y>y1) continue;
    ctx.drawImage(DUST_SPRS[((P.hue[i]*0.043)|0)%3], sx(x)-dustR, sy(y)-dustR, dustR*2, dustR*2);
  }
  ctx.globalAlpha = 1;
  if (S.glow) ctx.globalCompositeOperation = 'lighter';

  const eraNow = SIM.era;
  // stars are point sources: past 1× they sharpen instead of inflating, and
  // the bright ones grow telescope diffraction spikes
  const zStar = z <= 1 ? z : Math.pow(z, 0.42);
  let systemsDrawn = 0;
  for (let i=0;i<N;i++){
    const t = P.type[i];
    if (t === GAS) continue;
    const x = P.x[i]; if (x<x0||x>x1) continue;
    const y = P.y[i]; if (y<y0||y>y1) continue;
    const px = sx(x), py = sy(y);
    const m = P.m[i];
    if (t === STAR){
      // runaway stars (slingshots, supernova survivors) streak with motion
      const vx = P.vx[i], vy = P.vy[i], v2 = vx*vx + vy*vy;
      if (v2 > 4.5){
        const sl = Math.min(11, Math.sqrt(v2)*2.4) * z * DPR;
        const vn = sl / Math.sqrt(v2);
        const sg = ctx.createLinearGradient(px - vx*vn, py - vy*vn, px, py);
        sg.addColorStop(0, 'rgba(200,220,255,0)');
        sg.addColorStop(1, 'rgba(200,220,255,0.4)');
        ctx.strokeStyle = sg; ctx.lineWidth = DPR;
        ctx.beginPath(); ctx.moveTo(px - vx*vn, py - vy*vn); ctx.lineTo(px, py); ctx.stroke();
      }
      let r = Math.max(2.2, (2 + Math.pow(m,0.45)*2.6) * zStar) * DPR;
      // Cepheid variables breathe — brightness swells and dims on a steady beat
      if (P.spin[i] > 0) r *= 1 + 0.3*Math.sin(eraNow*P.spin[i]*0.8 + P.hue[i]);
      const wr = m > 24;   // Wolf-Rayet: furious wind, violet sheath
      const spr = wr ? wrSpr : starSprite(m);
      ctx.drawImage(spr, px-r, py-r, r*2, r*2);
      if (m > 4){   // the big ones get a wider corona — they should dominate the sky
        const r2 = r*(wr ? 2.6 : 2.1);
        ctx.globalAlpha = 0.45;
        ctx.drawImage(spr, px-r2, py-r2, r2*2, r2*2);
        ctx.globalAlpha = 1;
      }
      if (z > 1.1 && m > 0.55){
        const sl = r * (2.6 + Math.min(3, m*0.12)) * Math.min(1, (z-1.1)*0.8);
        ctx.globalAlpha = Math.min(0.85, 0.3 + m*0.05);
        ctx.drawImage(spikeSpr, px-sl, py-sl, sl*2, sl*2);
        ctx.globalAlpha = 1;
      }
      // zoom close enough and a star resolves into a little planetary system —
      // planets are barely-there motes in muted mineral tones, the way they'd
      // really look next to their sun; orbits only whisper unless followed
      if (z > 2.2 && systemsDrawn < 150){
        systemsDrawn++;
        const h = (P.id[i]*2654435761)>>>0;
        const np = h % 5;
        const followed = followId && followIdx === i;
        for (let k=0;k<np;k++){
          const orbR = (3 + k*1.9 + ((h>>(k*3))&3)*0.7) * z * DPR;
          const sp = 0.5/Math.pow(3+k*1.9, 0.8);
          const a = eraNow*sp + ((h>>(k*5))&31);
          const ppx = px + Math.cos(a)*orbR, ppy = py + Math.sin(a)*orbR;
          if (followed || z > 3.2){
            ctx.globalAlpha = followed ? 0.28 : 0.07;
            ctx.strokeStyle = '#8893b8'; ctx.lineWidth = 0.5*DPR;
            ctx.beginPath(); ctx.arc(px, py, orbR, 0, 6.2832); ctx.stroke();
          }
          const giantP = ((h>>(k*2+9))&7) === 0;   // the occasional gas giant
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = ['#8a8f98','#b08d6a','#6f8fb0','#c2a577'][(h>>(k*4))&3];
          ctx.beginPath();
          ctx.arc(ppx, ppy, Math.max(0.7, (giantP?0.5:0.28)*z)*DPR, 0, 6.2832); ctx.fill();
          ctx.globalAlpha = 1;
        }
        // some systems keep an asteroid belt…
        if (((h>>11)&7) === 0){
          const ab = (5.5 + np*2.6 + ((h>>13)&3)) * z * DPR;
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = '#9aa2bd';
          for (let k=0;k<26;k++){
            const a = k*0.2417 + eraNow*0.06 + (h&63);
            const rr = ab * (1 + 0.06*Math.sin(k*3.7));
            ctx.fillRect(px + Math.cos(a)*rr, py + Math.sin(a)*rr, DPR, DPR);
          }
          ctx.globalAlpha = 1;
        }
        // …and some host a comet on a long eccentric ellipse, tail blown sunward-away
        if (((h>>7)&7) === 0){
          const ecc = 0.55 + ((h>>9)&3)*0.09;
          const semi = (10 + ((h>>16)&7)) * z * DPR;
          const w = (h>>20)&63;
          const ta = eraNow*0.18 + (h&31);             // sweep angle (not true Kepler — close enough)
          const cr = semi*(1-ecc*ecc) / (1 + ecc*Math.cos(ta));
          const cx2 = px + Math.cos(ta+w)*cr, cy2 = py + Math.sin(ta+w)*cr;
          const near = Math.min(1.6, semi/cr);          // brighter + longer tail near periapsis
          const tl = 6*z*DPR * near*near;
          const tg = ctx.createLinearGradient(cx2, cy2,
            cx2 + Math.cos(ta+w)*tl, cy2 + Math.sin(ta+w)*tl);
          tg.addColorStop(0, `rgba(190,235,255,${0.7*near})`);
          tg.addColorStop(1, 'rgba(190,235,255,0)');
          ctx.strokeStyle = tg; ctx.lineWidth = DPR;
          ctx.beginPath(); ctx.moveTo(cx2, cy2);
          ctx.lineTo(cx2 + Math.cos(ta+w)*tl, cy2 + Math.sin(ta+w)*tl); ctx.stroke();
          ctx.globalAlpha = Math.min(1, 0.5 + 0.5*near);
          ctx.fillStyle = '#dff2ff';
          ctx.beginPath(); ctx.arc(cx2, cy2, Math.max(0.8, 0.45*z)*DPR, 0, 6.2832); ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    } else if (t === BD){
      // a failed star: barely an ember
      const r = Math.max(1.2, 1.6*zStar) * DPR;
      ctx.globalAlpha = 0.8;
      ctx.drawImage(bdSpr, px-r, py-r, r*2, r*2);
      ctx.globalAlpha = 1;
    } else if (t === GIANT){
      // giants ARE physically huge — they keep growing with zoom and, close
      // up, resolve into a limb-darkened disc with a convective shimmer
      const r = Math.max(1.6, (3 + Math.pow(m,0.45)*3.6) * (z<=1?z:Math.pow(z,0.8))) * DPR;
      const b = 1 + 0.12*Math.sin(performance.now()*0.004 + i);
      ctx.drawImage(giantSpr, px-r*b, py-r*b, r*2*b, r*2*b);
      if (z > 1.4){
        const dr = r*0.62*b;
        ctx.drawImage(limbSpr, px-dr, py-dr, dr*2, dr*2);
      }
    } else if (t === WD){
      const fade = Math.max(0.25, 1 - P.age[i]/30000);
      const r = Math.max(0.9, 1.5*zStar) * DPR;
      ctx.globalAlpha = fade;
      ctx.drawImage(wdSpr, px-r, py-r, r*2, r*2);
      if (z > 1.1){   // tiny but intense: a pinprick with spikes
        const sl = r*2.4;
        ctx.globalAlpha = fade*0.5;
        ctx.drawImage(spikeSpr, px-sl, py-sl, sl*2, sl*2);
      }
      ctx.globalAlpha = 1;
    } else if (t === NS || t === MAGNETAR){
      const mag = t === MAGNETAR;
      const r = Math.max(1, (mag?3:2)*zStar) * DPR;
      // young remnants still wear their pulsar wind nebula
      if (P.age[i] < 2600){
        const nr = 14*z*DPR * (0.6 + 0.4*(1 - P.age[i]/2600));
        ctx.globalAlpha = 0.35 * (1 - P.age[i]/2600);
        ctx.drawImage(pwnSpr, px-nr, py-nr, nr*2, nr*2);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(mag ? magSpr : nsSpr, px-r, py-r, r*2, r*2);
      // the lighthouse: two opposed radiation CONES sweeping with the spin —
      // narrow at the pole, flaring and fading with distance
      const a = P.hue[i], L = ((mag?40:26) + 10*Math.sin(a*3)) * z * DPR;
      const wEnd = L * (mag ? 0.16 : 0.1);
      const col = mag ? '174,242,255' : '207,232,255';
      for (let side=0; side<2; side++){
        const dx = Math.cos(a + side*Math.PI), dy = Math.sin(a + side*Math.PI);
        const bg = ctx.createLinearGradient(px, py, px+dx*L, py+dy*L);
        bg.addColorStop(0, `rgba(${col},${mag?0.7:0.55})`);
        bg.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px+dx*L - dy*wEnd, py+dy*L + dx*wEnd);
        ctx.lineTo(px+dx*L + dy*wEnd, py+dy*L - dx*wEnd);
        ctx.closePath(); ctx.fill();
      }
    } else if (t === BH){
      const core = Math.max(1.2, (2 + Math.sqrt(m)*0.16) * z) * DPR;
      const feed = Math.min(1, P.hue[i] / 60);
      if (feed > 0.02){
        // hot accretion glow; a heavy feeder fires polar jets — quasar mode
        const r = core * (3 + feed*2.5);
        ctx.globalAlpha = 0.35 + 0.5*feed;
        ctx.drawImage(accSpr, px-r, py-r, r*2, r*2);
        if (feed > 0.8 && m > 400){
          // relativistic jets: tapered, flickering, fading out at the tips
          const J = Math.min(120*z, core*10) * (0.8 + 0.25*Math.sin(performance.now()*0.011));
          const grad = ctx.createLinearGradient(px, py-J, px, py+J);
          grad.addColorStop(0,   'rgba(190,226,255,0)');
          grad.addColorStop(0.5, 'rgba(220,240,255,0.55)');
          grad.addColorStop(1,   'rgba(190,226,255,0)');
          ctx.strokeStyle = grad; ctx.lineWidth = Math.max(1, core*0.22);
          ctx.beginPath(); ctx.moveTo(px, py-J); ctx.lineTo(px, py+J); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = 'source-over';
      // gravitational lensing: light from behind the hole reappears inverted
      // in an Einstein ring around it (180°-rotated copy of the backdrop,
      // clipped to an annulus). Faked, but it bends the right way.
      const lensR = core * 2.6;
      if (lensR > 5*DPR && lensR < 128 &&
          px-lensR >= 0 && py-lensR >= 0 && px+lensR < W && py+lensR < H){
        const d = Math.ceil(lensR);
        lctx.clearRect(0, 0, d*2, d*2);
        lctx.save();
        lctx.beginPath();
        lctx.arc(d, d, lensR*0.96, 0, 6.2832);
        lctx.arc(d, d, core*1.05, 0, 6.2832, true);
        lctx.clip();
        lctx.translate(d, d); lctx.rotate(Math.PI); lctx.translate(-d, -d);
        lctx.drawImage(cv, px-d, py-d, d*2, d*2, 0, 0, d*2, d*2);
        lctx.restore();
        ctx.globalAlpha = 0.75;
        ctx.drawImage(lensCv, 0, 0, d*2, d*2, px-d, py-d, d*2, d*2);
        ctx.globalAlpha = 1;
      }
      // feeding holes resolved up close get the M87 look: a tilted accretion
      // disc, doppler-beamed — the side spinning toward you burns brighter
      if (z > 1.3 && feed > 0.15){
        const dr = core*2.1;
        ctx.save();
        ctx.translate(px, py); ctx.rotate(0.5); ctx.scale(1, 0.38);
        ctx.lineWidth = core*0.55;
        ctx.globalAlpha = Math.min(0.9, 0.45 + 0.5*feed);
        ctx.strokeStyle = '#fff6dd';                       // approaching side
        ctx.beginPath(); ctx.arc(0, 0, dr, Math.PI*0.55, Math.PI*1.45); ctx.stroke();
        ctx.globalAlpha = Math.min(0.5, 0.18 + 0.25*feed);
        ctx.strokeStyle = '#ff9a4d';                       // receding side
        ctx.beginPath(); ctx.arc(0, 0, dr, Math.PI*1.45, Math.PI*0.55); ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
      }
      // the hole itself: a disc of true black with a thin photon ring
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(px, py, core, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = 'rgba(255,200,120,0.8)'; ctx.lineWidth = Math.max(0.7, core*0.16);
      ctx.beginPath(); ctx.arc(px, py, core*1.12, 0, 6.2832); ctx.stroke();
      if (S.glow) ctx.globalCompositeOperation = 'lighter';
    }
  }

  drawFx();

  // a soft reticle around whoever the camera is riding with
  if (followId && followIdx >= 0){
    const fr = (10 + Math.sqrt(P.m[followIdx])) * Math.max(0.5, z) * DPR + 6*DPR;
    ctx.globalAlpha = 0.35 + 0.15*Math.sin(performance.now()*0.004);
    ctx.strokeStyle = '#ffd9a0'; ctx.lineWidth = DPR;
    ctx.beginPath(); ctx.arc(sx(P.x[followIdx]), sy(P.y[followIdx]), fr, 0, 6.2832); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // labels for the celebrities (only when reasonably zoomed in)
  if (S.labels && z > 0.3){
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = `${11*DPR}px Segoe UI, sans-serif`;
    ctx.fillStyle = 'rgba(205,214,238,0.75)';
    let shown = 0;
    for (let i=0;i<N && shown<24;i++){
      const t = P.type[i];
      let name = null;
      if (t === BH) name = P.hue[i] > 48 && P.m[i] > 400 ? `quasar · ${P.m[i]|0} M☉` : `black hole · ${P.m[i]|0} M☉`;
      else if (t === NS) name = 'pulsar';
      else if (t === MAGNETAR) name = 'magnetar';
      else if (t === GIANT) name = 'red giant';
      else if (t === STAR && P.m[i] > 24) name = 'Wolf-Rayet star';
      else if (t === STAR && P.spin[i] > 0 && z > 1.2) name = 'Cepheid variable';
      else if (t === BD && z > 1.2) name = 'brown dwarf';
      if (!name) continue;
      const x = P.x[i]; if (x<x0||x>x1) continue;
      const y = P.y[i]; if (y<y0||y>y1) continue;
      ctx.fillText(name, sx(x)+8*DPR, sy(y)-6*DPR);
      shown++;
    }
    if (S.glow) ctx.globalCompositeOperation = 'lighter';
  }

  ctx.globalCompositeOperation = 'source-over';
  if (shaken) ctx.restore();
  if (flashA > 0.01){
    ctx.fillStyle = `rgba(255,244,228,${flashA})`;
    ctx.fillRect(0,0,W,H);
    flashA *= 0.84;
  } else flashA = 0;
}

// ---- main loop + fps ----
let last = performance.now(), fpsT = 0, fpsN = 0, fps = 0;
let lastZoomTxt = '';
const vZoom = document.getElementById('vZoom');
function frame(t){
  const dt = t - last; last = t;
  fpsT += dt; fpsN++;
  if (fpsT > 500){
    fps = Math.round(1000 * fpsN / fpsT); fpsT = 0; fpsN = 0;
    const el = document.getElementById('vFps');
    el.textContent = fps;
    el.style.color = fps >= 50 ? '#7df3b0' : fps >= 30 ? '#ffd166' : '#ff5d73';
  }
  SIM.update();
  tourStep(t);
  easeZoom();
  applyFollow();
  drainEvents();
  draw();
  // live zoom readout
  const zTxt = (cam.z >= 1 ? cam.z.toFixed(1) : cam.z.toFixed(2)) + '×';
  if (zTxt !== lastZoomTxt){ lastZoomTxt = zTxt; vZoom.textContent = zTxt; }
  requestAnimationFrame(frame);
}

// ---- cinematic tour (used by 📺 Auto): drift wide, sidle up to a celebrity,
// dwell, pull back — a planetarium that films itself ----
let tourOn = false, tourPhase = 0, tourNext = 0;
function tourStep(now){
  if (!tourOn || pointers.size) return;   // hands on the controls = tour yields
  if (now < tourNext) return;
  if (tourPhase === 0){
    // find someone worth visiting: black holes > remnants > giants > big stars
    let best = -1, bs = 0;
    for (let i=0;i<SIM.N;i++){
      const t = P.type[i];
      let s = t===BH ? 3 : (t===MAGNETAR||t===NS) ? 2.5 : t===GIANT ? 2
            : (t===STAR && P.m[i] > 8) ? 1.5 : 0;
      if (s > 0) s += Math.random();
      if (s > bs){ bs = s; best = i; }
    }
    if (best >= 0){
      followId = P.id[best]; followIdx = best;
      zTarget = 1.7 + Math.random()*1.8; anchorX = anchorY = -1;
      tourPhase = 1; tourNext = now + 9000 + Math.random()*6000;
      return;
    }
    tourNext = now + 3000;   // nothing notable yet — check back soon
  } else {
    stopFollow();
    zTarget = 0.28 + Math.random()*0.22; anchorX = anchorY = -1;
    tourPhase = 0; tourNext = now + 7000 + Math.random()*5000;
  }
}

SIM.cam = cam;
SIM.recenter = recenter;
SIM.zoomBy = f => requestZoom(W*0.5, H*0.5, f);   // keyboard / button zoom, centred
SIM.setTour = on => { tourOn = on; tourPhase = 0; tourNext = 0; if (!on){ stopFollow(); } };
SIM.followInfo = () => {
  if (!followId || followIdx < 0 || followIdx >= SIM.N || P.id[followIdx] !== followId) return null;
  const i = followIdx;
  return { type: P.type[i], m: P.m[i], age: P.age[i], life: P.life[i],
           v: Math.hypot(P.vx[i], P.vy[i]), feed: P.hue[i], spin: P.spin[i] };
};
SIM.fpsNow = () => fps;

// ---- boot: a spiral galaxy, unless a shared link will restore state (tools.js) ----
if (!location.hash || location.hash.length < 5){
  if (reduceMotion) SIM.spawnSpiral(0, 0, 4200, 850, 1, 0, 0);
  else SIM.bigBang();
}
requestAnimationFrame(frame);
})();
