// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Pillar 4: Handover / acceptance packages (regime-aware taking-over /
// substantial / practical completion).
//
// Compiling first cut: lists handover packages for the active project. The
// create / assemble (auto-evidence manifest) / gate report / override / issue
// (e-signed certificate) / revoke actions are added by a follow-up agent (see
// TODO(pillar)). The completion gate is clear only when there are no open NCRs
// and no unreleased hold gates, unless a manager overrides it.

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { PackageCheck } from 'lucide-react';
import { listHandoverPackages, type HandoverPackage } from '../api';
import { SectionToolbar, StatusBadge } from './shared';
import { StubList } from './StubList';

const HANDOVER_STATUS_VARIANTS: Record<string, 'neutral' | 'blue' | 'success' | 'warning' | 'error'> = {
  draft: 'neutral',
  assembling: 'blue',
  ready: 'blue',
  issued: 'success',
  revoked: 'error',
};

const GATING_STATE_VARIANTS: Record<string, 'neutral' | 'blue' | 'success' | 'warning' | 'error'> = {
  blocked: 'error',
  clear: 'success',
  overridden: 'warning',
};

const REGIME_LABEL: Record<string, string> = {
  taking_over: 'Taking-over (FIDIC)',
  substantial: 'Substantial completion',
  practical: 'Practical completion',
};

interface SectionProps {
  projectId: string;
}

export function HandoverSection({ projectId }: SectionProps) {
  const { t } = useTranslation();

  const packagesQuery = useQuery({
    queryKey: ['cc', 'handover', projectId],
    queryFn: () => listHandoverPackages(projectId),
    enabled: !!projectId,
  });

  const packages = packagesQuery.data ?? [];

  return (
    <div className="space-y-3">
      <SectionToolbar
        title={t('construction_control.handover_heading', {
          defaultValue: 'Handover packages',
        })}
        count={packages.length}
      />
      {/* TODO(pillar): create package + assemble evidence manifest + completion-gate
          report + override gate (-> documentation NCR) + e-sign issue + revoke -
          fleshed out next. */}
      <StubList<HandoverPackage>
        rows={packages}
        isLoading={packagesQuery.isLoading}
        isError={packagesQuery.isError}
        rowKey={(p) => p.id}
        testIdPrefix="cc-handover"
        emptyIcon={<PackageCheck size={26} strokeWidth={1.5} />}
        emptyTitle={t('construction_control.handover.empty_title', {
          defaultValue: 'No handover packages yet',
        })}
        emptyDescription={t('construction_control.handover.empty_desc', {
          defaultValue:
            'A handover package assembles the acceptance evidence and gates the acceptance certificate behind open NCRs and unreleased hold points.',
        })}
        columns={[
          {
            key: 'number',
            header: t('construction_control.col.number', { defaultValue: 'Number' }),
            className: 'font-mono text-xs text-content-secondary whitespace-nowrap',
            render: (p) => p.package_number,
          },
          {
            key: 'title',
            header: t('construction_control.col.title', { defaultValue: 'Title' }),
            render: (p) => (
              <div>
                <div className="font-medium text-content-primary">{p.title}</div>
                <div className="text-xs text-content-tertiary">
                  {t(`construction_control.regime.${p.completion_regime}`, {
                    defaultValue: REGIME_LABEL[p.completion_regime],
                  })}
                </div>
              </div>
            ),
          },
          {
            key: 'completeness',
            header: t('construction_control.col.completeness', { defaultValue: 'Completeness' }),
            className: 'text-content-secondary whitespace-nowrap',
            render: (p) => `${p.completeness_pct}%`,
          },
          {
            key: 'gate',
            header: t('construction_control.col.gate', { defaultValue: 'Gate' }),
            render: (p) => (
              <div className="flex flex-col gap-1">
                <StatusBadge status={p.gating_state} variants={GATING_STATE_VARIANTS} />
                {(p.open_ncr_count > 0 || p.unreleased_hold_count > 0) && (
                  <span className="text-2xs text-content-tertiary">
                    {t('construction_control.handover.blockers', {
                      defaultValue: '{{ncr}} NCR, {{holds}} holds',
                      ncr: p.open_ncr_count,
                      holds: p.unreleased_hold_count,
                    })}
                  </span>
                )}
              </div>
            ),
          },
          {
            key: 'status',
            header: t('construction_control.col.status', { defaultValue: 'Status' }),
            render: (p) => <StatusBadge status={p.status} variants={HANDOVER_STATUS_VARIANTS} />,
          },
        ]}
      />
    </div>
  );
}

export default HandoverSection;
