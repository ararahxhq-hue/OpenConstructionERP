import { describe, it, expect } from 'vitest';
import {
  COPILOT_STEPS,
  COPILOT_STEP_COUNT,
  indexOfStep,
  stepAt,
  clampConfirmedCount,
  activeStepIndex,
  activeStepId,
  stepPhase,
  stepPhaseById,
  canConfirm,
  canConfirmStep,
  confirmStep,
  revisitStep,
  isComplete,
  progressPercent,
  type CopilotStepId,
} from './steps';

describe('COPILOT_STEPS shape', () => {
  it('has exactly four ordered steps in the intended sequence', () => {
    expect(COPILOT_STEP_COUNT).toBe(4);
    expect(COPILOT_STEPS.map((s) => s.id)).toEqual([
      'conceptual',
      'scope',
      'audit',
      'basis',
    ]);
  });

  it('numbers each step order to match its array index', () => {
    COPILOT_STEPS.forEach((s, i) => expect(s.order).toBe(i));
  });

  it('gives every step a non-empty title, description and cta label', () => {
    for (const s of COPILOT_STEPS) {
      expect(s.titleKey).toMatch(/^copilot\./);
      expect(s.titleFallback.length).toBeGreaterThan(0);
      expect(s.descFallback.length).toBeGreaterThan(0);
      expect(s.ctaFallback.length).toBeGreaterThan(0);
    }
  });

  it('has unique ids and unique i18n keys', () => {
    const ids = COPILOT_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = COPILOT_STEPS.map((s) => s.titleKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('indexOfStep / stepAt', () => {
  it('maps each id to its position', () => {
    expect(indexOfStep('conceptual')).toBe(0);
    expect(indexOfStep('scope')).toBe(1);
    expect(indexOfStep('audit')).toBe(2);
    expect(indexOfStep('basis')).toBe(3);
  });

  it('round-trips index -> step -> index', () => {
    for (let i = 0; i < COPILOT_STEP_COUNT; i++) {
      const step = stepAt(i);
      expect(step).not.toBeNull();
      expect(indexOfStep(step!.id)).toBe(i);
    }
  });

  it('returns null for out-of-range or non-integer indices', () => {
    expect(stepAt(-1)).toBeNull();
    expect(stepAt(COPILOT_STEP_COUNT)).toBeNull();
    expect(stepAt(1.5)).toBeNull();
  });
});

describe('clampConfirmedCount', () => {
  it('keeps in-range values', () => {
    expect(clampConfirmedCount(0)).toBe(0);
    expect(clampConfirmedCount(2)).toBe(2);
    expect(clampConfirmedCount(COPILOT_STEP_COUNT)).toBe(COPILOT_STEP_COUNT);
  });

  it('clamps below zero and above the total', () => {
    expect(clampConfirmedCount(-3)).toBe(0);
    expect(clampConfirmedCount(99)).toBe(COPILOT_STEP_COUNT);
  });

  it('floors fractional input and defends against non-finite values', () => {
    expect(clampConfirmedCount(2.9)).toBe(2);
    expect(clampConfirmedCount(Number.NaN)).toBe(0);
    expect(clampConfirmedCount(Number.POSITIVE_INFINITY)).toBe(COPILOT_STEP_COUNT);
  });
});

describe('active step derivation', () => {
  it('starts on the first step with nothing confirmed', () => {
    expect(activeStepIndex(0)).toBe(0);
    expect(activeStepId(0)).toBe('conceptual');
  });

  it('advances the active step as confirmations accrue', () => {
    expect(activeStepId(1)).toBe('scope');
    expect(activeStepId(2)).toBe('audit');
    expect(activeStepId(3)).toBe('basis');
  });

  it('reports no active step once every step is confirmed', () => {
    expect(activeStepIndex(COPILOT_STEP_COUNT)).toBe(-1);
    expect(activeStepId(COPILOT_STEP_COUNT)).toBeNull();
  });
});

describe('stepPhase', () => {
  it('splits steps into confirmed / active / locked around the confirmed count', () => {
    // Two steps confirmed: [confirmed, confirmed, active, locked]
    expect(stepPhase(0, 2)).toBe('confirmed');
    expect(stepPhase(1, 2)).toBe('confirmed');
    expect(stepPhase(2, 2)).toBe('active');
    expect(stepPhase(3, 2)).toBe('locked');
  });

  it('locks everything after the active step at the start', () => {
    expect(stepPhase(0, 0)).toBe('active');
    expect(stepPhase(1, 0)).toBe('locked');
    expect(stepPhase(2, 0)).toBe('locked');
    expect(stepPhase(3, 0)).toBe('locked');
  });

  it('marks all steps confirmed when complete', () => {
    for (let i = 0; i < COPILOT_STEP_COUNT; i++) {
      expect(stepPhase(i, COPILOT_STEP_COUNT)).toBe('confirmed');
    }
  });

  it('resolves phase by id consistently with the index form', () => {
    const ids: CopilotStepId[] = ['conceptual', 'scope', 'audit', 'basis'];
    ids.forEach((id, i) => {
      expect(stepPhaseById(id, 2)).toBe(stepPhase(i, 2));
    });
  });
});

describe('confirm gating', () => {
  it('only allows confirming the single active step', () => {
    // confirmedCount = 1 -> active is index 1 (scope)
    expect(canConfirm(0, 1)).toBe(false); // already confirmed
    expect(canConfirm(1, 1)).toBe(true); // active
    expect(canConfirm(2, 1)).toBe(false); // locked
    expect(canConfirm(3, 1)).toBe(false); // locked
  });

  it('exposes the same gate by step id', () => {
    expect(canConfirmStep('conceptual', 0)).toBe(true);
    expect(canConfirmStep('scope', 0)).toBe(false);
  });

  it('allows no confirmation once complete', () => {
    for (let i = 0; i < COPILOT_STEP_COUNT; i++) {
      expect(canConfirm(i, COPILOT_STEP_COUNT)).toBe(false);
    }
  });
});

describe('confirmStep progression', () => {
  it('advances one step at a time through the whole flow', () => {
    let c = 0;
    expect(activeStepId(c)).toBe('conceptual');
    c = confirmStep(c);
    expect(c).toBe(1);
    expect(activeStepId(c)).toBe('scope');
    c = confirmStep(c);
    expect(activeStepId(c)).toBe('audit');
    c = confirmStep(c);
    expect(activeStepId(c)).toBe('basis');
    c = confirmStep(c);
    expect(isComplete(c)).toBe(true);
    expect(activeStepId(c)).toBeNull();
  });

  it('never advances past completion', () => {
    expect(confirmStep(COPILOT_STEP_COUNT)).toBe(COPILOT_STEP_COUNT);
  });
});

describe('revisitStep', () => {
  it('rolls the flow back to an earlier confirmed step for a redo', () => {
    // All four confirmed, user reopens the scope step (index 1).
    expect(revisitStep('scope', COPILOT_STEP_COUNT)).toBe(1);
    // Reopening the very first step resets to the start.
    expect(revisitStep('conceptual', COPILOT_STEP_COUNT)).toBe(0);
  });

  it('is a no-op for the active or a locked step', () => {
    // confirmedCount = 1: scope is active, audit/basis are locked.
    expect(revisitStep('scope', 1)).toBe(1);
    expect(revisitStep('audit', 1)).toBe(1);
    expect(revisitStep('basis', 1)).toBe(1);
  });

  it('leaves an unknown id untouched', () => {
    expect(revisitStep('nope' as CopilotStepId, 2)).toBe(2);
  });
});

describe('isComplete / progressPercent', () => {
  it('reports completion only at the final count', () => {
    expect(isComplete(0)).toBe(false);
    expect(isComplete(3)).toBe(false);
    expect(isComplete(4)).toBe(true);
    expect(isComplete(10)).toBe(true);
  });

  it('reports progress in even quarters', () => {
    expect(progressPercent(0)).toBe(0);
    expect(progressPercent(1)).toBe(25);
    expect(progressPercent(2)).toBe(50);
    expect(progressPercent(3)).toBe(75);
    expect(progressPercent(4)).toBe(100);
  });

  it('clamps progress for out-of-range counts', () => {
    expect(progressPercent(-1)).toBe(0);
    expect(progressPercent(99)).toBe(100);
  });
});
