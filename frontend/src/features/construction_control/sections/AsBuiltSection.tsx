// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Pillar 3: As-built records (verified survey / scan records with metrology
// tolerance, an e-signed legal-record attestation, and import-from-scan).
//
// Compiling first cut: lists as-built records for the active project. The
// create / record-survey / verify / sign-validity / import-from-scan actions
// are added by a follow-up agent (see TODO(pillar)); the FSM is
// draft -> surveyed -> verified -> recorded.

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Ruler, ShieldCheck } from 'lucide-react';
import { listAsBuilt, type AsBuiltRecord } from '../api';
import { ElementLinks, SectionToolbar, StatusBadge } from './shared';
import { StubList } from './StubList';

const ASBUILT_STATUS_VARIANTS: Record<string, 'neutral' | 'blue' | 'success' | 'warning' | 'error'> = {
  draft: 'neutral',
  surveyed: 'blue',
  verified: 'blue',
  recorded: 'success',
  superseded: 'neutral',
  void: 'neutral',
};

const TOLERANCE_VARIANTS: Record<string, 'neutral' | 'blue' | 'success' | 'warning' | 'error'> = {
  within: 'success',
  out_of_tolerance: 'error',
  not_assessed: 'neutral',
};

interface SectionProps {
  projectId: string;
}

export function AsBuiltSection({ projectId }: SectionProps) {
  const { t } = useTranslation();

  const recordsQuery = useQuery({
    queryKey: ['cc', 'asbuilt', projectId],
    queryFn: () => listAsBuilt(projectId),
    enabled: !!projectId,
  });

  const records = recordsQuery.data ?? [];

  return (
    <div className="space-y-3">
      <SectionToolbar
        title={t('construction_control.asbuilt_heading', { defaultValue: 'As-built records' })}
        count={records.length}
      />
      {/* TODO(pillar): create as-built + import-from-scan + record-survey (tolerance
          check) + verify (out-of-tolerance -> auto-NCR) + e-sign legal-record
          attestation - fleshed out next. */}
      <StubList<AsBuiltRecord>
        rows={records}
        isLoading={recordsQuery.isLoading}
        isError={recordsQuery.isError}
        rowKey={(r) => r.id}
        testIdPrefix="cc-asbuilt"
        emptyIcon={<Ruler size={26} strokeWidth={1.5} />}
        emptyTitle={t('construction_control.asbuilt.empty_title', {
          defaultValue: 'No as-built records yet',
        })}
        emptyDescription={t('construction_control.asbuilt.empty_desc', {
          defaultValue:
            'As-built records capture a surveyed or scanned value, judge it against tolerance, and hold a signed legal-record attestation.',
        })}
        columns={[
          {
            key: 'number',
            header: t('construction_control.col.number', { defaultValue: 'Number' }),
            className: 'font-mono text-xs text-content-secondary whitespace-nowrap',
            render: (r) => r.record_number,
          },
          {
            key: 'title',
            header: t('construction_control.col.title', { defaultValue: 'Title' }),
            render: (r) => (
              <div>
                <div className="font-medium text-content-primary">{r.title}</div>
                {r.discipline && <div className="text-xs text-content-tertiary">{r.discipline}</div>}
                <div className="mt-1">
                  <ElementLinks elements={r.elements} />
                </div>
              </div>
            ),
          },
          {
            key: 'capture',
            header: t('construction_control.col.capture', { defaultValue: 'Capture' }),
            className: 'text-content-secondary whitespace-nowrap',
            render: (r) => r.capture_method.replace(/_/g, ' '),
          },
          {
            key: 'tolerance',
            header: t('construction_control.col.tolerance_result', { defaultValue: 'Tolerance' }),
            render: (r) =>
              r.tolerance_result ? (
                <StatusBadge status={r.tolerance_result} variants={TOLERANCE_VARIANTS} />
              ) : (
                <span className="text-content-tertiary">-</span>
              ),
          },
          {
            key: 'status',
            header: t('construction_control.col.status', { defaultValue: 'Status' }),
            render: (r) => (
              <div className="flex items-center gap-1.5">
                <StatusBadge status={r.status} variants={ASBUILT_STATUS_VARIANTS} />
                {r.valid_for_legal_record && (
                  <span
                    className="inline-flex items-center gap-1 text-2xs text-semantic-success"
                    title={t('construction_control.asbuilt.signed', {
                      defaultValue: 'Signed valid for the legal record',
                    })}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                  </span>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

export default AsBuiltSection;
