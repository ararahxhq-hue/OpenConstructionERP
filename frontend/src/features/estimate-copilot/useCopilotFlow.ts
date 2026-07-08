// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
//
// Estimate Copilot — flow controller.
//
// Thin orchestration over four capabilities the platform already exposes over
// HTTP. This hook owns the React Query mutations and the per-step confirm
// state; the ordering/gating rules live in `steps.ts` (pure, unit tested).
//
// Endpoints chained (referenced by URL only, never by import):
//   1. conceptual  POST /api/v1/rom-estimate/generate/        (rough first-pass number)
//   2. scope       POST /api/v1/boq/boqs/{boqId}/check-scope/ (missing trades / work packages)
//   3. audit       POST /api/v1/validation/run/               (quality rule checks)
//   4. basis       POST /api/v1/basis-of-estimate/generate/   (written basis-of-estimate)
//
// Money fields arrive as Decimal strings on the wire; they are kept as
// `string | number` and only ever formatted (never float-mathed) in the view.

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';

import { apiPost } from '@/shared/lib/api';
import {
  COPILOT_STEPS,
  type CopilotStepDef,
  type CopilotStepId,
  type StepPhase,
  activeStepId as activeStepIdFor,
  canConfirmStep,
  confirmStep as confirmStepCount,
  isComplete as isCompleteFor,
  progressPercent,
  revisitStep,
  stepPhaseById,
} from './steps';

/**
 * Rule sets applied by the quality audit. `boq_quality` is the universal
 * catch-all (zero prices, missing quantities, duplicates, unrealistic rates)
 * and `project_completeness` checks trade coverage. The audit endpoint flags
 * any set it cannot run under `unsupported_rule_sets` rather than failing.
 */
export const DEFAULT_AUDIT_RULE_SETS = ['boq_quality', 'project_completeness'] as const;

// ── Wire shapes (local, minimal) ──────────────────────────────────────────

/** Result of the conceptual first-pass estimate. Money is Decimal-as-string.
 *  Typed defensively because the copilot only consumes a headline summary. */
export interface ConceptualEstimateResult {
  /** Headline rollup. Decimal-as-string on the wire; may be absent. */
  grand_total?: string | number | null;
  currency?: string | null;
  /** Model self-reported confidence in [0, 1], when provided. */
  confidence?: number | null;
  /** One-line plain-words note on how the number was reached. */
  basis?: string | null;
  /** How many rough line items backed the number, when provided. */
  line_count?: number | null;
  model_used?: string | null;
}

/** One missing scope item flagged by the coverage check. */
export interface ScopeMissingItem {
  description: string;
  category: string;
  priority: 'high' | 'medium' | 'low';
  reason: string;
  estimated_rate: number;
  unit: string;
}

/** Response of POST /v1/boq/boqs/{boqId}/check-scope/. */
export interface ScopeCoverageResult {
  completeness_score: number;
  missing_items: ScopeMissingItem[];
  warnings: string[];
  summary: string;
  model_used: string;
  tokens_used: number;
}

/** Response of POST /v1/validation/run/ (only the fields the copilot shows). */
export interface QualityAuditResult {
  report_id: string;
  status: 'passed' | 'warnings' | 'errors' | 'skipped';
  score: number;
  total_rules: number;
  passed_count: number;
  warning_count: number;
  error_count: number;
  info_count: number;
  rule_sets: string[];
  unsupported_rule_sets?: string[];
  duration_ms: number;
}

/** One section of the written basis-of-estimate. */
export interface BasisSection {
  title: string;
  body: string;
}

/** Result of the basis-of-estimate generate endpoint. Typed defensively. */
export interface BasisOfEstimateResult {
  narrative?: string | null;
  sections?: BasisSection[] | null;
  model_used?: string | null;
}

// ── View model ─────────────────────────────────────────────────────────────

/** Per-step view model the page maps over to render the stepper. */
export interface CopilotStepView {
  def: CopilotStepDef;
  phase: StepPhase;
  isRunning: boolean;
  error: Error | null;
  hasResult: boolean;
  /** Active (or a confirmed step being re-opened) and inputs are ready. */
  canRun: boolean;
  /** Active, inputs ready, and a fresh result is present. */
  canConfirm: boolean;
}

/** Everything `EstimateCopilotPage` needs to drive the guided flow. */
export interface CopilotFlow {
  inputsReady: boolean;
  confirmedCount: number;
  activeStepId: CopilotStepId | null;
  isComplete: boolean;
  progress: number;
  steps: CopilotStepView[];
  conceptual: ConceptualEstimateResult | undefined;
  scope: ScopeCoverageResult | undefined;
  audit: QualityAuditResult | undefined;
  basis: BasisOfEstimateResult | undefined;
  run: (id: CopilotStepId) => void;
  confirm: (id: CopilotStepId) => void;
  revisit: (id: CopilotStepId) => void;
  reset: () => void;
}

/** Inputs the flow operates on. Both come from the global project context. */
export interface CopilotFlowInput {
  projectId: string | null;
  boqId: string | null;
}

/**
 * The slice of a React Query mutation the flow actually drives. Declared
 * structurally so each strongly-typed `useMutation` result assigns to it
 * without a cast.
 */
interface StepMutation {
  mutate: () => void;
  reset: () => void;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
}

/**
 * Build the guided estimate-copilot flow.
 *
 * @param input The active project and BOQ to run the flow against.
 * @returns A {@link CopilotFlow} the page renders and drives.
 */
export function useCopilotFlow({ projectId, boqId }: CopilotFlowInput): CopilotFlow {
  const { i18n } = useTranslation();
  const [confirmedCount, setConfirmedCount] = useState(0);

  const inputsReady = Boolean(projectId && boqId);

  // Step 1 — conceptual first-pass number.
  const conceptualM = useMutation<ConceptualEstimateResult, Error, void>({
    mutationFn: () =>
      apiPost<ConceptualEstimateResult>(
        '/v1/rom-estimate/generate/',
        { project_id: projectId, boq_id: boqId },
        { longRunning: true },
      ),
  });

  // Step 2 — scope coverage.
  const scopeM = useMutation<ScopeCoverageResult, Error, void>({
    mutationFn: () =>
      apiPost<ScopeCoverageResult>(
        `/v1/boq/boqs/${encodeURIComponent(boqId ?? '')}/check-scope/`,
        { locale: i18n.language },
        { longRunning: true },
      ),
  });

  // Step 3 — quality audit.
  const auditM = useMutation<QualityAuditResult, Error, void>({
    mutationFn: () =>
      apiPost<QualityAuditResult>('/v1/validation/run/', {
        project_id: projectId,
        boq_id: boqId,
        rule_sets: [...DEFAULT_AUDIT_RULE_SETS],
      }),
  });

  // Step 4 — basis of estimate.
  const basisM = useMutation<BasisOfEstimateResult, Error, void>({
    mutationFn: () =>
      apiPost<BasisOfEstimateResult>(
        '/v1/basis-of-estimate/generate/',
        { project_id: projectId, boq_id: boqId },
        { longRunning: true },
      ),
  });

  const mutations = useMemo(
    (): Record<CopilotStepId, StepMutation> => ({
      conceptual: conceptualM,
      scope: scopeM,
      audit: auditM,
      basis: basisM,
    }),
    [conceptualM, scopeM, auditM, basisM],
  );

  /** Reset every step's result at or after `fromIndex` (stale after a rollback). */
  const resetFrom = useCallback(
    (fromIndex: number) => {
      COPILOT_STEPS.forEach((s, i) => {
        if (i >= fromIndex) mutations[s.id].reset();
      });
    },
    [mutations],
  );

  const run = useCallback(
    (id: CopilotStepId) => {
      if (!inputsReady) return;
      if (!canConfirmStep(id, confirmedCount)) return; // only the active step runs
      mutations[id].mutate();
    },
    [inputsReady, confirmedCount, mutations],
  );

  const confirm = useCallback(
    (id: CopilotStepId) => {
      if (!canConfirmStep(id, confirmedCount)) return;
      if (!mutations[id].isSuccess) return; // must have a fresh result to confirm
      setConfirmedCount((c) => confirmStepCount(c));
    },
    [confirmedCount, mutations],
  );

  const revisit = useCallback(
    (id: CopilotStepId) => {
      const next = revisitStep(id, confirmedCount);
      if (next === confirmedCount) return;
      setConfirmedCount(next);
      resetFrom(next);
    },
    [confirmedCount, resetFrom],
  );

  const reset = useCallback(() => {
    setConfirmedCount(0);
    resetFrom(0);
  }, [resetFrom]);

  const steps = useMemo<CopilotStepView[]>(
    () =>
      COPILOT_STEPS.map((def) => {
        const m = mutations[def.id];
        const phase = stepPhaseById(def.id, confirmedCount);
        const isActive = canConfirmStep(def.id, confirmedCount);
        const hasResult = m.isSuccess;
        return {
          def,
          phase,
          isRunning: m.isPending,
          error: m.error ?? null,
          hasResult,
          canRun: isActive && inputsReady && !m.isPending,
          canConfirm: isActive && inputsReady && hasResult,
        };
      }),
    [mutations, confirmedCount, inputsReady],
  );

  return {
    inputsReady,
    confirmedCount,
    activeStepId: activeStepIdFor(confirmedCount),
    isComplete: isCompleteFor(confirmedCount),
    progress: progressPercent(confirmedCount),
    steps,
    conceptual: conceptualM.data,
    scope: scopeM.data,
    audit: auditM.data,
    basis: basisM.data,
    run,
    confirm,
    revisit,
    reset,
  };
}
