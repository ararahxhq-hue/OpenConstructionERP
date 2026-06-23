// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Pillar 5: Hold / witness / surveillance / review gating.
//
// Compiling first cut: lists gates for the active project. The create / release
// (party-role checked, e-signed) / waive actions and the can-proceed check are
// added by a follow-up agent (see TODO(pillar)). A hold gate blocks progress
// and can only be released by a satisfying party role; witness / surveillance /
// review gates may be waived.

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, Lock, Unlock } from 'lucide-react';
import { listGates, type HoldGate } from '../api';
import { SectionToolbar, StatusBadge } from './shared';
import { StubList } from './StubList';

const GATE_STATUS_VARIANTS: Record<string, 'neutral' | 'blue' | 'success' | 'warning' | 'error'> = {
  pending: 'warning',
  released: 'success',
  waived: 'blue',
  void: 'neutral',
};

const POINT_TYPE_VARIANTS: Record<string, 'neutral' | 'blue' | 'success' | 'warning' | 'error'> = {
  hold: 'error',
  witness: 'blue',
  surveillance: 'neutral',
  review: 'neutral',
};

interface SectionProps {
  projectId: string;
}

export function HoldWitnessSection({ projectId }: SectionProps) {
  const { t } = useTranslation();

  const gatesQuery = useQuery({
    queryKey: ['cc', 'gates', projectId],
    queryFn: () => listGates(projectId),
    enabled: !!projectId,
  });

  const gates = gatesQuery.data ?? [];

  return (
    <div className="space-y-3">
      <SectionToolbar
        title={t('construction_control.gates_heading', {
          defaultValue: 'Hold / witness points',
        })}
        count={gates.length}
      />
      {/* TODO(pillar): create gate + release (asserted party role must satisfy the
          required role, e-signed) + waive (witness / surveillance / review only) +
          can-proceed check - fleshed out next. */}
      <StubList<HoldGate>
        rows={gates}
        isLoading={gatesQuery.isLoading}
        isError={gatesQuery.isError}
        rowKey={(g) => g.id}
        testIdPrefix="cc-gate"
        emptyIcon={<ShieldAlert size={26} strokeWidth={1.5} />}
        emptyTitle={t('construction_control.gate.empty_title', {
          defaultValue: 'No hold or witness points yet',
        })}
        emptyDescription={t('construction_control.gate.empty_desc', {
          defaultValue:
            'Hold points stop progress until an authorised party releases them; witness, surveillance and review points can also be waived.',
        })}
        columns={[
          {
            key: 'number',
            header: t('construction_control.col.number', { defaultValue: 'Number' }),
            className: 'font-mono text-xs text-content-secondary whitespace-nowrap',
            render: (g) => g.gate_number,
          },
          {
            key: 'title',
            header: t('construction_control.col.title', { defaultValue: 'Title' }),
            render: (g) => (
              <div>
                <div className="font-medium text-content-primary">{g.title}</div>
                <div className="mt-0.5 flex items-center gap-1 text-xs text-content-tertiary">
                  {g.blocks_progress ? (
                    <Lock className="h-3 w-3" />
                  ) : (
                    <Unlock className="h-3 w-3" />
                  )}
                  {g.blocks_progress
                    ? t('construction_control.gate.blocks', { defaultValue: 'Blocks progress' })
                    : t('construction_control.gate.advisory', { defaultValue: 'Advisory' })}
                </div>
              </div>
            ),
          },
          {
            key: 'point_type',
            header: t('construction_control.col.point_type', { defaultValue: 'Type' }),
            render: (g) => <StatusBadge status={g.point_type} variants={POINT_TYPE_VARIANTS} />,
          },
          {
            key: 'role',
            header: t('construction_control.col.required_role', { defaultValue: 'Required role' }),
            className: 'uppercase text-xs text-content-secondary',
            render: (g) => g.required_party_role,
          },
          {
            key: 'status',
            header: t('construction_control.col.status', { defaultValue: 'Status' }),
            render: (g) => <StatusBadge status={g.status} variants={GATE_STATUS_VARIANTS} />,
          },
        ]}
      />
    </div>
  );
}

export default HoldWitnessSection;
