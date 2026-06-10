/* Aevum — a living cosmos.
   One rule (gravity, via a Barnes-Hut quadtree) plus a stellar life cycle:
   gas collapses → stars ignite → giants swell → supernovae seed new gas →
   pulsars sweep, black holes feed. Nothing else is scripted. */
(() => {
'use strict';

// ---- tunables / state ----
const S = {
  timeScale: 1,     // 0..4 — how fast the cosmos runs
  gravity: 1,       // multiplier on G
  formRate: 1,      // star-formation likelihood multiplier
  paused: false,
  glow: true,
  trails: false,
  labels: false,
};

const MAX = 20000;          // hard particle capacity
const G0 = 0.055;           // base gravitational constant (world units)
const EPS2 = 16;            // softening² — stops slingshot singularities
const THETA = 0.8;          // Barnes-Hut opening angle
const VMAX = 9;             // speed cap (keeps the toy stable)
const GAS_M = 0.16;         // mass of one gas wisp
const WORLD_R = 2600;       // beyond this, a gentle pull back toward the centre

// particle types
const GAS = 0, STAR = 1, GIANT = 2, WD = 3, NS = 4, BH = 5, BD = 6, MAGNETAR = 7;

// struct-of-arrays
const P = {
  x: new Float32Array(MAX), y: new Float32Array(MAX),
  vx: new Float32Array(MAX), vy: new Float32Array(MAX),
  m: new Float32Array(MAX),
  age: new Float32Array(MAX), life: new Float32Array(MAX),
  type: new Uint8Array(MAX),
  hue: new Float32Array(MAX),   // gas tint / NS spin phase / BH feed timer
  spin: new Float32Array(MAX),  // NS sweep speed
  id: new Uint32Array(MAX),     // stable identity (survives swap-with-last)
};
let N = 0;          // alive count (alive particles are always 0..N-1)
let nextId = 1;
let cmbLeft = 0;    // ticks of cosmic-microwave-background afterglow post big bang
let era = 0;        // cosmic clock, "Myr"

const events = [];  // {t:'birth'|'sn'|'giant'|'wd'|'eat'|'bhborn', x,y,m} — drained by render

function addP(x, y, vx, vy, m, type){
  if (N >= MAX) return -1;
  const i = N++;
  P.x[i] = x; P.y[i] = y; P.vx[i] = vx; P.vy[i] = vy;
  P.m[i] = m; P.type[i] = type; P.age[i] = 0;
  P.life[i] = type === STAR ? lifeOf(m) : 1e9;
  // gas takes its tint from a smooth spatial field, so each cloud owns a
  // coherent palette (a crimson nebula HERE, a teal one THERE) instead of
  // per-particle confetti that averages to mush
  P.hue[i] = type === GAS ? hueField(x, y) + (Math.random()-0.5)*22 : Math.random() * 360;
  // spin doubles as: gas → dust flag (dark nebula wisp), star → Cepheid pulse rate
  P.spin[i] = 0;
  if (type === GAS && Math.random() < 0.22) P.spin[i] = 1;
  if (type === STAR && m > 2.5 && m < 9 && Math.random() < 0.25) P.spin[i] = 0.5 + Math.random();
  P.id[i] = nextId++;
  return i;
}
function killP(i){          // swap-with-last
  N--;
  if (i !== N){
    P.x[i]=P.x[N]; P.y[i]=P.y[N]; P.vx[i]=P.vx[N]; P.vy[i]=P.vy[N];
    P.m[i]=P.m[N]; P.age[i]=P.age[N]; P.life[i]=P.life[N];
    P.type[i]=P.type[N]; P.hue[i]=P.hue[N]; P.spin[i]=P.spin[N];
    P.id[i]=P.id[N];
  }
}

// the colour field: three drifting sine waves → smooth 0..360 hue regions.
// reseeded per universe so every cosmos wears different nebula colours.
let hp1 = 1.3, hp2 = 4.1, hp3 = 2.2;
function reseedHues(){ hp1 = Math.random()*6.28; hp2 = Math.random()*6.28; hp3 = Math.random()*6.28; }
function hueField(x, y){
  const v = Math.sin(x*0.0042 + hp1) + Math.sin(y*0.0035 + hp2) + Math.sin((x*0.6 + y)*0.0021 + hp3);
  return ((v + 3) / 6) * 360;
}

// massive stars burn fast and die loud; dwarfs smoulder for ages.
// Tuned for spectacle: a sun-like star lives ~5 real minutes at 1×.
function lifeOf(m){ return 2200 + 12000 * Math.pow(m, -1.5); }

// initial mass function: mostly small stars, the occasional monster
function imf(){ return Math.min(34, 0.3 * Math.pow(Math.random(), -0.9)); }

// ---- Barnes-Hut quadtree (flat typed arrays, rebuilt every step) ----
const NODE_CAP = MAX * 2 + 64;
const qCx = new Float32Array(NODE_CAP), qCy = new Float32Array(NODE_CAP), qH = new Float32Array(NODE_CAP);
const qM = new Float32Array(NODE_CAP), qMx = new Float32Array(NODE_CAP), qMy = new Float32Array(NODE_CAP);
const qChild = new Int32Array(NODE_CAP * 4);
const qBody = new Int32Array(NODE_CAP);   // -1 empty, -2 internal, >=0 leaf body
let nNodes = 0;

function newNode(cx, cy, h){
  const k = nNodes++;
  qCx[k]=cx; qCy[k]=cy; qH[k]=h; qM[k]=0; qMx[k]=0; qMy[k]=0; qBody[k]=-1;
  const c4 = k*4; qChild[c4]=qChild[c4+1]=qChild[c4+2]=qChild[c4+3]=-1;
  return k;
}
function buildTree(){
  nNodes = 0;
  if (!N) return;
  let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;
  for (let i=0;i<N;i++){
    const x=P.x[i], y=P.y[i];
    if (x<minX)minX=x; if (x>maxX)maxX=x;
    if (y<minY)minY=y; if (y>maxY)maxY=y;
  }
  const half = Math.max(maxX-minX, maxY-minY)*0.5 + 1;
  newNode((minX+maxX)*0.5, (minY+maxY)*0.5, half);
  for (let i=0;i<N;i++) insert(i);
}
function insert(i){
  const x=P.x[i], y=P.y[i], m=P.m[i];
  let k = 0;
  for (let depth=0; depth<48; depth++){
    // accumulate mass + centre-of-mass on the way down
    const tm = qM[k]+m;
    qMx[k] = (qMx[k]*qM[k] + x*m)/tm; qMy[k] = (qMy[k]*qM[k] + y*m)/tm; qM[k]=tm;
    if (qBody[k] === -1 && qChild[k*4] === -1){ qBody[k]=i; return; }   // empty leaf
    if (qH[k] < 0.05){ return; }   // bucket: too deep, mass already counted
    if (qBody[k] >= 0){            // occupied leaf → push old body down
      const j = qBody[k]; qBody[k] = -2;
      const q = quadrant(k, P.x[j], P.y[j]);
      let c = qChild[k*4+q];
      if (c === -1){ c = childNode(k, q); qChild[k*4+q]=c; }
      // seed the child with j's mass (it wasn't counted below k yet)
      qM[c]+=P.m[j]; qMx[c]=P.x[j]; qMy[c]=P.y[j]; qBody[c]=j;
    }
    const q = quadrant(k, x, y);
    let c = qChild[k*4+q];
    if (c === -1){ c = childNode(k, q); qChild[k*4+q]=c; }
    k = c;
  }
}
function quadrant(k, x, y){ return (x > qCx[k] ? 1 : 0) + (y > qCy[k] ? 2 : 0); }
function childNode(k, q){
  const h = qH[k]*0.5;
  return newNode(qCx[k] + (q&1 ? h : -h), qCy[k] + (q&2 ? h : -h), h);
}

const stack = new Int32Array(2048);
function accel(i, out){
  let ax=0, ay=0;
  const x=P.x[i], y=P.y[i];
  const G = G0 * S.gravity;
  let sp = 0; stack[sp++] = 0;
  while (sp > 0){
    const k = stack[--sp];
    const c4 = k*4;
    const isLeaf = qChild[c4]===-1 && qChild[c4+1]===-1 && qChild[c4+2]===-1 && qChild[c4+3]===-1;
    const dx = qMx[k]-x, dy = qMy[k]-y;
    const d2 = dx*dx + dy*dy;
    const s = qH[k]*2;
    if (isLeaf || s*s < THETA*THETA*d2){
      if (isLeaf && qBody[k] === i) continue;   // that's just me
      const dd = d2 + EPS2;
      const inv = 1 / (dd * Math.sqrt(dd));     // ≡ pow(dd,-1.5), much faster
      ax += G*qM[k]*dx*inv; ay += G*qM[k]*dy*inv;
    } else {
      for (let q=0;q<4;q++){ const c=qChild[c4+q]; if (c!==-1 && sp<2046) stack[sp++]=c; }
    }
  }
  out[0]=ax; out[1]=ay;
}

// ---- star formation: coarse density grid over the gas ----
const CELL = 30;
const denseMap = new Map();   // "cx,cy" → array of gas indices
function formStars(){
  if (S.formRate <= 0) return;
  denseMap.clear();
  for (let i=0;i<N;i++){
    if (P.type[i] !== GAS) continue;
    const key = ((P.x[i]/CELL)|0) * 73856 + ((P.y[i]/CELL)|0) * 19349;
    let arr = denseMap.get(key);
    if (!arr){ arr = []; denseMap.set(key, arr); }
    arr.push(i);
  }
  const doomed = [];
  for (const arr of denseMap.values()){
    if (arr.length < 6) continue;
    if (Math.random() > 0.06 * S.formRate * (arr.length/6)) continue;
    // collapse! sample a stellar mass, consume that much gas (momentum-conserving)
    const want = imf();
    const take = Math.min(arr.length, Math.max(3, Math.round(want / GAS_M)));
    let mx=0,my=0,mvx=0,mvy=0,mm=0;
    for (let k=0;k<take;k++){
      const i=arr[k];
      mx+=P.x[i]*P.m[i]; my+=P.y[i]*P.m[i];
      mvx+=P.vx[i]*P.m[i]; mvy+=P.vy[i]*P.m[i]; mm+=P.m[i];
      doomed.push(i);
    }
    // a dense knot keeps accreting while it collapses, so crowded cells can
    // build true giants — only the richest cores ever exceed the SN threshold
    let m = Math.max(0.16, Math.min(want, mm*2.2));
    if (Math.random() < 0.1) m = 0.16 + Math.random()*0.07;   // fizzled collapse → brown dwarf
    if (m < 0.24){
      // not enough to ignite: a brown dwarf smoulders instead
      addP(mx/mm, my/mm, mvx/mm, mvy/mm, m, BD);
    } else {
      const j = addP(mx/mm, my/mm, mvx/mm, mvy/mm, m, STAR);
      if (j >= 0){
        P.age[j] = 0; P.life[j] = lifeOf(m);
        events.push({ t:'birth', x:mx/mm, y:my/mm, m });
      }
    }
  }
  // remove consumed gas, highest index first so swaps don't invalidate
  doomed.sort((a,b)=>b-a);
  for (const i of doomed) killP(i);
}

// ---- deaths: giants, white dwarfs, supernovae, remnants ----
function evolve(dt){
  era += dt * 0.05;
  for (let i=0;i<N;i++){
    const t = P.type[i];
    if (t === GAS || t === WD || t === BH || t === BD){
      if (t === BH && P.hue[i] > 0) P.hue[i] -= dt;          // accretion glow cools
      if (t === WD) P.age[i] += dt;
      continue;
    }
    if (t === NS || t === MAGNETAR){                          // pulsar sweep phase
      P.hue[i] += P.spin[i]*dt; P.age[i] += dt;
      // magnetars throw violent magnetic flares now and then
      if (t === MAGNETAR && Math.random() < 0.0011*dt)
        events.push({ t:'flare', x:P.x[i], y:P.y[i], m:P.m[i] });
      continue;
    }
    P.age[i] += dt;
    if (t === STAR && P.m[i] >= 0.55 && P.m[i] < 8 && P.age[i] > 0.82*P.life[i]){
      P.type[i] = GIANT;
      events.push({ t:'giant', x:P.x[i], y:P.y[i], m:P.m[i] });
      continue;
    }
    if (P.age[i] > P.life[i]){
      if (P.m[i] >= 8) supernova(i);
      else if (t === GIANT || P.m[i] >= 0.55){
        // puff off a planetary nebula, leave a cooling white dwarf
        puffGas(i, 3 + (Math.random()*3|0), 0.9);
        P.type[i] = WD; P.m[i] *= 0.55; P.age[i] = 0;
        events.push({ t:'wd', x:P.x[i], y:P.y[i], m:P.m[i] });
      } else { P.life[i] = 1e9; }   // red dwarfs effectively immortal
    }
  }
}
function puffGas(i, n, speed){
  for (let k=0;k<n;k++){
    const a = Math.random()*6.2832, v = speed*(0.5+Math.random());
    const j = addP(P.x[i]+Math.cos(a)*3, P.y[i]+Math.sin(a)*3,
         P.vx[i]+Math.cos(a)*v, P.vy[i]+Math.sin(a)*v, GAS_M, GAS);
    // stellar ejecta is enriched: it glows in warm rust-and-gold tones
    if (j >= 0) P.hue[j] = 50 + Math.random()*50;
  }
}
function supernova(i){
  const x=P.x[i], y=P.y[i], m=P.m[i];
  events.push({ t:'sn', x, y, m });
  // shockwave: shove everything nearby outward (strong enough to sculpt
  // bubbles in the gas, weak enough not to unbind the whole galaxy)
  const R = 120 + m*3, R2 = R*R;
  for (let j=0;j<N;j++){
    if (j===i) continue;
    const dx=P.x[j]-x, dy=P.y[j]-y, d2=dx*dx+dy*dy;
    if (d2 > R2 || d2 < 1) continue;
    // gas takes the blast (sculpts bubbles + triggers collapse); stars only
    // shudder — a kick past escape velocity would slowly evaporate the galaxy
    const base = P.type[j]===GAS ? 2.0 : 0.45;
    const d = Math.sqrt(d2), kick = base*(1-d/R)/Math.max(0.4,Math.sqrt(P.m[j]));
    P.vx[j]+=dx/d*kick; P.vy[j]+=dy/d*kick;
  }
  // fling enriched gas back into the void — fuel for the next generation
  const nGas = Math.min(8 + (m|0), MAX-N);
  for (let k=0;k<nGas;k++){
    const a=Math.random()*6.2832, v=1.4+Math.random()*2.4;
    addP(x+Math.cos(a)*4, y+Math.sin(a)*4, P.vx[i]+Math.cos(a)*v, P.vy[i]+Math.sin(a)*v, GAS_M, GAS);
  }
  // the core collapses: monster → black hole (announced by a gamma-ray burst),
  // otherwise a sweeping pulsar — and sometimes a flaring magnetar
  if (m >= 16){
    P.type[i]=BH; P.m[i]=m*0.45; P.hue[i]=40; P.age[i]=0; P.life[i]=1e9;
    events.push({ t:'grb', x, y, m, a:Math.random()*Math.PI });
    events.push({ t:'bhborn', x, y, m:P.m[i] });
  } else {
    const mag = Math.random() < 0.22;
    P.type[i] = mag ? MAGNETAR : NS;
    P.m[i]=mag?2.1:1.5; P.age[i]=0; P.life[i]=1e9;
    P.hue[i]=Math.random()*6.2832;
    P.spin[i]=mag ? 0.16+Math.random()*0.2 : 0.05+Math.random()*0.12;
  }
}

// ---- black holes feed; compact remnants merge ----
let eatCool = 0;
const eaten = [];
function feedBlackHoles(dt){
  eatCool -= dt;
  eaten.length = 0;
  for (let i=0;i<N;i++){
    if (P.type[i] !== BH) continue;
    const r = 5 + Math.sqrt(P.m[i])*0.22, r2=r*r;
    for (let j=0;j<N;j++){
      if (j===i || P.type[j]===BH || P.type[j]===255) continue;   // 255 = already eaten this pass
      const dx=P.x[j]-P.x[i], dy=P.y[j]-P.y[i];
      if (dx*dx+dy*dy < r2){
        const wasStar = P.type[j] !== GAS;
        P.m[i]+=P.m[j]; P.hue[i]=Math.min(140, P.hue[i]+22);   // accretion flare
        P.type[j]=255;
        eaten.push(j);
        if (wasStar || eatCool<=0){ events.push({ t:'eat', x:P.x[i], y:P.y[i], m:P.m[i], star:wasStar }); eatCool = 30; }
      }
    }
  }
  // remove after the scan so swap-with-last can't pull a live index out from under us
  if (eaten.length){
    eaten.sort((a,b)=>b-a);
    for (const j of eaten){ P.m[j] = 0; killP(j); }
  }
}

// compact-object collisions: NS+NS → kilonova; BH+BH → merger (one loud chirp)
const compact = [];
function mergeCompact(){
  compact.length = 0;
  for (let i=0;i<N;i++) if (P.type[i]===NS || P.type[i]===MAGNETAR || P.type[i]===BH) compact.push(i);
  if (compact.length < 2) return;
  for (let a=0;a<compact.length;a++){
    for (let b=a+1;b<compact.length;b++){
      const i=compact[a], j=compact[b];
      if (P.m[i]===0 || P.m[j]===0) continue;   // already merged this pass
      const dx=P.x[j]-P.x[i], dy=P.y[j]-P.y[i];
      const ti=P.type[i], tj=P.type[j];
      const rr = (ti===BH?4+Math.sqrt(P.m[i])*0.2:3) + (tj===BH?4+Math.sqrt(P.m[j])*0.2:3);
      if (dx*dx+dy*dy > rr*rr) continue;
      const mm = P.m[i]+P.m[j];
      const vx=(P.vx[i]*P.m[i]+P.vx[j]*P.m[j])/mm, vy=(P.vy[i]*P.m[i]+P.vy[j]*P.m[j])/mm;
      if (ti!==BH && tj!==BH){
        events.push({ t:'kilonova', x:P.x[i], y:P.y[i], m:mm });
        puffGas(i, 10, 2.2);                       // a spray of freshly-forged heavy elements
        P.type[i]=BH; P.m[i]=mm; P.hue[i]=120;     // most NS-NS pairs tip into a black hole
      } else {
        events.push({ t:'bhmerge', x:P.x[i], y:P.y[i], m:mm });
        P.type[i]=BH; P.m[i]=mm; P.hue[i]=Math.max(P.hue[i], 80);
      }
      P.vx[i]=vx; P.vy[i]=vy; P.age[i]=0; P.life[i]=1e9;
      P.m[j]=0;   // mark; reaped below
    }
  }
  for (let i=N-1;i>=0;i--) if (P.m[i]===0 && (P.type[i]===NS||P.type[i]===MAGNETAR||P.type[i]===BH)) killP(i);
}

// ---- close binaries with a swollen donor: novae and X-ray bursts ----
const wdIdx = [], giIdx = [];
function novae(){
  wdIdx.length = 0; giIdx.length = 0;
  for (let i=0;i<N;i++){
    const t = P.type[i];
    if (t===WD || t===NS || t===MAGNETAR) wdIdx.push(i);
    else if (t===GIANT) giIdx.push(i);
  }
  if (!wdIdx.length || !giIdx.length || wdIdx.length*giIdx.length > 250000) return;
  for (const i of wdIdx){
    for (const j of giIdx){
      const dx=P.x[j]-P.x[i], dy=P.y[j]-P.y[i];
      if (dx*dx+dy*dy < 18*18 && Math.random() < 0.05){
        // a white dwarf erupts as a nova; a neutron star flares in X-rays
        events.push({ t: P.type[i]===WD ? 'nova' : 'xray', x:P.x[i], y:P.y[i], m:P.m[i] });
        break;
      }
    }
  }
}

// ---- physics step ----
const aTmp = new Float64Array(2);
function step(dt){
  buildTree();
  for (let i=0;i<N;i++){
    accel(i, aTmp);
    let vx = P.vx[i] + aTmp[0]*dt, vy = P.vy[i] + aTmp[1]*dt;
    // far wanderers get a gentle pull home so the cosmos never empties
    const x=P.x[i], y=P.y[i], r2=x*x+y*y;
    if (r2 > WORLD_R*WORLD_R){ vx -= x*3e-5*dt*Math.sqrt(r2)/WORLD_R; vy -= y*3e-5*dt*Math.sqrt(r2)/WORLD_R; }
    if (P.type[i]===GAS){ vx*=0.9995; vy*=0.9995; }   // faint drag → gas cools & clumps
    const v2 = vx*vx+vy*vy;
    if (v2 > VMAX*VMAX){ const s=VMAX/Math.sqrt(v2); vx*=s; vy*=s; }
    P.vx[i]=vx; P.vy[i]=vy;
  }
  for (let i=0;i<N;i++){ P.x[i]+=P.vx[i]*dt; P.y[i]+=P.vy[i]*dt; }
  evolve(dt);
  feedBlackHoles(dt);
  mergeCompact();
}

let formTick = 0;
function update(){
  if (S.paused || !S.timeScale) return;
  const dt = Math.min(2, S.timeScale);
  const sub = S.timeScale > 2 ? 2 : 1;
  for (let k=0;k<sub;k++) step(S.timeScale/sub);
  if (cmbLeft > 0) cmbLeft -= S.timeScale;
  if (++formTick >= 3){ formTick = 0; formStars(); novae(); }
}

// ---- spawners ----
function clearAll(){ N = 0; era = 0; events.length = 0; reseedHues(); }

function circVel(r, Menc){ return Math.sqrt(G0*S.gravity*Math.max(1,Menc)/Math.max(8,r)); }

function spawnSpiral(cx, cy, count, R, dir, vx0, vy0, smbhScale){
  vx0 = vx0||0; vy0 = vy0||0;
  const smbhM = 3800 * (smbhScale||1);
  const bh = addP(cx, cy, vx0, vy0, smbhM, BH);
  if (bh>=0){ P.hue[bh]=30; }
  const diskM = count * 0.5;
  // half of all spirals grow a central bar (like the Milky Way's)
  const barred = Math.random() < 0.5;
  const barA = Math.random()*Math.PI, barL = R*0.3;
  for (let k=0;k<count && N<MAX;k++){
    // exponential-ish disk with two seeded arms
    let r = R*0.06 + (-Math.log(1-Math.random()*0.94))*R*0.3;
    if (r>R) r = R*Math.random();
    let th;
    if (barred && r < barL && Math.random()<0.7){
      // the bar: stars strung along a rotating spindle through the nucleus
      const s = (Math.random()*2-1);
      const w = (Math.random()-0.5)*barL*0.22;
      const x = cx + Math.cos(barA)*s*barL - Math.sin(barA)*w;
      const y = cy + Math.sin(barA)*s*barL + Math.cos(barA)*w;
      r = Math.max(8, Math.hypot(x-cx, y-cy)); th = Math.atan2(y-cy, x-cx);
    } else if (Math.random()<0.68 && r > R*0.16){
      // arms anchored to the bar's ends (or, unbarred, to the nucleus)
      const arm = (Math.random()<0.5 ? 0 : Math.PI) + (barred ? barA : 0);
      th = arm + (barred ? (r-barL) : r)*0.0145*dir + (Math.random()-0.5)*0.55;
    } else th = Math.random()*6.2832;
    const x = cx + Math.cos(th)*r, y = cy + Math.sin(th)*r;
    const Menc = smbhM + diskM*Math.pow(r/R, 1.4);
    const v = circVel(r, Menc) * (0.92+Math.random()*0.16);
    const tx = -Math.sin(th)*dir, ty = Math.cos(th)*dir;
    const gas = Math.random() < 0.55;
    if (gas) addP(x, y, vx0+tx*v, vy0+ty*v, GAS_M, GAS);
    else {
      const m = imf();
      const i = addP(x, y, vx0+tx*v, vy0+ty*v, m, STAR);
      if (i>=0) P.age[i] = Math.random()*0.75*P.life[i];   // mixed-age population
    }
  }
}
function spawnRing(cx, cy){
  // a Hoag-type ring galaxy: an old yellow core inside a detached blue ring
  const coreM = 2400;
  const bh = addP(cx, cy, 0, 0, coreM, BH); if (bh>=0) P.hue[bh]=20;
  for (let k=0;k<750 && N<MAX;k++){
    const r=20+90*Math.pow(Math.random(),0.6), th=Math.random()*6.2832;
    const v=circVel(r, coreM)*0.55, va=Math.random()*6.2832;
    const m=Math.min(2.6, imf());
    const i=addP(cx+Math.cos(th)*r, cy+Math.sin(th)*r, Math.cos(va)*v, Math.sin(va)*v, m, STAR);
    if (i>=0) P.age[i]=(0.3+Math.random()*0.5)*P.life[i];
  }
  const ringR = 480, ringM = coreM + 420;
  for (let k=0;k<2600 && N<MAX;k++){
    const r=ringR + (Math.random()-0.5)*80, th=Math.random()*6.2832;
    const v=circVel(r, ringM + 1300*0.5)*(0.97+Math.random()*0.06);
    const x=cx+Math.cos(th)*r, y=cy+Math.sin(th)*r;
    if (Math.random()<0.6) addP(x, y, -Math.sin(th)*v, Math.cos(th)*v, GAS_M, GAS);
    else {
      const i=addP(x, y, -Math.sin(th)*v, Math.cos(th)*v, imf(), STAR);
      if (i>=0) P.age[i]=Math.random()*0.4*P.life[i];   // the ring is young and blue
    }
  }
}
function spawnGroup(){
  // a little galaxy group: dwarfs waltzing around their common centre —
  // give it time and they strip, distort and merge into one
  clearAll();
  const n = 5, orbitR = 950;
  const totalM = n * 2200;
  for (let g=0; g<n; g++){
    const a = g*6.2832/n + Math.random()*0.5;
    const r = orbitR*(0.75+Math.random()*0.5);
    const x = Math.cos(a)*r, y = Math.sin(a)*r;
    const v = circVel(r, totalM*0.55)*(0.85+Math.random()*0.2);
    const vx = -Math.sin(a)*v, vy = Math.cos(a)*v;
    if (Math.random()<0.6) spawnSpiral(x, y, 950, 300, Math.random()<0.5?1:-1, vx, vy, 0.42);
    else {
      // dwarf elliptical: same recipe as the big one, just smaller
      const coreM = 1100;
      const bh = addP(x, y, vx, vy, coreM, BH); if (bh>=0) P.hue[bh]=10;
      for (let k=0;k<800 && N<MAX;k++){
        const rr=260*Math.pow(Math.random(),0.62), th=Math.random()*6.2832;
        const sig=circVel(rr, coreM+800*0.4*Math.pow(rr/260,1.2))*0.75;
        const va=Math.random()*6.2832, vv=sig*(0.5+Math.random());
        const i=addP(x+Math.cos(th)*rr, y+Math.sin(th)*rr, vx+Math.cos(va)*vv, vy+Math.sin(va)*vv, Math.min(1.6,imf()), STAR);
        if (i>=0) P.age[i]=(0.3+Math.random()*0.55)*P.life[i];
      }
    }
  }
  // thin intracluster gas threading the group
  for (let k=0;k<900 && N<MAX;k++){
    const r=1400*Math.sqrt(Math.random()), th=Math.random()*6.2832;
    const v=circVel(r, totalM*0.4)*0.7;
    addP(Math.cos(th)*r, Math.sin(th)*r, -Math.sin(th)*v, Math.cos(th)*v, GAS_M, GAS);
  }
}
function spawnElliptical(cx, cy, count, R){
  const coreM = 1800;
  const bh = addP(cx, cy, 0, 0, coreM, BH); if (bh>=0) P.hue[bh]=10;
  for (let k=0;k<count && N<MAX;k++){
    const r = R*Math.pow(Math.random(),0.62), th=Math.random()*6.2832;
    const x=cx+Math.cos(th)*r, y=cy+Math.sin(th)*r;
    const sig = circVel(r, coreM + count*0.4*Math.pow(r/R,1.2)) * 0.75;
    const va = Math.random()*6.2832, v = sig*(0.5+Math.random());
    // old population: small reddish suns, hardly any gas
    const m = Math.min(1.6, imf());
    const i = addP(x,y, Math.cos(va)*v, Math.sin(va)*v, m, STAR);
    if (i>=0) P.age[i] = (0.3+Math.random()*0.55)*P.life[i];
  }
}
function spawnNebula(cx, cy, count, R){
  const swirl = (Math.random()<0.5?-1:1) * (0.15+Math.random()*0.25);
  for (let k=0;k<count && N<MAX;k++){
    const r=R*Math.sqrt(Math.random()), th=Math.random()*6.2832;
    const tx=-Math.sin(th), ty=Math.cos(th);
    addP(cx+Math.cos(th)*r, cy+Math.sin(th)*r,
         tx*swirl*r/R + (Math.random()-0.5)*0.3,
         ty*swirl*r/R + (Math.random()-0.5)*0.3, GAS_M, GAS);
  }
}
function spawnCluster(cx, cy, count, R){
  for (let k=0;k<count && N<MAX;k++){
    const r=R*Math.pow(Math.random(),0.8), th=Math.random()*6.2832;
    const sig = circVel(r, count*1.1*Math.pow(r/R,1.3))*0.8;
    const va=Math.random()*6.2832, v=sig*(0.4+Math.random());
    const m=imf();
    const i=addP(cx+Math.cos(th)*r, cy+Math.sin(th)*r, Math.cos(va)*v, Math.sin(va)*v, m, STAR);
    if (i>=0) P.age[i]=Math.random()*0.5*P.life[i];
  }
  spawnNebula(cx, cy, count/2|0, R*1.4);
}
function spawnBinary(cx, cy){
  // two black holes locked in a slow waltz inside a shared accretion cloud —
  // gas streams between them, stars ignite in the disk, and one day they merge
  const m1=620, m2=430, d=140;
  const mu=m1+m2, r1=d*m2/mu, r2=d*m1/mu;
  const v = Math.sqrt(G0*S.gravity*mu/d) * 0.72;   // slightly sub-circular → slow inspiral
  let i = addP(cx-r1, cy, 0,  v*m2/mu, m1, BH); if (i>=0) P.hue[i]=70;
  i = addP(cx+r2, cy, 0, -v*m1/mu, m2, BH); if (i>=0) P.hue[i]=70;
  for (let k=0;k<2800 && N<MAX;k++){
    const r=180+Math.pow(Math.random(),0.65)*950, th=Math.random()*6.2832;
    const vv=circVel(r, mu + r*0.4)*(0.93+Math.random()*0.14);
    const x=cx+Math.cos(th)*r, y=cy+Math.sin(th)*r;
    if (Math.random()<0.78) addP(x, y, -Math.sin(th)*vv, Math.cos(th)*vv, GAS_M, GAS);
    else {
      const m=imf();
      const s=addP(x, y, -Math.sin(th)*vv, Math.cos(th)*vv, m, STAR);
      if (s>=0) P.age[s]=Math.random()*0.6*P.life[s];
    }
  }
}
function spawnCollision(){
  clearAll();
  spawnSpiral(-1050, -260, 3400, 760,  1,  0.55,  0.18);
  spawnSpiral( 1050,  260, 3400, 760, -1, -0.55, -0.18);
}
function bigBang(){
  clearAll();
  cmbLeft = 420;   // the relic glow of the hot young universe, fading as it cools
  // primordial density fluctuations: most matter starts in proto-clumps, the
  // rest is a thin fog. Gravity drags it into filaments — a little cosmic web —
  // and the knots collapse into the first stars.
  const H = 0.00055, swirl = 0.0005;
  const put = (x,y) => addP(x, y,
    x*H - y*swirl + (Math.random()-0.5)*0.3,
    y*H + x*swirl + (Math.random()-0.5)*0.3, GAS_M, GAS);
  for (let c=0;c<44;c++){
    const rc=1350*Math.sqrt(Math.random()), tc=Math.random()*6.2832;
    const cxp=Math.cos(tc)*rc, cyp=Math.sin(tc)*rc;
    const size=28+Math.random()*95, nn=70+(Math.random()*120|0);
    for (let k=0;k<nn && N<MAX-1600;k++){
      const a=Math.random()*6.2832, rr=size*Math.pow(Math.random(),0.6);
      put(cxp+Math.cos(a)*rr, cyp+Math.sin(a)*rr);
    }
  }
  for (let k=0;k<1600 && N<MAX;k++){
    const r=1500*Math.sqrt(Math.random()), th=Math.random()*6.2832;
    put(Math.cos(th)*r, Math.sin(th)*r);
  }
}

// ---- public API ----
window.AEVUM = {
  S, P, events,
  get N(){ return N; }, get era(){ return era; }, get cmb(){ return Math.max(0, cmbLeft)/420; },
  GAS, STAR, GIANT, WD, NS, BH, BD, MAGNETAR,
  update, clearAll, addP,
  spawnSpiral, spawnElliptical, spawnNebula, spawnCluster, spawnBinary, spawnCollision,
  spawnRing, spawnGroup, bigBang,
};
})();
