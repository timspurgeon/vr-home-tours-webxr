import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { VRButton } from 'https://unpkg.com/three@0.160.0/examples/jsm/webxr/VRButton.js';

/* ---------- helpers ---------- */
function setStatus(msg){ const el=document.getElementById('status'); if(el) el.textContent=msg; console.log('[VRHomeTours]', msg); }
function safeSrc(url){ if(!url) return url; return url.includes('://') ? url : encodeURI(url); }
const inXR = () => renderer.xr.isPresenting;

/* ---------- renderer / scene ---------- */
const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth/window.innerHeight, 0.01, 1000);
scene.add(new THREE.AmbientLight(0xffffff, 1.0));

/* VR button only if available */
if (navigator.xr?.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then(s => { if (s) document.body.appendChild(VRButton.createButton(renderer)); });
}

/* ---------- video / texture ---------- */
const video = document.createElement('video');
video.crossOrigin = 'anonymous';
video.playsInline = true; video.setAttribute('playsinline','');
video.muted = true;       video.setAttribute('muted','');
video.preload = 'metadata';
video.controls = false;

const videoTexture = new THREE.VideoTexture(video);
videoTexture.colorSpace = THREE.SRGBColorSpace;
videoTexture.minFilter = THREE.LinearFilter;
videoTexture.magFilter = THREE.LinearFilter;
videoTexture.generateMipmaps = false;

/* keep texture hot for Firefox */
let forceUpdate = false;
video.addEventListener('playing', ()=>{ forceUpdate = true; });
video.addEventListener('pause',   ()=>{ forceUpdate = false; });

/* diagnostics */
['error','stalled','abort','waiting','canplay','playing','pause','ended','loadeddata','loadedmetadata','timeupdate']
  .forEach(evt => video.addEventListener(evt, () => setStatus('video: '+evt)));
video.addEventListener('error', () => {
  const MAP={1:'ABORTED',2:'NETWORK',3:'DECODE (likely HEVC/H.265)',4:'SRC_NOT_SUPPORTED'};
  setStatus(`Video error: ${MAP[video.error?.code]||video.error?.code||'unknown'}. If 3/4, re-encode to H.264/AAC.`);
});

/* ---------- screens ---------- */
const flatScreen = new THREE.Mesh(new THREE.PlaneGeometry(1,1), new THREE.MeshBasicMaterial({ map: videoTexture }));
scene.add(flatScreen);

function buildCurvedGeom(width=3.2,height=1.8,fovDeg=95){
  const theta=THREE.MathUtils.degToRad(fovDeg), R=width/theta;
  return new THREE.CylinderGeometry(R,R,height,Math.max(24,Math.floor(fovDeg/1.8)),1,true,-theta/2,theta);
}
const curvedScreen = new THREE.Mesh(buildCurvedGeom(), new THREE.MeshBasicMaterial({ map: videoTexture, side: THREE.FrontSide }));
curvedScreen.visible=false; scene.add(curvedScreen);

const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(10, 64, 64),
  new THREE.MeshBasicMaterial({ map: videoTexture, side: THREE.BackSide })
);
sphere.visible = false; scene.add(sphere);

/* ---------- layout (contain fit) ---------- */
const curvedToggle = document.getElementById('curvedToggle');
function videoAspect(){ return (video.videoWidth && video.videoHeight) ? (video.videoWidth / video.videoHeight) : (16/9); }
function layoutScreens(){
  const d = inXR() ? 2.2 : 2.0;
  const y = inXR() ? 1.4 : 0.0;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  const visH = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
  const visW = visH * camera.aspect;

  const a = videoAspect(), maxW = visW * 0.95, maxH = visH * 0.95;
  let targetW = maxW, targetH = targetW / a;
  if (targetH > maxH){ targetH = maxH; targetW = targetH * a; }

  const use360 = sphere.visible;

  flatScreen.visible  = !use360 && !(curvedToggle && curvedToggle.checked);
  curvedScreen.visible= !use360 &&  (curvedToggle && curvedToggle.checked);

  flatScreen.position.set(0, y, -d);
  flatScreen.scale.set(targetW, targetH, 1);

  if (curvedScreen.visible){
    const old = curvedScreen.geometry;
    curvedScreen.geometry = buildCurvedGeom(targetW, targetH, 95);
    old.dispose();
    curvedScreen.position.set(0, y, -0.001);
  }
}

/* ---------- in-VR buttons ---------- */
const panel = new THREE.Group();
const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.9,0.24), new THREE.MeshBasicMaterial({ color:0x111111 }));
bg.position.set(0,0,0); panel.add(bg);
function makeButton(label,x){ const g=new THREE.Group(); const base=new THREE.Mesh(new THREE.PlaneGeometry(0.25,0.12), new THREE.MeshBasicMaterial({ color:0x1e88e5 })); base.position.set(x,0,0.001); base.userData.type=label; g.add(base); return g; }
const btnPrev=makeButton('prev',-0.3), btnPlay=makeButton('play',0), btnNext=makeButton('next',0.3);
panel.add(btnPrev,btnPlay,btnNext); panel.position.set(0,1.2,-1.2); scene.add(panel);
const c1=renderer.xr.getController(0), c2=renderer.xr.getController(1);
function ray(controller){ const geo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(0,0,-1)]); const line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:0xffffff})); line.scale.z=2; controller.add(line); }
ray(c1); ray(c2); scene.add(c1,c2);
const RC=THREE.Raycaster, M4=THREE.Matrix4, V3=THREE.Vector3;
const raycaster=new RC();
function handleSelect(ctrl){
  const mat=new M4().extractRotation(ctrl.matrixWorld);
  const dir=new V3(0,0,-1).applyMatrix4(mat).normalize();
  const origin=new V3().setFromMatrixPosition(ctrl.matrixWorld);
  raycaster.set(origin,dir);
  const hits=raycaster.intersectObjects([btnPrev.children[0],btnPlay.children[0],btnNext.children[0]]);
  if(hits.length){ const t=hits[0].object.userData.type; if(t==='prev') prev(); else if(t==='play') playPause(); else next(); }
}
c1.addEventListener('selectstart',()=>handleSelect(c1));
c2.addEventListener('selectstart',()=>handleSelect(c2));

/* ---------- playlist / UI ---------- */
let playlist=[], index=-1;
const playlistUI = document.getElementById('playlistUI');
function renderPlaylist(){
  if (!playlistUI) return;
  playlistUI.innerHTML='';
  playlist.forEach((e,i)=>{
    const div=document.createElement('div'); div.className='item'+(i===index?' active':'');
    div.innerHTML = `<div class="title">${e.title||('Video '+(i+1))}</div><div class="badge">${(e.mode||'2d').toUpperCase()}</div>`;
    div.addEventListener('click', ()=> playIndex(i));
    playlistUI.appendChild(div);
  });
}
async function loadManifest(){
  try{
    const res=await fetch('./tours.json',{cache:'no-store'});
    if(!res.ok) throw new Error('tours.json not found');
    const data=await res.json();
    if(Array.isArray(data.videos)){ playlist=data.videos; setStatus(`Loaded tours.json with ${playlist.length} video(s).`); renderPlaylist(); }
    else setStatus('tours.json has no "videos" array.');
  }catch(e){ setStatus(`Could not load tours.json (${e.message}).`); }
}
const is360 = e => (e.mode||'').toLowerCase().includes('360') || /360/i.test(e.title||'') || /360/i.test(e.url||'');

/* ---------- playback (debounced + serialized loads) ---------- */
let _starting=false, _loadToken=0;
const startBtn=document.getElementById('startBtn');
const enterVRBtn=document.getElementById('enterVRBtn');
const playBtn=document.getElementById('playBtn');
const prevBtn=document.getElementById('prevBtn');
const nextBtn=document.getElementById('nextBtn');
const fileInput=document.getElementById('fileInput');
const loadManifestBtn=document.getElementById('loadManifestBtn');

/* HUD refs */
const hud = document.getElementById('hud');
const hudPrev = document.getElementById('hudPrev');
const hudPlay = document.getElementById('hudPlay');
const hudNext = document.getElementById('hudNext');
const hudList = document.getElementById('hudList');
const titleNow = document.getElementById('titleNow');

if (playBtn) playBtn.disabled = true;
const hasSource = ()=> Boolean(video.currentSrc || video.src);

function openOverlay(){ const ov=document.getElementById('overlay'); if(ov){ ov.style.display='flex'; } }
function closeOverlay(){ const ov=document.getElementById('overlay'); if(ov){ ov.style.display='none'; } }
function showHUD(on){ if (!hud) return; hud.style.display = on && !inXR() ? 'flex' : 'none'; }

function applyScreenMode(entry){
  const use360 = is360(entry);
  sphere.visible = use360;
  layoutScreens();
}

async function loadVideo(src){
  const token=++_loadToken;
  try{ video.pause(); }catch{}
  video.removeAttribute('src');
  video.src = safeSrc(src);           // do NOT call video.load()
  await new Promise(resolve=>{
    let settled=false;
    const onReady=()=>{ if(settled||token!==_loadToken) return; settled=true; cleanup(); resolve(); };
    const onErr  =()=>{ if(settled||token!==_loadToken) return; settled=true; cleanup(); resolve(); };
    const cleanup=()=>{ video.removeEventListener('loadedmetadata',onReady); video.removeEventListener('canplay',onReady); video.removeEventListener('error',onErr); };
    video.addEventListener('loadedmetadata', onReady, {once:true});
    video.addEventListener('canplay',        onReady, {once:true});
    video.addEventListener('error',          onErr,   {once:true});
    setTimeout(()=>{ if(!settled){ settled=true; cleanup(); resolve(); } }, 8000);
  });
}

async function playIndex(i){
  if(!playlist.length) return;
  index=(i+playlist.length)%playlist.length;
  const entry=playlist[index];

  applyScreenMode(entry);
  renderPlaylist();
  titleNow && (titleNow.textContent = entry.title ? `• ${entry.title}` : '');

  await loadVideo(entry.url);

  try{
    const p = video.play(); if (p) await p;
    const started = await new Promise(resolve=>{
      let ok=false, t0=video.currentTime;
      const onTime = ()=>{ if(!ok && video.currentTime>t0){ ok=true; cleanup(); resolve(true); } };
      const onPlay = ()=> setTimeout(onTime,100);
      const onErr  = ()=>{ cleanup(); resolve(false); };
      function cleanup(){ video.removeEventListener('timeupdate',onTime); video.removeEventListener('playing',onPlay); video.removeEventListener('error',onErr); }
      video.addEventListener('timeupdate', onTime);
      video.addEventListener('playing', onPlay);
      video.addEventListener('error', onErr);
      setTimeout(()=>{ if(!ok){ cleanup(); resolve(false); } }, 4000);
    });

    if (started){
      setStatus(`Playing ${index+1}/${playlist.length}: ${entry.title} (${is360(entry)?'360':'2D'})`);
      if (playBtn) playBtn.disabled=false;
      closeOverlay();
      showHUD(true);
    } else {
      setStatus('Playback didn’t advance. Click Play/Pause once (autoplay policy), then Start again.');
    }
  }catch(e){
    setStatus(`Autoplay blocked or interrupted: ${e?.message||e}. Click Play/Pause once, then Start again.`);
  }
}

function next(){ if(playlist.length) playIndex(index+1); }
function prev(){ if(playlist.length) playIndex(index-1); }
function playPause(){ if (!hasSource() && playlist.length) { startFirst(); return; } if (video.paused) video.play(); else video.pause(); }

/* auto-advance & shortcuts */
video.addEventListener('ended', next);
window.addEventListener('keydown', (e)=>{
  if (e.code === 'Space'){ e.preventDefault(); playPause(); }
  if (e.key?.toLowerCase() === 'n') next();
  if (e.key?.toLowerCase() === 'p') prev();
  if (e.key === 'Escape'){ openOverlay(); showHUD(true); }   // Esc brings playlist back
});

async function ensureInitialLoad(){ if(!playlist.length) await loadManifest(); if(!playlist.length) setStatus('No videos yet.'); }
async function startFirst(){
  if (_starting) return;
  _starting = true;
  try{
    await ensureInitialLoad();
    if(!playlist.length) return setStatus('No videos found.');
    await playIndex(index===-1?0:index);
  } finally { _starting = false; }
}

/* ---------- DOM ---------- */
document.getElementById('startBtn')?.addEventListener('click', startFirst);
document.getElementById('enterVRBtn')?.addEventListener('click', startFirst);
document.getElementById('playBtn')?.addEventListener('click', playPause);
document.getElementById('prevBtn')?.addEventListener('click', prev);
document.getElementById('nextBtn')?.addEventListener('click', next);
curvedToggle?.addEventListener('change', ()=> layoutScreens());

document.getElementById('loadManifestBtn')?.addEventListener('click', async ()=>{
  await loadManifest(); if (playlist.length && index===-1) { index=0; renderPlaylist(); }
});
document.getElementById('fileInput')?.addEventListener('change', ()=>{
  const files=[...document.getElementById('fileInput').files];
  const newItems=files.map(f=>({ title:f.name, url:URL.createObjectURL(f), mode:/360/i.test(f.name)?'360':'2d' }));
  playlist.push(...newItems); renderPlaylist(); setStatus(`Added ${newItems.length} local file(s).`);
  document.getElementById('playBtn') && (document.getElementById('playBtn').disabled=false);
});

/* HUD actions */
hudPrev?.addEventListener('click', prev);
hudPlay?.addEventListener('click', playPause);
hudNext?.addEventListener('click', next);
hudList?.addEventListener('click', ()=>{ openOverlay(); showHUD(true); });

/* re-layout on changes */
video.addEventListener('loadedmetadata', layoutScreens);
window.addEventListener('resize', layoutScreens);
renderer.xr.addEventListener?.('sessionstart', ()=>{ layoutScreens(); showHUD(false); }); // hide HUD in VR
renderer.xr.addEventListener?.('sessionend',   ()=>{ layoutScreens(); showHUD(true); });

/* render */
renderer.setAnimationLoop(()=>{
  if (forceUpdate) videoTexture.needsUpdate = true;
  renderer.render(scene,camera);
});
