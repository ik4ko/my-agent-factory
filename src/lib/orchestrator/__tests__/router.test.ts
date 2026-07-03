import { routeTask, NEAR_CAP_RATIO, LANE_MODEL } from '@/lib/orchestrator/router';
import { MODELS, FABLE_SHARE_CAP, MIN_FABLE_PAYLOAD_TOKENS } from '@/lib/agents/model-router';
import { buildSystemPrompt } from '@/lib/orchestrator/prompts';
import type { SpendSnapshot } from '@/lib/telemetry/token-ledger';

const snap = (fable: number, other: number): SpendSnapshot => ({
  byModel: { [MODELS.FABLE]: fable, [MODELS.HAIKU]: other },
  totalTokens: fable + other,
  windowHours: 24,
});
const CALM = snap(0, 100);
const BIG = 'critical architecture migration plan. ' + 'x'.repeat(MIN_FABLE_PAYLOAD_TOKENS * 4);

describe('routeTask — lane heuristics', () => {
  it('SEAT: fast validations, even when framed as critical', () => {
    const d = routeTask({ description: 'critical: validate the heartbeat of agent 7' }, CALM);
    expect(d.lane).toBe('SEAT');
    expect(d.model).toBe(MODELS.HAIKU);
    expect(d.requiresApproval).toBe(false);
  });

  it('SEAT: near-cap forces everything non-trivial to the speed lane', () => {
    // fable = 19% of total, cap 20% → 95% of cap ≥ NEAR_CAP_RATIO(90%)
    const d = routeTask({ description: BIG }, snap(19, 81));
    expect(d.lane).toBe('SEAT');
    expect(d.reason).toContain('forced speed lane');
  });

  it('DOWN: high-ambiguity/creative payloads', () => {
    const d = routeTask({ description: 'parse this messy unstructured scraped dataset' }, CALM);
    expect(d.lane).toBe('DOWN');
    expect(d.model).toBe(MODELS.OPUS);
  });

  it('DOWN: high-stakes but under the 2k-token floor', () => {
    const d = routeTask({ description: 'critical schema migration' }, CALM);
    expect(d.lane).toBe('DOWN');
    expect(d.requiresApproval).toBe(false);
  });

  it('UP staged: massive structural planning requires human approval', () => {
    const d = routeTask({ description: BIG }, CALM);
    expect(d.lane).toBe('UP');
    expect(d.model).toBe(MODELS.FABLE);
    expect(d.requiresApproval).toBe(true);
    expect(d.reason).toContain('staged for approval');
  });

  it('codeContext counts toward the token estimate', () => {
    const d = routeTask(
      { description: 'critical architecture refactor', codeContext: 'y'.repeat(MIN_FABLE_PAYLOAD_TOKENS * 4) },
      CALM
    );
    expect(d.lane).toBe('UP');
  });

  it('SEAT: routine default', () => {
    const d = routeTask({ description: 'summarize this changelog' }, CALM);
    expect(d.lane).toBe('SEAT');
  });

  it('capHeadroom reflects remaining budget', () => {
    const d = routeTask({ description: 'summarize' }, snap(10, 90)); // share .1 / cap .2
    expect(d.capHeadroom).toBeCloseTo(0.5, 5);
    expect(NEAR_CAP_RATIO).toBeLessThan(1);
  });
});

describe('prompt factory wiring', () => {
  it('injects the matching lane × task-type prompt', () => {
    const d = routeTask({ description: BIG, agentType: 'planner' }, CALM);
    expect(d.systemPrompt).toBe(buildSystemPrompt('UP', 'planner'));
    expect(d.systemPrompt).toContain('EXECUTION LANE: UP');
    expect(d.systemPrompt).toContain('Architect');
  });

  it('every lane maps to a distinct model', () => {
    expect(new Set(Object.values(LANE_MODEL)).size).toBe(3);
  });

  it('lane directives are lane-specific', () => {
    expect(buildSystemPrompt('SEAT', 'coder')).toContain('PASS or FAIL');
    expect(buildSystemPrompt('DOWN', 'coder')).toContain('edge cases');
    expect(buildSystemPrompt('UP', 'coder')).toContain('CONSTRAINT_CONFLICT');
  });
});
