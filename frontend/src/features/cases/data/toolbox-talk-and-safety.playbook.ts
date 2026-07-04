// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Case: "Toolbox talk and safety check".
//
// Brief the crew on today's hazards, record who attended, then verify on the
// walk that the controls are actually in place. Content strings are key plus
// inline English default and live only here.

import type { Playbook } from '../types';

const playbook: Playbook = {
  id: 'toolbox-talk-and-safety',
  order: 105,
  category: 'quality',
  icon: 'HardHat',
  titleKey: 'cases.toolbox_talk_and_safety.title',
  titleDefault: 'Toolbox talk and safety check',
  descKey: 'cases.toolbox_talk_and_safety.desc',
  descDefault:
    'Brief the crew on today hazards, record who attended, then verify on the walk that the agreed controls are actually in place.',
  estMinutes: 8,
  steps: [
    {
      id: 'brief',
      icon: 'ShieldAlert',
      titleKey: 'cases.toolbox_talk_and_safety.step.brief.title',
      titleDefault: 'Run the toolbox talk',
      whatKey: 'cases.toolbox_talk_and_safety.step.brief.what',
      whatDefault:
        'Cover the hazards for the shift, the method and the controls, and log the attendance so every worker is signed on to the brief.',
      whyKey: 'cases.toolbox_talk_and_safety.step.brief.why',
      whyDefault:
        'A briefed crew makes safer calls in the moment. The attendance record is also what proves the talk happened if it is ever questioned.',
      moduleLabel: 'Safety',
      moduleLabelKey: 'nav.safety',
      to: '/projects/:projectId/safety',
    },
    {
      id: 'verify',
      icon: 'ClipboardCheck',
      titleKey: 'cases.toolbox_talk_and_safety.step.verify.title',
      titleDefault: 'Verify the controls on the walk',
      whatKey: 'cases.toolbox_talk_and_safety.step.verify.what',
      whatDefault:
        'Walk the area against a safety checklist, confirm edge protection, access and permits are right and log anything that fails.',
      whyKey: 'cases.toolbox_talk_and_safety.step.verify.why',
      whyDefault:
        'A talk is words until the walk confirms them. Checking the controls on the ground is what turns a brief into real protection.',
      moduleLabel: 'Inspections',
      moduleLabelKey: 'inspections.title',
      to: '/projects/:projectId/inspections',
    },
  ],
};

export default playbook;
