import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Plus, Trash2, Save, Users, Calculator, ArrowDownToLine } from 'lucide-react';

import { Button } from '@/shared/ui';
import { formatCurrency } from '@/shared/lib/money';
import { useToastStore } from '@/stores/useToastStore';
import { getErrorMessage } from '@/shared/lib/api';
import {
  laborRatesApi,
  buildComputeRequest,
  newOnCost,
  newCrewMember,
  type OnCostKind,
  type OnCostRowInput,
  type CrewRowInput,
  type LaborRateTemplate,
} from './api';

/** Debounce any value so the live compute does not fire on every keystroke. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const inputClass =
  'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 ' +
  'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ' +
  'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

const cardClass =
  'rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900';

/**
 * All-in labor and crew rate build-up.
 *
 * The estimator enters a base wage and a list of on-costs (statutory charges,
 * insurance, leave, overtime, supervision, small tools); the backend computes
 * a fully loaded hourly rate live. A crew composer blends several trades into a
 * composite crew rate. Every displayed figure is the authoritative Decimal the
 * backend returns - the page never does money arithmetic itself.
 */
export function LaborRatesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [baseWage, setBaseWage] = useState('30');
  const [currency, setCurrency] = useState('');
  // Seed a fresh build-up with common on-cost labels (editable by the user).
  const [onCosts, setOnCosts] = useState<OnCostRowInput[]>(() => [
    newOnCost(t('laborRates.seed.statutory', { defaultValue: 'Statutory charges' }), 'percentage'),
    newOnCost(t('laborRates.seed.insurance', { defaultValue: 'Insurance' }), 'percentage'),
    newOnCost(t('laborRates.seed.leave', { defaultValue: 'Leave & holiday provision' }), 'percentage'),
    newOnCost(t('laborRates.seed.overtime', { defaultValue: 'Overtime uplift' }), 'percentage'),
    newOnCost(t('laborRates.seed.supervision', { defaultValue: 'Supervision' }), 'percentage'),
    newOnCost(t('laborRates.seed.small_tools', { defaultValue: 'Small tools & consumables' }), 'fixed'),
  ]);
  const [crew, setCrew] = useState<CrewRowInput[]>(() => [newCrewMember()]);
  const [templateName, setTemplateName] = useState('');

  // ── Live build-up (authoritative, from the backend) ───────────────────────
  const request = useMemo(
    () => buildComputeRequest({ base_wage: baseWage, currency, onCosts, crew }),
    [baseWage, currency, onCosts, crew],
  );
  const debouncedRequest = useDebounced(request, 300);
  const computeQuery = useQuery({
    queryKey: ['labor-rates', 'compute', JSON.stringify(debouncedRequest)],
    queryFn: () => laborRatesApi.compute(debouncedRequest),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const breakdown = computeQuery.data;
  const allInRate = breakdown?.all_in_rate ?? '0';

  // ── Templates ─────────────────────────────────────────────────────────────
  const templatesQuery = useQuery({
    queryKey: ['labor-rates', 'templates'],
    queryFn: laborRatesApi.listTemplates,
  });

  const loadTemplate = (template: LaborRateTemplate) => {
    setBaseWage(template.base_wage ?? '0');
    setCurrency(template.currency ?? '');
    setOnCosts(
      (template.components ?? []).map((c) => newOnCost(c.label, c.kind, c.value)),
    );
    setTemplateName(template.name ?? '');
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      laborRatesApi.createTemplate({
        name: templateName.trim(),
        base_wage: request.base_wage,
        currency: request.currency,
        components: request.components,
      }),
    onSuccess: (created: LaborRateTemplate) => {
      addToast({
        type: 'success',
        title: t('laborRates.saved_title', { defaultValue: 'Template saved' }),
        message: t('laborRates.saved_msg', {
          defaultValue: '"{{name}}" is available to reuse.',
          name: created?.name ?? templateName,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ['labor-rates', 'templates'] });
    },
    onError: (err: unknown) => {
      addToast({
        type: 'error',
        title: t('laborRates.save_failed', { defaultValue: 'Could not save template' }),
        message: getErrorMessage(err),
      });
    },
  });

  // ── On-cost row editing ───────────────────────────────────────────────────
  const updateOnCost = (key: string, patch: Partial<OnCostRowInput>) =>
    setOnCosts((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeOnCost = (key: string) =>
    setOnCosts((rows) => rows.filter((r) => r.key !== key));
  const addOnCost = () => setOnCosts((rows) => [...rows, newOnCost()]);

  // ── Crew row editing ──────────────────────────────────────────────────────
  const updateCrew = (key: string, patch: Partial<CrewRowInput>) =>
    setCrew((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeCrew = (key: string) => setCrew((rows) => rows.filter((r) => r.key !== key));
  const addCrew = () => setCrew((rows) => [...rows, newCrewMember()]);
  const useAllInFor = (key: string) => updateCrew(key, { all_in_rate: allInRate });

  const crewBreakdown = breakdown?.crew ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
          <Calculator size={22} className="text-blue-600 dark:text-blue-400" />
          {t('laborRates.title', { defaultValue: 'Labor & crew rate build-up' })}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('laborRates.subtitle', {
            defaultValue:
              'Build a fully loaded hourly rate from a base wage plus on-costs, then blend trades into a crew rate.',
          })}
        </p>
      </header>

      {/* Template picker */}
      <div className={cardClass}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {t('laborRates.load_template', { defaultValue: 'Load a saved template' })}
            </span>
            <select
              className={inputClass}
              style={{ minWidth: '16rem' }}
              value=""
              onChange={(e) => {
                const found = (templatesQuery.data ?? []).find((tpl) => tpl.id === e.target.value);
                if (found) loadTemplate(found);
              }}
            >
              <option value="">
                {templatesQuery.isLoading
                  ? t('laborRates.loading', { defaultValue: 'Loading…' })
                  : t('laborRates.choose_template', { defaultValue: 'Choose a template…' })}
              </option>
              {(templatesQuery.data ?? []).map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name} · {formatCurrency(tpl.all_in_rate, tpl.currency)}
                </option>
              ))}
            </select>
          </label>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {t('laborRates.template_hint', {
              defaultValue: 'Loading a template fills the wage and on-costs below.',
            })}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Editor column */}
        <div className="space-y-6 lg:col-span-3">
          {/* Base wage + currency */}
          <div className={cardClass}>
            <div className="flex flex-wrap gap-4">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {t('laborRates.base_wage', { defaultValue: 'Base hourly wage' })}
                </span>
                <input
                  className={inputClass}
                  inputMode="decimal"
                  value={baseWage}
                  onChange={(e) => setBaseWage(e.target.value)}
                  placeholder="0.00"
                  aria-label={t('laborRates.base_wage', { defaultValue: 'Base hourly wage' })}
                />
              </label>
              <label className="flex w-28 flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {t('laborRates.currency', { defaultValue: 'Currency' })}
                </span>
                <input
                  className={inputClass}
                  maxLength={3}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  placeholder="EUR"
                  aria-label={t('laborRates.currency', { defaultValue: 'Currency' })}
                />
              </label>
            </div>
          </div>

          {/* On-cost list */}
          <div className={cardClass}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t('laborRates.oncosts', { defaultValue: 'On-costs' })}
              </h2>
              <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={addOnCost}>
                {t('laborRates.add_oncost', { defaultValue: 'Add on-cost' })}
              </Button>
            </div>

            <div className="space-y-2">
              {onCosts.length === 0 && (
                <p className="py-2 text-sm text-gray-400 dark:text-gray-500">
                  {t('laborRates.no_oncosts', {
                    defaultValue: 'No on-costs yet. The base wage is the all-in rate.',
                  })}
                </p>
              )}
              {onCosts.map((row) => (
                <div key={row.key} className="flex items-center gap-2">
                  <input
                    className={`${inputClass} flex-1`}
                    value={row.label}
                    onChange={(e) => updateOnCost(row.key, { label: e.target.value })}
                    placeholder={t('laborRates.oncost_label', { defaultValue: 'Label' })}
                    aria-label={t('laborRates.oncost_label', { defaultValue: 'Label' })}
                  />
                  <select
                    className={`${inputClass} w-32`}
                    value={row.kind}
                    onChange={(e) =>
                      updateOnCost(row.key, { kind: e.target.value as OnCostKind })
                    }
                    aria-label={t('laborRates.oncost_kind', { defaultValue: 'Kind' })}
                  >
                    <option value="percentage">
                      {t('laborRates.kind_percentage', { defaultValue: '% of wage' })}
                    </option>
                    <option value="fixed">
                      {t('laborRates.kind_fixed', { defaultValue: 'Fixed /h' })}
                    </option>
                  </select>
                  <div className="relative w-28">
                    <input
                      className={`${inputClass} pr-6 text-right`}
                      inputMode="decimal"
                      value={row.value}
                      onChange={(e) => updateOnCost(row.key, { value: e.target.value })}
                      placeholder="0"
                      aria-label={t('laborRates.oncost_value', { defaultValue: 'Value' })}
                    />
                    <span className="pointer-events-none absolute right-2 top-1.5 text-xs text-gray-400">
                      {row.kind === 'percentage' ? '%' : currency || '/h'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeOnCost(row.key)}
                    className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800"
                    aria-label={t('laborRates.remove', { defaultValue: 'Remove' })}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Crew composer */}
          <div className={cardClass}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                <Users size={16} className="text-gray-500" />
                {t('laborRates.crew', { defaultValue: 'Crew composer' })}
              </h2>
              <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={addCrew}>
                {t('laborRates.add_trade', { defaultValue: 'Add trade' })}
              </Button>
            </div>

            <div className="space-y-2">
              {crew.map((row) => (
                <div key={row.key} className="flex items-center gap-2">
                  <input
                    className={`${inputClass} flex-1`}
                    value={row.trade}
                    onChange={(e) => updateCrew(row.key, { trade: e.target.value })}
                    placeholder={t('laborRates.trade', { defaultValue: 'Trade' })}
                    aria-label={t('laborRates.trade', { defaultValue: 'Trade' })}
                  />
                  <input
                    className={`${inputClass} w-20 text-right`}
                    type="number"
                    min={0}
                    step={1}
                    value={String(row.count)}
                    onChange={(e) => updateCrew(row.key, { count: Number(e.target.value) })}
                    aria-label={t('laborRates.count', { defaultValue: 'Count' })}
                  />
                  <div className="relative w-28">
                    <input
                      className={`${inputClass} text-right`}
                      inputMode="decimal"
                      value={row.all_in_rate}
                      onChange={(e) => updateCrew(row.key, { all_in_rate: e.target.value })}
                      placeholder={t('laborRates.rate', { defaultValue: 'Rate /h' })}
                      aria-label={t('laborRates.rate', { defaultValue: 'Rate /h' })}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => useAllInFor(row.key)}
                    className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-800"
                    title={t('laborRates.use_all_in', {
                      defaultValue: 'Use the all-in rate above',
                    })}
                    aria-label={t('laborRates.use_all_in', {
                      defaultValue: 'Use the all-in rate above',
                    })}
                  >
                    <ArrowDownToLine size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeCrew(row.key)}
                    className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800"
                    aria-label={t('laborRates.remove', { defaultValue: 'Remove' })}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>

            {crewBreakdown && crewBreakdown.headcount > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm dark:bg-gray-800/60">
                <span className="text-gray-600 dark:text-gray-300">
                  {t('laborRates.crew_summary', {
                    defaultValue: '{{count}} people · {{total}}/h total',
                    count: crewBreakdown.headcount,
                    total: formatCurrency(crewBreakdown.total_cost_per_hour, currency),
                  })}
                </span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">
                  {t('laborRates.blended', { defaultValue: 'Blended: {{rate}}/h', rate: formatCurrency(crewBreakdown.blended_hourly_rate, currency) })}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Breakdown column */}
        <div className="lg:col-span-2">
          <div className={`${cardClass} lg:sticky lg:top-4`}>
            <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t('laborRates.breakdown', { defaultValue: 'Rate build-up' })}
            </h2>

            <dl className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-gray-600 dark:text-gray-300">
                  {t('laborRates.base_wage', { defaultValue: 'Base hourly wage' })}
                </dt>
                <dd className="font-medium text-gray-900 dark:text-gray-100">
                  {formatCurrency(breakdown?.base_wage ?? baseWage, currency)}
                </dd>
              </div>

              {(breakdown?.lines ?? []).map((line, i) => (
                <div
                  key={`${line.label}-${i}`}
                  className="flex items-center justify-between text-gray-500 dark:text-gray-400"
                >
                  <dt className="truncate pr-2">
                    {line.label}
                    <span className="ml-1 text-xs">
                      {line.kind === 'percentage' ? `(${line.value}%)` : ''}
                    </span>
                  </dt>
                  <dd>+ {formatCurrency(line.amount, currency)}</dd>
                </div>
              ))}

              <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-3 dark:border-gray-800">
                <dt className="font-semibold text-gray-900 dark:text-gray-100">
                  {t('laborRates.all_in_rate', { defaultValue: 'All-in hourly rate' })}
                </dt>
                <dd className="text-lg font-bold text-blue-600 dark:text-blue-400">
                  {formatCurrency(allInRate, currency)}
                </dd>
              </div>
            </dl>

            {computeQuery.isError && (
              <p className="mt-3 text-xs text-red-600 dark:text-red-400">
                {t('laborRates.compute_error', {
                  defaultValue: 'Could not compute the rate. Check your inputs.',
                })}
              </p>
            )}

            {/* Save as template */}
            <div className="mt-4 space-y-2 border-t border-gray-200 pt-4 dark:border-gray-800">
              <input
                className={inputClass}
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder={t('laborRates.template_name', {
                  defaultValue: 'Template name',
                })}
                aria-label={t('laborRates.template_name', { defaultValue: 'Template name' })}
              />
              <Button
                variant="primary"
                size="sm"
                icon={<Save size={14} />}
                loading={saveMutation.isPending}
                disabled={templateName.trim() === ''}
                onClick={() => saveMutation.mutate()}
              >
                {t('laborRates.save_template', { defaultValue: 'Save as template' })}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
