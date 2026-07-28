import {
  ROOMS,
  contentAgentIdsFromTasks,
  resolveTaskRoomScope,
  taskChannelSlug,
  taskInChannel,
  taskInScope,
} from '@/lib/rooms/scope';
import type { Task } from '@/lib/types/database.types';

const task = (over: Partial<Task> = {}): Task => ({
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  agent_id: null,
  description: 'do a thing',
  status: 'pending',
  created_at: '2026-07-25T00:00:00Z',
  ...over,
});

describe('content room scoping (real assigned_lane column)', () => {
  it('registers the room in ROOMS', () => {
    const room = ROOMS.find((r) => r.scope === 'content');
    expect(room).toBeDefined();
    expect(room?.href).toBe('/dashboard/rooms/youtube');
  });

  it('reads the channel slug straight off assigned_lane', () => {
    expect(taskChannelSlug(task({ assigned_lane: 'faceless' }))).toBe('faceless');
    expect(taskChannelSlug(task({ assigned_lane: '  medicare  ' }))).toBe('medicare');
  });

  it('returns null when no lane is set', () => {
    expect(taskChannelSlug(task())).toBeNull();
    expect(taskChannelSlug(task({ assigned_lane: null }))).toBeNull();
    expect(taskChannelSlug(task({ assigned_lane: '' }))).toBeNull();
  });

  it('does NOT mistake an orchestrator routing lane for a channel', () => {
    // The route-lane hook writes SEAT/UP/DOWN into the same column; those
    // tasks must never surface in the content room.
    for (const lane of ['SEAT', 'UP', 'DOWN', 'seat', 'Down']) {
      expect(taskChannelSlug(task({ assigned_lane: lane }))).toBeNull();
      expect(taskInScope(task({ assigned_lane: lane }), 'content')).toBe(false);
    }
  });

  it('scopes by the column, not by the description wording', () => {
    // No content keyword anywhere in the description — the lane alone decides.
    const t = task({ description: 'zzz', assigned_lane: 'faceless' });
    expect(taskInScope(t, 'content')).toBe(true);
    // And a content-sounding description with no lane is NOT in the room.
    expect(taskInScope(task({ description: '[SCRIPT 1/5] hook' }), 'content')).toBe(false);
  });

  it('narrows to a single channel', () => {
    const t = task({ assigned_lane: 'faceless' });
    expect(taskInChannel(t, 'faceless')).toBe(true);
    expect(taskInChannel(t, 'medicare')).toBe(false);
  });

  it('wins over the description regexes in resolveTaskRoomScope', () => {
    // A content script about markets is still content — the real column beats
    // TRADING_TASK_PATTERN, which this description would otherwise match.
    const t = task({ description: 'stock market etf explainer', assigned_lane: 'faceless' });
    expect(resolveTaskRoomScope(t)).toBe('content');
    // Without the lane it falls back to the regex rooms as before.
    expect(resolveTaskRoomScope(task({ description: 'stock market etf explainer' }))).toBe('trading');
  });

  it('earns agent membership from lane history', () => {
    const ids = contentAgentIdsFromTasks([
      task({ agent_id: 'agent-1', assigned_lane: 'faceless' }),
      task({ agent_id: 'agent-2', assigned_lane: 'SEAT' }),
      task({ agent_id: 'agent-3' }),
    ]);
    expect([...ids]).toEqual(['agent-1']);
  });
});
