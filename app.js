import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { VRButton } from 'https://unpkg.com/three@0.160.0/examples/jsm/webxr/VRButton.js';

/* ---------- helpers ---------- */
function setStatus(msg){
  const el = document.getElementById('status'); if (el) el.textContent = msg;
  console.log('[VRHomeTours]', msg);
}
function safeSrc(url){ if(!url) return url; return url.includes('://') ? url : encodeURI(url); } // spaces-safe

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

document.body.appendChild(VRButton.createButton(renderer));

/* ---------- video / texture ---------- */
const video = document.createElement('video');
video.crossOrigin = 'anonymous';
video.playsInline = true;  video.setAttribute('playsinline','');
video.muted = true;        video.setAttribute('muted','');
video.preload = 'metadata';
video.controls = false;

const videoTexture = new THREE.VideoTexture(video);
videoTexture.colorSpace = THREE.SRGBColorSpace;
videoTexture.minFilter = THREE.LinearFilter;
videoTexture.magFilter = THREE.LinearFilter;
videoTexture.generateMipmaps = false;

['error','stalled','abort','waiting','canplay','playing','pause','ended','loadeddata','loadedmetadata','timeupdate']
  .forEach(evt => video.addEventListener(evt, () => setStatus('video: '+evt)));

video.addEventListener('error', () => {
  const MAP = {1:'ABORTED',2:'NETWORK',3:'DECODE (likely HEVC/H.265)',4:'SRC_NOT_SUPPORTED'};
  const code = video.error ? video.error.code : 0;
  setStatus(`Video error: ${MAP[code]||code}. If 3/4, re-encode to H.264/AAC.`);
});

/* ---------- geometry ---------- */
const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(10, 64, 64),
  new THREE.MeshBasicMaterial({ map: videoTexture, side: THREE.BackSide })
);
sphere.visible = false; scene.add(sphere);

function buildCurvedScreen(width=3.2, height=1.8, fovDeg=95, distance=2.2){
  const theta = THREE.MathUtils.degToRad(fovDeg);
  const R = width / theta;
  const geom = new THREE.CylinderGeometry(R, R, height, Math.max(12, Math.floor(fovDeg/2)), 1, true, -theta/2, theta);
  const mat = new THREE.MeshBasicMaterial({ map: videoTexture, side: THREE.FrontSide });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(0, 1.4, -(distance + R));
  mesh.rotation.y = Math.PI;
  return mesh;
}
const screen = buildCurvedScreen(); screen.visible = false; scene.add(screen);

/* ---------- simple VR buttons ---------- */
const panel = new THREE.Group();
const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.9,0.24), new THREE.MeshBasicMaterial({ color:0x111111 }));
bg.position.set(0,0,0); panel.add(bg);
function makeButton(label,x){ const g=new THREE.Group();
  const base=new THREE.Mesh(new THREE.PlaneGeometry(0.25,0.12), new THREE.MeshBasicMaterial({ color:0x1e88e5 }));
  base.position.set(x,0,0.001); base.userData.type=label; g.add(base); return g; }
const btnPrev=makeButton('prev',-0.3), btnPlay=makeButton('play',0), btnNext=makeButton('next',0.3);
panel.add(btnPrev,btnPlay,btnNext); panel.position.set(0,1.2,-1.2); scene.add(panel);

const c1 = renderer.xr.getController(0), c2 = renderer.xr.getController(1);
function ray(controller){ const geo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-1)]);
  const line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:0xffffff})); line.scale.z=2; controller.add(line); }
ray(c1); ray(c2); scene.add(c1,c2);
const RC=THREE.Raycaster, M4=THREE.Matrix4, V3=THREE.Vector3;
const raycaster = new RC();
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

/* ---------- playlist / manifest ---------- */
let playlist=[], index=-1;
async function loadManifest(){
  try{
    const res = await fetch('./tours.json', { cache:'no-store' });
    if(!res.ok) throw new Error('tours.json not found');
    const data = await res.json();
    if(Array.isArray(data.videos)){ playlist=data.videos; setStatus(`Loaded tours.json with ${playlist.length} video(s).`); }
    else setStatus('tours.json has no "videos" array.');
  }catch(e){ setStatus(`Could not load tours.json (${e.message}).`); }
}
const is360 = e => (e.mode||'').toLowerCase().includes('360') || /360/i.test(e.title||'') || /360/i.test(e.url||'');

/* ---------- core playback (debounced + serialized loads) ---------- */
let _starting = false;
let _loadToken = 0;

function hasSource(){ return Boolean(video.currentSrc || video.src); }

async function loadVideo(src){
  const token = ++_loadToken;              // cancel previous loads
  try { video.pause(); } catch {}
  video.removeAttribute('src');            // reset to avoid Firefox abort noise
  // NOTE: do NOT call video.load()
  video.src = safeSrc(src);

  // Wait until it's decodable (or we time out). Ignore if a newer load started.
  await new Promise(resolve=>{
    let settled=false;
    const onReady = ()=>{ if(settled || token!==_loadToken) return; settled=true; cleanup(); resolve(); };
    const onErr   = ()=>{ if(settled || token!==_loadToken) return; settled=true; cleanup(); resolve(); };
    const cleanup = ()=>{ video.removeEventListener('loadedmetadata', onReady); video.removeEventListener('canplay', onReady); video.removeEventListener('error', onErr); };
    video.addEventListener('loadedmetadata', onReady, { once:true });
    video.addEventListener('canplay', onReady, { once:true });
    video.addEventListener('error', onErr, { once:true });
    setTimeout(()=>{ if(!settled){ settled=true; cleanup(); resolve(); }}, 8000);
  });
}

async function playIndex(i){
  if(!playlist.length) return;
  index = (i + playlist.length) % playlist.length;
  const entry = playlist[index];

  sphere.visible = is360(entry);
  screen.visible = !is360(entry);

  await loadVideo(entry.url);

  try{
    const p = video.play();
    if (p) await p;

    // Ensure playback actually advances before hiding overlay
    const started = await new Promise(resolve=>{
      let ok=false, t0=video.currentTime;
      const onTime = ()=>{ if(!ok && video.currentTime > t0){ ok=true; cleanup(); resolve(true); } };
      const onPlay = ()=> setTimeout(onTime, 100);
      const onErr  = ()=>{ cleanup(); resolve(false); };
      function cleanup(){ video.removeEventListener('timeupdate',onTime); video.removeEventListener('playing',onPlay); video.removeEventListener('error',onErr); }
      video.addEventListener('timeupdate', onTime);
      video.addEventListener('playing', onPlay);
      video.addEventListener('error', onErr);
      setTimeout(()=>{ if(!ok){ cleanup(); resolve(false); } }, 4000);
    });

    if (started){
      setStatus(`Playing ${index+1}/${playlist.length}: ${entry.title} (${is360(entry)?'360':'2D'})`);
      document.getElementById('overlay').style.display = 'none';
    } else {
      setStatus('Playback didn’t advance. Click Play/Pause once (autoplay policy), then Start again.');
    }
  }catch(e){
    setStatus(`Autoplay blocked or interrupted: ${e && e.message ? e.message : e}. Click Play/Pause once, then Start again.`);
  }
}

function next(){ if(playlist.length) playIndex(index+1); }
function prev(){ if(playlist.length) playIndex(index-1); }
function playPause(){
  // If user hits Play before Start, auto-start the first playlist item instead of toggling the empty element
  if (!hasSource() && playlist.length) { startFirst(); return; }
  if (video.paused) video.play(); else video.pause();
}

/* ---------- DOM ---------- */
const startBtn=document.getElementById('startBtn');
const enterVRBtn=document.getElementById('enterVRBtn');
const playBtn=document.getElementById('playBtn');
const prevBtn=document.getElementById('prevBtn');
const nextBtn=document.getElementById('nextBtn');
const fileInput=document.getElementById('fileInput');
const loadManifestBtn=document.getElementById('loadManifestBtn');

async function ensureInitialLoad(){ if(!playlist.length) await loadManifest(); if(!playlist.length) setStatus('No videos yet.'); }

// single entry point so Start/EnterVR behave the same, and are debounced
async function startFirst(){
  if (_starting) return;
  _starting = true;
  try{
    await ensureInitialLoad();
    if(!playlist.length) return setStatus('No videos found.');
    await playIndex(index === -1 ? 0 : index);
  } finally {
    _starting = false;
  }
}

startBtn.addEventListener('click', startFirst);
enterVRBtn.addEventListener('click', startFirst);

playBtn.addEventListener('click', playPause);
prevBtn.addEventListener('click', prev);
nextBtn.addEventListener('click', next);

fileInput.addEventListener('change', ()=>{
  const files=[...fileInput.files];
  const newItems = files.map(f => ({ title:f.name, url:URL.createObjectURL(f), mode:/360/i.test(f.name)?'360':'2d' }));
  playlist.push(...newItems);
  setStatus(`Added ${newItems.length} local file(s).`);
});
loadManifestBtn.addEventListener('click', loadManifest);

/* ---------- resize / render ---------- */
window.addEventListener('resize', ()=>{
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
renderer.setAnimationLoop(()=>{ renderer.render(scene, camera); });
