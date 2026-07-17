'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html, Line } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { Reorder } from 'framer-motion';
import * as THREE from 'three';
import { useQuery } from '@tanstack/react-query';
import { Maximize2, Minimize2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { subscribeWithReconnect } from '@/lib/supabase/realtime';
import { useConnectionStore } from '@/lib/realtime/connection-store';
import { useSpatialPulse, classifyLogRoom, type SpatialRoom } from '@/lib/fx/spatial-pulse';
import { useCoreFxStore } from '@/lib/fx/core-store';
import { AGENTS_KEY } from '@/hooks/use-agents-query';
import { TASKS_KEY } from '@/hooks/use-tasks-query';
import { useStagedOrders, STAGED_ORDERS_KEY } from '@/hooks/use-staged-orders-query';
import { useBusThoughts, readProvenance } from './agent-activity';
import { PanelChrome, StatusBadge, DataChip } from '@/components/deck';
import { MemoryViewer } from './memory-viewer';
import { WidgetErrorBoundary } from './widget-error-boundary';
import type { Agent, AgentType, Log, StagedOrderRow, Task } from '@/lib/types/database.types';
import { cn } from '@/lib/utils';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// BRAIN HUB â€” the Instrument Deck's WebGL signature (Brain Hub.dc.html).
// Four brain nodes with LIVE status colors bound to the real agents cache,
// dependency lines feeding a central bus with realtime pulses, click â†’
// camera fly-in â†’ Instrument-Deck panel reveal â†’ â—„ PULL OUT, and the rose
// approval-gate beacon that lights when a real staged order is pending.
// Three.js is reserved for THIS surface only (perf constraint).
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const IDLE_HEX = '#64748b';
const ACTIVE_HEX = '#38bdf8';
const CODEX_HEX = '#a78bfa';
const GATE_HEX = '#ff2d6b';
const BUS_POS: [number, number, number] = [0, 1.05, 0];
const BEACON_POS: [number, number, number] = [2.1, 2.15, 0.8];
const HOME_CAM: [number, number, number] = [0, 1.9, 6.4];
const HOME_LOOK: [number, number, number] = [0, 1.05, 0];

interface BrainDef {
  key: string;
  name: string;
  role: string;
  /** Real agent types whose live rows drive this brain's status. */
  types: AgentType[];
  /** Identity color when active; null â†’ status-driven (active blue / idle grey). */
  identity: string | null;
  position: [number, number, number];
  deps: string[];
  /** Pulse-bus room whose events flash this brain. */
  pulseRoom: SpatialRoom;
  future?: boolean;
}

/** Two working brains now, future planets kept dim until they are wired. */
const BRAINS: BrainDef[] = [
  { key: 'claude', name: 'CLAUDE', role: 'CEO ORCHESTRATION Â· DELEGATION', types: ['generic', 'planner'], identity: ACTIVE_HEX, position: [-2.1, 1.45, -0.4], deps: ['â†” CODEX'], pulseRoom: 'analytics' },
  { key: 'codex', name: 'CODEX', role: 'CODE GENERATION Â· SCRIPTING', types: ['coder'], identity: CODEX_HEX, position: [-0.65, 0.75, -1.65], deps: ['â†” CLAUDE'], pulseRoom: 'coding' },
  { key: 'hermes', name: 'HERMES', role: 'FUTURE RESEARCH LANE', types: [], identity: null, position: [1.0, 1.8, -1.3], deps: ['FUTURE'], pulseRoom: 'analytics', future: true },
  { key: 'grok', name: 'GROK', role: 'FUTURE CONTRARIAN LANE', types: [], identity: null, position: [2.4, 0.9, 0.2], deps: ['FUTURE'], pulseRoom: 'trading', future: true },
];

type Focus = { kind: 'brain'; key: string } | { kind: 'approval' } | null;

function brainStatus(brain: BrainDef, agents: Agent[]): { active: boolean; color: string } {
  const active = !brain.future && agents.some((a) => a.type != null && brain.types.includes(a.type) && a.status === 'busy');
  const color = brain.future ? '#263348' : brain.identity ?? (active ? ACTIVE_HEX : IDLE_HEX);
  return { active, color };
}

function camFor(pos: [number, number, number]): [number, number, number] {
  // Fly to a point pulled back from the node toward the home camera.
  const p = new THREE.Vector3(...pos);
  const dir = new THREE.Vector3(...HOME_CAM).sub(p).normalize().multiplyScalar(1.05);
  const c = p.clone().add(dir);
  return [c.x, Math.max(c.y, pos[1] + 0.05), c.z];
}

// â”€â”€ scene pieces â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function BrainNode({
  def,
  color,
  active,
  focused,
  idToBrain,
  onFocus,
}: {
  def: BrainDef;
  color: string;
  active: boolean;
  focused: boolean;
  /** Live agent-uuid â†’ brain-key lookup, rebuilt only when the agents cache
   *  changes â€” hover reads stay out of React entirely. */
  idToBrain: Map<string, string>;
  onFocus: () => void;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const highlight = useRef(0);
  const base = focused ? 2.2 : active ? 1.4 : 0.45;
  const ringBase = active ? 0.5 : 0.22;

  useFrame((_, delta) => {
    const m = mat.current;
    if (!m) return;
    const p = useSpatialPulse.getState().pulses[def.pulseRoom];
    const age = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - p.at;
    const flash = p.at > 0 ? p.mag * Math.exp(-age / 900) : 0;

    // Fleet-hover highlight (core-store FX bridge): a getState() read per
    // frame â€” a card hover never re-renders this tree. Eased so the glow
    // breathes on rather than snapping.
    const focusId = useCoreFxStore.getState().focusedAgentId;
    const target = focusId !== null && idToBrain.get(focusId) === def.key ? 1 : 0;
    highlight.current += (target - highlight.current) * (1 - Math.pow(0.002, delta));

    m.emissiveIntensity = base + flash * 2.0 + highlight.current * 1.3;
    const rm = ringMat.current;
    if (rm) rm.opacity = ringBase + highlight.current * 0.4;
    if (mesh.current) {
      mesh.current.rotation.x += delta * (focused ? 0.55 : 0.16);
      mesh.current.rotation.y += delta * (active ? 0.9 : 0.38);
    }
    if (ring.current) {
      ring.current.rotation.z += delta * 0.45;
    }
  });

  return (
    <group position={def.position}>
      <mesh
        ref={mesh}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onFocus();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'auto';
        }}
      >
        <icosahedronGeometry args={[0.3, 2]} />
        <meshStandardMaterial ref={mat} color={color} emissive={color} emissiveIntensity={base} toneMapped={false} roughness={0.35} metalness={0.15} />
      </mesh>
      {/* orbit ring â€” reads as "tracked fix", the 1A nav-instrument voice.
          Opacity is frame-driven (base + hover highlight). */}
      <mesh ref={ring} rotation={[Math.PI / 2.3, 0, 0]}>
        <torusGeometry args={[0.46, 0.006, 8, 48]} />
        <meshBasicMaterial ref={ringMat} color={color} transparent opacity={ringBase} toneMapped={false} />
      </mesh>
      <Html center distanceFactor={7} position={[0, -0.62, 0]} style={{ pointerEvents: 'none' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, whiteSpace: 'nowrap' }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color }}>{def.name}</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 7.5, letterSpacing: '0.1em', color: '#56657c' }}>{def.future ? 'FUTURE' : active ? 'BUSY' : 'IDLE'}</span>
        </div>
      </Html>
    </group>
  );
}

/** Central bus core. Breathes with live voice state (core-store
 *  FX bridge): while the mic is armed the wireframe brightens and swells on a
 *  fast wave â€” the deck's "the hub is listening" signal. Frame-loop
 *  getState() read only; arm/disarm never re-renders the scene. */
function BusCore() {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const level = useRef(0);

  useFrame(({ clock }, delta) => {
    const m = mat.current;
    const g = mesh.current;
    if (!m || !g) return;
    const listening = useCoreFxStore.getState().isListening;
    // Ease toward the live state so arm/disarm reads as a breath, not a snap.
    level.current += ((listening ? 1 : 0) - level.current) * (1 - Math.pow(0.002, delta));
    const wave = Math.sin(clock.elapsedTime * 5.2) * 0.5 + 0.5;
    m.emissiveIntensity = 1.1 + level.current * (0.9 + wave * 1.4);
    g.scale.setScalar(1 + level.current * (0.12 + wave * 0.1));
  });

  return (
    <mesh ref={mesh} position={BUS_POS}>
      <icosahedronGeometry args={[0.16, 1]} />
      <meshStandardMaterial ref={mat} color={ACTIVE_HEX} emissive={ACTIVE_HEX} emissiveIntensity={1.1} toneMapped={false} wireframe />
    </mesh>
  );
}

/** Dependency line brain â†’ bus, with a token pulse traveling along it while
 *  the brain is active. */
function DepLine({ from, color, active }: { from: [number, number, number]; color: string; active: boolean }) {
  const dot = useRef<THREE.Mesh>(null);
  const a = useMemo(() => new THREE.Vector3(...from), [from]);
  const b = useMemo(() => new THREE.Vector3(...BUS_POS), []);
  const seed = useMemo(() => Math.abs(from[0] * 7 + from[2] * 13), [from]);

  useFrame(({ clock }) => {
    const m = dot.current;
    if (!m) return;
    const t = ((clock.elapsedTime * (active ? 0.55 : 0.15) + seed) % 1 + 1) % 1;
    m.position.lerpVectors(a, b, t);
    (m.material as THREE.MeshBasicMaterial).opacity = active ? 0.95 : 0.3;
  });

  return (
    <group>
      <Line points={[a, b]} color={color} transparent opacity={active ? 0.34 : 0.14} lineWidth={1} />
      <mesh ref={dot}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshBasicMaterial color={color} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Rose approval beacon â€” lit only while a REAL staged order is pending. */
function ApprovalBeacon({ pending, focused, onFocus }: { pending: number; focused: boolean; onFocus: () => void }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const lit = pending > 0;

  useFrame(({ clock }) => {
    const m = mat.current;
    if (!m) return;
    m.emissiveIntensity = lit ? 1.6 + Math.sin(clock.elapsedTime * (Math.PI * 2 / 1.3)) * 0.9 : 0.12;
  });

  return (
    <group position={BEACON_POS}>
      <mesh
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (lit) onFocus();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          if (lit) document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'auto';
        }}
      >
        <octahedronGeometry args={[0.24, 0]} />
        <meshStandardMaterial
          ref={mat}
          color={lit ? GATE_HEX : '#22304a'}
          emissive={lit ? GATE_HEX : '#111b2e'}
          emissiveIntensity={lit ? 1.6 : 0.12}
          toneMapped={false}
        />
      </mesh>
      {lit && (
        <Html center distanceFactor={7} position={[0, -0.5, 0]} style={{ pointerEvents: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', fontFamily: 'JetBrains Mono, monospace' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: GATE_HEX }} />
            <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em', color: '#ff5c8a' }}>
              {pending} Â· ACTION REQUIRED
            </span>
          </div>
        </Html>
      )}
      {focused && null}
    </group>
  );
}

function Rig({ focus }: { focus: Focus }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controls = useRef<any>(null);
  const desiredCam = useRef(new THREE.Vector3());
  const desiredLook = useRef(new THREE.Vector3());
  // Fly to a focus ONLY while transitioning. Once arrived, hand the camera back
  // to the user so drag-to-orbit and free zoom aren't yanked back to the focus
  // point every frame. A new focus (planet click) re-arms the fly-to.
  const flying = useRef(true);
  const lastFocusKey = useRef('');

  useFrame((state, dt) => {
    const c = controls.current;
    if (!c) return;

    const focusKey =
      focus?.kind === 'brain' ? `brain:${focus.key}` : focus?.kind === 'approval' ? 'approval' : 'home';
    if (focusKey !== lastFocusKey.current) {
      lastFocusKey.current = focusKey;
      let cam = HOME_CAM;
      let look = HOME_LOOK;
      if (focus?.kind === 'brain') {
        const b = BRAINS.find((x) => x.key === focus.key)!;
        cam = camFor(b.position);
        look = b.position;
      } else if (focus?.kind === 'approval') {
        cam = camFor(BEACON_POS);
        look = BEACON_POS;
      }
      desiredCam.current.set(...cam);
      desiredLook.current.set(...look);
      flying.current = true;
    }

    // Free exploration: the user owns the camera; OrbitControls damping runs.
    if (!flying.current) {
      c.enabled = true;
      return;
    }

    if (state.camera.position.distanceTo(desiredCam.current) < 0.03) {
      flying.current = false;
      c.enabled = true;
      return;
    }
    const k = 1 - Math.pow(0.0016, dt);
    c.enabled = false;
    state.camera.position.lerp(desiredCam.current, k);
    c.target.lerp(desiredLook.current, k);
    c.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableZoom
      zoomSpeed={2.2}
      rotateSpeed={1.0}
      enableDamping
      dampingFactor={0.06}
      autoRotate={false}
      minDistance={0.45}
      maxDistance={34}
      minPolarAngle={0.12}
      maxPolarAngle={Math.PI * 0.62}
    />
  );
}

/** Subscribes the 3D scene to the Supabase data bus â€” log / staged-order /
 *  metric INSERTs each flash the corresponding brain. */
function usePulseBus() {
  const pulse = useSpatialPulse((s) => s.pulse);
  useEffect(() => {
    const supabase = createClient();
    const { setChannelStatus, clearChannel } = useConnectionStore.getState();
    const CHANNEL = 'spatial-pulse-bus';
    const dispose = subscribeWithReconnect({
      client: supabase,
      name: CHANNEL,
      onStatusChange: (s) => setChannelStatus(CHANNEL, s),
      build: (channel) =>
        channel
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'logs' }, (payload) => {
            const log = payload.new as Log;
            const mag = /\[(risk|order)\]|kill switch|auto-halt/i.test(log.message) ? 1.4 : 0.8;
            pulse(classifyLogRoom(log.message), mag);
          })
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'staged_orders' }, () => pulse('trading', 1.5))
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'metrics' }, () => pulse('analytics', 0.7)),
    });
    return () => {
      dispose();
      clearChannel(CHANNEL);
    };
  }, [pulse]);
}

// â”€â”€ Instrument-Deck reveal panels (DOM, real data) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function BrainPanel({ brainKey, onPullOut }: { brainKey: string; onPullOut: () => void }) {
  const def = BRAINS.find((b) => b.key === brainKey)!;
  const { data: agents = [] } = useQuery<Agent[]>({ queryKey: AGENTS_KEY, queryFn: async () => [], enabled: false, initialData: [] });
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: TASKS_KEY, queryFn: async () => [], enabled: false, initialData: [] });
  const thoughts = useBusThoughts(null); // cache-only observer â€” no extra channel

  const mine = agents.filter((a) => a.type != null && def.types.includes(a.type));
  const busy = mine.filter((a) => a.status === 'busy');
  const names = new Set(mine.map((a) => a.name.toLowerCase()));
  const myThoughts = thoughts.filter((t) => t.agent && names.has(t.agent.toLowerCase())).slice(0, 4);
  const latest = myThoughts[0] ? readProvenance(myThoughts[0]) : null;
  const myTasks = tasks.filter((t) => t.status === 'running' || t.status === 'pending').slice(0, 3);
  const color = def.identity ?? (busy.length > 0 ? ACTIVE_HEX : IDLE_HEX);

  return (
    <PanelChrome
      title={def.name}
      accent={def.key === 'codex' ? 'agent' : 'default'}
      headerRight={<StatusBadge status={busy.length > 0 ? 'active' : 'idle'}>{busy.length > 0 ? 'BUSY' : 'IDLE'}</StatusBadge>}
      bodyClassName="flex flex-col gap-3 p-3"
      className="pointer-events-auto h-full"
    >
      <span className="font-mono text-[8.5px] tracking-[0.16em] text-ink-low">{def.role}</span>

      <div className="grid grid-cols-2 gap-2 font-mono">
        <Metric label="MODEL" value={latest?.model ?? 'â€”'} tone={color} />
        <Metric label="LATENCY" value={latest?.latencyMs != null ? `${latest.latencyMs}ms` : 'â€”'} tone="#e8eef7" />
        <Metric label="AGENTS" value={`${busy.length} busy / ${mine.length}`} tone="#e8eef7" />
        <Metric label="PROVIDER" value={latest?.provider ?? 'â€”'} tone="#e8eef7" />
      </div>

      <div className="flex flex-col gap-1">
        <span className="font-mono text-[8px] tracking-[0.16em] text-ink-low">CURRENT TASKS</span>
        {myTasks.length === 0 ? (
          <span className="font-mono text-[9.5px] text-ink-low">queue clear</span>
        ) : (
          myTasks.map((t) => (
            <span key={t.id} className="truncate font-mono text-[9.5px] text-ink-mid">Â· {t.description}</span>
          ))
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="font-mono text-[8px] tracking-[0.16em] text-ink-low">RECENT ACTIVITY</span>
        {myThoughts.length === 0 ? (
          <span className="font-mono text-[9.5px] text-ink-low">no recent thoughts on the bus</span>
        ) : (
          myThoughts.map((t) => (
            <span key={t.id} className="truncate font-mono text-[9.5px] text-ink-mid">
              {readProvenance(t).preview || '(thought)'}
            </span>
          ))
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {def.deps.map((d) => (
          <DataChip key={d}>{d}</DataChip>
        ))}
      </div>

      <button
        type="button"
        onClick={onPullOut}
        className="mt-auto self-start rounded border border-primary/40 bg-primary/[0.08] px-3 py-1.5 font-mono text-[9.5px] font-bold tracking-[0.14em] text-primary-bright transition-colors hover:bg-primary/20"
      >
        â—„ PULL OUT
      </button>
    </PanelChrome>
  );
}

function ApprovalPanel({ orders, onPullOut }: { orders: StagedOrderRow[]; onPullOut: () => void }) {
  return (
    <PanelChrome
      title="STAGED ORDER"
      accent="gate"
      glow
      headerRight={<StatusBadge status="pending" className="!text-gate">{orders.length} PENDING</StatusBadge>}
      bodyClassName="flex flex-col gap-3 p-3"
      className="pointer-events-auto h-full"
    >
      <span className="font-mono text-[8.5px] tracking-[0.16em] text-gate-soft">HUMAN-APPROVAL GATE Â· TRADING</span>
      {orders.slice(0, 3).map((o) => (
        <div key={o.id} className="flex flex-col gap-1.5 rounded-[5px] border border-gate/40 bg-gate/[0.05] p-2.5 font-mono">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-bold text-ink-hi">{o.underlying} {o.option_type} {o.strike}</span>
            <span className="ml-auto tabular text-[10px] text-ink-mid">${Math.round(o.calculated_position_size_usd).toLocaleString()}</span>
          </div>
          {o.intent_kind === 'option_intent' ? (
            <span className="text-[8.5px] text-ink-mid">
              {o.action} {o.contracts}x · {o.price_effect} · max prem ${Math.round(o.max_premium_usd ?? 0).toLocaleString()} · max loss ${Math.round(o.max_loss_usd ?? 0).toLocaleString()}
            </span>
          ) : (
            <span className="text-[8.5px] text-ink-mid">
              ½ Kelly {(((o.kelly_fraction ?? 0) * 100)).toFixed(2)}% · E {(o.expectancy ?? 0).toFixed(2)}R · {o.source}
            </span>
          )}
        </div>
      ))}
      <Link
        href="/dashboard/rooms/trading"
        className="rounded border border-gate bg-gate px-3 py-2 text-center font-mono text-[10px] font-bold tracking-[0.14em] text-gate-foreground transition-colors hover:bg-gate-soft"
      >
        OPEN TRADING ROOM â†’
      </Link>
      <button
        type="button"
        onClick={onPullOut}
        className="mt-auto self-start rounded border border-primary/40 bg-primary/[0.08] px-3 py-1.5 font-mono text-[9.5px] font-bold tracking-[0.14em] text-primary-bright transition-colors hover:bg-primary/20"
      >
        â—„ PULL OUT
      </button>
    </PanelChrome>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex flex-col gap-[2px] rounded-[4px] border border-border/50 bg-white/[0.012] px-2 py-1.5">
      <span className="text-[7.5px] tracking-[0.12em] text-ink-low">{label}</span>
      <span className="truncate text-[11px] font-bold tabular" style={{ color: tone }}>{value}</span>
    </div>
  );
}

// â”€â”€ Floating workspace tiles (unchanged functionality) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type TileId = 'fleet' | 'tasks' | 'memory' | 'approvals';
const TILE_LABEL: Record<TileId, string> = { fleet: 'Fleet', tasks: 'Tasks', memory: 'Memory', approvals: 'Staged Orders' };
const TILE_ACCENT: Record<TileId, string> = {
  fleet: 'text-neon-green',
  tasks: 'text-warning',
  memory: 'text-agent-codex',
  approvals: 'text-gate-soft',
};

function TileBody({ id, expanded }: { id: TileId; expanded: boolean }) {
  const { data: agents = [] } = useQuery<Agent[]>({ queryKey: AGENTS_KEY, queryFn: async () => [], enabled: false, initialData: [] });
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: TASKS_KEY, queryFn: async () => [], enabled: false, initialData: [] });
  const { data: staged = [] } = useQuery<StagedOrderRow[]>({ queryKey: STAGED_ORDERS_KEY, queryFn: async () => [], enabled: false, initialData: [] });

  if (id === 'fleet') {
    const idle = agents.filter((a) => a.status === 'idle').length;
    const busy = agents.filter((a) => a.status === 'busy').length;
    const live = agents.filter((a) => a.status === 'busy' || a.last_heartbeat).slice(0, expanded ? 12 : 3);
    return (
      <div className="font-mono text-[10px]">
        <p className="text-ink-low">{idle} idle Â· {busy} busy Â· {agents.length} total</p>
        {live.map((a) => (
          <div key={a.id} className="flex items-center gap-1.5 py-0.5">
            <span className={cn('size-1 rounded-full', a.status === 'busy' ? 'bg-primary' : 'bg-neon-green')} />
            <span className="truncate text-ink-hi/80">{a.name}</span>
          </div>
        ))}
      </div>
    );
  }
  if (id === 'tasks') {
    const running = tasks.filter((t) => t.status === 'running').length;
    const pending = tasks.filter((t) => t.status === 'pending').length;
    const done = tasks.filter((t) => t.status === 'completed').length;
    return (
      <div className="font-mono text-[10px]">
        <p className="text-ink-low">{running} running Â· {pending} pending Â· {done} done</p>
        {tasks.slice(0, expanded ? 8 : 2).map((t) => (
          <p key={t.id} className="truncate py-0.5 text-ink-hi/75">{t.description}</p>
        ))}
      </div>
    );
  }
  if (id === 'approvals') {
    const pending = staged.filter((s) => s.human_approval_status === 'PENDING');
    return (
      <div className="font-mono text-[10px]">
        <p className="text-ink-low">{pending.length} awaiting verdict Â· nothing auto-executes</p>
        {pending.slice(0, expanded ? 8 : 2).map((s) => (
          <p key={s.id} className="truncate py-0.5 text-gate-soft/90">
            {s.intent_kind === 'option_intent'
              ? `${s.underlying} ${s.option_type} ${s.strike} · ${s.action} ${s.contracts}x`
              : `${s.underlying} ${s.option_type} ${s.strike} · Kelly ${(((s.kelly_fraction ?? 0) * 100)).toFixed(1)}%`}
          </p>
        ))}
      </div>
    );
  }
  return expanded ? (
    <div className="h-full min-h-0">
      <MemoryViewer />
    </div>
  ) : (
    <p className="font-mono text-[10px] text-ink-low">Double-click to inspect the memory bank.</p>
  );
}

function FloatingTiles() {
  const [order, setOrder] = useState<TileId[]>(['fleet', 'tasks', 'approvals', 'memory']);
  const [maximized, setMaximized] = useState<TileId | null>(null);

  if (maximized) {
    return (
      <div className="absolute inset-0 z-30 flex flex-col bg-background/95 backdrop-blur-sm">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
          <span className={cn('font-mono text-[10px] font-bold uppercase tracking-[0.15em]', TILE_ACCENT[maximized])}>
            {TILE_LABEL[maximized]}
          </span>
          <button
            onClick={() => setMaximized(null)}
            aria-label={`Restore ${TILE_LABEL[maximized]} tile`}
            className="ml-auto flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-ink-mid hover:text-ink-hi"
          >
            <Minimize2 className="size-3" aria-hidden /> restore
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <WidgetErrorBoundary name={TILE_LABEL[maximized]}>
            <TileBody id={maximized} expanded />
          </WidgetErrorBoundary>
        </div>
      </div>
    );
  }

  return (
    <Reorder.Group
      axis="x"
      values={order}
      onReorder={setOrder}
      className="pointer-events-auto absolute left-2 right-2 top-9 z-10 flex list-none gap-2 overflow-x-auto"
    >
      {order.map((id) => (
        <Reorder.Item
          key={id}
          value={id}
          onDoubleClick={() => setMaximized(id)}
          className="w-44 shrink-0 cursor-grab rounded-lg border border-border/60 bg-surface-1/55 p-2 backdrop-blur-md active:cursor-grabbing"
        >
          <div className="mb-1 flex items-center gap-1.5">
            <span className={cn('font-mono text-[9px] font-bold uppercase tracking-[0.12em]', TILE_ACCENT[id])}>{TILE_LABEL[id]}</span>
            <button
              onClick={() => setMaximized(id)}
              aria-label={`Maximize ${TILE_LABEL[id]} tile`}
              className="ml-auto text-ink-low/50 hover:text-ink-hi"
            >
              <Maximize2 className="size-2.5" aria-hidden />
            </button>
          </div>
          <TileBody id={id} expanded={false} />
        </Reorder.Item>
      ))}
    </Reorder.Group>
  );
}

// â”€â”€ the hub â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function SpatialWorkspace({
  showTiles = false,
  onBrainSelect,
}: {
  showTiles?: boolean;
  onBrainSelect?: (brainKey: string) => void;
}) {
  const [focus, setFocus] = useState<Focus>(null);
  usePulseBus();

  const { data: agents = [] } = useQuery<Agent[]>({ queryKey: AGENTS_KEY, queryFn: async () => [], enabled: false, initialData: [] });
  const { data: pendingOrders = [] } = useStagedOrders();

  // Agent uuid â†’ brain key, for the fleet-hover highlight. Rebuilt only when
  // the agents cache changes (rare); the per-frame hover read is a Map.get.
  const idToBrain = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) {
      if (a.type == null) continue;
      const brain = BRAINS.find((b) => b.types.includes(a.type as AgentType));
      if (brain) m.set(a.id, brain.key);
    }
    return m;
  }, [agents]);

  const selectBrain = (brainKey: string) => {
    setFocus({ kind: 'brain', key: brainKey });
    onBrainSelect?.(brainKey);
  };

  // Own the wheel across the ENTIRE scene wrapper so the page scroll container
  // never competes with OrbitControls zoom. React registers onWheel as passive,
  // so preventDefault requires a non-passive native listener. OrbitControls
  // still handles zoom over the canvas; over the HTML overlays (hint pill,
  // quick-focus rail, approval panel) this simply blocks page scroll so there
  // are no dead zones where a wheel does nothing / scrolls the page instead.
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // No dead zones: if the wheel landed on an interactive HTML overlay
      // (quick-focus rail, approval panel, tiles) instead of the canvas,
      // forward it to the canvas so OrbitControls zooms everywhere on the
      // scene surface — not just over the canvas hotspot. Pointer-events-none
      // overlays (hint pill) already pass through, so target is the canvas there.
      const canvas = el.querySelector('canvas');
      if (canvas && e.target !== canvas) {
        canvas.dispatchEvent(
          new WheelEvent('wheel', {
            deltaX: e.deltaX,
            deltaY: e.deltaY,
            deltaMode: e.deltaMode,
            clientX: e.clientX,
            clientY: e.clientY,
            bubbles: false,
            cancelable: true,
          }),
        );
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      ref={wrapperRef}
      onWheelCapture={(e) => e.stopPropagation()}
      className="touch-none relative h-full w-full overflow-hidden rounded-md border border-border bg-[#070c15]">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: HOME_CAM, fov: 50 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={() => setFocus(null)}
        onCreated={({ scene }) => {
          scene.fog = new THREE.Fog('#070c15', 7, 17);
        }}
      >
        <ambientLight intensity={0.3} />
        <hemisphereLight args={['#16233d', '#05070c', 0.5]} />
        <pointLight position={[0, 3.5, 3]} intensity={20} color={ACTIVE_HEX} distance={16} />
        <pointLight position={[-4, 2, 2]} intensity={10} color={CODEX_HEX} distance={14} />

        {/* deck floor */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.0, 0]} receiveShadow>
          <planeGeometry args={[40, 40]} />
          <meshStandardMaterial color="#0a1120" metalness={0.2} roughness={0.9} />
        </mesh>
        <gridHelper args={[40, 60, '#12324a', '#0c1626']} position={[0, -0.99, 0]} />

        {/* central bus â€” breathes while Nova / room chat voice is armed */}
        <BusCore />

        {BRAINS.map((def) => {
          const { active, color } = brainStatus(def, agents);
          return (
            <group key={def.key}>
              <DepLine from={def.position} color={color} active={active} />
              <BrainNode
                def={def}
                color={color}
                active={active}
                focused={focus?.kind === 'brain' && focus.key === def.key}
                idToBrain={idToBrain}
                onFocus={() => selectBrain(def.key)}
              />
            </group>
          );
        })}

        <ApprovalBeacon
          pending={pendingOrders.length}
          focused={focus?.kind === 'approval'}
          onFocus={() => setFocus({ kind: 'approval' })}
        />

        <Rig focus={focus} />

        <EffectComposer>
          <Bloom intensity={0.9} luminanceThreshold={0.25} luminanceSmoothing={0.9} mipmapBlur />
        </EffectComposer>
      </Canvas>

      {/* floating workspace tiles â€” hidden while a focus panel is open */}
      {!focus && showTiles && <FloatingTiles />}

      {!focus && (
        <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full border border-border/60 bg-background/70 px-2.5 py-0.5 font-mono text-[9px] text-ink-low backdrop-blur">
          drag to orbit Â· scroll up to zoom in Â· scroll down to zoom out{pendingOrders.length > 0 ? ' Â· rose beacon = order awaiting you' : ''}
        </div>
      )}

      {/* Instrument-Deck reveal panel â€” right side, over the scene */}
      {focus?.kind === 'approval' && (
        <div className="pointer-events-none absolute bottom-3 right-3 top-3 z-20 w-[min(340px,88vw)]">
          <ApprovalPanel orders={pendingOrders} onPullOut={() => setFocus(null)} />
        </div>
      )}

      {/* quick-focus rail */}
      <div className="absolute bottom-2 left-2 flex gap-2">
        {BRAINS.map((b) => {
          const { color } = brainStatus(b, agents);
          return (
            <button
              key={b.key}
              onClick={() => selectBrain(b.key)}
              className={cn(
                'rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors',
                focus?.kind === 'brain' && focus.key === b.key ? 'border-current' : 'border-border/50 hover:border-current',
              )}
              style={{ color }}
            >
              {b.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default SpatialWorkspace;


