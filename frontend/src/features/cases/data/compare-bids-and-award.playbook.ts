// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Case: "Compare bids and award".
//
// Open a tender, level the returned bids on a like-for-like basis, spot the
// gaps and outliers, then produce the award recommendation. Content strings
// are key plus inline English default and live only here.

import type { Playbook } from '../types';

const playbook: Playbook = {
  id: 'compare-bids-and-award',
  order: 85,
  category: 'tendering',
  icon: 'Gavel',
  titleKey: 'cases.compare_bids_and_award.title',
  titleDefault: 'Compare bids and award',
  descKey: 'cases.compare_bids_and_award.desc',
  descDefault:
    'Open the tender, level the returned bids like for like, spot the gaps and outliers, then produce a defensible award recommendation.',
  estMinutes: 12,
  steps: [
    {
      id: 'open',
      icon: 'FileSignature',
      titleKey: 'cases.compare_bids_and_award.step.open.title',
      titleDefault: 'Open the tender package',
      whatKey: 'cases.compare_bids_and_award.step.open.what',
      whatDefault:
        'Confirm the tender scope, the bidder list and the return deadline, and check every invited party has the same priced schedule.',
      whyKey: 'cases.compare_bids_and_award.step.open.why',
      whyDefault:
        'A fair comparison starts from an identical ask. If bidders priced different scopes, the cheapest number is meaningless.',
      moduleLabel: 'Tendering',
      moduleLabelKey: 'nav.tendering',
      to: '/tendering',
    },
    {
      id: 'level',
      icon: 'Scale',
      titleKey: 'cases.compare_bids_and_award.step.level.title',
      titleDefault: 'Level the bids',
      whatKey: 'cases.compare_bids_and_award.step.level.what',
      whatDefault:
        'Line the returns up side by side, normalise qualifications and exclusions and flag the outliers and the coverage gaps.',
      whyKey: 'cases.compare_bids_and_award.step.level.why',
      whyDefault:
        'The headline price rarely wins on merit alone. Levelling exposes the bidder who left out scope to look cheap.',
      moduleLabel: 'Bid management',
      moduleLabelKey: 'nav.bid_management',
      to: '/bid-management',
    },
    {
      id: 'award',
      icon: 'Trophy',
      titleKey: 'cases.compare_bids_and_award.step.award.title',
      titleDefault: 'Recommend the award',
      whatKey: 'cases.compare_bids_and_award.step.award.what',
      whatDefault:
        'Produce the comparison report with the price spread, coverage and your recommended bidder and the reasons behind the choice.',
      whyKey: 'cases.compare_bids_and_award.step.award.why',
      whyDefault:
        'An award is a decision someone will question later. A written recommendation with the numbers behind it is what makes it stick.',
      moduleLabel: 'Reports',
      moduleLabelKey: 'nav.reports',
      to: '/reports',
    },
  ],
};

export default playbook;
