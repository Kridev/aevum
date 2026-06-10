/* Aevum — PNG export, video capture, save / load / share, fullscreen, intro */
(() => {
'use strict';
const SIM = window.AEVUM;
const { S } = SIM;
const $ = id => document.getElementById(id);
function flash(msg){ const s = $('status'); s.textContent = msg; clearTimeout(flash._t); flash._t = setTimeout(()=>s.textContent='', 2600); }

// ---- PNG export ----
$('bSnap').onclick = () => {
  const cv = document.getElementById('stage');
  cv.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `aevum-${Date.now()}.png`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
    flash('saved PNG');
  });
};

// ---- video capture (WebM via MediaRecorder) ----
let recorder = null, chunks = [];
const bRec = $('bRec');
bRec.onclick = () => {
  if (recorder){ recorder.stop(); return; }
  const cv = document.getElementById('stage');
  if (!cv.captureStream || typeof MediaRecorder === 'undefined'){ flash('recording not supported here'); return; }
  let mime = 'video/webm;codecs=vp9';
  if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
  try {
    recorder = new MediaRecorder(cv.captureStream(60), { mimeType: mime, videoBitsPerSecond: 8e6 });
  } catch(e){ flash('recording failed to start'); recorder = null; return; }
  chunks = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `aevum-${Date.now()}.webm`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
    recorder = null; bRec.classList.remove('active'); bRec.textContent = '🎬 Record';
    flash('saved WebM clip');
  };
  recorder.start();
  bRec.classList.add('active'); bRec.textContent = '⏹ Stop';
  flash('recording… click again to save');
};

// ---- serialise the dials + scene (positions are emergent — reseed instead) ----
function serialise(){
  return {
    v: 1,
    time: +S.timeScale.toFixed(2), grav: +S.gravity.toFixed(2), form: +S.formRate.toFixed(2),
    glow: S.glow, trails: S.trails, labels: S.labels,
    scene: window.AEVUM_UI ? window.AEVUM_UI.lastScene : 'bigbang',
  };
}
function apply(st, reseed){
  S.timeScale = st.time; S.gravity = st.grav; S.formRate = st.form;
  S.glow = !!st.glow; S.trails = !!st.trails; S.labels = !!st.labels;
  const UI = window.AEVUM_UI;
  if (UI){ UI.syncControls(); if (reseed && st.scene) UI.runScene(st.scene); }
}

// ---- save / load (localStorage) ----
$('bSave').onclick = () => { localStorage.setItem('aevum', JSON.stringify(serialise())); flash('saved to this browser'); };
$('bLoad').onclick = () => {
  const raw = localStorage.getItem('aevum');
  if (!raw){ flash('nothing saved yet'); return; }
  try { apply(JSON.parse(raw), true); flash('loaded'); } catch(e){ flash('load failed'); }
};

// ---- shareable URL ----
$('bShare').onclick = async () => {
  const packed = btoa(JSON.stringify(serialise()));
  const url = location.origin + location.pathname + '#' + packed;
  try { await navigator.clipboard.writeText(url); flash('share link copied to clipboard'); }
  catch(e){ location.hash = packed; flash('link in address bar'); }
};

// ---- fullscreen ----
$('bFull').onclick = () => {
  if (!document.fullscreenElement){
    (document.documentElement.requestFullscreen || (()=>{})).call(document.documentElement);
  } else {
    (document.exitFullscreen || (()=>{})).call(document);
  }
};

// ---- help overlay ----
const help = $('help');
$('helpBtn').onclick = () => help.classList.add('show');
$('helpClose').onclick = () => help.classList.remove('show');
help.addEventListener('click', e => { if (e.target === help) help.classList.remove('show'); });

// ---- intro overlay (?nointro skips it for kiosks/embeds) ----
const intro = $('intro');
function dismiss(){ intro.classList.add('gone'); }
if (intro){
  if (/[?&]nointro\b/.test(location.search)){
    intro.style.display = 'none';
  } else {
    intro.addEventListener('click', dismiss);
    setTimeout(dismiss, 5200);
  }
}

// ---- restore from URL hash on boot ----
if (location.hash.length > 4){
  try { apply(JSON.parse(atob(location.hash.slice(1))), true); flash('loaded from link'); }
  catch(e){ /* malformed — ignore */ }
}
})();
