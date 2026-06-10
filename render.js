/* Sidereum — renderer: camera, glow sprites, lifecycle visuals, effects.
   Owns the rAF loop; physics (sim.js) is advanced from here. */
(() => {
'use strict';
const SIM = window.SIDEREUM;
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
  zoomAt(e.clientX*DPR, e.clientY*DPR, Math.pow(1.0015, -e.deltaY));
}, { passive: false });
cv.addEventListener('dblclick', e => {
  const wx = (e.clientX*DPR - W*0.5)/cam.z + cam.x;
  const wy = (e.clientY*DPR - H*0.5)/cam.z + cam.y;
  SIM.spawnNebula(wx, wy, 420, 150);
});
cv.addEventListener('contextmenu', e => e.preventDefault());
function recenter(){ stopFollow(); cam.x = 0; cam.y = 0; cam.z = 0.34; camMoved = true; }

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
const dustSpr   = (() => {   // dark nebula wisp — drawn opaque-ish, occludes the glow
  const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  grad.addColorStop(0, 'rgba(6,5,10,0.85)');
  grad.addColorStop(0.55, 'rgba(8,6,14,0.4)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, s, s);
  return c;
})();
// gas wisps in a few nebula tints, picked per-particle by P.hue
const GAS_SPRS = [
  makeSprite('rgba(130,170,255,0.85)', 'rgba(60,90,200,0.4)'),
  makeSprite('rgba(190,130,255,0.85)', 'rgba(110,60,200,0.4)'),
  makeSprite('rgba(120,225,235,0.85)', 'rgba(40,130,160,0.4)'),
  makeSprite('rgba(255,140,190,0.85)', 'rgba(180,50,110,0.4)'),
];

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

// ---- distant starfield (static, parallax) ----
const FAR = [];
for (let i=0;i<420;i++) FAR.push({ x:(Math.random()-0.5)*9000, y:(Math.random()-0.5)*9000, s:Math.random() });
function drawFar(){
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
const listeners = [];        // audio / UI subscribe here
SIM.onEvent = fn => listeners.push(fn);
function drainEvents(){
  for (const e of events){
    for (const fn of listeners) fn(e);
    if (e.t === 'sn')      fx.push({ k:'sn',    x:e.x, y:e.y, age:0, max:90, m:e.m });
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
  gctx.globalAlpha = Math.min(0.5, 0.3 + 0.07/z);
  const gasR = Math.max(4, 10*z) * DPR;   // half-res radius — wisps must overlap into nebulae
  for (let i=0;i<N;i++){
    if (P.type[i] !== GAS || P.spin[i] > 0) continue;
    const x = P.x[i]; if (x<x0||x>x1) continue;
    const y = P.y[i]; if (y<y0||y>y1) continue;
    const spr = GAS_SPRS[((P.hue[i]*0.0111)|0) & 3];
    gctx.drawImage(spr, sx(x)*0.5-gasR, sy(y)*0.5-gasR, gasR*2, gasR*2);
  }
  ctx.drawImage(gasCv, 0, 0, W, H);

  // dark nebulae: dusty wisps drawn over the glow, carving lanes and globules
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.55;
  const dustR = Math.max(5, 12*z) * DPR;
  for (let i=0;i<N;i++){
    if (P.type[i] !== GAS || P.spin[i] === 0) continue;
    const x = P.x[i]; if (x<x0||x>x1) continue;
    const y = P.y[i]; if (y<y0||y>y1) continue;
    ctx.drawImage(dustSpr, sx(x)-dustR, sy(y)-dustR, dustR*2, dustR*2);
  }
  ctx.globalAlpha = 1;
  if (S.glow) ctx.globalCompositeOperation = 'lighter';

  const eraNow = SIM.era;
  let systemsDrawn = 0;
  for (let i=0;i<N;i++){
    const t = P.type[i];
    if (t === GAS) continue;
    const x = P.x[i]; if (x<x0||x>x1) continue;
    const y = P.y[i]; if (y<y0||y>y1) continue;
    const px = sx(x), py = sy(y);
    const m = P.m[i];
    if (t === STAR){
      let r = Math.max(2.2, (2 + Math.pow(m,0.45)*2.6) * z) * DPR;
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
      // zoom close enough and a star resolves into a little planetary system
      if (z > 2.2 && systemsDrawn < 150){
        systemsDrawn++;
        const h = (P.id[i]*2654435761)>>>0;
        const np = h % 5;
        for (let k=0;k<np;k++){
          const orbR = (4 + k*2.6 + ((h>>(k*3))&3)) * z * DPR;
          const sp = 0.5/Math.pow(4+k*2.6, 0.8);
          const a = eraNow*sp + ((h>>(k*5))&31);
          const ppx = px + Math.cos(a)*orbR, ppy = py + Math.sin(a)*orbR;
          ctx.globalAlpha = 0.25;
          ctx.strokeStyle = '#8893b8'; ctx.lineWidth = 0.5*DPR;
          ctx.beginPath(); ctx.arc(px, py, orbR, 0, 6.2832); ctx.stroke();
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = ['#9db9ff','#d8b88a','#8fd8c0','#c5cbe8'][k&3];
          ctx.beginPath(); ctx.arc(ppx, ppy, Math.max(1, 0.5*z)*DPR, 0, 6.2832); ctx.fill();
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
      const r = Math.max(1.2, 1.6*z) * DPR;
      ctx.globalAlpha = 0.8;
      ctx.drawImage(bdSpr, px-r, py-r, r*2, r*2);
      ctx.globalAlpha = 1;
    } else if (t === GIANT){
      const r = Math.max(1.6, (3 + Math.pow(m,0.45)*3.6) * z) * DPR;
      // giants smoulder — slow breathing pulse
      const b = 1 + 0.12*Math.sin(performance.now()*0.004 + i);
      ctx.drawImage(giantSpr, px-r*b, py-r*b, r*2*b, r*2*b);
    } else if (t === WD){
      const fade = Math.max(0.25, 1 - P.age[i]/30000);
      const r = Math.max(0.9, 1.7*z) * DPR;
      ctx.globalAlpha = fade;
      ctx.drawImage(wdSpr, px-r, py-r, r*2, r*2);
      ctx.globalAlpha = 1;
    } else if (t === NS || t === MAGNETAR){
      const mag = t === MAGNETAR;
      const r = Math.max(1, (mag?3:2)*z) * DPR;
      // young remnants still wear their pulsar wind nebula
      if (P.age[i] < 2600){
        const nr = 14*z*DPR * (0.6 + 0.4*(1 - P.age[i]/2600));
        ctx.globalAlpha = 0.35 * (1 - P.age[i]/2600);
        ctx.drawImage(pwnSpr, px-nr, py-nr, nr*2, nr*2);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(mag ? magSpr : nsSpr, px-r, py-r, r*2, r*2);
      // the lighthouse: two opposed beams sweeping with the spin phase
      const a = P.hue[i], L = ((mag?40:26) + 10*Math.sin(a*3)) * z * DPR;
      ctx.globalAlpha = mag ? 0.65 : 0.5;
      ctx.strokeStyle = mag ? '#aef2ff' : '#cfe8ff';
      ctx.lineWidth = Math.max(0.6, (mag?1.4:0.9)*z*DPR);
      ctx.beginPath();
      ctx.moveTo(px - Math.cos(a)*L, py - Math.sin(a)*L);
      ctx.lineTo(px + Math.cos(a)*L, py + Math.sin(a)*L);
      ctx.stroke();
      ctx.globalAlpha = 1;
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
}

// ---- main loop + fps ----
let last = performance.now(), fpsT = 0, fpsN = 0, fps = 0;
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
  applyFollow();
  drainEvents();
  draw();
  requestAnimationFrame(frame);
}

SIM.cam = cam;
SIM.recenter = recenter;
SIM.fpsNow = () => fps;

// ---- boot: a spiral galaxy, unless a shared link will restore state (tools.js) ----
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!location.hash || location.hash.length < 5){
  if (reduceMotion) SIM.spawnSpiral(0, 0, 4200, 850, 1, 0, 0);
  else SIM.bigBang();
}
requestAnimationFrame(frame);
})();
