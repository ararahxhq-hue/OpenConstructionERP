// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Case: "Estimate from a cost database".
//
// Price a job from a real cost database: find the right items, build the BOQ,
// bundle repeat work into assemblies, then validate before you commit a number.
// Content strings are key plus inline English default and live only here.

import type { Playbook } from '../types';

const playbook: Playbook = {
  id: 'estimate-from-cost-database',
  order: 75,
  category: 'estimating',
  icon: 'Database',
  titleKey: 'cases.estimate_from_cost_database.title',
  titleDefault: 'Estimate from a cost database',
  descKey: 'cases.estimate_from_cost_database.desc',
  descDefault:
    'Find priced items in a cost database, build the BOQ from them, bundle repeat work into assemblies and validate before you commit a number.',
  estMinutes: 12,
  steps: [
    {
      id: 'browse',
      icon: 'Database',
      titleKey: 'cases.estimate_from_cost_database.step.browse.title',
      titleDefault: 'Find the right priced items',
      whatKey: 'cases.estimate_from_cost_database.step.browse.what',
      whatDefault:
        'Search the cost database by trade, keyword or code and read what each rate actually includes before you pull it in.',
      whyKey: 'cases.estimate_from_cost_database.step.browse.why',
      whyDefault:
        'A rate is only right if its scope matches your work. Reading the item before you use it stops a labour-only line being priced as full supply and fix.',
      moduleLabel: 'Cost Explorer',
      moduleLabelKey: 'nav.cost_explorer',
      to: '/cost-explorer',
    },
    {
      id: 'build',
      icon: 'ListChecks',
      titleKey: 'cases.estimate_from_cost_database.step.build.title',
      titleDefault: 'Build the BOQ',
      whatKey: 'cases.estimate_from_cost_database.step.build.what',
      whatDefault:
        'Drop the chosen items into the BOQ, set your quantities and let the totals roll up. Group the lines the way you will report them.',
      whyKey: 'cases.estimate_from_cost_database.step.build.why',
      whyDefault:
        'The BOQ is where scope becomes money. Starting from database items means every line already carries a defensible source and unit rate.',
      moduleLabel: 'BOQ',
      moduleLabelKey: 'nav.boq',
      to: '/boq',
    },
    {
      id: 'assemblies',
      icon: 'Boxes',
      titleKey: 'cases.estimate_from_cost_database.step.assemblies.title',
      titleDefault: 'Bundle repeat work into assemblies',
      whatKey: 'cases.estimate_from_cost_database.step.assemblies.what',
      whatDefault:
        'Turn recurring build-ups, like a wall with formwork and rebar, into a single assembly so one quantity drives all its components.',
      whyKey: 'cases.estimate_from_cost_database.step.assemblies.why',
      whyDefault:
        'Assemblies keep repeated pricing consistent and fast. Change the rate once and every BOQ line that uses it updates together.',
      moduleLabel: 'Assemblies',
      moduleLabelKey: 'nav.assemblies',
      to: '/assemblies',
    },
    {
      id: 'validate',
      icon: 'ShieldCheck',
      titleKey: 'cases.estimate_from_cost_database.step.validate.title',
      titleDefault: 'Validate before you commit',
      whatKey: 'cases.estimate_from_cost_database.step.validate.what',
      whatDefault:
        'Run the estimate through the checks for zero prices, missing quantities, duplicates and unit rates that look off against the benchmark.',
      whyKey: 'cases.estimate_from_cost_database.step.validate.why',
      whyDefault:
        'A single missed quantity or stray zero can wreck a tender number. Validation catches the honest mistakes before the client sees them.',
      moduleLabel: 'Validation',
      moduleLabelKey: 'nav.validation',
      to: '/validation',
    },
  ],
};

export default playbook;
