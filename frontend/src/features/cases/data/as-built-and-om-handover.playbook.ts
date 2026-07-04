// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Case: "As-built and O and M handover".
//
// Gather the as-built record, confirm the quality file is complete, then issue
// the operation and maintenance package the operator will actually use.
// Content strings are key plus inline English default and live only here.

import type { Playbook } from '../types';

const playbook: Playbook = {
  id: 'as-built-and-om-handover',
  order: 115,
  category: 'handover',
  icon: 'BookOpen',
  titleKey: 'cases.as_built_and_om_handover.title',
  titleDefault: 'As-built and O and M handover',
  descKey: 'cases.as_built_and_om_handover.desc',
  descDefault:
    'Gather the as-built record, confirm the quality file is complete, then issue the operation and maintenance package the operator will use.',
  estMinutes: 12,
  steps: [
    {
      id: 'asbuilt',
      icon: 'FolderOpen',
      titleKey: 'cases.as_built_and_om_handover.step.asbuilt.title',
      titleDefault: 'Gather the as-built record',
      whatKey: 'cases.as_built_and_om_handover.step.asbuilt.what',
      whatDefault:
        'Collect the as-built drawings, product data, warranties and manuals into the project files, structured so each system is findable.',
      whyKey: 'cases.as_built_and_om_handover.step.asbuilt.why',
      whyDefault:
        'The operator runs the building from this record for decades. As-built means what was actually installed, not what was once drawn.',
      moduleLabel: 'Files',
      moduleLabelKey: 'nav.documents',
      to: '/projects/:projectId/files',
    },
    {
      id: 'quality',
      icon: 'FileCheck',
      titleKey: 'cases.as_built_and_om_handover.step.quality.title',
      titleDefault: 'Confirm the quality file',
      whatKey: 'cases.as_built_and_om_handover.step.quality.what',
      whatDefault:
        'Check the quality records, test certificates and commissioning results are complete and that no non-conformance is left open.',
      whyKey: 'cases.as_built_and_om_handover.step.quality.why',
      whyDefault:
        'The quality file is the proof the building is fit to occupy. A gap here is the one an insurer or the client finds later.',
      moduleLabel: 'Quality management',
      moduleLabelKey: 'nav.qms',
      to: '/projects/:projectId/qms',
    },
    {
      id: 'issue',
      icon: 'ShieldCheck',
      titleKey: 'cases.as_built_and_om_handover.step.issue.title',
      titleDefault: 'Issue the O and M package',
      whatKey: 'cases.as_built_and_om_handover.step.issue.what',
      whatDefault:
        'Assemble the close-out package, confirm the handover gates are met and issue the signed O and M set to the operator.',
      whyKey: 'cases.as_built_and_om_handover.step.issue.why',
      whyDefault:
        'A clean issue discharges the obligation and starts the defects period cleanly. It is also the last impression the client keeps.',
      moduleLabel: 'Close-out',
      moduleLabelKey: 'nav.closeout',
      to: '/closeout',
    },
  ],
};

export default playbook;
