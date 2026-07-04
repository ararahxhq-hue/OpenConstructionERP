// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Case: "Coordinate models and resolve clashes".
//
// Combine the discipline models, run the clash test, then drive the real
// conflicts to closure by raising them where site can act on them. Content
// strings are key plus inline English default and live only here.

import type { Playbook } from '../types';

const playbook: Playbook = {
  id: 'coordinate-models-and-clashes',
  order: 95,
  category: 'bim',
  icon: 'Combine',
  titleKey: 'cases.coordinate_models_and_clashes.title',
  titleDefault: 'Coordinate models and resolve clashes',
  descKey: 'cases.coordinate_models_and_clashes.desc',
  descDefault:
    'Combine the discipline models, run the clash test, filter out the noise and drive the real conflicts to closure where site can act.',
  estMinutes: 13,
  steps: [
    {
      id: 'federate',
      icon: 'Layers',
      titleKey: 'cases.coordinate_models_and_clashes.step.federate.title',
      titleDefault: 'Federate the models',
      whatKey: 'cases.coordinate_models_and_clashes.step.federate.what',
      whatDefault:
        'Combine the architectural, structural and MEP models into one federation and confirm they share the same origin and levels.',
      whyKey: 'cases.coordinate_models_and_clashes.step.federate.why',
      whyDefault:
        'Clashes only mean something when the models line up. A shared origin is what stops a whole building reading as one giant clash.',
      moduleLabel: 'Federations',
      moduleLabelKey: 'nav.federations',
      to: '/bim/federations',
    },
    {
      id: 'clash',
      icon: 'Crosshair',
      titleKey: 'cases.coordinate_models_and_clashes.step.clash.title',
      titleDefault: 'Run and triage the clash test',
      whatKey: 'cases.coordinate_models_and_clashes.step.clash.what',
      whatDefault:
        'Run the clash test between disciplines, group the results and filter out tolerances and duplicates so only the real hits remain.',
      whyKey: 'cases.coordinate_models_and_clashes.step.clash.why',
      whyDefault:
        'A raw clash list is thousands of hits nobody reads. Triage is what turns it into the short list that actually needs a decision.',
      moduleLabel: 'Clash detection',
      moduleLabelKey: 'nav.clash',
      to: '/clash',
    },
    {
      id: 'resolve',
      icon: 'AlertTriangle',
      titleKey: 'cases.coordinate_models_and_clashes.step.resolve.title',
      titleDefault: 'Drive the conflicts to closure',
      whatKey: 'cases.coordinate_models_and_clashes.step.resolve.what',
      whatDefault:
        'Raise the surviving conflicts as trackable issues, assign the owning discipline and follow each one until the model is corrected.',
      whyKey: 'cases.coordinate_models_and_clashes.step.resolve.why',
      whyDefault:
        'A clash found in the model costs an hour to fix. The same clash found on site costs a rework order and a delay.',
      moduleLabel: 'Non-conformance',
      moduleLabelKey: 'nav.ncr',
      to: '/projects/:projectId/ncr',
    },
  ],
};

export default playbook;
