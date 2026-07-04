// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Case: "Earned value and forecast".
//
// Measure where the project really is against plan and budget: update the
// programme, read the EVM indices and forecast the outturn cost and date.
// Content strings are key plus inline English default and live only here.

import type { Playbook } from '../types';

const playbook: Playbook = {
  id: 'earned-value-and-forecast',
  order: 90,
  category: 'planning',
  icon: 'TrendingUp',
  titleKey: 'cases.earned_value_and_forecast.title',
  titleDefault: 'Earned value and forecast',
  descKey: 'cases.earned_value_and_forecast.desc',
  descDefault:
    'Measure where the project really is against plan and budget, update the programme, read the EVM indices and forecast the outturn.',
  estMinutes: 13,
  steps: [
    {
      id: 'update',
      icon: 'CalendarClock',
      titleKey: 'cases.earned_value_and_forecast.step.update.title',
      titleDefault: 'Update the programme',
      whatKey: 'cases.earned_value_and_forecast.step.update.what',
      whatDefault:
        'Bring progress up to the data date, set the percent complete on each activity and confirm the actual costs to date are in.',
      whyKey: 'cases.earned_value_and_forecast.step.update.why',
      whyDefault:
        'Earned value is only as honest as the update behind it. A clean data date is what lets the indices be trusted.',
      moduleLabel: 'Schedule',
      moduleLabelKey: 'schedule.title',
      to: '/schedule',
    },
    {
      id: 'measure',
      icon: 'LineChart',
      titleKey: 'cases.earned_value_and_forecast.step.measure.title',
      titleDefault: 'Read the earned value',
      whatKey: 'cases.earned_value_and_forecast.step.measure.what',
      whatDefault:
        'Read the cost and schedule performance indices, the variances and the value earned against the value planned for this period.',
      whyKey: 'cases.earned_value_and_forecast.step.measure.why',
      whyDefault:
        'CPI and SPI turn a gut feel into a measured trend. Below one on either means the gap is widening, not just present.',
      moduleLabel: 'Value',
      moduleLabelKey: 'nav.value',
      to: '/projects/:projectId/value',
    },
    {
      id: 'forecast',
      icon: 'FileBarChart',
      titleKey: 'cases.earned_value_and_forecast.step.forecast.title',
      titleDefault: 'Forecast the outturn',
      whatKey: 'cases.earned_value_and_forecast.step.forecast.what',
      whatDefault:
        'Project the estimate at completion and the likely finish date from the current trend and report it against the budget and baseline.',
      whyKey: 'cases.earned_value_and_forecast.step.forecast.why',
      whyDefault:
        'A forecast at completion warns you months out. Acting on a projected overrun beats explaining the actual one.',
      moduleLabel: 'Reports',
      moduleLabelKey: 'nav.reports',
      to: '/reports',
    },
  ],
};

export default playbook;
