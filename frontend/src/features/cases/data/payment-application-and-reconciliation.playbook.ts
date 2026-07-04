// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Case: "Payment application and reconciliation".
//
// Value the work done this period against the contract, raise the payment
// application and reconcile what was certified against what was paid. Content
// strings are key plus inline English default and live only here.

import type { Playbook } from '../types';

const playbook: Playbook = {
  id: 'payment-application-and-reconciliation',
  order: 110,
  category: 'commercial',
  icon: 'Receipt',
  titleKey: 'cases.payment_application_and_reconciliation.title',
  titleDefault: 'Payment application and reconciliation',
  descKey: 'cases.payment_application_and_reconciliation.desc',
  descDefault:
    'Value the work done this period against the contract, raise the payment application and reconcile what was certified against what was paid.',
  estMinutes: 12,
  steps: [
    {
      id: 'contract',
      icon: 'FileSignature',
      titleKey: 'cases.payment_application_and_reconciliation.step.contract.title',
      titleDefault: 'Confirm the contract position',
      whatKey: 'cases.payment_application_and_reconciliation.step.contract.what',
      whatDefault:
        'Check the contract value, agreed variations and retention terms so the application is built on the current agreed sum.',
      whyKey: 'cases.payment_application_and_reconciliation.step.contract.why',
      whyDefault:
        'An application off a stale contract sum gets rejected. Starting from the agreed position is what makes it certifiable first time.',
      moduleLabel: 'Contracts',
      moduleLabelKey: 'nav.contracts',
      to: '/projects/:projectId/contracts',
    },
    {
      id: 'apply',
      icon: 'Banknote',
      titleKey: 'cases.payment_application_and_reconciliation.step.apply.title',
      titleDefault: 'Raise the payment application',
      whatKey: 'cases.payment_application_and_reconciliation.step.apply.what',
      whatDefault:
        'Value the work done this period, add materials on site and approved variations, deduct retention and previous payments and issue it.',
      whyKey: 'cases.payment_application_and_reconciliation.step.apply.why',
      whyDefault:
        'Cash flow is what keeps a job alive. A clear, evidenced application is what gets the certificate signed on time.',
      moduleLabel: 'Finance',
      moduleLabelKey: 'nav.finance',
      to: '/projects/:projectId/finance',
    },
    {
      id: 'reconcile',
      icon: 'Scale',
      titleKey: 'cases.payment_application_and_reconciliation.step.reconcile.title',
      titleDefault: 'Reconcile certified against paid',
      whatKey: 'cases.payment_application_and_reconciliation.step.reconcile.what',
      whatDefault:
        'Match what you applied for against what was certified and paid, and chase any shortfall or wrongly withheld amount.',
      whyKey: 'cases.payment_application_and_reconciliation.step.reconcile.why',
      whyDefault:
        'Money quietly lost to under-certification never comes back on its own. Reconciling each cycle is what recovers it while it is fresh.',
      moduleLabel: 'Reconciliation',
      moduleLabelKey: 'nav.reconciliation',
      to: '/projects/:projectId/reconciliation',
    },
  ],
};

export default playbook;
