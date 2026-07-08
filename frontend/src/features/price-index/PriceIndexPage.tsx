/**
 * Price Index - bring costs from a base period and region to a target period
 * and region using stored construction cost index series and regional factors.
 *
 * Three areas, all working against platform-wide reference data:
 *   1. Index series: manage named cost indices and their period/value points.
 *   2. Regional factors: manage per-region cost factors.
 *   3. Adjust: post amounts and see base vs adjusted with the applied factor.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Trash2,
  Calculator,
  LineChart,
  MapPin,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import { Button, Badge, Card, CardHeader, EmptyState, ErrorState, Input, PageHeader } from '@/shared/ui';
import { useToastStore } from '@/stores/useToastStore';
import { getErrorMessage } from '@/shared/lib/api';
import {
  listSeries,
  fetchSeries,
  createSeries,
  deleteSeries,
  addPoint,
  deletePoint,
  listLocationFactors,
  createLocationFactor,
  deleteLocationFactor,
  adjustAmounts,
  blankAdjustLine,
  isValidPeriod,
  isAdjustLineReady,
  formatFactor,
  factorDirection,
  type AdjustLineInput,
  type AdjustResponse,
  type FactorDirection,
} from './api';

const QK = {
  series: ['price-index', 'series'] as const,
  seriesDetail: (id: string) => ['price-index', 'series', id] as const,
  locations: ['price-index', 'locations'] as const,
};

export function PriceIndexPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      <PageHeader
        srTitle={t('price_index.title', { defaultValue: 'Price Index' })}
        subtitle={t('price_index.subtitle', {
          defaultValue:
            'Bring an old rate library or a foreign benchmark to current-period money and your region using cost index series and regional factors.',
        })}
      />
      <PriceIndexContent />
    </div>
  );
}

function FactorArrow({ direction }: { direction: FactorDirection }) {
  if (direction === 'up') return <TrendingUp className="h-3.5 w-3.5 text-semantic-warning" aria-hidden />;
  if (direction === 'down') return <TrendingDown className="h-3.5 w-3.5 text-semantic-success" aria-hidden />;
  return <Minus className="h-3.5 w-3.5 text-content-tertiary" aria-hidden />;
}

function PriceIndexContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);

  const seriesListQ = useQuery({ queryKey: QK.series, queryFn: listSeries });
  const locationsQ = useQuery({ queryKey: QK.locations, queryFn: listLocationFactors });
  const seriesDetailQ = useQuery({
    queryKey: selectedSeriesId ? QK.seriesDetail(selectedSeriesId) : QK.seriesDetail('none'),
    queryFn: () => fetchSeries(selectedSeriesId as string),
    enabled: !!selectedSeriesId,
  });

  const seriesList = useMemo(() => seriesListQ.data ?? [], [seriesListQ.data]);
  const locations = useMemo(() => locationsQ.data ?? [], [locationsQ.data]);

  // Auto-select the first series once the list arrives so the points panel and
  // the adjust dropdown are never empty when data exists.
  useEffect(() => {
    if (selectedSeriesId) return;
    const first = seriesList[0];
    if (first) setSelectedSeriesId(first.id);
  }, [seriesList, selectedSeriesId]);

  const onError = (e: unknown) =>
    addToast({ type: 'error', title: t('common.error', { defaultValue: 'Error' }), message: getErrorMessage(e) });

  // ── Series form state ──────────────────────────────────────────────────
  const [newSeriesName, setNewSeriesName] = useState('');

  const createSeriesMut = useMutation({
    mutationFn: () => createSeries({ name: newSeriesName.trim() }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: QK.series });
      setNewSeriesName('');
      setSelectedSeriesId(created.id);
    },
    onError,
  });

  const deleteSeriesMut = useMutation({
    mutationFn: (id: string) => deleteSeries(id),
    onSuccess: (_res, id) => {
      queryClient.invalidateQueries({ queryKey: QK.series });
      if (selectedSeriesId === id) setSelectedSeriesId(null);
    },
    onError,
  });

  // ── Point form state ───────────────────────────────────────────────────
  const [newPeriod, setNewPeriod] = useState('');
  const [newPointFactor, setNewPointFactor] = useState('');

  const addPointMut = useMutation({
    mutationFn: () =>
      addPoint(selectedSeriesId as string, { period: newPeriod.trim(), factor: newPointFactor.trim() }),
    onSuccess: () => {
      if (selectedSeriesId) queryClient.invalidateQueries({ queryKey: QK.seriesDetail(selectedSeriesId) });
      queryClient.invalidateQueries({ queryKey: QK.series });
      setNewPeriod('');
      setNewPointFactor('');
    },
    onError,
  });

  const deletePointMut = useMutation({
    mutationFn: (pointId: string) => deletePoint(selectedSeriesId as string, pointId),
    onSuccess: () => {
      if (selectedSeriesId) queryClient.invalidateQueries({ queryKey: QK.seriesDetail(selectedSeriesId) });
      queryClient.invalidateQueries({ queryKey: QK.series });
    },
    onError,
  });

  // ── Location factor form state ─────────────────────────────────────────
  const [newRegionCode, setNewRegionCode] = useState('');
  const [newRegionLabel, setNewRegionLabel] = useState('');
  const [newRegionFactor, setNewRegionFactor] = useState('');

  const createLocationMut = useMutation({
    mutationFn: () =>
      createLocationFactor({
        region_code: newRegionCode.trim(),
        label: newRegionLabel.trim(),
        factor: newRegionFactor.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK.locations });
      setNewRegionCode('');
      setNewRegionLabel('');
      setNewRegionFactor('');
    },
    onError,
  });

  const deleteLocationMut = useMutation({
    mutationFn: (id: string) => deleteLocationFactor(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QK.locations }),
    onError,
  });

  // ── Adjust panel state ─────────────────────────────────────────────────
  const [adjustSeriesId, setAdjustSeriesId] = useState('');
  const [lines, setLines] = useState<AdjustLineInput[]>([blankAdjustLine()]);
  const [adjustResult, setAdjustResult] = useState<AdjustResponse | null>(null);

  const effectiveAdjustSeries = adjustSeriesId || selectedSeriesId || seriesList[0]?.id || '';

  const adjustMut = useMutation({
    mutationFn: () => adjustAmounts(effectiveAdjustSeries, lines.filter(isAdjustLineReady)),
    onSuccess: (res) => setAdjustResult(res),
    onError,
  });

  const updateLine = (idx: number, patch: Partial<AdjustLineInput>) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, blankAdjustLine()]);
  const removeLine = (idx: number) =>
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_l, i) => i !== idx)));

  const readyLineCount = lines.filter(isAdjustLineReady).length;
  const canAdjust = !!effectiveAdjustSeries && readyLineCount > 0 && !adjustMut.isPending;

  const seriesDetail = seriesDetailQ.data;
  const points = seriesDetail?.points ?? [];

  const pointFactorValid = newPointFactor.trim() !== '' && Number(newPointFactor) > 0;
  const regionFactorValid = newRegionFactor.trim() !== '' && Number(newRegionFactor) > 0;

  if (seriesListQ.isError) {
    return (
      <ErrorState
        title={t('price_index.load_error', { defaultValue: 'Could not load price index data' })}
        onRetry={() => seriesListQ.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Index series ─────────────────────────────────────────── */}
        <Card>
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <LineChart className="h-4 w-4 text-oe-blue" aria-hidden />
                {t('price_index.series_title', { defaultValue: 'Cost index series' })}
              </span>
            }
            subtitle={t('price_index.series_subtitle', {
              defaultValue: 'A named index and its value at each period. Escalation is the ratio between two periods.',
            })}
          />
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-2">
              {seriesListQ.isLoading ? (
                <span className="inline-flex items-center gap-2 text-sm text-content-tertiary">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {t('common.loading', { defaultValue: 'Loading...' })}
                </span>
              ) : seriesList.length === 0 ? (
                <span className="text-sm text-content-tertiary">
                  {t('price_index.no_series', { defaultValue: 'No index series yet. Create one below.' })}
                </span>
              ) : (
                seriesList.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedSeriesId(s.id)}
                    className={
                      'rounded-lg border px-3 py-1.5 text-sm transition-colors ' +
                      (s.id === selectedSeriesId
                        ? 'border-oe-blue bg-oe-blue/10 text-oe-blue'
                        : 'border-border text-content-secondary hover:border-content-tertiary')
                    }
                  >
                    {s.name}
                    <span className="ml-2 text-xs text-content-tertiary">
                      {t('price_index.point_count', { defaultValue: '{{count}} pts', count: s.point_count })}
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label={t('price_index.new_series_name', { defaultValue: 'New series name' })}
                  value={newSeriesName}
                  onChange={(e) => setNewSeriesName(e.target.value)}
                  placeholder={t('price_index.new_series_ph', { defaultValue: 'e.g. General building index' })}
                />
              </div>
              <Button
                variant="secondary"
                icon={<Plus className="h-4 w-4" />}
                disabled={newSeriesName.trim() === '' || createSeriesMut.isPending}
                loading={createSeriesMut.isPending}
                onClick={() => createSeriesMut.mutate()}
              >
                {t('price_index.add_series', { defaultValue: 'Add series' })}
              </Button>
            </div>

            {/* Selected series points */}
            {selectedSeriesId && (
              <div className="rounded-lg border border-border-light p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-content-primary">
                    {seriesDetail?.name ?? t('price_index.points', { defaultValue: 'Index points' })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => deleteSeriesMut.mutate(selectedSeriesId)}
                    loading={deleteSeriesMut.isPending}
                  >
                    {t('price_index.delete_series', { defaultValue: 'Delete series' })}
                  </Button>
                </div>

                {seriesDetailQ.isLoading ? (
                  <span className="text-sm text-content-tertiary">
                    {t('common.loading', { defaultValue: 'Loading...' })}
                  </span>
                ) : points.length === 0 ? (
                  <span className="text-sm text-content-tertiary">
                    {t('price_index.no_points', { defaultValue: 'No points yet. Add a period and its index value.' })}
                  </span>
                ) : (
                  <ul className="divide-y divide-border-light">
                    {points.map((p) => (
                      <li key={p.id} className="flex items-center justify-between py-1.5 text-sm">
                        <span className="font-mono text-content-secondary">{p.period}</span>
                        <span className="flex items-center gap-3">
                          <span className="font-medium text-content-primary">{formatFactor(p.factor)}</span>
                          <button
                            type="button"
                            aria-label={t('common.delete', { defaultValue: 'Delete' })}
                            className="text-content-tertiary hover:text-semantic-error"
                            onClick={() => deletePointMut.mutate(p.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 flex items-end gap-2">
                  <Input
                    label={t('price_index.period', { defaultValue: 'Period' })}
                    value={newPeriod}
                    onChange={(e) => setNewPeriod(e.target.value)}
                    placeholder="2026-01"
                    className="font-mono"
                    error={
                      newPeriod !== '' && !isValidPeriod(newPeriod)
                        ? t('price_index.period_invalid', { defaultValue: 'Use YYYY-MM' })
                        : undefined
                    }
                  />
                  <Input
                    label={t('price_index.index_value', { defaultValue: 'Index value' })}
                    value={newPointFactor}
                    onChange={(e) => setNewPointFactor(e.target.value)}
                    placeholder="1.00"
                    inputMode="decimal"
                  />
                  <Button
                    variant="secondary"
                    icon={<Plus className="h-4 w-4" />}
                    disabled={!isValidPeriod(newPeriod) || !pointFactorValid || addPointMut.isPending}
                    loading={addPointMut.isPending}
                    onClick={() => addPointMut.mutate()}
                  >
                    {t('price_index.add_point', { defaultValue: 'Add' })}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* ── Regional factors ─────────────────────────────────────── */}
        <Card>
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <MapPin className="h-4 w-4 text-oe-blue" aria-hidden />
                {t('price_index.regions_title', { defaultValue: 'Regional factors' })}
              </span>
            }
            subtitle={t('price_index.regions_subtitle', {
              defaultValue: 'How each region sits relative to a national baseline of 1. A missing region is treated as 1.',
            })}
          />
          <div className="mt-4 space-y-4">
            {locationsQ.isLoading ? (
              <span className="text-sm text-content-tertiary">
                {t('common.loading', { defaultValue: 'Loading...' })}
              </span>
            ) : locations.length === 0 ? (
              <EmptyState
                icon={<MapPin className="h-5 w-5" />}
                title={t('price_index.no_regions', { defaultValue: 'No regional factors yet' })}
                description={t('price_index.no_regions_desc', {
                  defaultValue: 'Add a region code and its cost factor to adjust across locations.',
                })}
              />
            ) : (
              <ul className="divide-y divide-border-light">
                {locations.map((lf) => (
                  <li key={lf.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="min-w-0">
                      <span className="font-mono text-content-primary">{lf.region_code}</span>
                      {lf.label && <span className="ml-2 text-content-tertiary">{lf.label}</span>}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1 font-medium text-content-primary">
                        <FactorArrow direction={factorDirection(lf.factor)} />
                        {formatFactor(lf.factor)}
                      </span>
                      <button
                        type="button"
                        aria-label={t('common.delete', { defaultValue: 'Delete' })}
                        className="text-content-tertiary hover:text-semantic-error"
                        onClick={() => deleteLocationMut.mutate(lf.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Input
                label={t('price_index.region_code', { defaultValue: 'Region code' })}
                value={newRegionCode}
                onChange={(e) => setNewRegionCode(e.target.value)}
                placeholder="HIGH_COST_METRO"
                className="font-mono"
              />
              <Input
                label={t('price_index.region_factor', { defaultValue: 'Factor' })}
                value={newRegionFactor}
                onChange={(e) => setNewRegionFactor(e.target.value)}
                placeholder="1.15"
                inputMode="decimal"
              />
              <div className="col-span-2">
                <Input
                  label={t('price_index.region_label', { defaultValue: 'Label (optional)' })}
                  value={newRegionLabel}
                  onChange={(e) => setNewRegionLabel(e.target.value)}
                  placeholder={t('price_index.region_label_ph', { defaultValue: 'High-cost metro area' })}
                />
              </div>
              <div className="col-span-2">
                <Button
                  variant="secondary"
                  icon={<Plus className="h-4 w-4" />}
                  disabled={newRegionCode.trim() === '' || !regionFactorValid || createLocationMut.isPending}
                  loading={createLocationMut.isPending}
                  onClick={() => createLocationMut.mutate()}
                >
                  {t('price_index.add_region', { defaultValue: 'Add regional factor' })}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Adjust panel ───────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <Calculator className="h-4 w-4 text-oe-blue" aria-hidden />
              {t('price_index.adjust_title', { defaultValue: 'Adjust amounts' })}
            </span>
          }
          subtitle={t('price_index.adjust_subtitle', {
            defaultValue: 'Bring amounts from a base period and region to a target period and region.',
          })}
        />
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-content-primary">
                {t('price_index.index_series', { defaultValue: 'Index series' })}
              </span>
              <select
                value={effectiveAdjustSeries}
                onChange={(e) => setAdjustSeriesId(e.target.value)}
                className="h-9 rounded-lg border border-border bg-surface-primary px-3 text-sm text-content-primary focus:border-oe-blue focus:outline-none focus:ring-2 focus:ring-oe-blue/30"
              >
                {seriesList.length === 0 && (
                  <option value="">{t('price_index.no_series_option', { defaultValue: 'No series available' })}</option>
                )}
                {seriesList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-12">
                <div className="sm:col-span-3">
                  <Input
                    label={idx === 0 ? t('price_index.amount', { defaultValue: 'Amount' }) : undefined}
                    value={line.amount}
                    onChange={(e) => updateLine(idx, { amount: e.target.value })}
                    placeholder="1000.00"
                    inputMode="decimal"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Input
                    label={idx === 0 ? t('price_index.base_period', { defaultValue: 'Base period' }) : undefined}
                    value={line.base_period}
                    onChange={(e) => updateLine(idx, { base_period: e.target.value })}
                    placeholder="2019-01"
                    className="font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Input
                    label={idx === 0 ? t('price_index.target_period', { defaultValue: 'Target period' }) : undefined}
                    value={line.target_period}
                    onChange={(e) => updateLine(idx, { target_period: e.target.value })}
                    placeholder="2026-01"
                    className="font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <RegionSelect
                    label={idx === 0 ? t('price_index.base_region', { defaultValue: 'Base region' }) : undefined}
                    value={line.base_region ?? ''}
                    options={locations.map((l) => l.region_code)}
                    onChange={(v) => updateLine(idx, { base_region: v })}
                    baselineLabel={t('price_index.baseline', { defaultValue: 'National (1)' })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <RegionSelect
                    label={idx === 0 ? t('price_index.target_region', { defaultValue: 'Target region' }) : undefined}
                    value={line.target_region ?? ''}
                    options={locations.map((l) => l.region_code)}
                    onChange={(v) => updateLine(idx, { target_region: v })}
                    baselineLabel={t('price_index.baseline', { defaultValue: 'National (1)' })}
                  />
                </div>
                <div className="flex sm:col-span-1">
                  <button
                    type="button"
                    aria-label={t('price_index.remove_line', { defaultValue: 'Remove line' })}
                    className="h-9 px-2 text-content-tertiary hover:text-semantic-error disabled:opacity-30"
                    disabled={lines.length <= 1}
                    onClick={() => removeLine(idx)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" size="sm" icon={<Plus className="h-4 w-4" />} onClick={addLine}>
              {t('price_index.add_line', { defaultValue: 'Add line' })}
            </Button>
            <Button
              variant="primary"
              icon={<Calculator className="h-4 w-4" />}
              disabled={!canAdjust}
              loading={adjustMut.isPending}
              onClick={() => adjustMut.mutate()}
            >
              {t('price_index.run_adjust', { defaultValue: 'Adjust' })}
            </Button>
          </div>

          {adjustResult && <AdjustResults result={adjustResult} />}
        </div>
      </Card>
    </div>
  );
}

function RegionSelect({
  label,
  value,
  options,
  onChange,
  baselineLabel,
}: {
  label?: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  baselineLabel: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      {label && <span className="font-medium text-content-primary">{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-lg border border-border bg-surface-primary px-2 text-sm text-content-primary focus:border-oe-blue focus:outline-none focus:ring-2 focus:ring-oe-blue/30"
      >
        <option value="">{baselineLabel}</option>
        {options.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
    </label>
  );
}

function AdjustResults({ result }: { result: AdjustResponse }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto rounded-lg border border-border-light">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-light text-left text-xs uppercase tracking-wide text-content-tertiary">
            <th className="px-3 py-2 font-medium">{t('price_index.col_amount', { defaultValue: 'Base amount' })}</th>
            <th className="px-3 py-2 font-medium">{t('price_index.col_move', { defaultValue: 'From / to' })}</th>
            <th className="px-3 py-2 text-right font-medium">
              {t('price_index.col_factor', { defaultValue: 'Applied factor' })}
            </th>
            <th className="px-3 py-2 text-right font-medium">
              {t('price_index.col_adjusted', { defaultValue: 'Adjusted amount' })}
            </th>
          </tr>
        </thead>
        <tbody>
          {result.results.map((r, i) => (
            <tr key={i} className="border-b border-border-light last:border-0">
              <td className="px-3 py-2 font-mono text-content-secondary">{r.amount}</td>
              <td className="px-3 py-2 text-content-secondary">
                <span className="inline-flex flex-wrap items-center gap-1">
                  <span className="font-mono">{r.base_period}</span>
                  {r.base_region && <span className="text-content-tertiary">/{r.base_region}</span>}
                  <ArrowRight className="h-3 w-3 text-content-tertiary" aria-hidden />
                  <span className="font-mono">{r.target_period}</span>
                  {r.target_region && <span className="text-content-tertiary">/{r.target_region}</span>}
                </span>
                {r.note && <div className="text-xs text-semantic-warning">{r.note}</div>}
                {r.error && <div className="text-xs text-semantic-error">{r.error}</div>}
              </td>
              <td className="px-3 py-2 text-right">
                {r.applied_factor ? (
                  <span className="inline-flex items-center justify-end gap-1 font-medium">
                    <FactorArrow direction={factorDirection(r.applied_factor)} />
                    {formatFactor(r.applied_factor)}
                  </span>
                ) : (
                  <span className="text-content-tertiary">&mdash;</span>
                )}
              </td>
              <td className="px-3 py-2 text-right font-semibold text-content-primary">
                {r.adjusted_amount ?? (
                  <Badge variant="error" size="sm">
                    {t('price_index.not_adjusted', { defaultValue: 'not adjusted' })}
                  </Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
