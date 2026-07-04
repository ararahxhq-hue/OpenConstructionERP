// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Case: "Set contingency from cost risk".
//
// Turn a single-point estimate into a range: run a Monte Carlo over the risky
// items, read the P50 to P90 spread and set a contingency you can defend.
// Content strings are key plus inline English default and live only here.

import type { Playbook } from '../types';

const playbook: Playbook = {
  id: 'cost-risk-and-contingency',
  order: 80,
  category: 'estimating',
  icon: 'Dice5',
  titleKey: 'cases.cost_risk_and_contingency.title',
  titleDefault: 'Set contingency from cost risk',
  descKey: 'cases.cost_risk_and_contingency.desc',
  descDefault:
    'Turn a single-point estimate into a range, run a Monte Carlo over the risky lines, read the spread and set a contingency you can defend.',
  estMinutes: 11,
  steps: [
    {
      id: 'baseline',
      icon: 'ListChecks',
      titleKey: 'cases.cost_risk_and_contingency.step.baseline.title',
      titleDefault: 'Fix the base estimate',
      whatKey: 'cases.cost_risk_and_contingency.step.baseline.what',
      whatDefault:
        'Confirm the BOQ is complete and priced, then flag the lines that are genuinely uncertain in quantity or rate.',
      whyKey: 'cases.cost_risk_and_contingency.step.baseline.why',
      whyDefault:
        'Risk analysis on a broken estimate just launders the error. A clean base is what makes the range mean something.',
      moduleLabel: 'BOQ',
      moduleLabelKey: 'nav.boq',
      to: '/boq',
    },
    {
      id: 'simulate',
      icon: 'Dice5',
      titleKey: 'cases.cost_risk_and_contingency.step.simulate.title',
      titleDefault: 'Run the Monte Carlo',
      whatKey: 'cases.cost_risk_and_contingency.step.simulate.what',
      whatDefault:
        'Give the uncertain lines a low, likely and high value, set any correlations and run the simulation to get a cost distribution.',
      whyKey: 'cases.cost_risk_and_contingency.step.simulate.why',
      whyDefault:
        'One number hides the risk. A P50 to P90 curve tells you how much cover you need to hit a confidence level you can stand behind.',
      moduleLabel: 'Cost risk',
      moduleLabelKey: 'nav.risks',
      to: '/risks?tab=montecarlo',
    },
    {
      id: 'report',
      icon: 'FileBarChart',
      titleKey: 'cases.cost_risk_and_contingency.step.report.title',
      titleDefault: 'Set contingency and report it',
      whatKey: 'cases.cost_risk_and_contingency.step.report.what',
      whatDefault:
        'Pick the confidence level, read the contingency it implies from the S-curve and export the tornado of the biggest drivers.',
      whyKey: 'cases.cost_risk_and_contingency.step.report.why',
      whyDefault:
        'A contingency backed by a distribution survives a challenge. Showing the top drivers tells the client exactly what the money is covering.',
      moduleLabel: 'Reports',
      moduleLabelKey: 'nav.reports',
      to: '/reports',
    },
  ],
};

export default playbook;
