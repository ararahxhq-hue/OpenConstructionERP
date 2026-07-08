// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Production-Norm Expansion.
 *
 * Manage a library of production-norm coefficients (labor-hours, machine-hours
 * and material quantities per unit of a work item) and expand any work item and
 * quantity into the unpriced resource demand behind a rate - the hours and
 * material takeoff an estimator sees before any pricing is applied.
 *
 * Coefficients and expanded quantities arrive from the API as Decimal-as-string;
 * they are only ever formatted for display (fmtNumber) and never used in JS
 * arithmetic on the wire value.
 */

import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Clock,
  Cog,
  Boxes,
  Coins,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { Button, Card, Badge, EmptyState, RecoveryCard, SkeletonTable } from '@/shared/ui';
import { PageHeader } from '@/shared/ui/PageHeader';
import { getErrorMessage } from '@/shared/lib/api';
import { fmtNumber } from '@/shared/lib/formatters';
import { useToastStore } from '@/stores/useToastStore';
import { laborRatesApi, type LaborRateTemplate } from '@/features/labor-rates/api';
import {
  fetchNorms,
  createNorm,
  deleteNorm,
  addNormMaterial,
  deleteNormMaterial,
  expandWork,
  isValidQuantity,
  buildBuildAssemblyPayload,
  resourceBadge,
  withCurrency,
  type ProductionNorm,
  type ExpansionResult,
  type BuildAssemblyResult,
  type PricedComponent,
  type ResourceKind,
} from './api';
import { useBuildAssembly } from './useBuildAssembly';

const INPUT_CLS =
  'w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm ' +
  'text-content-primary placeholder:text-content-tertiary focus:border-oe-blue focus:outline-none ' +
  'focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900/40';

const NORMS_KEY = ['norm-expansion-norms'];

/* ── Expand panel ──────────────────────────────────────────────────────── */

function ExpandPanel({ norms }: { norms: ProductionNorm[] }) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [workKey, setWorkKey] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [result, setResult] = useState<ExpansionResult | null>(null);

  const selectedNorm = useMemo(
    () => norms.find((n) => n.work_key === workKey),
    [norms, workKey],
  );

  const mutation = useMutation({
    mutationFn: () => expandWork({ work_key: workKey, quantity: quantity.trim() }),
    onSuccess: (data) => setResult(data),
    onError: (err) => {
      setResult(null);
      addToast({
        type: 'error',
        title: t('normExpansion.expand_failed', { defaultValue: 'Could not expand work item' }),
        message: getErrorMessage(err),
      });
    },
  });

  const canExpand = !!selectedNorm && isValidQuantity(quantity);

  return (
    <Card padding="md">
      <h2 className="mb-1 text-sm font-semibold text-content-primary">
        {t('normExpansion.expand_title', { defaultValue: 'Expand a work item' })}
      </h2>
      <p className="mb-3 text-xs text-content-tertiary">
        {t('normExpansion.expand_help', {
          defaultValue:
            'Pick a work item and enter a quantity to see the labor-hours, machine-hours and materials behind it, before any pricing.',
        })}
      </p>

      <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[2fr_1fr_auto]">
        <div>
          <label className="mb-1 block text-xs font-medium text-content-secondary">
            {t('normExpansion.work_item', { defaultValue: 'Work item' })}
          </label>
          <select
            className={INPUT_CLS}
            value={workKey}
            onChange={(e) => {
              setWorkKey(e.target.value);
              setResult(null);
            }}
            aria-label={t('normExpansion.select_work_item', { defaultValue: 'Select a work item' })}
            data-testid="norm-expand-select"
          >
            <option value="">
              {t('normExpansion.choose_work_item', { defaultValue: 'Choose a work item...' })}
            </option>
            {norms.map((n) => (
              <option key={n.id} value={n.work_key}>
                {n.name ? `${n.name} (${n.unit})` : `${n.work_key} (${n.unit})`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-content-secondary">
            {t('normExpansion.quantity', { defaultValue: 'Quantity' })}
            {selectedNorm ? ` (${selectedNorm.unit})` : ''}
          </label>
          <input
            className={INPUT_CLS}
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="1"
            data-testid="norm-expand-quantity"
          />
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={!canExpand || mutation.isPending}
          onClick={() => mutation.mutate()}
          data-testid="norm-expand-run"
        >
          {t('normExpansion.expand_action', { defaultValue: 'Expand' })}
        </Button>
      </div>

      {result && <ExpansionResultView result={result} />}
    </Card>
  );
}

function ResourceTile({
  icon,
  label,
  value,
  unit,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="rounded-lg border border-border-light bg-surface-secondary/40 p-3">
      <div className="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-content-tertiary">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums text-content-primary">
        {fmtNumber(value, 2)}
        <span className="ml-1 text-xs font-normal text-content-tertiary">{unit}</span>
      </div>
    </div>
  );
}

function ExpansionResultView({ result }: { result: ExpansionResult }) {
  const { t } = useTranslation();
  const hoursUnit = t('normExpansion.hours_unit', { defaultValue: 'h' });

  return (
    <div className="mt-4 space-y-3" data-testid="norm-expand-result">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <ResourceTile
          icon={<Clock size={12} className="text-oe-blue" />}
          label={t('normExpansion.labor_hours', { defaultValue: 'Labor hours' })}
          value={result.labor_hours}
          unit={hoursUnit}
        />
        <ResourceTile
          icon={<Cog size={12} className="text-oe-blue" />}
          label={t('normExpansion.machine_hours', { defaultValue: 'Machine hours' })}
          value={result.machine_hours}
          unit={hoursUnit}
        />
        <ResourceTile
          icon={<Boxes size={12} className="text-oe-blue" />}
          label={t('normExpansion.material_lines', { defaultValue: 'Material lines' })}
          value={String(result.materials.length)}
          unit=""
        />
      </div>

      {result.materials.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[360px] text-sm">
            <thead>
              <tr className="border-b border-border-light text-left text-2xs uppercase tracking-wide text-content-tertiary">
                <th className="py-2 pr-3 font-medium">
                  {t('normExpansion.col_material', { defaultValue: 'Material' })}
                </th>
                <th className="py-2 pr-3 text-right font-medium">
                  {t('normExpansion.col_quantity', { defaultValue: 'Quantity' })}
                </th>
                <th className="py-2 pr-3 font-medium">
                  {t('normExpansion.col_unit', { defaultValue: 'Unit' })}
                </th>
              </tr>
            </thead>
            <tbody>
              {result.materials.map((m, idx) => (
                <tr
                  key={`${m.name}-${idx}`}
                  className="border-b border-border-light/60 hover:bg-surface-secondary/40"
                >
                  <td className="py-2 pr-3 text-content-primary">{m.name}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-content-secondary">
                    {fmtNumber(m.qty, 3)}
                  </td>
                  <td className="py-2 pr-3 text-content-tertiary">{m.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Build priced assembly panel ───────────────────────────────────────── */

function BuildAssemblyPanel({ norms }: { norms: ProductionNorm[] }) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [normId, setNormId] = useState('');
  const [laborRateTemplateId, setLaborRateTemplateId] = useState('');
  const [machineRateTemplateId, setMachineRateTemplateId] = useState('');
  const [region, setRegion] = useState('');
  const [applyWaste, setApplyWaste] = useState(true);
  const [result, setResult] = useState<BuildAssemblyResult | null>(null);

  // The equipment rate reuses the labour-rate templates (an all-in hourly
  // rate); we read that list here but never mutate the labour-rates feature.
  const templatesQuery = useQuery({
    queryKey: ['labor-rates', 'templates'],
    queryFn: laborRatesApi.listTemplates,
  });
  const templates: LaborRateTemplate[] = templatesQuery.data ?? [];
  const noTemplates = !templatesQuery.isLoading && templates.length === 0;

  const buildMut = useBuildAssembly();

  const selectedNorm = useMemo(() => norms.find((n) => n.id === normId), [norms, normId]);
  // A labour rate is required to actually price the labour hours, so the run is
  // gated on it (the backend would otherwise leave labour unpriced and flagged).
  const canBuild = !!selectedNorm && laborRateTemplateId !== '' && !buildMut.isPending;

  const templateLabel = (tpl: LaborRateTemplate): string =>
    tpl.all_in_rate ? `${tpl.name} · ${withCurrency(tpl.all_in_rate, tpl.currency)}` : tpl.name;

  const run = () => {
    if (!selectedNorm) return;
    const body = buildBuildAssemblyPayload({
      laborRateTemplateId,
      machineRateTemplateId,
      region,
      applyWaste,
    });
    buildMut.mutate(
      { normId: selectedNorm.id, body },
      {
        onSuccess: (data) => setResult(data),
        onError: (err) => {
          setResult(null);
          addToast({
            type: 'error',
            title: t('normExpansion.build_failed', { defaultValue: 'Could not build assembly' }),
            message: getErrorMessage(err),
          });
        },
      },
    );
  };

  return (
    <Card padding="md">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-content-primary">
        <Coins size={15} className="text-oe-blue" />
        {t('normExpansion.build_title', { defaultValue: 'Build priced assembly' })}
      </h2>
      <p className="mb-3 text-xs text-content-tertiary">
        {t('normExpansion.build_help', {
          defaultValue:
            'Turn a norm into a saved, priced unit rate: labour priced from a labour rate, materials matched to cost items and grossed up for waste. You can then apply the assembly to a BOQ position.',
        })}
      </p>

      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-content-secondary">
              {t('normExpansion.build_norm', { defaultValue: 'Work item' })}
            </label>
            <select
              className={INPUT_CLS}
              value={normId}
              onChange={(e) => {
                setNormId(e.target.value);
                setResult(null);
              }}
              aria-label={t('normExpansion.select_work_item', { defaultValue: 'Select a work item' })}
              data-testid="norm-build-select"
            >
              <option value="">
                {t('normExpansion.choose_work_item', { defaultValue: 'Choose a work item...' })}
              </option>
              {norms.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name ? `${n.name} (${n.unit})` : `${n.work_key} (${n.unit})`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-content-secondary">
              {t('normExpansion.build_labor_rate', { defaultValue: 'Labour rate (required)' })}
            </label>
            <select
              className={INPUT_CLS}
              value={laborRateTemplateId}
              onChange={(e) => setLaborRateTemplateId(e.target.value)}
              aria-label={t('normExpansion.build_labor_rate', {
                defaultValue: 'Labour rate (required)',
              })}
              data-testid="norm-build-labor"
            >
              <option value="">
                {templatesQuery.isLoading
                  ? t('normExpansion.loading', { defaultValue: 'Loading...' })
                  : t('normExpansion.choose_labor_rate', { defaultValue: 'Choose a labour rate...' })}
              </option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {templateLabel(tpl)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-content-secondary">
              {t('normExpansion.build_machine_rate', { defaultValue: 'Machine rate (optional)' })}
            </label>
            <select
              className={INPUT_CLS}
              value={machineRateTemplateId}
              onChange={(e) => setMachineRateTemplateId(e.target.value)}
              aria-label={t('normExpansion.build_machine_rate', {
                defaultValue: 'Machine rate (optional)',
              })}
              data-testid="norm-build-machine"
            >
              <option value="">
                {t('normExpansion.build_machine_none', { defaultValue: 'None' })}
              </option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {templateLabel(tpl)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_auto_auto]">
          <div>
            <label className="mb-1 block text-xs font-medium text-content-secondary">
              {t('normExpansion.build_region', { defaultValue: 'Region (optional)' })}
            </label>
            <input
              className={INPUT_CLS}
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder={t('normExpansion.build_region_ph', { defaultValue: 'e.g. Berlin' })}
              data-testid="norm-build-region"
            />
          </div>
          <label className="flex h-9 cursor-pointer items-center gap-2 text-sm text-content-secondary">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border-light text-oe-blue focus:ring-oe-blue"
              checked={applyWaste}
              onChange={(e) => setApplyWaste(e.target.checked)}
              data-testid="norm-build-waste"
            />
            {t('normExpansion.apply_waste', { defaultValue: 'Apply waste factors' })}
          </label>
          <Button
            variant="primary"
            size="sm"
            disabled={!canBuild}
            onClick={run}
            data-testid="norm-build-run"
          >
            <Coins size={14} className="mr-1 shrink-0" />
            {t('normExpansion.build_action', { defaultValue: 'Build priced assembly' })}
          </Button>
        </div>

        {noTemplates && (
          <p className="text-xs text-content-tertiary">
            {t('normExpansion.build_no_templates', {
              defaultValue: 'No labour-rate templates yet. Create one on the Labour Rates page first.',
            })}{' '}
            <Link to="/labor-rates" className="text-oe-blue-text underline hover:no-underline">
              {t('normExpansion.build_open_labor_rates', { defaultValue: 'Open Labour Rates' })}
            </Link>
          </p>
        )}
      </div>

      {result && <BuildAssemblyResultView result={result} />}
    </Card>
  );
}

function BuildAssemblyResultView({ result }: { result: BuildAssemblyResult }) {
  const { t } = useTranslation();
  const curSuffix = result.currency ? ` (${result.currency})` : '';
  const hasUnpriced = result.unpriced.length > 0;
  const hasUnmatched = result.waste_applied && result.waste_unmatched.length > 0;

  const kindLabel = (kind: ResourceKind): string => {
    switch (kind) {
      case 'labor':
        return t('normExpansion.res_labor', { defaultValue: 'Labour' });
      case 'equipment':
        return t('normExpansion.res_equipment', { defaultValue: 'Equipment' });
      case 'material':
        return t('normExpansion.res_material', { defaultValue: 'Material' });
      default:
        return t('normExpansion.res_other', { defaultValue: 'Other' });
    }
  };

  return (
    <div className="mt-4 space-y-3" data-testid="norm-build-result">
      {/* Headline: saved assembly + built-up unit rate */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-light bg-surface-secondary/40 p-3">
        <div className="min-w-0">
          <div className="text-2xs uppercase tracking-wide text-content-tertiary">
            {t('normExpansion.build_saved', { defaultValue: 'Saved as assembly' })}
          </div>
          <Link
            to={`/assemblies/${result.id}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-oe-blue-text hover:underline"
            data-testid="norm-build-assembly-link"
          >
            {result.code}
            <ArrowRight size={13} className="shrink-0" />
          </Link>
          <div className="text-2xs text-content-tertiary">
            {t('normExpansion.build_apply_hint', {
              defaultValue: 'Open the assembly to apply it to a BOQ position.',
            })}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xs uppercase tracking-wide text-content-tertiary">
            {t('normExpansion.build_unit_rate', { defaultValue: 'Unit rate' })}
          </div>
          <div
            className="text-lg font-bold tabular-nums text-content-primary"
            data-testid="norm-build-total-rate"
          >
            {withCurrency(result.total_rate, result.currency)}
            <span className="ml-1 text-xs font-normal text-content-tertiary">/ {result.unit}</span>
          </div>
        </div>
      </div>

      {/* Flags: unpriced lines and materials with no waste factor */}
      {hasUnpriced && (
        <div className="flex items-start gap-2 rounded-lg border border-semantic-error/30 bg-semantic-error-bg/50 p-2.5 text-xs text-semantic-error">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {t('normExpansion.build_unpriced', {
              defaultValue:
                '{{count}} line(s) could not be priced and need a rate: {{names}}',
              count: result.unpriced.length,
              names: result.unpriced.join(', '),
            })}
          </span>
        </div>
      )}
      {hasUnmatched && (
        <div className="flex items-start gap-2 rounded-lg border border-semantic-warning/30 bg-semantic-warning-bg/50 p-2.5 text-xs text-[#b45309]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {t('normExpansion.build_unmatched', {
              defaultValue:
                'No waste factor for: {{names}}. These materials were priced at their net quantity.',
              names: result.waste_unmatched.join(', '),
            })}
          </span>
        </div>
      )}

      {/* Priced build-up table (one row per component) */}
      {result.components.length === 0 ? (
        <p className="text-xs text-content-tertiary">
          {t('normExpansion.build_no_lines', {
            defaultValue: 'This norm has no labour, machine or material lines to price.',
          })}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border-light text-left text-2xs uppercase tracking-wide text-content-tertiary">
                <th className="py-2 pr-3 font-medium">
                  {t('normExpansion.col_type', { defaultValue: 'Type' })}
                </th>
                <th className="py-2 pr-3 font-medium">
                  {t('normExpansion.col_description', { defaultValue: 'Description' })}
                </th>
                <th className="py-2 pr-3 text-right font-medium">
                  {t('normExpansion.col_net_qty', { defaultValue: 'Net qty' })}
                </th>
                <th className="py-2 pr-3 text-right font-medium">
                  {t('normExpansion.col_waste', { defaultValue: 'Waste %' })}
                </th>
                <th className="py-2 pr-3 text-right font-medium">
                  {t('normExpansion.col_gross_qty', { defaultValue: 'Gross qty' })}
                </th>
                <th className="py-2 pr-3 text-right font-medium">
                  {t('normExpansion.col_unit_cost', { defaultValue: 'Unit cost' })}
                  {curSuffix}
                </th>
                <th className="py-2 pr-3 text-right font-medium">
                  {t('normExpansion.col_line_total', { defaultValue: 'Line total' })}
                  {curSuffix}
                </th>
              </tr>
            </thead>
            <tbody>
              {result.components.map((c, idx) => (
                <BuildRow
                  key={`${c.description}-${idx}`}
                  component={c}
                  wasteApplied={result.waste_applied}
                  kindLabel={kindLabel}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BuildRow({
  component: c,
  wasteApplied,
  kindLabel,
}: {
  component: PricedComponent;
  wasteApplied: boolean;
  kindLabel: (kind: ResourceKind) => string;
}) {
  const { t } = useTranslation();
  const badge = resourceBadge(c.resource_type);
  // Labour / equipment have no net-gross split, so fall back to the coefficient.
  const netCell = c.net_qty ?? c.quantity;
  const isMaterial = badge.kind === 'material';
  const unmatched = wasteApplied && isMaterial && c.waste_matched === false;

  return (
    <tr
      className={`border-b border-border-light/60 hover:bg-surface-secondary/40 ${
        c.priced ? '' : 'bg-semantic-error-bg/40'
      }`}
    >
      <td className="py-2 pr-3">
        <span title={kindLabel(badge.kind)}>
          <Badge variant={badge.variant} size="sm">
            {badge.letter}
          </Badge>
        </span>
      </td>
      <td className="py-2 pr-3 text-content-primary">
        <div className="flex flex-wrap items-center gap-1.5">
          <span>{c.description}</span>
          {!c.priced && (
            <Badge variant="error" size="sm">
              {t('normExpansion.badge_unpriced', { defaultValue: 'Unpriced' })}
            </Badge>
          )}
          {unmatched && (
            <Badge variant="warning" size="sm">
              {t('normExpansion.badge_no_waste', { defaultValue: 'No waste factor' })}
            </Badge>
          )}
        </div>
        {!c.priced && c.unpriced_reason && (
          <div className="text-2xs text-content-tertiary">{c.unpriced_reason}</div>
        )}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums text-content-secondary">
        {netCell}
        <span className="ml-1 text-2xs text-content-tertiary">{c.unit}</span>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums text-content-secondary">
        {c.waste_pct !== null ? `${c.waste_pct}%` : '-'}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums text-content-secondary">
        {c.gross_qty !== null ? (
          <>
            {c.gross_qty}
            <span className="ml-1 text-2xs text-content-tertiary">{c.unit}</span>
          </>
        ) : (
          '-'
        )}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums text-content-secondary">{c.unit_cost}</td>
      <td className="py-2 pr-3 text-right tabular-nums font-medium text-content-primary">
        {c.total}
      </td>
    </tr>
  );
}

/* ── Create-norm form ──────────────────────────────────────────────────── */

const EMPTY_NORM = {
  work_key: '',
  name: '',
  unit: '',
  category: '',
  labor_hours_per_unit: '',
  machine_hours_per_unit: '',
};

function CreateNormForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [form, setForm] = useState({ ...EMPTY_NORM });

  const mutation = useMutation({
    mutationFn: () =>
      createNorm({
        work_key: form.work_key.trim(),
        name: form.name.trim(),
        unit: form.unit.trim(),
        category: form.category.trim() || undefined,
        labor_hours_per_unit: form.labor_hours_per_unit.trim() || '0',
        machine_hours_per_unit: form.machine_hours_per_unit.trim() || '0',
      }),
    onSuccess: () => {
      setForm({ ...EMPTY_NORM });
      onCreated();
      addToast({
        type: 'success',
        title: t('normExpansion.norm_created', { defaultValue: 'Production norm created' }),
      });
    },
    onError: (err) =>
      addToast({
        type: 'error',
        title: t('normExpansion.norm_create_failed', { defaultValue: 'Could not create norm' }),
        message: getErrorMessage(err),
      }),
  });

  const set = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const canCreate = form.work_key.trim() !== '' && form.unit.trim() !== '';

  return (
    <div className="grid grid-cols-2 items-end gap-2 rounded-lg border border-dashed border-border-light p-3 sm:grid-cols-7">
      <input
        className={INPUT_CLS}
        placeholder={t('normExpansion.col_work_key', { defaultValue: 'Work key' })}
        value={form.work_key}
        onChange={(e) => set('work_key', e.target.value)}
      />
      <input
        className={`${INPUT_CLS} sm:col-span-2`}
        placeholder={t('normExpansion.col_name', { defaultValue: 'Name' })}
        value={form.name}
        onChange={(e) => set('name', e.target.value)}
      />
      <input
        className={INPUT_CLS}
        placeholder={t('normExpansion.col_unit', { defaultValue: 'Unit' })}
        value={form.unit}
        onChange={(e) => set('unit', e.target.value)}
      />
      <input
        className={INPUT_CLS}
        inputMode="decimal"
        placeholder={t('normExpansion.col_labor', { defaultValue: 'Labor h/unit' })}
        value={form.labor_hours_per_unit}
        onChange={(e) => set('labor_hours_per_unit', e.target.value)}
      />
      <input
        className={INPUT_CLS}
        inputMode="decimal"
        placeholder={t('normExpansion.col_machine', { defaultValue: 'Machine h/unit' })}
        value={form.machine_hours_per_unit}
        onChange={(e) => set('machine_hours_per_unit', e.target.value)}
      />
      <Button
        variant="secondary"
        size="sm"
        disabled={!canCreate || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        <Plus size={14} className="mr-1 shrink-0" />
        {t('normExpansion.add', { defaultValue: 'Add' })}
      </Button>
    </div>
  );
}

/* ── Material editor (per norm) ────────────────────────────────────────── */

function MaterialEditor({ norm, onChanged }: { norm: ProductionNorm; onChanged: () => void }) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [qty, setQty] = useState('');

  const addMut = useMutation({
    mutationFn: () =>
      addNormMaterial(norm.id, { name: name.trim(), unit: unit.trim(), qty_per_unit: qty.trim() || '0' }),
    onSuccess: () => {
      setName('');
      setUnit('');
      setQty('');
      onChanged();
    },
    onError: (err) =>
      addToast({
        type: 'error',
        title: t('normExpansion.material_add_failed', { defaultValue: 'Could not add material' }),
        message: getErrorMessage(err),
      }),
  });

  const deleteMut = useMutation({
    mutationFn: (materialId: string) => deleteNormMaterial(materialId),
    onSuccess: () => onChanged(),
    onError: (err) =>
      addToast({
        type: 'error',
        title: t('normExpansion.material_delete_failed', { defaultValue: 'Could not delete material' }),
        message: getErrorMessage(err),
      }),
  });

  const canAdd = name.trim() !== '' && unit.trim() !== '';

  return (
    <div className="space-y-2 bg-surface-secondary/30 p-3">
      {norm.materials.length === 0 ? (
        <p className="text-xs text-content-tertiary">
          {t('normExpansion.no_materials', {
            defaultValue: 'No materials yet. Add the materials this work item consumes per unit.',
          })}
        </p>
      ) : (
        <ul className="space-y-1">
          {norm.materials.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between rounded border border-border-light bg-surface-primary px-2 py-1 text-sm"
            >
              <span className="text-content-primary">{m.name}</span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums text-content-secondary">
                  {fmtNumber(m.qty_per_unit, 3)} {m.unit}/{norm.unit}
                </span>
                <button
                  type="button"
                  onClick={() => deleteMut.mutate(m.id)}
                  className="rounded p-1 text-content-tertiary hover:bg-red-50 hover:text-semantic-error dark:hover:bg-red-900/20"
                  aria-label={t('normExpansion.delete_material', { defaultValue: 'Delete material' })}
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4">
        <input
          className={INPUT_CLS}
          placeholder={t('normExpansion.col_material', { defaultValue: 'Material' })}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={INPUT_CLS}
          placeholder={t('normExpansion.col_unit', { defaultValue: 'Unit' })}
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
        <input
          className={INPUT_CLS}
          inputMode="decimal"
          placeholder={t('normExpansion.col_qty_per_unit', { defaultValue: 'Qty/unit' })}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={!canAdd || addMut.isPending}
          onClick={() => addMut.mutate()}
        >
          <Plus size={14} className="mr-1 shrink-0" />
          {t('normExpansion.add_material', { defaultValue: 'Add material' })}
        </Button>
      </div>
    </div>
  );
}

/* ── Norm library ──────────────────────────────────────────────────────── */

function NormLibrary({
  norms,
  onChanged,
}: {
  norms: ProductionNorm[];
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const deleteMut = useMutation({
    mutationFn: (normId: string) => deleteNorm(normId),
    onSuccess: () => {
      onChanged();
      addToast({
        type: 'success',
        title: t('normExpansion.norm_deleted', { defaultValue: 'Production norm deleted' }),
      });
    },
    onError: (err) =>
      addToast({
        type: 'error',
        title: t('normExpansion.norm_delete_failed', { defaultValue: 'Could not delete norm' }),
        message: getErrorMessage(err),
      }),
  });

  if (norms.length === 0) {
    return (
      <EmptyState
        title={t('normExpansion.no_norms', { defaultValue: 'No production norms yet' })}
        description={t('normExpansion.no_norms_desc', {
          defaultValue:
            'Add a work item with its labor-hours, machine-hours and material coefficients per unit to build the library.',
        })}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border-light text-left text-2xs uppercase tracking-wide text-content-tertiary">
            <th className="py-2 pr-3 font-medium" />
            <th className="py-2 pr-3 font-medium">
              {t('normExpansion.col_work_key', { defaultValue: 'Work key' })}
            </th>
            <th className="py-2 pr-3 font-medium">
              {t('normExpansion.col_name', { defaultValue: 'Name' })}
            </th>
            <th className="py-2 pr-3 font-medium">
              {t('normExpansion.col_unit', { defaultValue: 'Unit' })}
            </th>
            <th className="py-2 pr-3 text-right font-medium">
              {t('normExpansion.col_labor', { defaultValue: 'Labor h/unit' })}
            </th>
            <th className="py-2 pr-3 text-right font-medium">
              {t('normExpansion.col_machine', { defaultValue: 'Machine h/unit' })}
            </th>
            <th className="py-2 pr-3 text-right font-medium">
              {t('normExpansion.col_materials', { defaultValue: 'Materials' })}
            </th>
            <th className="py-2 pl-1" />
          </tr>
        </thead>
        <tbody>
          {norms.map((n) => {
            const isOpen = expandedId === n.id;
            return (
              <Fragment key={n.id}>
                <tr className="border-b border-border-light/60 hover:bg-surface-secondary/40">
                  <td className="py-2 pr-1">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isOpen ? null : n.id)}
                      className="rounded p-1 text-content-tertiary hover:bg-surface-secondary"
                      aria-label={t('normExpansion.toggle_materials', {
                        defaultValue: 'Show materials',
                      })}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  </td>
                  <td className="py-2 pr-3 font-medium text-content-primary">{n.work_key}</td>
                  <td className="py-2 pr-3 text-content-secondary">{n.name || '-'}</td>
                  <td className="py-2 pr-3 text-content-tertiary">{n.unit}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-content-secondary">
                    {fmtNumber(n.labor_hours_per_unit, 3)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-content-secondary">
                    {fmtNumber(n.machine_hours_per_unit, 3)}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <Badge variant="neutral">{n.materials.length}</Badge>
                  </td>
                  <td className="py-2 pl-1 text-right">
                    <button
                      type="button"
                      onClick={() => deleteMut.mutate(n.id)}
                      className="rounded p-1 text-content-tertiary hover:bg-red-50 hover:text-semantic-error dark:hover:bg-red-900/20"
                      aria-label={t('normExpansion.delete_norm', { defaultValue: 'Delete norm' })}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={8} className="p-0">
                      <MaterialEditor norm={n} onChanged={onChanged} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────────────────────── */

export function NormExpansionPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const {
    data: norms = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: NORMS_KEY,
    queryFn: () => fetchNorms(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: NORMS_KEY });

  return (
    <div className="space-y-6">
      <PageHeader
        srTitle={t('normExpansion.title', { defaultValue: 'Production-Norm Expansion' })}
        subtitle={t('normExpansion.subtitle', {
          defaultValue:
            'Expand a work item into the labor-hours, machine-hours and material takeoff behind its rate, from a library of production-norm coefficients, before any pricing.',
        })}
        actions={
          <Button variant="primary" size="sm" onClick={() => setShowCreate((v) => !v)}>
            <Plus size={16} className="mr-1.5 shrink-0" />
            {t('normExpansion.new_norm', { defaultValue: 'New norm' })}
          </Button>
        }
      />

      {isLoading ? (
        <SkeletonTable rows={4} columns={5} />
      ) : isError ? (
        <RecoveryCard error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <ExpandPanel norms={norms} />

          <BuildAssemblyPanel norms={norms} />

          <Card padding="md">
            <h2 className="mb-3 text-sm font-semibold text-content-primary">
              {t('normExpansion.library', { defaultValue: 'Norm library' })}
            </h2>
            {showCreate && (
              <div className="mb-3">
                <CreateNormForm
                  onCreated={() => {
                    invalidate();
                    setShowCreate(false);
                  }}
                />
              </div>
            )}
            <NormLibrary norms={norms} onChanged={invalidate} />
          </Card>
        </>
      )}
    </div>
  );
}
