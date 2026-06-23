// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Pillar 2: Material records (EN 10204 digital passport) + ISO/IEC 17025 lab
// test results.
//
// This is a compiling first cut: it lists material records and lab tests for
// the active project. The create / review / record-result forms are added by a
// follow-up agent (see the TODO(pillar) markers); the data wiring, types and
// list rendering follow the AcceptanceInspectionsSection reference.

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Boxes, FlaskConical } from 'lucide-react';
import { Badge } from '@/shared/ui';
import {
  listMaterials,
  listTestResults,
  type MaterialRecord,
  type TestResult,
} from '../api';
import { SectionToolbar, StatusBadge } from './shared';
import { StubList } from './StubList';

const MATERIAL_STATUS_VARIANTS: Record<string, 'neutral' | 'blue' | 'success' | 'warning' | 'error'> = {
  draft: 'neutral',
  submitted: 'blue',
  under_review: 'blue',
  accepted: 'success',
  rejected: 'error',
  expired: 'warning',
  superseded: 'neutral',
};

const TEST_STATUS_VARIANTS: Record<string, 'neutral' | 'blue' | 'success' | 'warning' | 'error'> = {
  draft: 'neutral',
  recorded: 'success',
  void: 'neutral',
};

interface SectionProps {
  projectId: string;
}

export function MaterialsLabsSection({ projectId }: SectionProps) {
  const { t } = useTranslation();

  const materialsQuery = useQuery({
    queryKey: ['cc', 'materials', projectId],
    queryFn: () => listMaterials(projectId),
    enabled: !!projectId,
  });
  const testsQuery = useQuery({
    queryKey: ['cc', 'test-results', projectId],
    queryFn: () => listTestResults(projectId),
    enabled: !!projectId,
  });

  const materials = materialsQuery.data ?? [];
  const tests = testsQuery.data ?? [];

  return (
    <div className="space-y-8">
      {/* ── Material records ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionToolbar
          title={t('construction_control.materials_heading', {
            defaultValue: 'Material records',
          })}
          count={materials.length}
        />
        {/* TODO(pillar): create material + submit-for-review + record conformity
            decision (accept / reject / conditional -> auto-NCR) - fleshed out next. */}
        <StubList<MaterialRecord>
          rows={materials}
          isLoading={materialsQuery.isLoading}
          isError={materialsQuery.isError}
          rowKey={(m) => m.id}
          testIdPrefix="cc-material"
          emptyIcon={<Boxes size={26} strokeWidth={1.5} />}
          emptyTitle={t('construction_control.material.empty_title', {
            defaultValue: 'No material records yet',
          })}
          emptyDescription={t('construction_control.material.empty_desc', {
            defaultValue:
              'Material records carry the EN 10204 conformity certificate, CE / UKCA marking and batch / heat / lot traceability.',
          })}
          columns={[
            {
              key: 'number',
              header: t('construction_control.col.number', { defaultValue: 'Number' }),
              className: 'font-mono text-xs text-content-secondary whitespace-nowrap',
              render: (m) => m.record_number,
            },
            {
              key: 'name',
              header: t('construction_control.col.material', { defaultValue: 'Material' }),
              render: (m) => (
                <div>
                  <div className="font-medium text-content-primary">{m.name}</div>
                  {m.spec_grade && (
                    <div className="text-xs text-content-tertiary">{m.spec_grade}</div>
                  )}
                </div>
              ),
            },
            {
              key: 'cert',
              header: t('construction_control.col.certificate', { defaultValue: 'Certificate' }),
              className: 'text-content-secondary',
              render: (m) =>
                m.cert_type ? (
                  <span>
                    {m.cert_type}
                    {m.cert_number ? ` ${m.cert_number}` : ''}
                  </span>
                ) : (
                  <span className="text-content-tertiary">-</span>
                ),
            },
            {
              key: 'status',
              header: t('construction_control.col.status', { defaultValue: 'Status' }),
              render: (m) => (
                <div className="flex items-center gap-1.5">
                  <StatusBadge status={m.status} variants={MATERIAL_STATUS_VARIANTS} />
                  {m.is_expired && (
                    <Badge variant="warning" size="sm">
                      {t('construction_control.material.expired', { defaultValue: 'Expired' })}
                    </Badge>
                  )}
                </div>
              ),
            },
          ]}
        />
      </section>

      {/* ── Lab test results ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionToolbar
          title={t('construction_control.tests_heading', { defaultValue: 'Lab test results' })}
          count={tests.length}
        />
        {/* TODO(pillar): create test + record-result (pass / fail / conditional ->
            auto-NCR) with ISO/IEC 17025 lab + accreditation fields - fleshed out next. */}
        <StubList<TestResult>
          rows={tests}
          isLoading={testsQuery.isLoading}
          isError={testsQuery.isError}
          rowKey={(x) => x.id}
          testIdPrefix="cc-test"
          emptyIcon={<FlaskConical size={26} strokeWidth={1.5} />}
          emptyTitle={t('construction_control.test.empty_title', {
            defaultValue: 'No lab test results yet',
          })}
          emptyDescription={t('construction_control.test.empty_desc', {
            defaultValue:
              'Lab test results capture the sample, method, laboratory and ISO/IEC 17025 accreditation, and judge the measured value against the criterion.',
          })}
          columns={[
            {
              key: 'number',
              header: t('construction_control.col.number', { defaultValue: 'Number' }),
              className: 'font-mono text-xs text-content-secondary whitespace-nowrap',
              render: (x) => x.result_number,
            },
            {
              key: 'title',
              header: t('construction_control.col.title', { defaultValue: 'Title' }),
              render: (x) => (
                <div>
                  <div className="font-medium text-content-primary">{x.title}</div>
                  {x.lab_name && <div className="text-xs text-content-tertiary">{x.lab_name}</div>}
                </div>
              ),
            },
            {
              key: 'method',
              header: t('construction_control.col.method', { defaultValue: 'Method' }),
              className: 'text-content-secondary',
              render: (x) => x.test_method || <span className="text-content-tertiary">-</span>,
            },
            {
              key: 'status',
              header: t('construction_control.col.status', { defaultValue: 'Status' }),
              render: (x) => (
                <div className="flex items-center gap-1.5">
                  <StatusBadge status={x.status} variants={TEST_STATUS_VARIANTS} />
                  {x.result && (
                    <span className="text-2xs text-content-tertiary">
                      {t(`construction_control.result.${x.result}`, { defaultValue: x.result })}
                    </span>
                  )}
                </div>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}

export default MaterialsLabsSection;
