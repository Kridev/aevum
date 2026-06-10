/* Sidereum — renderer: camera, glow sprites, lifecycle visuals, effects.
   Owns the rAF loop; physics (sim.js) is advanced from here. */
(() => {
'use strict';
const SIM = window.SIDEREUM;
const { S, P, events, GAS, STAR, GIANT, WD, NS, BH } = SIM;

const cv = document.getElementById('stage');
const ctx = cv.getContext('2d', { alpha: false });
// gas is drawn to a half-resolution layer then scaled up — thousands of soft
// blobs cost 4× less fill, and the blur from upscaling actually helps the look
const gasCv = document.createElement('canvas');
const gctx = gasCv.getContext('2d');
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

let dragging = false, lastPX = 0, lastPY = 0, downAt = 0;
cv.addEventListener('pointerdown', e => {
  dragging = true; lastPX = e.clientX; lastPY = e.clientY; downAt = performance.now();
  cv.classList.add('dragging'); cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', e => {
  if (!dragging) return;
  cam.x -= (e.clientX - lastPX) * DPR / cam.z;
  cam.y -= (e.clientY - lastPY) * DPR / cam.z;
  lastPX = e.clientX; lastPY = e.clientY; camMoved = true;
});
addEventListener('pointerup', () => { dragging = false; cv.classList.remove('dragging'); });
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const f = Math.pow(1.0015, -e.deltaY);
  const mx = e.clientX * DPR, my = e.clientY * DPR;
  // zoom toward the cursor: keep the world point under it fixed
  const wx = (mx - W*0.5)/cam.z + cam.x, wy = (my - H*0.5)/cam.z + cam.y;
  cam.z = Math.min(8, Math.max(0.05, cam.z * f));
  cam.x = wx - (mx - W*0.5)/cam.z;
  cam.y = wy - (my - H*0.5)/cam.z;
  camMoved = true;
}, { passive: false });
cv.addEventListener('dblclick', e => {
  const wx = (e.clientX*DPR - W*0.5)/cam.z + cam.x;
  const wy = (e.clientY*DPR - H*0.5)/cam.z + cam.y;
  SIM.spawnNebula(wx, wy, 420, 150);
});
cv.addEventListener('contextmenu', e => e.preventDefault());
function recenter(){ cam.x = 0; cam.y = 0; cam.z = 0.34; camMoved = true; }

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
// gas wisps in a few nebula tints, picked per-particle by P.hue
const GAS_SPRS = [
  makeSprite('rgba(130,170,255,0.85)', 'rgba(60,90,200,0.4)'),
  makeSprite('rgba(190,130,255,0.85)', 'rgba(110,60,200,0.4)'),
  makeSprite('rgba(120,225,235,0.85)', 'rgba(40,130,160,0.4)'),
  makeSprite('rgba(255,140,190,0.85)', 'rgba(180,50,110,0.4)'),
];

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
    if (P.type[i] !== GAS) continue;
    const x = P.x[i]; if (x<x0||x>x1) continue;
    const y = P.y[i]; if (y<y0||y>y1) continue;
    const spr = GAS_SPRS[((P.hue[i]*0.0111)|0) & 3];
    gctx.drawImage(spr, sx(x)*0.5-gasR, sy(y)*0.5-gasR, gasR*2, gasR*2);
  }
  ctx.drawImage(gasCv, 0, 0, W, H);

  for (let i=0;i<N;i++){
    const t = P.type[i];
    if (t === GAS) continue;
    const x = P.x[i]; if (x<x0||x>x1) continue;
    const y = P.y[i]; if (y<y0||y>y1) continue;
    const px = sx(x), py = sy(y);
    const m = P.m[i];
    if (t === STAR){
      const r = Math.max(2.2, (2 + Math.pow(m,0.45)*2.6) * z) * DPR;
      const spr = starSprite(m);
      ctx.drawImage(spr, px-r, py-r, r*2, r*2);
      if (m > 4){   // the big ones get a wider corona — they should dominate the sky
        const r2 = r*2.1;
        ctx.globalAlpha = 0.45;
        ctx.drawImage(spr, px-r2, py-r2, r2*2, r2*2);
        ctx.globalAlpha = 1;
      }
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
    } else if (t === NS){
      const r = Math.max(1, 2*z) * DPR;
      ctx.drawImage(nsSpr, px-r, py-r, r*2, r*2);
      // the lighthouse: two opposed beams sweeping with the spin phase
      const a = P.hue[i], L = (26 + 10*Math.sin(a*3)) * z * DPR;
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#cfe8ff'; ctx.lineWidth = Math.max(0.6, 0.9*z*DPR);
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
      // the hole itself: a disc of true black with a thin photon ring
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(px, py, core, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = 'rgba(255,200,120,0.8)'; ctx.lineWidth = Math.max(0.7, core*0.16);
      ctx.beginPath(); ctx.arc(px, py, core*1.12, 0, 6.2832); ctx.stroke();
      if (S.glow) ctx.globalCompositeOperation = 'lighter';
    }
  }

  drawFx();

  // labels for the celebrities (only when reasonably zoomed in)
  if (S.labels && z > 0.3){
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = `${11*DPR}px Segoe UI, sans-serif`;
    ctx.fillStyle = 'rgba(205,214,238,0.75)';
    let shown = 0;
    for (let i=0;i<N && shown<24;i++){
      const t = P.type[i];
      if (t !== BH && t !== NS && t !== GIANT) continue;
      const x = P.x[i]; if (x<x0||x>x1) continue;
      const y = P.y[i]; if (y<y0||y>y1) continue;
      const name = t===BH
        ? (P.hue[i] > 48 && P.m[i] > 400 ? `quasar · ${P.m[i]|0} M☉` : `black hole · ${P.m[i]|0} M☉`)
        : t===NS ? 'pulsar' : 'red giant';
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
