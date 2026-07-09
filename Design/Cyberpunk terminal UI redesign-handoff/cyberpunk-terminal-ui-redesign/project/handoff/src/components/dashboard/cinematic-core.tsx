'use client';

/**
 * CinematicCore — background particle field for the My Agent Factory dashboard.
 *
 * TERMINAL SPEC (v2):
 *  - Micro-scale particles: gl_PointSize clamped to 1–3 CSS px. Razor-sharp
 *    digital dust — the perspective size blowup (9.0 / -mv.z) is GONE, which
 *    is what caused the milky white additive blob.
 *  - Base opacity uniform = 0.12. The field sits quietly at -z-10 and never
 *    bleeds into foreground text.
 *  - isListening (from TaskInput, via useCoreFxStore) morphs the sphere into
 *    a live frequency waveform.
 *  - focusTarget (from AgentFleet card hover) leans the field and projects a
 *    sharp 1px vector line toward the hovered card.
 *
 * Zero external assets. Safe-by-construction: ResizeObserver scaling,
 * IntersectionObserver + visibility pause, WebGL context-loss recovery,
 * prefers-reduced-motion support, full GPU disposal on unmount.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CoreFocusTarget {
  /** Viewport-space x in CSS pixels (e.g. from getBoundingClientRect center). */
  x: number;
  /** Viewport-space y in CSS pixels. */
  y: number;
  /** Optional agent identifier (e.g. 'hermes' | 'codex' | 'claude'). */
  id?: string;
}

export interface CinematicCoreProps {
  /** Warp the sphere into an active frequency waveform. */
  isListening?: boolean;
  /** Screen position of the targeted agent card; null clears focus. */
  focusTarget?: CoreFocusTarget | null;
  /** Global energy multiplier, 0–2. Default 1. */
  intensity?: number;
  /** Base particle opacity, 0.02–0.4. Default 0.12 (terminal spec). */
  opacity?: number;
  /** Particle budget multiplier, 0.25–1.5. Applied at scene init only. */
  densityScale?: number;
  className?: string;
}

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

const COLOR_CYAN = new THREE.Color('#06b6d4');
const COLOR_PURPLE = new THREE.Color('#a855f7');
const SPHERE_RADIUS = 1.35;
const CAMERA_Z = 4.2;
const MAX_PIXEL_RATIO = 2;
const BASE_OPACITY = 0.12;
const DAMP = {
  morph: 2.8, // sphere <-> waveform
  focus: 3.4, // beam + camera pull
  rotate: 2.2, // pointer parallax
} as const;

function particleBudget(width: number, height: number, scale: number): number {
  const area = width * height;
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4;
  const base = Math.round(area / 300) * (cores >= 8 ? 1.25 : 1);
  return Math.round(Math.max(2000, Math.min(6000, base)) * scale);
}

// ---------------------------------------------------------------------------
// Shaders — micro-dust: no perspective blowup, no fake bloom
// ---------------------------------------------------------------------------

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 aSphere;
  attribute vec3 aWave;
  attribute float aSeed;

  uniform float uTime;
  uniform float uMorph;      // 0 = sphere, 1 = waveform
  uniform float uFocus;      // 0..1 focus energy
  uniform vec3  uFocusDir;   // normalized direction toward focus point
  uniform float uIntensity;
  uniform float uPixelRatio;

  varying float vGlow;
  varying float vMix;

  void main() {
    // Breathing sphere with per-particle phase.
    vec3 sphere = aSphere * (1.0 + 0.04 * uIntensity * sin(uTime * 0.7 + aSeed * 6.2831));

    // Live frequency waveform: harmonics summed in the shader so the
    // signal undulates every frame without CPU work.
    float wx = aWave.x;
    float y =
        sin(wx * 2.4 + uTime * 2.2 + aSeed * 0.8) * 0.55
      + sin(wx * 5.3 - uTime * 3.1 + aSeed * 2.0) * 0.22
      + sin(wx * 9.7 + uTime * 4.6)               * 0.08;
    y *= exp(-0.16 * wx * wx) * uIntensity;                 // gaussian envelope
    vec3 wave = vec3(aWave.x, y + aWave.y * 0.1, aWave.z);

    float m = smoothstep(0.0, 1.0, uMorph);
    vec3 pos = mix(sphere, wave, m);

    // Focus energy: particles lean toward the targeted agent card.
    pos += uFocusDir * (uFocus * 0.22 * fract(aSeed * 5.17));

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    // MICRO-SCALE: strictly 1–3 CSS px. No distance-based size term —
    // that perspective blowup is what smeared the field into a blob.
    float size = mix(1.0, 3.0, fract(aSeed * 7.13));
    gl_PointSize = clamp(size, 1.0, 3.0) * uPixelRatio;

    vGlow = 0.5 + 0.5 * sin(uTime * 1.6 + aSeed * 12.56);
    vMix  = fract(aSeed * 3.71);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform vec3  uColorA;
  uniform vec3  uColorB;
  uniform float uOpacity;
  uniform float uFocus;

  varying float vGlow;
  varying float vMix;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    // Sharp disc — tight falloff only at the rim, no soft bloom halo.
    float alpha = smoothstep(0.5, 0.32, d);

    vec3 col = mix(uColorA, uColorB, vMix);
    col *= 0.85 + vGlow * (0.35 + uFocus * 0.3);

    gl_FragColor = vec4(col, alpha * uOpacity);
  }
`;

// ---------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------

/** Fibonacci sphere + waveform ribbon targets, generated once. */
function buildGeometry(count: number): THREE.BufferGeometry {
  const sphere = new Float32Array(count * 3);
  const wave = new Float32Array(count * 3);
  const seed = new Float32Array(count);

  const golden = Math.PI * (3 - Math.sqrt(5));
  const rows = 6; // waveform depth rows

  for (let i = 0; i < count; i++) {
    // Fibonacci sphere point.
    const t = i / (count - 1);
    const inclination = Math.acos(1 - 2 * t);
    const azimuth = golden * i;
    const r = SPHERE_RADIUS * (0.92 + 0.08 * Math.sin(i * 12.9898));
    sphere[i * 3 + 0] = r * Math.sin(inclination) * Math.cos(azimuth);
    sphere[i * 3 + 1] = r * Math.cos(inclination);
    sphere[i * 3 + 2] = r * Math.sin(inclination) * Math.sin(azimuth);

    // Waveform ribbon slot: x across [-2.6, 2.6], z in shallow rows.
    const row = i % rows;
    const col = Math.floor(i / rows) / Math.max(1, Math.floor(count / rows) - 1);
    wave[i * 3 + 0] = (col - 0.5) * 5.2;
    wave[i * 3 + 1] = (Math.sin(i * 78.233) * 0.5 + 0.5) * 2 - 1; // jitter, scaled in shader
    wave[i * 3 + 2] = (row / (rows - 1) - 0.5) * 0.9;

    seed[i] = Math.abs(Math.sin(i * 0.1031) * 43758.5453) % 1;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(sphere, 3)); // for frustum culling bounds
  geometry.setAttribute('aSphere', new THREE.BufferAttribute(sphere, 3));
  geometry.setAttribute('aWave', new THREE.BufferAttribute(wave, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geometry.computeBoundingSphere();
  // Waveform is wider than the sphere — expand bounds so culling never clips it.
  if (geometry.boundingSphere) geometry.boundingSphere.radius = 3.2;
  return geometry;
}

/** Vector line from core toward focus target: 1px line + reticle pulse. */
function buildBeam(): {
  group: THREE.Group;
  line: THREE.Line;
  lineMaterial: THREE.LineBasicMaterial;
  pulse: THREE.Points;
  pulseMaterial: THREE.PointsMaterial;
} {
  const group = new THREE.Group();

  const lineGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 0),
  ]);
  const lineMaterial = new THREE.LineBasicMaterial({
    color: COLOR_CYAN,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const line = new THREE.Line(lineGeometry, lineMaterial);
  line.frustumCulled = false;

  const pulseGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]);
  const pulseMaterial = new THREE.PointsMaterial({
    color: COLOR_CYAN,
    size: 5, // sub-pixel reticle, not a glow ball
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const pulse = new THREE.Points(pulseGeometry, pulseMaterial);
  pulse.frustumCulled = false;

  group.add(line, pulse);
  return { group, line, lineMaterial, pulse, pulseMaterial };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CinematicCore({
  isListening = false,
  focusTarget = null,
  intensity = 1,
  opacity = BASE_OPACITY,
  densityScale = 1,
  className = '',
}: CinematicCoreProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Live prop mirror — lets the render loop read fresh values without
  // re-initializing the WebGL scene on every prop change.
  const stateRef = useRef({ isListening, focusTarget, intensity, opacity });
  stateRef.current.isListening = isListening;
  stateRef.current.focusTarget = focusTarget;
  stateRef.current.intensity = Math.max(0, Math.min(2, intensity));
  stateRef.current.opacity = Math.max(0.02, Math.min(0.4, opacity));

  // densityScale is applied at init only (geometry rebuild is not worth it
  // live) — remount the component to apply a new density.
  const densityRef = useRef(densityScale);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ---- Renderer (with graceful fallback if WebGL is unavailable) --------
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: false, // 1–3px points don't need MSAA
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      container.style.background =
        'radial-gradient(ellipse at center, rgba(6,182,212,0.05), transparent 70%)';
      return;
    }

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);

    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    // ---- Scene -------------------------------------------------------------
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 50);
    camera.position.set(0, 0, CAMERA_Z);

    const uniforms = {
      uTime: { value: 0 },
      uMorph: { value: 0 },
      uFocus: { value: 0 },
      uFocusDir: { value: new THREE.Vector3() },
      uIntensity: { value: 1 },
      uPixelRatio: { value: pixelRatio },
      uColorA: { value: COLOR_CYAN.clone() },
      uColorB: { value: COLOR_PURPLE.clone() },
      uOpacity: { value: BASE_OPACITY },
    };

    const geometry = buildGeometry(
      particleBudget(width, height, Math.max(0.25, Math.min(1.5, densityRef.current)))
    );
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    const rig = new THREE.Group(); // rotated by pointer parallax
    rig.add(points);
    scene.add(rig);

    const beam = buildBeam();
    scene.add(beam.group);

    // ---- Interaction state --------------------------------------------------
    const _lookTarget = new THREE.Vector3();
    const pointer = { x: 0, y: 0 }; // -1..1 targets
    const smooth = {
      morph: 0,
      focus: 0,
      rotX: 0,
      rotY: 0,
      lookAt: new THREE.Vector3(),
      focusPoint: new THREE.Vector3(),
    };

    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timeScale = reducedMotion ? 0.25 : 1;

    // Parallax listens on window so it keeps working when the component is
    // used as a pointer-events-none background layer.
    const onPointerMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      pointer.x = THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
      pointer.y = THREE.MathUtils.clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
    };
    const onPointerLeave = () => {
      pointer.x = 0;
      pointer.y = 0;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('blur', onPointerLeave, { passive: true });

    /** Convert a viewport-space focus target into a world-space point. */
    const _dir = new THREE.Vector3();
    const focusWorldPoint = (target: CoreFocusTarget, out: THREE.Vector3) => {
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((target.x - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      const ndcY = -(((target.y - rect.top) / Math.max(1, rect.height)) * 2 - 1);
      out.set(
        THREE.MathUtils.clamp(ndcX, -1.6, 1.6),
        THREE.MathUtils.clamp(ndcY, -1.6, 1.6),
        0.5,
      ).unproject(camera);
      // Project onto a shell just outside the sphere so beams stay legible.
      _dir.copy(out).sub(camera.position).normalize();
      out.copy(camera.position).addScaledVector(_dir, CAMERA_Z - 0.4);
      return out;
    };

    // ---- Resize ------------------------------------------------------------
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.max(1, Math.round(entry.contentRect.width));
      const h = Math.max(1, Math.round(entry.contentRect.height));
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(container);

    // ---- Pause when hidden/off-screen ---------------------------------------
    let rafId = 0;
    let running = false;
    let inViewport = true;
    let clockStart = performance.now();
    let elapsedAtPause = 0;

    const clock = () => elapsedAtPause + (performance.now() - clockStart) / 1000;

    const render = () => {
      rafId = requestAnimationFrame(render);
      const t = clock() * timeScale;
      const dt = Math.min(0.05, Math.max(0.001, t - uniforms.uTime.value)) || 0.016;
      uniforms.uTime.value = t;

      const live = stateRef.current;

      // Damped interpolation (exponential easing, frame-rate independent).
      const ease = (current: number, target: number, speed: number) =>
        current + (target - current) * (1 - Math.exp(-speed * dt * 60 * 0.016));

      smooth.morph = ease(smooth.morph, live.isListening ? 1 : 0, DAMP.morph);
      smooth.focus = ease(smooth.focus, live.focusTarget ? 1 : 0, DAMP.focus);
      smooth.rotY = ease(smooth.rotY, pointer.x * 0.35, DAMP.rotate);
      smooth.rotX = ease(smooth.rotX, pointer.y * 0.22, DAMP.rotate);

      uniforms.uMorph.value = smooth.morph;
      uniforms.uFocus.value = smooth.focus;
      uniforms.uIntensity.value = live.intensity;
      // Base opacity from the Tweaks store; listening lifts it slightly but
      // stays quiet — the field must never wash out foreground text.
      uniforms.uOpacity.value = live.opacity * (1 + smooth.morph * 0.35);

      // Idle auto-rotation + pointer parallax.
      rig.rotation.y = t * 0.08 + smooth.rotY;
      rig.rotation.x = smooth.rotX;

      // Focus vector line + interpolated camera attention.
      if (live.focusTarget) {
        focusWorldPoint(live.focusTarget, smooth.focusPoint);
        uniforms.uFocusDir.value.copy(smooth.focusPoint).normalize();

        const positions = beam.line.geometry.attributes.position;
        positions.setXYZ(1, smooth.focusPoint.x, smooth.focusPoint.y, smooth.focusPoint.z);
        positions.needsUpdate = true;
        beam.pulse.position.copy(smooth.focusPoint);
      }
      beam.lineMaterial.opacity = smooth.focus * 0.4;
      beam.pulseMaterial.opacity = smooth.focus * (0.45 + 0.25 * Math.sin(t * 6));
      beam.pulseMaterial.size = 4 + 2 * Math.sin(t * 6) * smooth.focus;

      // Interpolated camera attention — zero per-frame allocations.
      if (live.focusTarget) {
        _lookTarget.copy(smooth.focusPoint).multiplyScalar(0.22);
      } else {
        _lookTarget.set(0, 0, 0);
      }
      smooth.lookAt.lerp(_lookTarget, 1 - Math.exp(-DAMP.focus * dt));
      camera.lookAt(smooth.lookAt);

      renderer.render(scene, camera);
    };

    const start = () => {
      if (running || document.hidden || !inViewport) return;
      running = true;
      clockStart = performance.now();
      rafId = requestAnimationFrame(render);
    };
    const stop = () => {
      if (!running) return;
      running = false;
      elapsedAtPause = clock();
      cancelAnimationFrame(rafId);
    };

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        inViewport = entry?.isIntersecting ?? true;
        inViewport ? start() : stop();
      },
      { threshold: 0.01 },
    );
    intersectionObserver.observe(container);

    // ---- WebGL context loss recovery ----------------------------------------
    const onContextLost = (event: Event) => {
      event.preventDefault();
      stop();
    };
    const onContextRestored = () => start();
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    start();

    // ---- Teardown: release every GPU resource --------------------------------
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('blur', onPointerLeave);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();

      geometry.dispose();
      material.dispose();
      beam.line.geometry.dispose();
      beam.lineMaterial.dispose();
      beam.pulse.geometry.dispose();
      beam.pulseMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, []); // scene is created once; live props flow through stateRef

  return (
    <div
      ref={containerRef}
      role="presentation"
      aria-hidden="true"
      className={`pointer-events-none relative h-full w-full overflow-hidden ${className}`}
    />
  );
}

export default CinematicCore;
