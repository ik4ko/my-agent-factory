'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { Reorder } from 'framer-motion';
import * as THREE from 'three';
import { useQuery } from '@tanstack/react-query';
import { Activity, Code2, LineChart, Maximize2, Minimize2, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { subscribeWithReconnect } from '@/lib/supabase/realtime';
import { useConnectionStore } from '@/lib/realtime/connection-store';
import { useSpatialPulse, classifyLogRoom, type SpatialRoom } from '@/lib/fx/spatial-pulse';
import { AGENTS_KEY } from '@/hooks/use-agents-query';
import { TASKS_KEY } from '@/hooks/use-tasks-query';
import { STAGED_ORDERS_KEY } from './staged-orders';
import { RiskPanel } from './risk-panel';
import { StagedOrders } from './staged-orders';
import { LiveTerminal } from './live-terminal';
import { TaskOutputFeed } from './task-output-feed';
import { TokenStream } from './token-stream';
import { MemoryViewer } from './memory-viewer';
import { WidgetErrorBoundary } from './widget-error-boundary';
import type { Agent, Log, Metric, StagedOrderRow, Task } from '@/lib/types/database.types';
import { cn } from '@/lib/utils';

// Immersive cyberpunk-lofi command room. Low-poly neon terminals whose
// emissive glow physically reacts to the Supabase data bus (a [RISK]/[ORDER]
// log INSERT flashes the matching monitor), bloom post-processing for the
// glow, pan/zoom orbit, and a floating reorderable tile HUD. Fully
// self-contained — no external asset fetches — so it stays inside the app's
// strict `default-src 'self'` CSP.

interface MonitorDef {
  id: SpatialRoom;
  label: string;
  color: string;
  position: [number, number, number];
  rotation: [number, number, number];
  cam: [number, number, number];
  look: [number, number, number];
}

const HOME_CAM: [number, number, number] = [0, 1.7, 6.8];
const HOME_LOOK: [number, number, number] = [0, 0.85, -0.8];

const MONITORS: MonitorDef[] = [
  { id: 'trading', label: 'Trading', color: '#39d353', position: [-2.5, 0.95, -0.7], rotation: [0, 0.5, 0], cam: [-2.5, 1.05, 1.5], look: [-2.5, 0.95, -0.7] },
  { id: 'coding', label: 'Coding', color: '#38bdf8', position: [0, 0.95, -1.5], rotation: [0, 0, 0], cam: [0, 1.05, 1.0], look: [0, 0.95, -1.5] },
  { id: 'analytics', label: 'Analytics', color: '#f59e0b', position: [2.5, 0.95, -0.7], rotation: [0, -0.5, 0], cam: [2.5, 1.05, 1.5], look: [2.5, 0.95, -0.7] },
];

const PULSE_TAU_MS = 900; // emissive flash decay time-constant

function Monitor({
  def,
  hovered,
  focused,
  onFocus,
  onHover,
}: {
  def: MonitorDef;
  hovered: boolean;
  focused: boolean;
  onFocus: (id: SpatialRoom) => void;
  onHover: (id: SpatialRoom | null) => void;
}) {
  const screen = useRef<THREE.MeshStandardMaterial>(null);
  const base = focused ? 1.5 : hovered ? 1.05 : 0.5;

  // Data-reactive glow: read the pulse bus every frame (no React re-render)
  // and add a decaying flash on top of the resting emissive level.
  useFrame(() => {
    const mat = screen.current;
    if (!mat) return;
    const p = useSpatialPulse.getState().pulses[def.id];
    const dt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - p.at;
    const flash = p.at > 0 ? p.mag * Math.exp(-dt / PULSE_TAU_MS) : 0;
    mat.emissiveIntensity = base + flash * 2.4;
  });

  return (
    <group position={def.position} rotation={def.rotation}>
      <mesh castShadow>
        <boxGeometry args={[1.5, 0.95, 0.08]} />
        <meshStandardMaterial color="#0d1117" metalness={0.4} roughness={0.6} />
      </mesh>
      <mesh
        position={[0, 0, 0.05]}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onFocus(def.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(def.id);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = 'auto';
        }}
      >
        <planeGeometry args={[1.34, 0.8]} />
        <meshStandardMaterial ref={screen} color={def.color} emissive={def.color} emissiveIntensity={base} toneMapped={false} />
      </mesh>
      <mesh position={[0, -0.72, 0]} castShadow>
        <boxGeometry args={[0.14, 0.5, 0.14]} />
        <meshStandardMaterial color="#161b22" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, -0.98, 0]}>
        <boxGeometry args={[0.6, 0.05, 0.4]} />
        <meshStandardMaterial color="#161b22" metalness={0.5} roughness={0.5} />
      </mesh>
    </group>
  );
}

function Rig({ focused }: { focused: SpatialRoom | null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controls = useRef<any>(null);
  const desiredCam = useRef(new THREE.Vector3());
  const desiredLook = useRef(new THREE.Vector3());

  useFrame((state, dt) => {
    const c = controls.current;
    if (!c) return;
    const mon = focused ? MONITORS.find((m) => m.id === focused) : null;
    desiredCam.current.set(...(mon ? mon.cam : HOME_CAM));
    desiredLook.current.set(...(mon ? mon.look : HOME_LOOK));

    const arrivedHome = !focused && state.camera.position.distanceTo(desiredCam.current) < 0.03;
    if (arrivedHome) {
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
      enablePan
      enableDamping
      dampingFactor={0.08}
      minDistance={1.8}
      maxDistance={15}
      minPolarAngle={0.15}
      maxPolarAngle={Math.PI / 2 - 0.03}
    />
  );
}

/** Subscribes the 3D scene to the Supabase data bus — log / staged-order /
 *  metric INSERTs each flash the corresponding monitor mesh. Lives inside the
 *  canvas host so it mounts/unmounts with the pane. */
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

// ---------------------------------------------------------------------------
// Room overlays (real data)
// ---------------------------------------------------------------------------

/** Kelly-sizing grid — recent staged theses with their fractional allocation,
 *  the high-density signal for GROK-originating (SANDBOX) proposals. */
function KellyGrid() {
  const { data: rows = [], isLoading } = useQuery<StagedOrderRow[]>({
    queryKey: ['staged-orders', 'recent-kelly'],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('staged_orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    staleTime: 15_000,
    refetchInterval: 20_000,
  });

  if (isLoading) return <p className="font-terminal text-[10px] text-muted-foreground/40">loading allocations…</p>;
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-3 font-terminal text-[10px] text-muted-foreground/40">
        No staged theses yet — a GROK thesis with parseable trade params stages here with its Kelly allocation.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full font-terminal text-[10px]">
        <thead>
          <tr className="border-b border-border bg-surface-1/60 text-left text-[9px] uppercase tracking-wider text-muted-foreground/50">
            <th className="px-2 py-1 font-medium">underlying</th>
            <th className="px-2 py-1 font-medium">Kelly ƒ</th>
            <th className="px-2 py-1 font-medium">size</th>
            <th className="px-2 py-1 font-medium">E[R]</th>
            <th className="px-2 py-1 font-medium">win%</th>
            <th className="px-2 py-1 font-medium">src</th>
            <th className="px-2 py-1 font-medium">status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className="border-b border-border/40 last:border-b-0">
              <td className="px-2 py-1 font-semibold text-foreground/85">
                {o.underlying} <span className={o.option_type === 'CALL' ? 'text-neon-green' : 'text-neon-red'}>{o.option_type} {o.strike}</span>
              </td>
              <td className="px-2 py-1 tabular text-neon-cyan/90">{(o.kelly_fraction * 100).toFixed(2)}%</td>
              <td className="px-2 py-1 tabular">${o.calculated_position_size_usd.toLocaleString()}</td>
              <td className="px-2 py-1 tabular text-neon-purple/80">{o.expectancy.toFixed(2)}R</td>
              <td className="px-2 py-1 tabular text-muted-foreground/60">{(o.win_rate * 100).toFixed(0)}%</td>
              <td className="px-2 py-1">
                <span className={cn('rounded border px-1 py-px text-[8px]', o.source === 'SANDBOX' ? 'border-neon-orange/40 text-neon-orange/80' : 'border-neon-cyan/40 text-neon-cyan/80')}>
                  {o.source}
                </span>
              </td>
              <td className={cn('px-2 py-1', o.human_approval_status === 'PENDING' ? 'text-warning' : o.human_approval_status === 'APPROVED' ? 'text-neon-green' : 'text-muted-foreground/40')}>
                {o.human_approval_status}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FileTreeFrame() {
  return (
    <div className="rounded-md border border-neon-cyan/20 bg-surface-1/50 p-2.5 font-terminal text-[10px] leading-relaxed text-neon-cyan/60">
      <span className="text-neon-cyan/80">.sandbox/</span> <span className="text-muted-foreground/40">· SANDBOX_ROOT (realpath-confined)</span>
      <br />├─ patches/&nbsp;&nbsp;<span className="text-muted-foreground/40">· execution-ready diff frames</span>
      <br />├─ src/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-muted-foreground/40">· active edit target</span>
      <br />└─ .runlog&nbsp;&nbsp;<span className="text-muted-foreground/40">· argv-allowlisted tool-runner output →</span>
    </div>
  );
}

function RoomOverlay({ room, onClose }: { room: SpatialRoom; onClose: () => void }) {
  const meta = MONITORS.find((m) => m.id === room)!;
  const Icon = room === 'trading' ? LineChart : room === 'coding' ? Code2 : Activity;

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background/92 backdrop-blur-sm">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <Icon className="size-3.5" style={{ color: meta.color }} aria-hidden />
        <span className="font-terminal text-[11px] font-bold uppercase tracking-[0.15em]" style={{ color: meta.color }}>
          {meta.label} Room
        </span>
        <button
          onClick={onClose}
          aria-label="Exit room — return to the spatial view"
          className="ml-auto flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-terminal text-[9px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3" aria-hidden /> exit
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {room === 'trading' && (
          <div className="flex flex-col gap-3">
            <WidgetErrorBoundary name="Risk">
              <RiskPanel />
            </WidgetErrorBoundary>
            <section>
              <h3 className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Kelly allocation grid · GROK theses</h3>
              <WidgetErrorBoundary name="Kelly Grid">
                <KellyGrid />
              </WidgetErrorBoundary>
            </section>
            <WidgetErrorBoundary name="Staged Orders">
              <StagedOrders />
            </WidgetErrorBoundary>
            <div className="h-[220px] rounded-md border border-border p-2.5">
              <WidgetErrorBoundary name="Trading Terminal">
                <LiveTerminal scope="trading" />
              </WidgetErrorBoundary>
            </div>
          </div>
        )}

        {room === 'coding' && (
          <div className="flex flex-col gap-3">
            <FileTreeFrame />
            <WidgetErrorBoundary name="Code Review">
              <TaskOutputFeed agentTypes={['coder', 'planner']} title="Patch frames — latest Codex output" accent="text-neon-cyan" emptyText="No Codex output yet — dispatch a build task from the Coding Room or Orchestrate pane." />
            </WidgetErrorBoundary>
            <div className="h-[220px] rounded-md border border-border p-2.5">
              <WidgetErrorBoundary name="Sandbox Runner">
                <LiveTerminal scope="coding" />
              </WidgetErrorBoundary>
            </div>
          </div>
        )}

        {room === 'analytics' && (
          <div className="flex h-full min-h-0 flex-col gap-3">
            <WidgetErrorBoundary name="Token Stream">
              <TokenStream />
            </WidgetErrorBoundary>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Floating workspace tiles (Chrome-tab model) — semi-transparent, drag-
// reorderable HUD over the 3D scene. Contents are passive live summaries read
// from the shared query cache the deck already owns on /dashboard, so no
// duplicate realtime channels are opened.
// ---------------------------------------------------------------------------

type TileId = 'fleet' | 'tasks' | 'memory' | 'approvals';
const TILE_LABEL: Record<TileId, string> = { fleet: 'Fleet', tasks: 'Tasks', memory: 'Memory', approvals: 'Staged Orders' };
const TILE_ACCENT: Record<TileId, string> = {
  fleet: 'text-neon-green',
  tasks: 'text-warning',
  memory: 'text-neon-purple',
  approvals: 'text-neon-orange',
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
      <div className="font-terminal text-[10px]">
        <p className="text-muted-foreground/60">{idle} idle · {busy} busy · {agents.length} total</p>
        {live.map((a) => (
          <div key={a.id} className="flex items-center gap-1.5 py-0.5">
            <span className={cn('size-1 rounded-full', a.status === 'busy' ? 'bg-neon-cyan' : 'bg-neon-green')} />
            <span className="truncate text-foreground/80">{a.name}</span>
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
      <div className="font-terminal text-[10px]">
        <p className="text-muted-foreground/60">{running} running · {pending} pending · {done} done</p>
        {tasks.slice(0, expanded ? 8 : 2).map((t) => (
          <p key={t.id} className="truncate py-0.5 text-foreground/75">{t.description}</p>
        ))}
      </div>
    );
  }
  if (id === 'approvals') {
    const pending = staged.filter((s) => s.human_approval_status === 'PENDING');
    return (
      <div className="font-terminal text-[10px]">
        <p className="text-muted-foreground/60">{pending.length} awaiting verdict · nothing auto-executes</p>
        {pending.slice(0, expanded ? 8 : 2).map((s) => (
          <p key={s.id} className="truncate py-0.5 text-neon-orange/80">
            {s.underlying} {s.option_type} {s.strike} · Kelly {(s.kelly_fraction * 100).toFixed(1)}%
          </p>
        ))}
      </div>
    );
  }
  // memory — full component only when expanded (it owns a light channel); the
  // collapsed tile is a static hint to avoid mounting it in a tiny box.
  return expanded ? (
    <div className="h-full min-h-0">
      <MemoryViewer />
    </div>
  ) : (
    <p className="font-terminal text-[10px] text-muted-foreground/50">Double-click to inspect the memory bank.</p>
  );
}

function FloatingTiles() {
  const [order, setOrder] = useState<TileId[]>(['fleet', 'tasks', 'approvals', 'memory']);
  const [maximized, setMaximized] = useState<TileId | null>(null);

  if (maximized) {
    // Full-tiled focus — strictly inset within the bounded spatial pane
    // (h-screen would overflow the pane + native title bar; inset-0 obeys the
    // rigid vertical boundary).
    return (
      <div className="absolute inset-0 z-30 flex flex-col bg-background/95 backdrop-blur-sm">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
          <span className={cn('font-terminal text-[10px] font-bold uppercase tracking-[0.15em]', TILE_ACCENT[maximized])}>
            {TILE_LABEL[maximized]}
          </span>
          <button
            onClick={() => setMaximized(null)}
            aria-label={`Restore ${TILE_LABEL[maximized]} tile`}
            className="ml-auto flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-terminal text-[9px] text-muted-foreground hover:text-foreground"
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
            <span className={cn('font-terminal text-[9px] font-bold uppercase tracking-[0.12em]', TILE_ACCENT[id])}>{TILE_LABEL[id]}</span>
            <button
              onClick={() => setMaximized(id)}
              aria-label={`Maximize ${TILE_LABEL[id]} tile`}
              className="ml-auto text-muted-foreground/30 hover:text-foreground"
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

export function SpatialWorkspace() {
  const [focused, setFocused] = useState<SpatialRoom | null>(null);
  const [hovered, setHovered] = useState<SpatialRoom | null>(null);
  usePulseBus();

  // live event counts (re-renders the small HUD readout, not the canvas)
  const counts = useSpatialPulse((s) => s.pulses);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md border border-border bg-[#06070a]">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: HOME_CAM, fov: 50 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ scene }) => {
          scene.fog = new THREE.Fog('#06070a', 6, 16);
        }}
      >
        <ambientLight intensity={0.32} />
        <hemisphereLight args={['#1b2a4a', '#05060a', 0.5]} />
        <pointLight position={[0, 3, 3]} intensity={26} color="#39d353" distance={16} />
        <pointLight position={[-4, 2, 2]} intensity={15} color="#38bdf8" distance={14} />
        <pointLight position={[4, 2, 2]} intensity={15} color="#f59e0b" distance={14} />

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.0, 0]} receiveShadow>
          <planeGeometry args={[40, 40]} />
          <meshStandardMaterial color="#0a0c12" metalness={0.2} roughness={0.9} />
        </mesh>
        <gridHelper args={[40, 60, '#12324a', '#0c1420']} position={[0, -0.99, 0]} />

        {MONITORS.map((def) => (
          <Monitor key={def.id} def={def} hovered={hovered === def.id} focused={focused === def.id} onFocus={setFocused} onHover={setHovered} />
        ))}

        <Rig focused={focused} />

        <EffectComposer>
          <Bloom intensity={0.9} luminanceThreshold={0.25} luminanceSmoothing={0.9} mipmapBlur />
        </EffectComposer>
      </Canvas>

      {/* floating workspace tiles — hidden while a monitor room is open */}
      {!focused && <FloatingTiles />}

      {/* hint + live event HUD */}
      {!focused && (
        <>
          <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full border border-border/60 bg-background/70 px-2.5 py-0.5 font-terminal text-[9px] text-muted-foreground/60 backdrop-blur">
            drag to orbit · right-drag to pan · scroll to zoom · click a monitor
          </div>
          <div className="pointer-events-none absolute bottom-2 right-2 flex gap-2 font-terminal text-[9px]">
            {MONITORS.map((m) => (
              <span key={m.id} style={{ color: m.color }} title={`${counts[m.id].count} live events pulsed on ${m.label}`}>
                {m.label} {counts[m.id].count}
              </span>
            ))}
          </div>
        </>
      )}

      {focused && <RoomOverlay room={focused} onClose={() => setFocused(null)} />}

      <div className="absolute bottom-2 left-2 flex gap-2">
        {MONITORS.map((m) => (
          <button
            key={m.id}
            onClick={() => setFocused(m.id)}
            className={cn('rounded border px-1.5 py-0.5 font-terminal text-[9px] uppercase tracking-wider transition-colors', focused === m.id ? 'border-current' : 'border-border/50 hover:border-current')}
            style={{ color: m.color }}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default SpatialWorkspace;
