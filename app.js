import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { VRButton } from 'https://unpkg.com/three@0.160.0/examples/jsm/webxr/VRButton.js';

// ---------- Renderer / Scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 1000);
scene.add(new THREE.AmbientLight(0xffffff, 1.0));

document.body.appendChild(VRButton.createButton(renderer));

// ---------- Video element / texture ----------
const video = document.createElement('video');
video.crossOrigin = 'anonymous';   // cross-origin hosts need proper CORS to texture
video.playsInline = true;          // mobile inline playback
video.muted = true;                // autoplay-friendly
video.setAttribute('muted','');    // enforce muted in all engines
video.preload = 'metadata';
video.controls = false;

const videoTexture = new THREE.VideoTexture(video);
videoTexture.colorSpace = THREE.SRGBColorSpace;

// Diagnostics (shows in the status line)
['error','stalled','abort','waiting','canplay','playing','pause','ended','loadeddata'].forEach(evt => {
  video.addEventListener(evt, () => setStatus(`video: ${evt}`));
});
video.addEventListener('error', () => {
  const code = video.error ? video.error.code : 'unknown';
  setStatus(`Video error (code ${code}). If your file plays directly but not here, it may be HEVC/H.265 — re-encode to H.264/AAC.`);
});

// ---------- Helpers ----------
function setStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg;
  console.log('[VRHomeTours]', msg);
}

// Encode spaces etc. for relative paths like "./Screen Recording.mp4"
function safeSrc(url) {
  if (!url) return url;
  if (url.includes('://')) return url;      // absolute URL: leave it
  return encodeURI(url);                     // relative file: encode spaces
}

// ---------- 360 sphere ----------
const sphereRadius = 10;
const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(sphereRadius, 64, 64),
  new THREE.MeshBasicMaterial({ map: videoTexture, side: THREE.BackSide })
);
sphere.visible = false;
scene.add(sphere);

// ---------- Curved 2D screen ----------
function buildCurvedScreen(width = 3.2, height = 1.8, fovDeg = 95, distance = 2.2) {
  const theta = THREE.MathUtils.degToRad(fovDeg);
  const R = width / theta; // L=R*theta -> R=L/theta
  const geom = new THREE.CylinderGeometry(R, R, height, Math.max(12, Math.floor(fovDeg/2)), 1, true, -theta/2, theta);
  const mat = new THREE.MeshBasicMaterial({ map: videoTexture, side: THREE.FrontSide });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(0, 1.4, - (distance + R));
  mesh.rotation.y = Math.PI;
  return mesh;
}
const screen = buildCurvedScreen();
screen.visible = false;
scene.add(screen);

// ---------- Simple in-VR panel buttons ----------
const panel = new THREE.Group();
const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.24), new THREE.MeshBasicMaterial({ color: 0x111111 }));
bg.position.set(0, 0, 0);
panel.add(bg);
function makeButton(label, x) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.12), new THREE.MeshBasicMaterial({ color: 0x1e88e5 }));
  base.position.set(x, 0, 0.001);
  base.userData.type = label;
  g.add(base);
  return g;
}
const btnPrev = makeButton('prev', -0.3);
const btnPlay = makeButton('play', 0.0);
const btnNext = makeButton('next', 0.3);
panel.add(btnPrev, btnPlay, btnNext);
panel.position.set(0, 1.2, -1.2);
scene.add(panel);

const controller1 = renderer.xr.getController(0);
const controller2 = renderer.xr.getController(1);
function buildRay(controller) {
  const geo = new THREE.BufferGeometry().setFromPoints([ new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-1) ]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff }));
  line.scale.z = 2;
  controller.add(line);
}
buildRay(controller1); buildRay(controller2);
scene.add(controller1, controller2);

// Use THREE namespace (avoid second import)
const Raycaster = THREE.Raycaster, Matrix4 = THREE.Matrix4, Vector3 = THREE.Vector3;
const raycaster = new Raycaster();
function handleSelect(ctrl) {
  const mat = new Matrix4().extractRotation(ctrl.matrixWorld);
  const dir = new Vector3(0,0,-1).applyMatrix4(mat).normalize();
  const origin = new Vector3().setFromMatrixPosition(ctrl.matrixWorld);
  raycaster.set(origin, dir);
  const hits = raycaster.intersectObjects([btnPrev.children[0], btnPlay.children[0], btnNext.children[0]]);
  if (hits.length) {
    const t = hits[0].object.userData.type;
    if (t === 'prev') prev();
    else if (t === 'play') playPause();
    else if (t === 'next') next();
  }
}
controller1.addEventListener('selectstart', () => handleSelect(controller1));
controller2.addEventListener('selectstart', () => handleSelect(controller2));

// ---------- Playlist / manifest ----------
let playlist = [];   // { title, url, mode: '360'|'2d' }
let index = -1;

async function loadManifest() {
  try {
    const res = await fetch('./tours.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('tours.json not found');
    const data = await res.json();
    if (Array.isArray(data.videos)) {
      playlist = data.videos;
      setStatus(`Loaded tours.json with ${playlist.length} video(s).`);
    } else {
      setStatus('tours.json has no "videos" array.');
    }
  } catch (e) {
    setStatus(`Could not load tours.json (${e.message}). Use “Add Local Videos” or create tours.json in repo root.`);
  }
}

function is360(entry) {
  if (entry.mode) return entry.mode.toLowerCase().includes('360');
  return /360/i.test(entry.title || '') || /360/i.test(entry.url || '');
}

async function loadVideo(src) {
  if (!src) return;
  video.pause();
  video.src = safeSrc(src);
  video.load();
  // do not block Start on long 'canplay' waits; playing will trigger events
}

async function playIndex(i) {
  if (!playlist.length) return;
  index = (i + playlist.length) % playlist.length;
  const entry = playlist[index];

  sphere.visible = is360(entry);
  screen.visible = !is360(entry);

  await loadVideo(entry.url);

  try {
    await video.play(); // Start was a user gesture, so this should succeed when muted
    setStatus(`Playing ${index+1}/${playlist.length}: ${entry.title} (${is360(entry) ? '360' : '2D'})`);
    document.getElementById('overlay').style.display = 'none';
  } catch (e) {
    setStatus(`Autoplay blocked: ${e.message}. Click Play/Pause once, then Start again.`);
  }
}

function next() { if (playlist.length) playIndex(index + 1); }
function prev() { if (playlist.length) playIndex(index - 1); }
function playPause() { if (video.paused) video.play(); else video.pause(); }

// ---------- DOM controls ----------
const startBtn = document.getElementById('startBtn');
const enterVRBtn = document.getElementById('enterVRBtn');
const playBtn = document.getElementById('playBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const fileInput = document.getElementById('fileInput');
const loadManifestBtn = document.getElementById('loadManifestBtn');

async function ensureInitialLoad() {
  if (!playlist.length) await loadManifest();
  if (!playlist.length) setStatus('No videos yet. Use “Add Local Videos” or provide tours.json.');
}

startBtn.addEventListener('click', async () => {
  await ensureInitialLoad();
  if (!playlist.length) { setStatus('No videos found. Add a local MP4 or fix tours.json.'); return; }
  await playIndex(0);
});

enterVRBtn.addEventListener('click', async () => {
  await ensureInitialLoad();
  if (!playlist.length) { setStatus('No videos found. Add a local MP4 or fix tours.json.'); return; }
  await playIndex(0);
  // VRButton manages the session
});

playBtn.addEventListener('click', playPause);
prevBtn.addEventListener('click', prev);
nextBtn.addEventListener('click', next);

fileInput.addEventListener('change', () => {
  const files = [...fileInput.files];
  const newItems = files.map(f => ({
    title: f.name,
    url: URL.createObjectURL(f),
    mode: /360/i.test(f.name) ? '360' : '2d'
  }));
  playlist.push(...newItems);
  setStatus(`Added ${newItems.length} local file(s).`);
});

loadManifestBtn.addEventListener('click', loadManifest);

// ---------- Resize / render ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});
