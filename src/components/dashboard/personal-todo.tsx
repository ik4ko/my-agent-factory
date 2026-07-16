'use client';

import { useEffect, useState } from 'react';
import { ListTodo, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

const LS_KEY = 'personal.todos.v1';

function loadTodos(): TodoItem[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TodoItem[]) : [];
  } catch {
    return [];
  }
}

/**
 * Personal to-do list + tracker — browser-local (no backend), doubling as
 * both the checklist and the lightweight personal task tracker for the
 * Personal Room. Uses hydrate-after-mount / write-on-change localStorage so
 * SSR never reads browser-only state.
 */
export function PersonalTodo() {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [value, setValue] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setTodos(loadTodos());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(todos));
    } catch {
      /* storage unavailable — list is session-only */
    }
  }, [todos, hydrated]);

  const add = () => {
    const text = value.trim();
    if (!text) return;
    setTodos((t) => [{ id: crypto.randomUUID(), text, done: false, createdAt: Date.now() }, ...t]);
    setValue('');
  };

  const toggle = (id: string) => {
    setTodos((t) => t.map((item) => (item.id === id ? { ...item, done: !item.done } : item)));
  };

  const remove = (id: string) => {
    setTodos((t) => t.filter((item) => item.id !== id));
  };

  const active = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  return (
    <div className="flex flex-col gap-2.5 rounded-md surface-glass hairline p-3">
      <div className="flex items-center gap-1.5">
        <ListTodo className="size-3.5 text-neon-orange" aria-hidden />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">To-do</span>
        {hydrated && (
          <span className="font-terminal text-[10px] text-muted-foreground/40">
            {active.length} open{done.length > 0 ? ` · ${done.length} done` : ''}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          placeholder="Add a task…"
          suppressHydrationWarning
          className="flex-1 rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-neon-orange/40"
        />
        <button
          type="button"
          onClick={add}
          disabled={!value.trim()}
          aria-label="Add task"
          className="flex shrink-0 items-center justify-center rounded-md border border-neon-orange/40 bg-neon-orange/10 p-1.5 text-neon-orange transition-colors hover:bg-neon-orange/20 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      </div>

      {todos.length === 0 ? (
        <p className="py-2 text-center font-terminal text-[10px] text-muted-foreground/40">
          Nothing tracked yet — add your first task above.
        </p>
      ) : (
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
          {[...active, ...done].map((item) => (
            <div
              key={item.id}
              className={cn(
                'group flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5',
                item.done ? 'bg-surface-1/40' : 'bg-surface-1'
              )}
            >
              <button
                type="button"
                onClick={() => toggle(item.id)}
                aria-pressed={item.done}
                aria-label={item.done ? `Mark "${item.text}" as not done` : `Mark "${item.text}" as done`}
                className={cn(
                  'flex size-3.5 shrink-0 items-center justify-center rounded border transition-colors',
                  item.done ? 'border-neon-green/60 bg-neon-green/20' : 'border-border hover:border-neon-green/40'
                )}
              >
                {item.done && <span className="size-1.5 rounded-sm bg-neon-green" aria-hidden />}
              </button>
              <span
                className={cn(
                  'flex-1 min-w-0 truncate text-xs',
                  item.done ? 'text-muted-foreground/40 line-through' : 'text-foreground/85'
                )}
              >
                {item.text}
              </span>
              <button
                type="button"
                onClick={() => remove(item.id)}
                aria-label={`Delete "${item.text}"`}
                className="shrink-0 rounded p-0.5 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/40 hover:!text-neon-red"
              >
                <Trash2 className="size-3" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
