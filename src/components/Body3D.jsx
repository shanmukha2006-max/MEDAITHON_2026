import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { PlacementDiagram } from './PatchArt.jsx';

// Interactive 3D breathing view: a stylised anatomical torso (female or male proportions, chosen by
// the patient), lungs that fill on inhale, the diaphragm dome moving down on inhale and up on exhale,
// and the proposed patch on the lower ribcage over the diaphragm. An illustration of the mechanism,
// not a medical image. Falls back to the 2D diagram when WebGL is unavailable.

// torso outline: [radius, height] from hips (y=0) to neck
const PROFILES = {
  male: [[0, 0], [0.95, 0.05], [1.0, 0.4], [0.92, 0.9], [0.98, 1.4], [1.08, 1.9], [1.16, 2.4], [1.22, 2.72], [0.92, 3.0], [0.36, 3.1], [0, 3.12]],
  female: [[0, 0], [1.04, 0.05], [1.09, 0.45], [0.8, 1.0], [0.86, 1.5], [0.94, 1.95], [0.98, 2.4], [1.01, 2.7], [0.8, 2.95], [0.32, 3.05], [0, 3.07]],
};
const DEPTH = 0.62;      // front-to-back flattening of the torso
const DIAPHRAGM_Y = 1.62; // lower ribcage, where the patch sits
const radiusAt = (profile, y) => {
  for (let i = 1; i < profile.length; i++) {
    const [r0, y0] = profile[i - 1], [r1, y1] = profile[i];
    if (y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0 || 1);
  }
  return 0;
};

function buildBody(model, patch) {
  const g = new THREE.Group();
  const profile = PROFILES[model];
  const skin = new THREE.MeshStandardMaterial({ color: 0xe9d3c4, roughness: 0.62, metalness: 0.02, transparent: true, opacity: 1 });
  const torso = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 64), skin);
  torso.scale.z = DEPTH; torso.name = 'torso';
  g.add(torso);
  if (model === 'female') for (const s of [-1, 1]) {
    const bust = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 24), skin);
    bust.position.set(0.38 * s, 2.22, radiusAt(profile, 2.22) * DEPTH - 0.14); bust.scale.set(1, 0.9, 0.72); g.add(bust);
  }
  const shoulderR = radiusAt(profile, 2.72);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.45, 32), skin); neck.position.y = 3.25; g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 40, 32), skin); head.position.y = 3.85; head.scale.set(0.9, 1.08, 0.95); g.add(head);
  for (const s of [-1, 1]) {
    const sh = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 24), skin); sh.position.set(s * (shoulderR + 0.02), 2.72, 0); g.add(sh);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.22, 1.9, 24), skin);
    arm.position.set(s * (shoulderR + 0.22), 1.82, 0); arm.rotation.z = s * 0.14; g.add(arm);
  }
  // inside: lungs and diaphragm (visible when “see inside” is on)
  const lungMat = new THREE.MeshStandardMaterial({ color: 0xd98b8b, roughness: 0.5, transparent: true, opacity: 0.85 });
  const lungs = new THREE.Group(); lungs.name = 'lungs';
  for (const s of [-1, 1]) {
    const lung = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 24), lungMat);
    lung.position.set(s * 0.38, 2.28, 0); lung.scale.set(0.9, 1.45, 0.75); lungs.add(lung);
  }
  g.add(lungs);
  const dia = new THREE.Mesh(new THREE.SphereGeometry(0.85, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2.6),
    new THREE.MeshStandardMaterial({ color: 0x2ec5d3, roughness: 0.4, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  dia.position.y = DIAPHRAGM_Y - 0.15; dia.scale.z = DEPTH * 1.05; dia.name = 'diaphragm';
  g.add(dia);
  // the patch, on the skin over the diaphragm (child of the torso, so it moves with each breath)
  const care = patch === 'care';
  const pw = care ? 0.82 : 0.62, ph = care ? 0.36 : 0.26;
  const pad = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, 0.05), new THREE.MeshStandardMaterial({ color: 0xdff2f4, roughness: 0.35 }));
  const zFront = radiusAt(profile, DIAPHRAGM_Y) + 0.03;
  pad.position.set(0, DIAPHRAGM_Y, zFront); pad.name = 'patch';
  if (care) { const mod = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.06), new THREE.MeshStandardMaterial({ color: 0x0a2540, roughness: 0.3 })); mod.position.z = 0.05; pad.add(mod); }
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: 0x2ec5d3 })); led.position.set(care ? 0 : 0.18, 0, 0.07); pad.add(led);
  // place the pad in torso space (torso is scaled in z), keeping its own proportions
  pad.scale.z = 1 / DEPTH; torso.add(pad);
  return { group: g, torso, lungs, dia, skin };
}

export default function Body3D({ bodyModel = 'female', onBodyModelChange, rate = 12, initialPatch = 'care', compact = false }) {
  const mountRef = useRef(null);
  const [webgl, setWebgl] = useState(true);
  const [patch, setPatch] = useState(initialPatch);
  const [inside, setInside] = useState(true);
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [paused, setPaused] = useState(reduce);
  const [phase, setPhase] = useState('Breathing in');
  const live = useRef({ rate, paused, inside });
  live.current = { rate: Math.max(6, Math.min(40, Number(rate) || 12)), paused, inside };
  const model = bodyModel === 'male' ? 'male' : 'female';

  useEffect(() => {
    const el = mountRef.current; if (!el) return undefined;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { setWebgl(false); return undefined; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', `3D illustration of a ${model} torso breathing, with the ${patch === 'care' ? 'BreatheGuard Care' : 'BreatheGuard Quick'} patch on the lower ribcage over the diaphragm`);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 2.25, 7.6); camera.lookAt(0, 2.1, 0);
    scene.add(new THREE.HemisphereLight(0xeaf8fb, 0x24435f, 1.05));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 6, 6); scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fe6f2, 0.8); rim.position.set(-4, 3, -5); scene.add(rim);
    const body = buildBody(model, patch); scene.add(body.group);
    body.group.rotation.y = -0.35;
    const size = () => { const w = el.clientWidth || 600, h = el.clientHeight || 420; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    size(); const ro = new ResizeObserver(size); ro.observe(el);
    // drag to rotate
    let drag = null;
    const down = (e) => { drag = { x: e.clientX, r: body.group.rotation.y }; renderer.domElement.setPointerCapture?.(e.pointerId); };
    const move = (e) => { if (drag) body.group.rotation.y = drag.r + (e.clientX - drag.x) * 0.012; };
    const up = () => { drag = null; };
    renderer.domElement.addEventListener('pointerdown', down); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    let t = 0, last = performance.now(), prevB = 0, raf = 0, lastPhase = '', lastDraw = 0, onScreen = true;
    // Render only when visible, at about 30 fps, so the 3D view never starves the live recorder or other work.
    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; }); io.observe(el);
    const tick = (now) => {
      const dt = Math.min(0.25, (now - last) / 1000); last = now; // keeps the true breathing rate on slow devices
      const L = live.current;
      if (!L.paused) t += dt;
      const b = (1 - Math.cos(2 * Math.PI * ((t * L.rate) / 60))) / 2; // 0 = exhaled, 1 = full inhale
      body.torso.scale.x = 1 + 0.035 * b; body.torso.scale.z = DEPTH * (1 + 0.05 * b);
      body.lungs.scale.set(1 + 0.1 * b, 1 + 0.08 * b, 1 + 0.1 * b);
      body.dia.position.y = DIAPHRAGM_Y - 0.15 - 0.22 * b; body.dia.scale.y = 1 - 0.38 * b; // contracts and flattens on inhale
      body.skin.opacity = L.inside ? 0.32 : 1; body.skin.depthWrite = !L.inside;
      body.lungs.visible = L.inside; body.dia.visible = L.inside;
      const ph = L.paused ? 'Paused' : b > prevB ? 'Breathing in' : 'Breathing out';
      if (ph !== lastPhase) { lastPhase = ph; setPhase(ph); }
      prevB = b;
      if (onScreen && document.visibilityState === 'visible' && now - lastDraw >= 33) { lastDraw = now; renderer.render(scene, camera); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      scene.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
      renderer.dispose(); renderer.domElement.remove();
    };
  }, [model, patch]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!webgl) return (<div className="stack-s"><p className="notice small">3D view needs WebGL, which this device does not provide. Showing the diagram instead.</p><PlacementDiagram variant={patch} /></div>);
  return (
    <div className={`body3d ${compact ? 'compact' : ''}`} data-testid="body3d">
      <div className="body3d-bar">
        <div className="seg" role="group" aria-label="Body model">
          {['female', 'male'].map((m) => <button key={m} className={model === m ? 'on' : ''} aria-pressed={model === m} onClick={() => onBodyModelChange?.(m)}>{m === 'female' ? 'Female' : 'Male'}</button>)}
        </div>
        <div className="seg" role="group" aria-label="Patch">
          {['care', 'quick'].map((p) => <button key={p} className={patch === p ? 'on' : ''} aria-pressed={patch === p} onClick={() => setPatch(p)}>{p === 'care' ? 'Care' : 'Quick'}</button>)}
        </div>
        <label className="check small"><input type="checkbox" checked={inside} onChange={(e) => setInside(e.target.checked)} />See inside</label>
        <button className="btn sm" onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? 'Play animation' : 'Pause animation'}</button>
      </div>
      <div className="body3d-stage" ref={mountRef}>
        <div className={`body3d-phase ${phase === 'Breathing in' ? 'in' : phase === 'Breathing out' ? 'out' : ''}`} data-testid="breath-phase">{phase} · {Math.round(live.current.rate)}/min</div>
        <div className="body3d-legend small"><span><i style={{ background: '#d98b8b' }} />Lungs fill</span><span><i style={{ background: '#2ec5d3' }} />Diaphragm moves down on inhale</span><span><i style={{ background: '#dff2f4', border: '1px solid #7ec6cd' }} />{patch === 'care' ? 'Care' : 'Quick'} patch over the diaphragm</span></div>
      </div>
      <p className="tiny muted">Drag to rotate. Stylised illustration of the breathing mechanism and the proposed patch position; not a medical image. Body model is the patient’s own choice.</p>
    </div>
  );
}
