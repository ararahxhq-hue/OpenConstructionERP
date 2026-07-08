// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
//
// Estimate Copilot — public surface of the guided draft-my-estimate flow.

export { EstimateCopilotPage } from './EstimateCopilotPage';
export {
  useCopilotFlow,
  DEFAULT_AUDIT_RULE_SETS,
  type CopilotFlow,
  type CopilotFlowInput,
  type CopilotStepView,
  type ConceptualEstimateResult,
  type ScopeCoverageResult,
  type QualityAuditResult,
  type BasisOfEstimateResult,
} from './useCopilotFlow';
export {
  COPILOT_STEPS,
  COPILOT_STEP_COUNT,
  type CopilotStepId,
  type CopilotStepDef,
  type StepPhase,
} from './steps';
