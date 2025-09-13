import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { VRButton } from 'https://unpkg.com/three@0.160.0/examples/jsm/webxr/VRButton.js';

/* ---------- helpers ---------- */
function setStatus(msg){ const el=document.getElementById('status'); if(el) el.textContent=msg; console.log('[VRHomeTours]', msg); }
function safeSrc(url){ if(!url) return url; return url.includes('://') ? url : encodeURI(url); }

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

/* VR button only if supported */
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

/* Force texture update every frame (some FF builds need this) */
let forceUpdate = false;
video.addEventListener('playing', ()=>{ forceUpdate = true; });
video.addEventListener('pause',   ()=>{ forceUpdate = false; });

['error','stalled','abort','waiting','canplay','playing','pause','ended','loadeddata','loadedmetadata','timeupdate']
  .forEach(evt => video.addEventListener(evt, () => setStatus('video: '+evt)));

video.addEventListener('error', () => {
  const MAP={1:'ABORTED',2:'NETWORK',3:'DECODE (likely HEVC/H.265)',4:'SRC_NOT_SUPPORTED'};
  setStatus(`Video error: ${MAP[video.error?.code]||video.error?.code||'unknown'}. If 3/4, re-encode to H.264/AAC.`);
});

/* ---------- SIMPLE 2D SCREEN (flat plane) ---------- */
const screen = new THREE.Mesh(
  new THREE.PlaneGeometry(3.2, 1.8),
  new THREE.MeshBasicMaterial({ map: videoTexture, side: THREE.FrontSide })
);
screen.position.set(0, 1.4, -2.2);
scene.add(screen);

/* ---------- playlist / manifest ---------- */
let playlist=[], index=-1;
async function loadManifest(){
  try{
    const res=await fetch('./tours.json',{cache:'no-store'});
    if(!res.ok) throw new Error('tours.json not found');
    const data=await res.json();
    if(Array.isArray(data.videos)){ playlist=data.videos; setStatus(`Loaded tours.json with ${playlist.length} video(s).`); }
    else setStatus('tours.json has no "videos" array.');
  }catch(e){ setStatus(`Could not load tours.json (${e.message}).`); }
}

/* ---------- playback (serialized loads, no .load()) ---------- */
let _starting=false, _loadToken=0;

const startBtn=document.getElementById('startBtn');
const enterVRBtn=document.getElementById('enterVRBtn');
const playBtn=document.getElementById('playBtn');
const prevBtn=document.getElementById('prevBtn');
const nextBtn=document.getElementById('nextBtn');
const fileInput=document.getElementById('fileInput');
const loadManifestBtn=document.getElementById('loadManifestBtn');
const debugBtn=document.getElementById('debugBtn');

if (playBtn) playBtn.disabled = true;
const hasSource = ()=> Boolean(video.currentSrc || video.src);

async function loadVideo(src){
  const token=++_loadToken;
  try{ video.pause(); }catch{}
  video.removeAttribute('src');
  video.src = safeSrc(src);             // do NOT call video.load()
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

  await loadVideo(entry.url);

  try{
    const pr = video.play();
    if (pr) await pr;

    // ensure it actually advances before hiding overlay
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
      setStatus(`Playing ${index+1}/${playlist.length}: ${entry.title}`);
      if (playBtn) playBtn.disabled=false;
      document.getElementById('overlay').style.display='none';
    } else {
      setStatus('Playback didn’t advance. Click Play/Pause once (autoplay policy), then Start again.');
    }
  }catch(e){
    setStatus(`Autoplay blocked or interrupted: ${e?.message||e}. Click Play/Pause once, then Start again.`);
  }
}

function next(){ if(playlist.length) playIndex(index+1); }
function prev(){ if(playlist.length) playIndex(index-1); }
function playPause(){
  if (!hasSource() && playlist.length) { startFirst(); return; }
  if (video.paused) video.play(); else video.pause();
}

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

/* ---------- inline debug player ---------- */
const inlineWrap=document.getElementById('inlineWrap');
const inline=document.getElementById('inline');
document.getElementById('closeInline')?.addEventListener('click',()=>{ inlineWrap.style.display='none'; inline.pause(); });

debugBtn?.addEventListener('click', async ()=>{
  await ensureInitialLoad();
  inline.src = playlist.length ? safeSrc(playlist[0].url)
                               : 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
  inlineWrap.style.display='block';
  inline.play().catch(e=>setStatus('Inline play blocked: '+e.message));
});

/* ---------- DOM ---------- */
startBtn?.addEventListener('click', startFirst);
enterVRBtn?.addEventListener('click', startFirst);
playBtn?.addEventListener('click', playPause);
prevBtn?.addEventListener('click', prev);
nextBtn?.addEventListener('click', next);
fileInput?.addEventListener('change', ()=>{
  const files=[...fileInput.files];
  const newItems=files.map(f=>({ title:f.name, url:URL.createObjectURL(f), mode:/360/i.test(f.name)?'360':'2d' }));
  playlist.push(...newItems);
  setStatus(`Added ${newItems.length} local file(s).`);
  if (playBtn) playBtn.disabled=false;
});
loadManifestBtn?.addEventListener('click', loadManifest);

/* ---------- render ---------- */
window.addEventListener('resize', ()=>{
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
renderer.setAnimationLoop(()=>{
  // hard nudge for Firefox: keep the texture “hot”
  if (forceUpdate) videoTexture.needsUpdate = true;
  renderer.render(scene,camera);
});
