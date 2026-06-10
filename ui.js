/* Sidereum — UI: sliders, seed buttons, toggles, HUD census, toasts, keys */
(() => {
'use strict';
const SIM = window.SIDEREUM;
const { S, P } = SIM;
const $ = id => document.getElementById(id);

// ---- sliders ----
function bind(slider, label, key, fmt){
  const el = $(slider), lbl = $(label);
  const render = () => { lbl.textContent = fmt ? fmt(S[key]) : S[key]; };
  el.value = S[key];
  el.addEventListener('input', () => { S[key] = parseFloat(el.value); render(); });
  render();
}
bind('sTime', 'vTime', 'timeScale', v => v.toFixed(1)+'×');
bind('sGrav', 'vGrav', 'gravity',   v => v.toFixed(2));
bind('sForm', 'vForm', 'formRate',  v => v.toFixed(1));

// ---- seeds (each remembers itself so Share can recreate the scene) ----
let lastScene = 'bigbang';
const SCENES = {
  spiral:     () => { SIM.clearAll(); SIM.spawnSpiral(0, 0, 4200, 850, 1, 0, 0); },
  elliptical: () => { SIM.clearAll(); SIM.spawnElliptical(0, 0, 3600, 700); },
  collision:  () => { SIM.spawnCollision(); },
  nebula:     () => { SIM.clearAll(); SIM.spawnNebula(0, 0, 3800, 620); },
  cluster:    () => { SIM.clearAll(); SIM.spawnCluster(0, 0, 1700, 320); },
  binary:     () => { SIM.clearAll(); SIM.spawnBinary(0, 0); },
  ring:       () => { SIM.clearAll(); SIM.spawnRing(0, 0); },
  group:      () => { SIM.spawnGroup(); },
  bigbang:    () => { SIM.bigBang(); },
};
function runScene(name){
  if (!SCENES[name]) return;
  lastScene = name;
  SCENES[name]();
  SIM.recenter();
}
[['pSpiral','spiral'],['pElliptical','elliptical'],['pCollision','collision'],
 ['pNebula','nebula'],['pCluster','cluster'],['pBinary','binary'],
 ['pRing','ring'],['pGroup','group'],['bBang','bigbang']]
  .forEach(([id, name]) => { $(id).onclick = () => runScene(name); });

// ---- view toggles ----
const bGlow = $('bGlow');
bGlow.onclick = () => { S.glow = !S.glow; bGlow.classList.toggle('active', S.glow); };
const bTrails = $('bTrails');
bTrails.onclick = () => { S.trails = !S.trails; bTrails.classList.toggle('active', S.trails); };
const bLabels = $('bLabels');
bLabels.onclick = () => { S.labels = !S.labels; bLabels.classList.toggle('active', S.labels); };
const bPause = $('bPause');
bPause.onclick = () => { S.paused = !S.paused; bPause.classList.toggle('active', S.paused); bPause.textContent = S.paused ? 'Resume' : 'Pause'; };
$('bHome').onclick = () => SIM.recenter();

// ---- 📺 Auto: hands-free planetarium — reseeds the void every so often ----
let autoOn = false, autoTimer = null;
const bAuto = $('bAuto');
function autoStep(){
  const names = Object.keys(SCENES);
  runScene(names[(Math.random()*names.length)|0]);
}
bAuto.onclick = () => {
  autoOn = !autoOn;
  bAuto.classList.toggle('active', autoOn);
  clearInterval(autoTimer);
  if (autoOn){ autoStep(); autoTimer = setInterval(autoStep, 45000); }
};

// ---- HUD census ----
setInterval(() => {
  const n = SIM.N;
  let gas=0, stars=0, remn=0, bh=0;
  for (let i=0;i<n;i++){
    const t = P.type[i];
    if (t === SIM.GAS) gas++;
    else if (t === SIM.STAR || t === SIM.GIANT || t === SIM.BD) stars++;
    else if (t === SIM.BH) bh++;
    else remn++;
  }
  $('vGas').textContent = gas;
  $('vStars').textContent = stars;
  $('vRemn').textContent = remn;
  $('vBH').textContent = bh;
  $('vEra').textContent = SIM.era | 0;
}, 500);

// ---- toasts for the headline events ----
const toasts = $('toasts');
let toastCool = 0;
function toast(msg){
  const now = performance.now();
  if (now - toastCool < 2500 || toasts.children.length > 2) return;
  toastCool = now;
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  toasts.appendChild(el);
  setTimeout(() => el.remove(), 4100);
}
SIM.onEvent(e => {
  if (e.t === 'sn') toast(`💥 supernova — ${e.m.toFixed(0)} M☉`);
  else if (e.t === 'bhborn') toast('🕳️ a black hole is born');
  else if (e.t === 'kilonova') toast('💛 kilonova — neutron stars collide');
  else if (e.t === 'bhmerge') toast('🌀 black holes merge — spacetime rings');
  else if (e.t === 'eat' && e.star) toast('⭐ tidal disruption — a star is devoured');
  else if (e.t === 'grb') toast('☄️ gamma-ray burst');
  else if (e.t === 'nova') toast('💡 nova — a white dwarf erupts');
  else if (e.t === 'flare' && Math.random() < 0.3) toast('⚡ magnetar flare');
  else if (e.t === 'giant' && Math.random() < 0.1) toast('🔴 a sun swells into a red giant');
});

// ---- panel toggle ----
const ui = $('ui'), toggleBtn = $('toggleUI');
let panelHidden = false;
function hidePanel(h){ ui.classList.toggle('hidden', h); toggleBtn.classList.toggle('show', h); }
toggleBtn.onclick = () => { panelHidden = false; hidePanel(false); };
$('bClose').onclick = () => { panelHidden = true; hidePanel(true); };

// ---- keyboard ----
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  switch (e.key.toLowerCase()){
    case ' ': e.preventDefault(); bPause.click(); break;
    case 'g': bGlow.click(); break;
    case 't': bTrails.click(); break;
    case 'l': bLabels.click(); break;
    case 'a': bAuto.click(); break;
    case 'b': runScene('bigbang'); break;
    case 'h': panelHidden = !panelHidden; hidePanel(panelHidden); break;
    case 'f': $('bFull').click(); break;
    case '0': SIM.recenter(); break;
    case '?': $('helpBtn').click(); break;
    case 'escape': $('help').classList.remove('show'); break;
    case '1': runScene('spiral'); break;
    case '2': runScene('elliptical'); break;
    case '3': runScene('collision'); break;
    case '4': runScene('nebula'); break;
    case '5': runScene('cluster'); break;
    case '6': runScene('binary'); break;
    case '7': runScene('ring'); break;
    case '8': runScene('group'); break;
  }
});

window.SIDEREUM_UI = {
  get lastScene(){ return lastScene; },
  runScene,
  syncControls(){
    const set = (id,lbl,val,fmt) => { const e=$(id); if(e){ e.value=val; $(lbl).textContent=fmt(val); } };
    set('sTime','vTime',S.timeScale, v=>(+v).toFixed(1)+'×');
    set('sGrav','vGrav',S.gravity,   v=>(+v).toFixed(2));
    set('sForm','vForm',S.formRate,  v=>(+v).toFixed(1));
    bGlow.classList.toggle('active', S.glow);
    bTrails.classList.toggle('active', S.trails);
    bLabels.classList.toggle('active', S.labels);
  },
};
})();
