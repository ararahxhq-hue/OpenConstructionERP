// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Case: "Change register and impact".
//
// Log every change in one register, read the time and cost impact the platform
// scores against the real ledger, then report the trend to the client.
// Content strings are key plus inline English default and live only here.

import type { Playbook } from '../types';

const playbook: Playbook = {
  id: 'change-register-and-impact',
  order: 120,
  category: 'commercial',
  icon: 'GitCompare',
  titleKey: 'cases.change_register_and_impact.title',
  titleDefault: 'Change register and impact',
  descKey: 'cases.change_register_and_impact.desc',
  descDefault:
    'Log every change in one register, read the time and cost impact scored against the real ledger, then report the trend to the client.',
  estMinutes: 11,
  steps: [
    {
      id: 'register',
      icon: 'ClipboardList',
      titleKey: 'cases.change_register_and_impact.step.register.title',
      titleDefault: 'Log the change',
      whatKey: 'cases.change_register_and_impact.step.register.what',
      whatDefault:
        'Capture each change with its origin, status and value in one register so nothing lives only in an email thread.',
      whyKey: 'cases.change_register_and_impact.step.register.why',
      whyDefault:
        'Unlogged changes are unpaid changes. A single register is what turns scattered instructions into a claimable, trackable list.',
      moduleLabel: 'Change orders',
      moduleLabelKey: 'nav.change_orders',
      to: '/change-orders',
    },
    {
      id: 'impact',
      icon: 'LineChart',
      titleKey: 'cases.change_register_and_impact.step.impact.title',
      titleDefault: 'Read the impact',
      whatKey: 'cases.change_register_and_impact.step.impact.what',
      whatDefault:
        'Read the time and cost impact scored against the project ledger, the Pareto of the biggest drivers and the run rate of new changes.',
      whyKey: 'cases.change_register_and_impact.step.impact.why',
      whyDefault:
        'A pile of small changes hides a big one. Scoring the impact against real data is what surfaces the drift before it becomes an overrun.',
      moduleLabel: 'Change intelligence',
      moduleLabelKey: 'nav.change_intelligence',
      to: '/change-intelligence',
    },
    {
      id: 'report',
      icon: 'FileBarChart',
      titleKey: 'cases.change_register_and_impact.step.report.title',
      titleDefault: 'Report the trend',
      whatKey: 'cases.change_register_and_impact.step.report.what',
      whatDefault:
        'Produce the change report with the cumulative value, the open versus agreed split and the effect on the forecast final account.',
      whyKey: 'cases.change_register_and_impact.step.report.why',
      whyDefault:
        'A client accepts a change trend they saw coming, not one sprung at the end. Reporting it early is what keeps the final account calm.',
      moduleLabel: 'Reports',
      moduleLabelKey: 'nav.reports',
      to: '/reports',
    },
  ],
};

export default playbook;
