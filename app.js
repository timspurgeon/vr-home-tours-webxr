import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { VRButton } from 'https://unpkg.com/three@0.160.0/examples/jsm/webxr/VRButton.js';

// ------- Basic Scene Setup -------
const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 1000);

const light = new THREE.AmbientLight(0xffffff, 1.0);
scene.add(light);

// ------- Video Player -------
const video = document.createElement('video');
video.crossOrigin = 'anonymous';
video.playsInline = true;
video.preload = 'metadata';
video.controls = false;
video.muted = false;  // toggle to true if you need autoplay without user gesture
const videoTexture = new THREE.VideoTexture(video);
videoTexture.colorSpace = THREE.SRGBColorSpace;

// ------- 360 Sphere -------
const sphereRadius = 10;
const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(sphereRadius, 64, 64),
  new THREE.MeshBasicMaterial({ map: videoTexture, side: THREE.BackSide })
);
sphere.visible = false;
scene.add(sphere);

// ------- Curved 2D Screen -------
function buildCurvedScreen(width = 3.2, height = 1.8, fovDeg = 95, distance = 2.2) {
  const theta = THREE.MathUtils.degToRad(fovDeg);
  const R = width / theta; // arc length L=R*theta
  const geom = new THREE.CylinderGeometry(R, R, height, Math.max(12, Math.floor(fovDeg/2)), 1, true, -theta/2, theta);
  const mat = new THREE.MeshBasicMaterial({ map: videoTexture, side: THREE.FrontSide });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(0, 1.4, - (distance + R)); // place in front of user
  mesh.rotation.y = Math.PI; // face camera
  return mesh;
}
const screen = buildCurvedScreen();
screen.visible = false;
scene.add(screen);

// ------- UI Panel in 3D (simple) -------
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

// Simple white point as reticle
function buildRay(controller) {
  const geo = new THREE.BufferGeometry().setFromPoints([ new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-1) ]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff }));
  line.name = 'ray';
  line.scale.z = 2;
  controller.add(line);
}

const controller1 = renderer.xr.getController(0);
const controller2 = renderer.xr.getController(1);
buildRay(controller1);
buildRay(controller2);
scene.add(controller1, controller2);

const raycaster = new THREE.Raycaster();

function handleSelect(ctrl) {
  const mat = new THREE.Matrix4();
  mat.extractRotation(ctrl.matrixWorld);
  const dir = new THREE.Vector3(0,0,-1).applyMatrix4(mat).normalize();
  const origin = new THREE.Vector3().setFromMatrixPosition(ctrl.matrixWorld);
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

// ------- Playlist / Manifest -------
let playlist = []; // {title, url, mode: '360'|'2d'}
let index = -1;
let is360 = false;

async function loadManifest() {
  try {
    const res = await fetch('./tours.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('Manifest not found');
    const data = await res.json();
    if (Array.isArray(data.videos)) playlist = data.videos;
    setStatus(`Loaded tours.json with ${playlist.length} video(s).`);
  } catch (e) {
    setStatus('Could not load tours.json. Add videos manually or host a manifest.');
  }
}

function setStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg;
  console.log('[VRHomeTours]', msg);
}

function detectIs360(entry) {
  if (entry.mode) return entry.mode.toLowerCase().includes('360');
  return /360/i.test(entry.title || '') || /360/i.test(entry.url || '');
}

async function playIndex(i) {
  if (playlist.length === 0) return;
  index = (i + playlist.length) % playlist.length;
  const entry = playlist[index];
  is360 = detectIs360(entry);

  sphere.visible = is360;
  screen.visible = !is360;

  // load source
  await loadVideo(entry.url);
  await video.play().catch(()=>{});
  setStatus(`Playing ${index+1}/${playlist.length}: ${entry.title} (${is360 ? '360' : '2D'})`);
}

function next() { if (playlist.length) playIndex(index + 1); }
function prev() { if (playlist.length) playIndex(index - 1); }

function playPause() {
  if (video.paused) video.play();
  else video.pause();
}

// Load video element src, handling blob URLs for local files
async function loadVideo(src) {
  if (!src) return;
  video.pause();
  video.src = src;
  video.load();
  await new Promise(res => {
    if (video.readyState >= 2) res();
    else {
      const onCanPlay = () => { video.removeEventListener('canplay', onCanPlay); res(); };
      video.addEventListener('canplay', onCanPlay);
    }
  });
}

// ------- DOM overlay controls -------
const startBtn = document.getElementById('startBtn');
const enterVRBtn = document.getElementById('enterVRBtn');
const playBtn = document.getElementById('playBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const fileInput = document.getElementById('fileInput');
const loadManifestBtn = document.getElementById('loadManifestBtn');

document.body.appendChild(VRButton.createButton(renderer));

startBtn.addEventListener('click', async () => {
  await ensureInitialLoad();
  if (playlist.length) playIndex(0);
  document.getElementById('overlay').style.display = 'none';
});
enterVRBtn.addEventListener('click', async () => {
  await ensureInitialLoad();
  if (playlist.length) playIndex(0);
  document.getElementById('overlay').style.display = 'none';
  // The VRButton handles entering immersive VR
  renderer.xr.setSession(null); // no-op placeholder; VRButton internally manages session
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

async function ensureInitialLoad() {
  if (!playlist.length) await loadManifest();
  if (!playlist.length) setStatus('No videos yet. Use "Add Local Videos" or provide tours.json.');
}

// ------- Render loop -------
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onWindowResize);

renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});
