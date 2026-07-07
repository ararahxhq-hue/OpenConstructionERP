// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Cost-Value Reconciliation (CVR) & Cashflow.
 *
 * The commercial monthly CVR: pick a reporting month, reconcile cost-to-date
 * against value earned per cost head, read the forecast final margin, and track
 * the project cashflow as a cumulative S-curve plus interim payment applications.
 *
 * Money arrives from the API as Decimal-as-string; it is only ever formatted for
 * display (formatCurrency) or coerced to a finite number for the chart (toNum).
 * We never do arithmetic that assumes a JS number on a wire value.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Plus, Trash2, Lock, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { Button, Card, Badge, EmptyState, RecoveryCard, SkeletonTable } from '@/shared/ui';
import { PageHeader } from '@/shared/ui/PageHeader';
import { RequiresProject } from '@/shared/auth/RequiresProject';
import { apiGet, getErrorMessage } from '@/shared/lib/api';
import { formatCurrency, toNum } from '@/shared/lib/money';
import { useToastStore } from '@/stores/useToastStore';
import { useProjectContextStore } from '@/stores/useProjectContextStore';
import {
  fetchCvrReports,
  createCvrReport,
  finalizeCvrReport,
  deleteCvrReport,
  fetchCvrSummary,
  fetchCvrLines,
  createCvrLine,
  deleteCvrLine,
  fetchCashflowSeries,
  createCashflowPoint,
  fetchPaymentApplications,
  createPaymentApplication,
  type CvrReport,
  type CvrLine,
  type CvrSummary,
  type CashflowSeries,
  type PaymentApplication,
  type PaymentApplicationStatus,
} from './api';

interface Project {
  id: string;
  name: string;
}

const INPUT_CLS =
  'w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm ' +
  'text-content-primary placeholder:text-content-tertiary focus:border-oe-blue focus:outline-none ' +
  'focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900/40';

/** Current month as YYYY-MM, the natural default for a new CVR / cash point. */
function currentPeriod(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${month}`;
}

/** Format a percentage string (e.g. "20.79") for display with one decimal. */
function fmtPct(pct: string): string {
  return `${toNum(pct).toFixed(1)}%`;
}

const PAYAPP_STATUS_TONE: Record<PaymentApplicationStatus, string> = {
  draft: 'bg-surface-secondary text-content-secondary',
  submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  certified: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  paid: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};

/* ── Summary strip ─────────────────────────────────────────────────────── */

function SummaryStrip({ summary, currency }: { summary: CvrSummary; currency: string }) {
  const { t } = useTranslation();
  const marginPositive = toNum(summary.margin_to_date) >= 0;
  const forecastPositive = toNum(summary.forecast_margin) >= 0;

  const tiles: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }[] = [
    {
      label: t('cvr.value_to_date', { defaultValue: 'Value to date' }),
      value: formatCurrency(summary.total_value_to_date, currency),
    },
    {
      label: t('cvr.cost_to_date', { defaultValue: 'Cost to date' }),
      value: formatCurrency(summary.total_cost_to_date, currency),
    },
    {
      label: t('cvr.margin_to_date', { defaultValue: 'Margin to date' }),
      value: formatCurrency(summary.margin_to_date, currency),
      sub: fmtPct(summary.margin_to_date_pct),
      tone: marginPositive ? 'good' : 'bad',
    },
    {
      label: t('cvr.forecast_margin', { defaultValue: 'Forecast margin' }),
      value: formatCurrency(summary.forecast_margin, currency),
      sub: fmtPct(summary.forecast_margin_pct),
      tone: forecastPositive ? 'good' : 'bad',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.label} padding="sm">
          <div className="text-2xs uppercase tracking-wide text-content-tertiary">{tile.label}</div>
          <div
            className={
              'mt-1 text-lg font-bold tabular-nums ' +
              (tile.tone === 'good'
                ? 'text-semantic-success'
                : tile.tone === 'bad'
                  ? 'text-semantic-error'
                  : 'text-content-primary')
            }
          >
            {tile.value}
          </div>
          {tile.sub && (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-content-tertiary">
              {tile.tone === 'good' ? (
                <TrendingUp size={12} className="text-semantic-success" />
              ) : tile.tone === 'bad' ? (
                <TrendingDown size={12} className="text-semantic-error" />
              ) : null}
              {tile.sub}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

/* ── Add cost head (line) form ─────────────────────────────────────────── */

const EMPTY_LINE = {
  cost_code: '',
  description: '',
  cost_to_date: '',
  value_to_date: '',
  accruals: '',
  forecast_cost: '',
  forecast_value: '',
};

function AddLineForm({
  reportId,
  disabled,
  onAdded,
}: {
  reportId: string;
  disabled: boolean;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [form, setForm] = useState({ ...EMPTY_LINE });

  const mutation = useMutation({
    mutationFn: () =>
      createCvrLine(reportId, {
        cost_code: form.cost_code,
        description: form.description,
        cost_to_date: form.cost_to_date || '0',
        value_to_date: form.value_to_date || '0',
        accruals: form.accruals || '0',
        forecast_cost: form.forecast_cost || '0',
        forecast_value: form.forecast_value || '0',
      }),
    onSuccess: () => {
      setForm({ ...EMPTY_LINE });
      onAdded();
      addToast({ type: 'success', title: t('cvr.line_added', { defaultValue: 'Cost head added' }) });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('cvr.line_add_failed', { defaultValue: 'Could not add cost head' }), message: getErrorMessage(err) }),
  });

  if (disabled) return null;

  const set = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="grid grid-cols-2 items-end gap-2 rounded-lg border border-dashed border-border-light p-3 sm:grid-cols-8">
      <input className={INPUT_CLS} placeholder={t('cvr.col_code', { defaultValue: 'Code' })} value={form.cost_code} onChange={(e) => set('cost_code', e.target.value)} />
      <input className={`${INPUT_CLS} sm:col-span-2`} placeholder={t('cvr.col_description', { defaultValue: 'Description' })} value={form.description} onChange={(e) => set('description', e.target.value)} />
      <input className={INPUT_CLS} inputMode="decimal" placeholder={t('cvr.col_cost_to_date', { defaultValue: 'Cost' })} value={form.cost_to_date} onChange={(e) => set('cost_to_date', e.target.value)} />
      <input className={INPUT_CLS} inputMode="decimal" placeholder={t('cvr.col_value_to_date', { defaultValue: 'Value' })} value={form.value_to_date} onChange={(e) => set('value_to_date', e.target.value)} />
      <input className={INPUT_CLS} inputMode="decimal" placeholder={t('cvr.col_forecast_cost', { defaultValue: 'FC cost' })} value={form.forecast_cost} onChange={(e) => set('forecast_cost', e.target.value)} />
      <input className={INPUT_CLS} inputMode="decimal" placeholder={t('cvr.col_forecast_value', { defaultValue: 'FC value' })} value={form.forecast_value} onChange={(e) => set('forecast_value', e.target.value)} />
      <Button variant="secondary" size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
        <Plus size={14} className="mr-1 shrink-0" />
        {t('cvr.add', { defaultValue: 'Add' })}
      </Button>
    </div>
  );
}

/* ── Lines table ───────────────────────────────────────────────────────── */

function LinesTable({
  lines,
  summary,
  currency,
  canEdit,
  onDelete,
}: {
  lines: CvrLine[];
  summary: CvrSummary | undefined;
  currency: string;
  canEdit: boolean;
  onDelete: (lineId: string) => void;
}) {
  const { t } = useTranslation();

  if (lines.length === 0) {
    return (
      <EmptyState
        title={t('cvr.no_lines', { defaultValue: 'No cost heads yet' })}
        description={t('cvr.no_lines_desc', {
          defaultValue: 'Add the cost heads you are reconciling this month to see margin roll up.',
        })}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border-light text-left text-2xs uppercase tracking-wide text-content-tertiary">
            <th className="py-2 pr-3 font-medium">{t('cvr.col_code', { defaultValue: 'Code' })}</th>
            <th className="py-2 pr-3 font-medium">{t('cvr.col_description', { defaultValue: 'Description' })}</th>
            <th className="py-2 pr-3 text-right font-medium">{t('cvr.col_cost_to_date', { defaultValue: 'Cost to date' })}</th>
            <th className="py-2 pr-3 text-right font-medium">{t('cvr.col_value_to_date', { defaultValue: 'Value to date' })}</th>
            <th className="py-2 pr-3 text-right font-medium">{t('cvr.col_forecast_cost', { defaultValue: 'Forecast cost' })}</th>
            <th className="py-2 pr-3 text-right font-medium">{t('cvr.col_forecast_value', { defaultValue: 'Forecast value' })}</th>
            <th className="py-2 pr-3 text-right font-medium">{t('cvr.col_margin', { defaultValue: 'Margin' })}</th>
            {canEdit && <th className="py-2 pl-1" />}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const marginPositive = toNum(line.margin_to_date) >= 0;
            return (
              <tr key={line.id} className="border-b border-border-light/60 hover:bg-surface-secondary/40">
                <td className="py-2 pr-3 font-medium text-content-primary">{line.cost_code || '-'}</td>
                <td className="py-2 pr-3 text-content-secondary">
                  <span className="inline-flex items-center gap-1.5">
                    {line.description || '-'}
                    {line.flags.length > 0 && (
                      <span title={line.flags.join(', ')}>
                        <AlertTriangle size={13} className="text-amber-500" />
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-content-secondary">{formatCurrency(line.cost_to_date, currency)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-content-secondary">{formatCurrency(line.value_to_date, currency)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-content-tertiary">{formatCurrency(line.forecast_cost, currency)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-content-tertiary">{formatCurrency(line.forecast_value, currency)}</td>
                <td className={'py-2 pr-3 text-right font-semibold tabular-nums ' + (marginPositive ? 'text-semantic-success' : 'text-semantic-error')}>
                  {formatCurrency(line.margin_to_date, currency)}
                </td>
                {canEdit && (
                  <td className="py-2 pl-1 text-right">
                    <button
                      type="button"
                      onClick={() => onDelete(line.id)}
                      className="rounded p-1 text-content-tertiary hover:bg-red-50 hover:text-semantic-error dark:hover:bg-red-900/20"
                      aria-label={t('cvr.delete_line', { defaultValue: 'Delete cost head' })}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        {summary && (
          <tfoot>
            <tr className="border-t-2 border-border-light font-semibold text-content-primary">
              <td className="py-2 pr-3" colSpan={2}>{t('cvr.totals', { defaultValue: 'Totals' })}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(summary.total_cost_to_date, currency)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(summary.total_value_to_date, currency)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(summary.total_forecast_cost, currency)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(summary.total_forecast_value, currency)}</td>
              <td className={'py-2 pr-3 text-right tabular-nums ' + (toNum(summary.margin_to_date) >= 0 ? 'text-semantic-success' : 'text-semantic-error')}>
                {formatCurrency(summary.margin_to_date, currency)}
              </td>
              {canEdit && <td />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/* ── Cashflow S-curve ──────────────────────────────────────────────────── */

function CashflowChart({ series }: { series: CashflowSeries }) {
  const { t } = useTranslation();
  const currency = series.currency;
  const data = useMemo(
    () =>
      series.points.map((p) => ({
        period: p.period,
        cumIn: toNum(p.cumulative_cash_in),
        cumOut: toNum(p.cumulative_cash_out),
        cumNet: toNum(p.cumulative_net),
      })),
    [series.points],
  );

  if (data.length === 0) {
    return (
      <EmptyState
        title={t('cvr.no_cashflow', { defaultValue: 'No cashflow points yet' })}
        description={t('cvr.no_cashflow_desc', {
          defaultValue: 'Add monthly cash-in and cash-out to plot the cumulative S-curve.',
        })}
      />
    );
  }

  return (
    <div style={{ width: '100%', height: 320 }} data-testid="cvr-cashflow-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <defs>
            <linearGradient id="cvrCumIn" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="cvrCumOut" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light, #e5e7eb)" />
          <XAxis dataKey="period" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={72} tickFormatter={(v: number) => formatCurrency(v, currency, undefined, { maximumFractionDigits: 0 })} />
          <Tooltip
            contentStyle={{ fontSize: 12 }}
            formatter={(value: unknown): string => formatCurrency(value as string | number, currency)}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area
            type="monotone"
            dataKey="cumIn"
            name={t('cvr.cumulative_cash_in', { defaultValue: 'Cumulative cash in' })}
            stroke="#22c55e"
            fill="url(#cvrCumIn)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="cumOut"
            name={t('cvr.cumulative_cash_out', { defaultValue: 'Cumulative cash out' })}
            stroke="#ef4444"
            fill="url(#cvrCumOut)"
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="cumNet"
            name={t('cvr.cumulative_net', { defaultValue: 'Cumulative net' })}
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────────────────────── */

export function CvrPage() {
  const { t } = useTranslation();
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const activeProjectId = useProjectContextStore((s) => s.activeProjectId);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiGet<Project[]>('/v1/projects/'),
    staleTime: 5 * 60_000,
  });

  const projectId = routeProjectId || activeProjectId || projects[0]?.id || '';

  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [showNewReport, setShowNewReport] = useState(false);
  const [newPeriod, setNewPeriod] = useState(currentPeriod());
  const [newCurrency, setNewCurrency] = useState('');

  // Reports
  const {
    data: reportList,
    isLoading: reportsLoading,
    isError: reportsError,
    error: reportsErr,
    refetch: refetchReports,
  } = useQuery({
    queryKey: ['cvr-reports', projectId],
    queryFn: () => fetchCvrReports(projectId),
    enabled: !!projectId,
  });

  const reports = useMemo<CvrReport[]>(() => reportList?.items ?? [], [reportList]);

  // Keep a valid report selected as the list changes.
  useEffect(() => {
    if (reports.length === 0) {
      if (selectedReportId) setSelectedReportId('');
      return;
    }
    if (!reports.some((r) => r.id === selectedReportId)) {
      setSelectedReportId(reports[0]?.id ?? '');
    }
  }, [reports, selectedReportId]);

  const selectedReport = useMemo(
    () => reports.find((r) => r.id === selectedReportId),
    [reports, selectedReportId],
  );
  const reportCurrency = selectedReport?.currency ?? '';
  const canEdit = selectedReport?.status !== 'final';

  // Selected report detail
  const { data: summary } = useQuery({
    queryKey: ['cvr-summary', selectedReportId],
    queryFn: () => fetchCvrSummary(selectedReportId),
    enabled: !!selectedReportId,
  });
  const { data: lines = [] } = useQuery({
    queryKey: ['cvr-lines', selectedReportId],
    queryFn: () => fetchCvrLines(selectedReportId),
    enabled: !!selectedReportId,
  });

  // Cashflow (project-scoped)
  const { data: cashflow } = useQuery({
    queryKey: ['cvr-cashflow-series', projectId],
    queryFn: () => fetchCashflowSeries(projectId),
    enabled: !!projectId,
  });

  // Payment applications (project-scoped)
  const { data: payappList } = useQuery({
    queryKey: ['cvr-payapps', projectId],
    queryFn: () => fetchPaymentApplications(projectId),
    enabled: !!projectId,
  });
  const payapps = useMemo<PaymentApplication[]>(() => payappList?.items ?? [], [payappList]);

  const invalidateReport = () => {
    qc.invalidateQueries({ queryKey: ['cvr-summary', selectedReportId] });
    qc.invalidateQueries({ queryKey: ['cvr-lines', selectedReportId] });
    qc.invalidateQueries({ queryKey: ['cvr-reports', projectId] });
  };

  // Mutations
  const createReportMut = useMutation({
    mutationFn: () =>
      createCvrReport({ project_id: projectId, period: newPeriod, currency: newCurrency || undefined }),
    onSuccess: (created) => {
      setShowNewReport(false);
      setNewCurrency('');
      setSelectedReportId(created.id);
      qc.invalidateQueries({ queryKey: ['cvr-reports', projectId] });
      addToast({ type: 'success', title: t('cvr.report_created', { defaultValue: 'CVR report created' }) });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('cvr.report_create_failed', { defaultValue: 'Could not create report' }), message: getErrorMessage(err) }),
  });

  const finalizeMut = useMutation({
    mutationFn: () => finalizeCvrReport(selectedReportId),
    onSuccess: () => {
      invalidateReport();
      addToast({ type: 'success', title: t('cvr.report_finalized', { defaultValue: 'Report finalized' }) });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('cvr.finalize_failed', { defaultValue: 'Could not finalize report' }), message: getErrorMessage(err) }),
  });

  const deleteReportMut = useMutation({
    mutationFn: () => deleteCvrReport(selectedReportId),
    onSuccess: () => {
      setSelectedReportId('');
      qc.invalidateQueries({ queryKey: ['cvr-reports', projectId] });
      addToast({ type: 'success', title: t('cvr.report_deleted', { defaultValue: 'Report deleted' }) });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('cvr.delete_failed', { defaultValue: 'Could not delete report' }), message: getErrorMessage(err) }),
  });

  const deleteLineMut = useMutation({
    mutationFn: (lineId: string) => deleteCvrLine(lineId),
    onSuccess: () => invalidateReport(),
    onError: (err) =>
      addToast({ type: 'error', title: t('cvr.line_delete_failed', { defaultValue: 'Could not delete cost head' }), message: getErrorMessage(err) }),
  });

  if (!projectId) {
    return <RequiresProject>{null}</RequiresProject>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        srTitle={t('cvr.title', { defaultValue: 'Cost-Value Reconciliation' })}
        subtitle={t('cvr.subtitle', {
          defaultValue:
            'Reconcile cost against value earned per cost head, forecast the final margin, and track project cashflow.',
        })}
        actions={
          <Button variant="primary" size="sm" onClick={() => setShowNewReport((v) => !v)}>
            <Plus size={16} className="mr-1.5 shrink-0" />
            {t('cvr.new_report', { defaultValue: 'New CVR month' })}
          </Button>
        }
      />

      {/* New report inline form */}
      {showNewReport && (
        <Card padding="md">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-content-secondary">{t('cvr.period', { defaultValue: 'Period (YYYY-MM)' })}</label>
              <input className={INPUT_CLS} value={newPeriod} onChange={(e) => setNewPeriod(e.target.value)} placeholder="2026-06" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-content-secondary">{t('cvr.currency', { defaultValue: 'Currency' })}</label>
              <input className={INPUT_CLS} value={newCurrency} onChange={(e) => setNewCurrency(e.target.value.toUpperCase())} placeholder="USD" maxLength={3} />
            </div>
            <Button variant="primary" size="sm" disabled={createReportMut.isPending || !/^\d{4}-\d{2}$/.test(newPeriod)} onClick={() => createReportMut.mutate()}>
              {t('cvr.create', { defaultValue: 'Create' })}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowNewReport(false)}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </div>
        </Card>
      )}

      {reportsLoading ? (
        <SkeletonTable rows={4} columns={5} />
      ) : reportsError ? (
        <RecoveryCard error={reportsErr} onRetry={() => refetchReports()} />
      ) : reports.length === 0 ? (
        <EmptyState
          title={t('cvr.no_reports', { defaultValue: 'No CVR reports yet' })}
          description={t('cvr.no_reports_desc', {
            defaultValue: 'Create your first monthly CVR to reconcile cost against value and forecast the final margin.',
          })}
        />
      ) : (
        <>
          {/* Report picker + report-level actions */}
          <Card padding="md">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <label className="text-sm text-content-secondary">{t('cvr.report', { defaultValue: 'Report' })}</label>
                <select
                  className={INPUT_CLS + ' w-auto'}
                  value={selectedReportId}
                  onChange={(e) => setSelectedReportId(e.target.value)}
                  aria-label={t('cvr.select_report', { defaultValue: 'Select CVR report' })}
                >
                  {reports.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.period}
                      {r.status === 'final' ? ` (${t('cvr.status_final', { defaultValue: 'final' })})` : ''}
                    </option>
                  ))}
                </select>
                {selectedReport && (
                  <Badge variant={selectedReport.status === 'final' ? 'success' : 'warning'}>
                    {selectedReport.status === 'final'
                      ? t('cvr.status_final', { defaultValue: 'Final' })
                      : t('cvr.status_draft', { defaultValue: 'Draft' })}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <Button variant="secondary" size="sm" disabled={finalizeMut.isPending} onClick={() => finalizeMut.mutate()}>
                    <Lock size={14} className="mr-1 shrink-0" />
                    {t('cvr.finalize', { defaultValue: 'Finalize' })}
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => deleteReportMut.mutate()}
                  disabled={deleteReportMut.isPending}
                  className="rounded p-1.5 text-content-tertiary hover:bg-red-50 hover:text-semantic-error dark:hover:bg-red-900/20"
                  aria-label={t('cvr.delete_report', { defaultValue: 'Delete report' })}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </Card>

          {/* Summary strip */}
          {summary && <SummaryStrip summary={summary} currency={reportCurrency} />}

          {/* Advisory warnings */}
          {summary && summary.warnings.length > 0 && (
            <Card padding="sm">
              <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">{t('cvr.forecast_warnings', { defaultValue: 'Forecast checks' })}</div>
                  <div className="text-content-tertiary">
                    {t('cvr.forecast_warnings_desc', {
                      defaultValue: 'Some lines forecast below what is already spent or earned. Review the flagged cost heads.',
                    })}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* CVR table */}
          <Card padding="md">
            <h2 className="mb-3 text-sm font-semibold text-content-primary">
              {t('cvr.cost_heads', { defaultValue: 'Cost heads' })}
            </h2>
            <LinesTable
              lines={lines}
              summary={summary}
              currency={reportCurrency}
              canEdit={canEdit}
              onDelete={(id) => deleteLineMut.mutate(id)}
            />
            {selectedReportId && (
              <div className="mt-3">
                <AddLineForm reportId={selectedReportId} disabled={!canEdit} onAdded={invalidateReport} />
              </div>
            )}
          </Card>
        </>
      )}

      {/* Cashflow S-curve (project-scoped) */}
      <Card padding="md">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-content-primary">{t('cvr.cashflow', { defaultValue: 'Cashflow forecast' })}</h2>
          {cashflow && (
            <div className="text-xs text-content-tertiary">
              {t('cvr.net_position', { defaultValue: 'Net position' })}:{' '}
              <span className={'font-semibold tabular-nums ' + (toNum(cashflow.net_position) >= 0 ? 'text-semantic-success' : 'text-semantic-error')}>
                {formatCurrency(cashflow.net_position, cashflow.currency)}
              </span>
            </div>
          )}
        </div>
        {cashflow ? <CashflowChart series={cashflow} /> : <SkeletonTable rows={3} columns={3} />}
        <CashflowPointForm projectId={projectId} defaultCurrency={reportCurrency} onAdded={() => qc.invalidateQueries({ queryKey: ['cvr-cashflow-series', projectId] })} />
      </Card>

      {/* Payment applications (project-scoped) */}
      <Card padding="md">
        <h2 className="mb-3 text-sm font-semibold text-content-primary">
          {t('cvr.payment_applications', { defaultValue: 'Payment applications' })}
        </h2>
        <PaymentApplicationsSection
          projectId={projectId}
          applications={payapps}
          defaultCurrency={reportCurrency}
          onChanged={() => qc.invalidateQueries({ queryKey: ['cvr-payapps', projectId] })}
        />
      </Card>
    </div>
  );
}

/* ── Cashflow point add form ───────────────────────────────────────────── */

function CashflowPointForm({
  projectId,
  defaultCurrency,
  onAdded,
}: {
  projectId: string;
  defaultCurrency: string;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [period, setPeriod] = useState(currentPeriod());
  const [cashIn, setCashIn] = useState('');
  const [cashOut, setCashOut] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      createCashflowPoint({
        project_id: projectId,
        period,
        cash_in: cashIn || '0',
        cash_out: cashOut || '0',
        currency: defaultCurrency || undefined,
      }),
    onSuccess: () => {
      setCashIn('');
      setCashOut('');
      onAdded();
      addToast({ type: 'success', title: t('cvr.cash_point_added', { defaultValue: 'Cashflow point added' }) });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('cvr.cash_point_failed', { defaultValue: 'Could not add cashflow point' }), message: getErrorMessage(err) }),
  });

  return (
    <div className="mt-3 grid grid-cols-2 items-end gap-2 rounded-lg border border-dashed border-border-light p-3 sm:grid-cols-4">
      <input className={INPUT_CLS} placeholder={t('cvr.period', { defaultValue: 'Period (YYYY-MM)' })} value={period} onChange={(e) => setPeriod(e.target.value)} />
      <input className={INPUT_CLS} inputMode="decimal" placeholder={t('cvr.cash_in', { defaultValue: 'Cash in' })} value={cashIn} onChange={(e) => setCashIn(e.target.value)} />
      <input className={INPUT_CLS} inputMode="decimal" placeholder={t('cvr.cash_out', { defaultValue: 'Cash out' })} value={cashOut} onChange={(e) => setCashOut(e.target.value)} />
      <Button variant="secondary" size="sm" disabled={mutation.isPending || !/^\d{4}-\d{2}$/.test(period)} onClick={() => mutation.mutate()}>
        <Plus size={14} className="mr-1 shrink-0" />
        {t('cvr.add_point', { defaultValue: 'Add point' })}
      </Button>
    </div>
  );
}

/* ── Payment applications ──────────────────────────────────────────────── */

function PaymentApplicationsSection({
  projectId,
  applications,
  defaultCurrency,
  onChanged,
}: {
  projectId: string;
  applications: PaymentApplication[];
  defaultCurrency: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [period, setPeriod] = useState(currentPeriod());
  const [number, setNumber] = useState('');
  const [gross, setGross] = useState('');
  const [retention, setRetention] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      createPaymentApplication({
        project_id: projectId,
        period,
        application_number: number || undefined,
        gross_value: gross || '0',
        retention: retention || '0',
        currency: defaultCurrency || undefined,
      }),
    onSuccess: () => {
      setNumber('');
      setGross('');
      setRetention('');
      onChanged();
      addToast({ type: 'success', title: t('cvr.payapp_added', { defaultValue: 'Payment application added' }) });
    },
    onError: (err) =>
      addToast({ type: 'error', title: t('cvr.payapp_failed', { defaultValue: 'Could not add payment application' }), message: getErrorMessage(err) }),
  });

  return (
    <div className="space-y-3">
      {applications.length === 0 ? (
        <EmptyState
          title={t('cvr.no_payapps', { defaultValue: 'No payment applications yet' })}
          description={t('cvr.no_payapps_desc', {
            defaultValue: 'Log interim applications for payment to track gross, retention and the net due.',
          })}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border-light text-left text-2xs uppercase tracking-wide text-content-tertiary">
                <th className="py-2 pr-3 font-medium">{t('cvr.col_application', { defaultValue: 'Application' })}</th>
                <th className="py-2 pr-3 font-medium">{t('cvr.col_period', { defaultValue: 'Period' })}</th>
                <th className="py-2 pr-3 text-right font-medium">{t('cvr.col_gross', { defaultValue: 'Gross' })}</th>
                <th className="py-2 pr-3 text-right font-medium">{t('cvr.col_retention', { defaultValue: 'Retention' })}</th>
                <th className="py-2 pr-3 text-right font-medium">{t('cvr.col_net', { defaultValue: 'Net due' })}</th>
                <th className="py-2 pr-3 font-medium">{t('cvr.col_status', { defaultValue: 'Status' })}</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((app) => (
                <tr key={app.id} className="border-b border-border-light/60">
                  <td className="py-2 pr-3 font-medium text-content-primary">{app.application_number || '-'}</td>
                  <td className="py-2 pr-3 text-content-secondary">{app.period}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-content-secondary">{formatCurrency(app.gross_value, app.currency)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-content-tertiary">{formatCurrency(app.retention, app.currency)}</td>
                  <td className="py-2 pr-3 text-right font-semibold tabular-nums text-content-primary">{formatCurrency(app.net_value, app.currency)}</td>
                  <td className="py-2 pr-3">
                    <span className={'inline-flex rounded-full px-2 py-0.5 text-2xs font-semibold ' + PAYAPP_STATUS_TONE[app.status]}>
                      {t(`cvr.payapp_status_${app.status}`, { defaultValue: app.status })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-2 items-end gap-2 rounded-lg border border-dashed border-border-light p-3 sm:grid-cols-5">
        <input className={INPUT_CLS} placeholder={t('cvr.col_application', { defaultValue: 'IPA-001' })} value={number} onChange={(e) => setNumber(e.target.value)} />
        <input className={INPUT_CLS} placeholder={t('cvr.period', { defaultValue: 'Period (YYYY-MM)' })} value={period} onChange={(e) => setPeriod(e.target.value)} />
        <input className={INPUT_CLS} inputMode="decimal" placeholder={t('cvr.col_gross', { defaultValue: 'Gross' })} value={gross} onChange={(e) => setGross(e.target.value)} />
        <input className={INPUT_CLS} inputMode="decimal" placeholder={t('cvr.col_retention', { defaultValue: 'Retention' })} value={retention} onChange={(e) => setRetention(e.target.value)} />
        <Button variant="secondary" size="sm" disabled={mutation.isPending || !/^\d{4}-\d{2}$/.test(period)} onClick={() => mutation.mutate()}>
          <Plus size={14} className="mr-1 shrink-0" />
          {t('cvr.add', { defaultValue: 'Add' })}
        </Button>
      </div>
    </div>
  );
}
