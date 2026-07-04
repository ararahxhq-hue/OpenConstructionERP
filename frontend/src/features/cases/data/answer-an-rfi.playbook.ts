// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Case: "Answer an RFI".
//
// Turn a site question into a tracked request, chase the answer through the
// right party and file the response so it becomes the record. Content strings
// are key plus inline English default and live only here.

import type { Playbook } from '../types';

const playbook: Playbook = {
  id: 'answer-an-rfi',
  order: 100,
  category: 'site',
  icon: 'MessageSquare',
  titleKey: 'cases.answer_an_rfi.title',
  titleDefault: 'Answer an RFI',
  descKey: 'cases.answer_an_rfi.desc',
  descDefault:
    'Turn a site question into a tracked request, chase the answer through the right party and file the response so it becomes the record.',
  estMinutes: 9,
  steps: [
    {
      id: 'raise',
      icon: 'HelpCircle',
      titleKey: 'cases.answer_an_rfi.step.raise.title',
      titleDefault: 'Raise the request',
      whatKey: 'cases.answer_an_rfi.step.raise.what',
      whatDefault:
        'Log the RFI with a clear question, the affected location and drawing, and a needed-by date driven by the programme.',
      whyKey: 'cases.answer_an_rfi.step.raise.why',
      whyDefault:
        'A vague question gets a slow answer. A precise RFI with a date attached is what lets a late reply be pinned to a delay.',
      moduleLabel: 'RFIs',
      moduleLabelKey: 'nav.rfi',
      to: '/projects/:projectId/rfi',
    },
    {
      id: 'chase',
      icon: 'Send',
      titleKey: 'cases.answer_an_rfi.step.chase.title',
      titleDefault: 'Route and chase it',
      whatKey: 'cases.answer_an_rfi.step.chase.what',
      whatDefault:
        'Send it to the party who owns the answer and track the correspondence so the open item and its due date stay visible.',
      whyKey: 'cases.answer_an_rfi.step.chase.why',
      whyDefault:
        'RFIs go quiet in inboxes. Routing and chasing in one thread is what keeps the answer moving and the trail intact.',
      moduleLabel: 'Correspondence',
      moduleLabelKey: 'nav.correspondence',
      to: '/projects/:projectId/correspondence',
    },
    {
      id: 'file',
      icon: 'FolderOpen',
      titleKey: 'cases.answer_an_rfi.step.file.title',
      titleDefault: 'File the answer',
      whatKey: 'cases.answer_an_rfi.step.file.what',
      whatDefault:
        'Attach the response and any revised drawing to the project files and close the RFI so the record is complete.',
      whyKey: 'cases.answer_an_rfi.step.file.why',
      whyDefault:
        'The answer only helps if the crew can find it. A filed, closed RFI is what stops the same question being asked twice.',
      moduleLabel: 'Files',
      moduleLabelKey: 'nav.documents',
      to: '/projects/:projectId/files',
    },
  ],
};

export default playbook;
