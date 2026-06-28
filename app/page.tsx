'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase-client';

type Agent = {
  id: string;
  name: string;
  status: string;
  current_task: string | null;
};

type TaskRecord = {
  id: string;
  agent_id: string;
  description: string;
  status: string;
  created_at: string;
};

type LogEntry = {
  id: string;
  agent_id: string | null;
  message: string;
  level: string;
  timestamp: string;
};

const AGENT_META: Record<string, string> = {
  'a1111111-1111-1111-1111-111111111111': 'text-cyan-400 border-cyan-500/30',
  'a2222222-2222-2222-2222-222222222222': 'text-emerald-400 border-emerald-500/30',
  'a3333333-3333-3333-3333-333333333333': 'text-fuchsia-400 border-fuchsia-500/30',
  'a4444444-4444-4444-4444-444444444444': 'text-amber-400 border-amber-500/30',
};

export default function Dashboard() {
  const [command, setCommand] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [statusMessage, setStatusMessage] = useState('System standby');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const statusTone = useMemo(() => {
    if (isLoading) return 'border-amber-500/30 bg-amber-950/20 text-amber-400';
    if (isListening) return 'border-cyan-500/30 bg-cyan-950/20 text-cyan-400';
    return 'border-emerald-500/30 bg-emerald-950/20 text-emerald-400';
  }, [isLoading, isListening]);

  const livePulseClass = isListening ? 'animate-pulse' : 'animate-[pulse_2.2s_ease-in-out_infinite]';

  useEffect(() => {
    const loadData = async () => {
      const [{ data: agentData }, { data: taskData }, { data: logData }] = await Promise.all([
        supabase.from('agents').select('*').order('name', { ascending: true }),
        supabase.from('tasks').select('*').order('created_at', { ascending: false }).limit(8),
        supabase.from('logs').select('*').order('timestamp', { ascending: false }).limit(12),
      ]);

      setAgents((agentData || []) as Agent[]);
      setTasks((taskData || []) as TaskRecord[]);
      setLogs((logData || []) as LogEntry[]);
    };

    void loadData();

    const agentChannel = supabase.channel('agents-updates').on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'agents' },
      (payload) => {
        const nextAgent = payload.new as Agent;
        setAgents((prev) => {
          const without = prev.filter((agent) => agent.id !== nextAgent.id);
          return [...without, nextAgent].sort((a, b) => a.name.localeCompare(b.name));
        });
      }
    ).subscribe();

    const taskChannel = supabase.channel('tasks-updates').on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tasks' },
      (payload) => {
        const nextTask = payload.new as TaskRecord;
        setTasks((prev) => [nextTask, ...prev.filter((item) => item.id !== nextTask.id)].slice(0, 8));
      }
    ).subscribe();

    const logChannel = supabase.channel('logs-updates').on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'logs' },
      (payload) => {
        const entry = payload.new as LogEntry;
        setLogs((prev) => [entry, ...prev].slice(0, 12));
      }
    ).subscribe();

    return () => {
      void supabase.removeChannel(agentChannel);
      void supabase.removeChannel(taskChannel);
      void supabase.removeChannel(logChannel);
    };
  }, []);

  const executeSystemCommand = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!command.trim()) return;

    setIsLoading(true);
    setStatusMessage('Hermes is routing your directive...');

    try {
      const response = await fetch('/api/hermes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: command }),
      });

      const result = await response.json();
      if (result.success) {
        setStatusMessage(`Task queued for ${result.agent_name || 'Hermes'}`);
        setCommand('');
      } else {
        setStatusMessage(result.error || 'Routing failed');
      }
    } catch (error) {
      console.error(error);
      setStatusMessage('Network error while contacting Hermes');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMicToggle = () => {
    if (typeof window === 'undefined') return;
    const SpeechRecognitionCtor = (window as Window & typeof globalThis & { webkitSpeechRecognition?: any; SpeechRecognition?: any }).SpeechRecognition
      || (window as Window & typeof globalThis & { webkitSpeechRecognition?: any; SpeechRecognition?: any }).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setStatusMessage('Voice input is not supported in this browser');
      return;
    }

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0]?.transcript || '')
          .join(' ')
          .trim();
        if (transcript) {
          setCommand((prev) => (prev ? `${prev} ${transcript}` : transcript));
          setStatusMessage(`Captured: ${transcript}`);
        }
        setIsListening(false);
      };
      recognition.onerror = () => {
        setIsListening(false);
        setStatusMessage('Voice capture interrupted');
      };
      recognition.onend = () => setIsListening(false);
      recognitionRef.current = recognition;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      setStatusMessage('Voice input paused');
      return;
    }

    recognitionRef.current.start();
    setIsListening(true);
    setStatusMessage('Listening for commands');
  };

  const handleBriefMe = async () => {
    setIsLoading(true);
    setStatusMessage('Generating briefing...');

    try {
      const response = await fetch('/api/report');
      const result = await response.json();
      if (typeof window !== 'undefined') {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(result.summary || 'No summary yet');
        utterance.rate = 1;
        utterance.pitch = 1;
        window.speechSynthesis.speak(utterance);
      }
      setStatusMessage('Briefing delivered');
    } catch (error) {
      console.error(error);
      setStatusMessage('Briefing failed');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement | null;
      const isTypingTarget = Boolean(activeElement && ['INPUT', 'TEXTAREA'].includes(activeElement.tagName));

      if (event.code === 'Space' && !event.repeat && !isTypingTarget) {
        event.preventDefault();
        handleMicToggle();
      }

      if (event.key === 'Enter' && !event.shiftKey && !isTypingTarget) {
        event.preventDefault();
        void executeSystemCommand();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [command, isListening, isLoading]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#020617] text-zinc-100 font-mono">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.16),transparent_18%),radial-gradient(circle_at_16%_20%,_rgba(16,185,129,0.14),transparent_18%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_45%),linear-gradient(90deg,rgba(125,211,252,0.05),transparent_20%)]" />
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-24 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-cyan-500/5 blur-3xl animate-[pulse_10s_linear_infinite]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-cyan-400/20 via-transparent to-emerald-400/20" />
        <div className="absolute left-[18%] top-[42%] h-px w-[28%] bg-cyan-500/10" />
        <div className="absolute right-[18%] top-[36%] h-px w-[26%] bg-emerald-500/12" />
      </div>
      <div className="mx-auto relative z-10 flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="relative overflow-hidden rounded-[32px] border border-cyan-500/10 bg-[#071121]/85 p-6 shadow-[0_0_80px_rgba(16,185,129,0.16)] backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,_rgba(16,185,129,0.08),transparent_32%)]" />
          <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-gradient-to-b from-cyan-400/30 to-transparent" />
          <div className="relative grid gap-8 lg:grid-cols-[0.9fr_0.45fr]">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-950/20 px-3 py-1 text-[10px] uppercase tracking-[0.35em] text-cyan-300">
                <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
                Hermes · Nous Research inspired agent OS
              </div>
              <h1 className="max-w-4xl text-5xl font-black uppercase tracking-[0.28em] text-zinc-100 sm:text-6xl">HERMES AI AGENT</h1>
              <p className="max-w-3xl text-base leading-8 text-zinc-400">
                A cinematic control surface for routing intent, delegating work, and observing decisions in real time.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-3xl border border-cyan-500/20 bg-cyan-950/20 p-4 text-sm text-zinc-200 shadow-[0_0_24px_rgba(16,185,129,0.08)]">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-cyan-300">Agents active</p>
                  <p className="mt-2 text-2xl font-semibold text-zinc-100">{agents.length}</p>
                </div>
                <div className="rounded-3xl border border-emerald-500/20 bg-emerald-950/15 p-4 text-sm text-zinc-200 shadow-[0_0_24px_rgba(16,185,129,0.06)]">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-emerald-300">Live tasks</p>
                  <p className="mt-2 text-2xl font-semibold text-zinc-100">{tasks.length}</p>
                </div>
                <div className="rounded-3xl border border-fuchsia-500/10 bg-fuchsia-950/10 p-4 text-sm text-zinc-200 shadow-[0_0_24px_rgba(192,132,252,0.06)]">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-fuchsia-300">Decision feed</p>
                  <p className="mt-2 text-2xl font-semibold text-zinc-100">{logs.length}</p>
                </div>
              </div>
            </div>
            <div className="relative isolate overflow-hidden rounded-[32px] border border-cyan-500/20 bg-[#04121f]/80 p-5 shadow-[0_0_40px_rgba(8,145,178,0.18)]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,_rgba(34,211,238,0.18),transparent_40%),radial-gradient(circle_at_70%_70%,_rgba(16,185,129,0.18),transparent_30%)]" />
              <div className="relative flex min-h-[360px] flex-col items-center justify-center gap-5 text-center">
                <div className="absolute inset-0 opacity-75 mix-blend-screen">
                  <div className="absolute left-0 top-1/4 h-px w-[70%] bg-cyan-400/10" />
                  <div className="absolute right-0 top-2/3 h-px w-[55%] bg-emerald-400/10" />
                </div>
                <div className="relative flex items-center justify-center">
                  <div className="absolute h-44 w-44 rounded-full bg-cyan-500/10 blur-3xl" />
                  <div className="absolute h-56 w-56 rounded-full border border-cyan-400/10" />
                  <div className="relative z-10 flex h-32 w-32 items-center justify-center rounded-full border border-cyan-300/40 bg-cyan-400/10 shadow-[0_0_40px_rgba(34,211,238,0.18)]">
                    <div className={`h-16 w-16 rounded-full border border-cyan-300/40 bg-cyan-400/20 ${livePulseClass}`} />
                  </div>
                </div>
                <div className="space-y-2 text-left text-sm text-zinc-300">
                  <p className="uppercase tracking-[0.3em] text-cyan-300">Core status</p>
                  <p className="text-lg font-semibold text-zinc-100">Hermes is ready to intake directives and orchestrate the fleet.</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[24px] border border-zinc-800 bg-zinc-950/80 p-5 shadow-[0_0_35px_rgba(6,182,212,0.08)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-cyan-400">Command Orb</p>
                <h2 className="text-lg font-semibold text-zinc-100">Direct Hermes</h2>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleMicToggle}
                  className={`rounded-full border px-3 py-2 text-[10px] uppercase tracking-[0.25em] transition ${isListening ? 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.2)]' : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-cyan-500/30'}`}
                >
                  {isListening ? 'Listening' : 'Push to talk'}
                </button>
                <button
                  type="button"
                  onClick={handleBriefMe}
                  className="rounded-full border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 text-[10px] uppercase tracking-[0.25em] text-emerald-300 transition hover:shadow-[0_0_18px_rgba(16,185,129,0.16)]"
                >
                  Brief Me
                </button>
              </div>
            </div>
            <form onSubmit={executeSystemCommand} className="space-y-4">
              <textarea
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                disabled={isLoading}
                placeholder="Example: research the latest trends in autonomous agents and break the work into steps..."
                className="min-h-[120px] w-full rounded-xl border border-zinc-800 bg-zinc-900/90 px-4 py-3 text-sm text-zinc-200 outline-none transition focus:border-emerald-500/40 focus:shadow-[0_0_24px_rgba(16,185,129,0.18)]"
              />
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 rounded-xl bg-emerald-500 px-4 py-3 text-xs font-semibold uppercase tracking-[0.25em] text-zinc-950 transition hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.2)] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
                >
                  {isLoading ? 'Routing...' : 'Transmit'}
                </button>
                <button
                  type="button"
                  onClick={() => setCommand('')}
                  className="rounded-xl border border-zinc-700 px-4 py-3 text-xs uppercase tracking-[0.25em] text-zinc-400 transition hover:border-zinc-500"
                >
                  Clear
                </button>
              </div>
            </form>
          </div>

          <div className="rounded-[24px] border border-zinc-800 bg-zinc-950/80 p-5 shadow-[0_0_35px_rgba(16,185,129,0.08)]">
            <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-400">Agent Fleet</p>
            <div className="mt-4 space-y-3">
              {agents.map((agent) => (
                <div key={agent.id} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 transition hover:border-emerald-500/20 hover:shadow-[0_0_18px_rgba(16,185,129,0.08)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-100">{agent.name}</p>
                      <p className="text-xs text-zinc-500">{agent.current_task || 'Awaiting next directive'}</p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] ${AGENT_META[agent.id] || 'border-zinc-700 text-zinc-400'}`}>
                      {agent.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[24px] border border-zinc-800 bg-zinc-950/80 p-5 shadow-[0_0_25px_rgba(6,182,212,0.06)]">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-[0.3em] text-cyan-400">Live Workstream</p>
              <span className="text-[10px] uppercase tracking-[0.25em] text-zinc-600">Realtime</span>
            </div>
            <div className="space-y-3">
              {tasks.map((task) => (
                <div key={task.id} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-zinc-100">{task.description}</p>
                    <span className="rounded-full border border-emerald-500/20 bg-emerald-950/20 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-emerald-400">
                      {task.status}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-zinc-500">{new Date(task.created_at).toLocaleTimeString()}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[24px] border border-zinc-800 bg-zinc-950/80 p-5 shadow-[0_0_25px_rgba(16,185,129,0.06)]">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-400">Decision Stream</p>
              <span className="text-[10px] uppercase tracking-[0.25em] text-zinc-600">Live</span>
            </div>
            <div className="space-y-2 rounded-xl border border-zinc-800 bg-black/70 p-3 font-mono text-sm text-zinc-300 shadow-[inset_0_0_24px_rgba(16,185,129,0.06)]">
              {logs.map((log) => (
                <div key={log.id} className="flex gap-2">
                  <span className="text-emerald-500">$</span>
                  <span className="text-zinc-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  <span className="text-cyan-400">[{log.level}]</span>
                  <span className="break-all">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}