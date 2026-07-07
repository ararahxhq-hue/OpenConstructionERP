// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Leaf,
  Minus,
  Pencil,
  Plus,
  ShieldCheck,
  Target,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, EmptyState } from '@/shared/ui';
import { PageHeader } from '@/shared/ui/PageHeader';
import { RequiresProject } from '@/shared/auth/RequiresProject';
import { useConfirm } from '@/shared/hooks/useConfirm';
import { apiGet, getErrorMessage } from '@/shared/lib/api';
import { useToastStore } from '@/stores/useToastStore';
import { useProjectContextStore } from '@/stores/useProjectContextStore';
import {
  createEsgEntry,
  deleteEsgEntry,
  fetchEsgEntries,
  fetchEsgMetrics,
  fetchEsgSummary,
  updateEsgEntry,
  type EsgCategory,
  type EsgEntry,
  type EsgMetricDefinition,
  type EsgMetricSummary,
} from './api';

/* ── Constants & helpers ───────────────────────────────────────────────── */

interface Project {
  id: string;
  name: string;
}

const CATEGORY_ORDER: EsgCategory[] = ['environmental', 'social', 'governance'];

const CATEGORY_META: Record<
  EsgCategory,
  { label: string; icon: typeof Leaf; accent: string }
> = {
  environmental: {
    label: 'Environmental',
    icon: Leaf,
    accent: 'text-emerald-600 dark:text-emerald-400',
  },
  social: { label: 'Social', icon: Users, accent: 'text-sky-600 dark:text-sky-400' },
  governance: {
    label: 'Governance',
    icon: ShieldCheck,
    accent: 'text-violet-600 dark:text-violet-400',
  },
};

const CHIP_GOOD = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
const CHIP_BAD = 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
const CHIP_NEUTRAL = 'bg-surface-tertiary text-content-tertiary';

const inputCls =
  'h-10 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';

const numberFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parse a Decimal-as-string into a finite number, or null. */
function toNum(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmtNum(n: number | null): string {
  return n === null ? '-' : numberFmt.format(n);
}

function formatPeriod(period: string | null): string {
  if (!period) return '';
  const [year, month] = period.split('-');
  const idx = Number(month) - 1;
  return MONTHS[idx] ? `${MONTHS[idx]} ${year}` : period;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function statusChip(onTrack: boolean | null): string {
  if (onTrack === true) return CHIP_GOOD;
  if (onTrack === false) return CHIP_BAD;
  return CHIP_NEUTRAL;
}

/* ── Sparkline (pure SVG, no deps) ─────────────────────────────────────── */

function Sparkline({ values, onTrack }: { values: number[]; onTrack: boolean | null }) {
  const { t } = useTranslation();
  if (values.length < 2) {
    return (
      <div className="h-8 flex items-center text-2xs text-content-quaternary">
        {t('esg.trend_needs_two', { defaultValue: 'Trend appears after 2+ periods' })}
      </div>
    );
  }
  const w = 140;
  const h = 32;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = (w - 2 * pad) / (values.length - 1);
  const coords = values.map((v, i) => ({
    x: pad + i * stepX,
    y: h - pad - ((v - min) / span) * (h - 2 * pad),
  }));
  const points = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const lastPoint = coords[coords.length - 1];
  const tone =
    onTrack === true
      ? 'text-emerald-500'
      : onTrack === false
        ? 'text-red-500'
        : 'text-content-tertiary';
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={clsx('w-full h-8', tone)}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {lastPoint && <circle cx={lastPoint.x} cy={lastPoint.y} r={2} fill="currentColor" />}
    </svg>
  );
}

/* ── Metric KPI card ───────────────────────────────────────────────────── */

function MetricCard({
  summary,
  onAdd,
}: {
  summary: EsgMetricSummary;
  onAdd: (metricKey: string) => void;
}) {
  const { t } = useTranslation();
  const label = t(`esg.metric_${summary.metric_key}`, { defaultValue: summary.label });
  const latest = toNum(summary.latest_value);
  const target = toNum(summary.target);
  const unit = summary.unit;
  const hasReading = latest !== null;
  const values = summary.trend
    .map((p) => toNum(p.value))
    .filter((v): v is number => v !== null);

  const directionHint =
    summary.direction === 'lower_better'
      ? t('esg.lower_better', { defaultValue: 'Lower is better' })
      : t('esg.higher_better', { defaultValue: 'Higher is better' });

  return (
    <div className="flex flex-col rounded-xl border border-border-light bg-surface-elevated/90 p-4 shadow-xs transition-shadow duration-normal ease-oe hover:shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-content-primary truncate" title={label}>
            {label}
          </p>
          <p className="text-2xs text-content-tertiary">{directionHint}</p>
        </div>
        <Badge variant="neutral" size="sm" className="shrink-0 font-mono">
          {unit}
        </Badge>
      </div>

      {!hasReading ? (
        <div className="mt-4 flex flex-1 flex-col items-start justify-between gap-3">
          <p className="text-sm text-content-quaternary">
            {t('esg.no_readings_yet', { defaultValue: 'No readings yet' })}
          </p>
          <Button variant="ghost" size="sm" onClick={() => onAdd(summary.metric_key)}>
            <Plus size={14} className="mr-1" />
            {t('esg.add_reading', { defaultValue: 'Add reading' })}
          </Button>
        </div>
      ) : (
        <>
          {/* Value + delta */}
          <div className="mt-3 flex items-end justify-between gap-2">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold tabular-nums text-content-primary">
                {fmtNum(latest)}
              </span>
              <span className="text-xs text-content-tertiary">{unit}</span>
            </div>
            {summary.delta_pct !== null && (
              <span
                className={clsx(
                  'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-2xs font-semibold tabular-nums',
                  statusChip(summary.on_track),
                )}
                title={
                  summary.on_track === true
                    ? t('esg.on_track', { defaultValue: 'On track vs target' })
                    : summary.on_track === false
                      ? t('esg.off_track', { defaultValue: 'Off track vs target' })
                      : undefined
                }
              >
                {summary.delta_pct > 0 ? (
                  <ArrowUpRight size={11} />
                ) : summary.delta_pct < 0 ? (
                  <ArrowDownRight size={11} />
                ) : (
                  <Minus size={11} />
                )}
                {summary.delta_pct > 0 ? '+' : ''}
                {numberFmt.format(summary.delta_pct)}%
              </span>
            )}
          </div>

          {/* Target line */}
          <div className="mt-1 flex items-center gap-1 text-xs text-content-secondary">
            <Target size={12} className="text-content-tertiary shrink-0" />
            {target !== null ? (
              <span>
                {t('esg.target', { defaultValue: 'Target' })} {fmtNum(target)} {unit}
              </span>
            ) : (
              <span className="text-content-quaternary">
                {t('esg.no_target', { defaultValue: 'No target set' })}
              </span>
            )}
          </div>

          {/* Trend */}
          <div className="mt-3">
            <Sparkline values={values} onTrack={summary.on_track} />
          </div>

          {/* Footer */}
          <div className="mt-2 flex items-center justify-between text-2xs text-content-tertiary">
            <span>{formatPeriod(summary.latest_period)}</span>
            <span className="tabular-nums">
              {t('esg.n_periods', {
                defaultValue: '{{count}} periods',
                count: summary.entry_count,
              })}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Add / edit reading modal ──────────────────────────────────────────── */

function ReadingModal({
  metrics,
  projectId,
  editEntry,
  presetMetric,
  onClose,
  onSaved,
}: {
  metrics: EsgMetricDefinition[];
  projectId: string;
  editEntry: EsgEntry | null;
  presetMetric: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const isEdit = editEntry !== null;

  const [metricKey, setMetricKey] = useState(
    editEntry?.metric_key ?? presetMetric ?? metrics[0]?.key ?? '',
  );
  const [period, setPeriod] = useState(editEntry?.period ?? currentMonth());
  const [value, setValue] = useState(editEntry?.value ?? '');
  const [target, setTarget] = useState(editEntry?.target ?? '');
  const [note, setNote] = useState(editEntry?.note ?? '');
  const [touched, setTouched] = useState(false);

  const selectedMetric = metrics.find((m) => m.key === metricKey);

  const grouped = useMemo(() => {
    const map: Record<EsgCategory, EsgMetricDefinition[]> = {
      environmental: [],
      social: [],
      governance: [],
    };
    for (const m of metrics) map[m.category]?.push(m);
    return map;
  }, [metrics]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const valueError = touched && (value.trim() === '' || Number(value) < 0 || !Number.isFinite(Number(value)));
  const canSubmit = metricKey !== '' && period !== '' && value.trim() !== '' && Number(value) >= 0;

  const saveMut = useMutation({
    mutationFn: async () => {
      if (isEdit && editEntry) {
        return updateEsgEntry(editEntry.id, {
          value: value.trim(),
          target: target.trim() === '' ? null : target.trim(),
          note: note.trim() === '' ? null : note.trim(),
        });
      }
      return createEsgEntry({
        project_id: projectId,
        metric_key: metricKey,
        period,
        value: value.trim(),
        target: target.trim() === '' ? undefined : target.trim(),
        note: note.trim() === '' ? undefined : note.trim(),
      });
    },
    onSuccess: () => {
      addToast({
        type: 'success',
        title: isEdit
          ? t('esg.reading_updated', { defaultValue: 'Reading updated' })
          : t('esg.reading_saved', { defaultValue: 'Reading saved' }),
      });
      onSaved();
      onClose();
    },
    onError: (e: unknown) => {
      addToast({
        type: 'error',
        title: t('esg.save_failed', { defaultValue: 'Could not save reading' }),
        message: getErrorMessage(e),
      });
    },
  });

  const handleSubmit = () => {
    setTouched(true);
    if (canSubmit) saveMut.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-lg animate-fade-in"
      role="dialog"
      aria-label={
        isEdit
          ? t('esg.edit_reading', { defaultValue: 'Edit reading' })
          : t('esg.new_reading', { defaultValue: 'New reading' })
      }
    >
      <div className="w-full max-w-lg bg-surface-elevated rounded-xl shadow-xl border border-border animate-card-in mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
          <h2 className="text-lg font-semibold text-content-primary">
            {isEdit
              ? t('esg.edit_reading', { defaultValue: 'Edit reading' })
              : t('esg.new_reading', { defaultValue: 'New reading' })}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('common.close', { defaultValue: 'Close' })}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-content-tertiary hover:bg-surface-secondary hover:text-content-primary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-4 space-y-4">
          {/* Metric + period */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="esg-metric" className="block text-sm font-medium text-content-primary mb-1.5">
                {t('esg.field_metric', { defaultValue: 'Metric' })}
              </label>
              <select
                id="esg-metric"
                value={metricKey}
                onChange={(e) => setMetricKey(e.target.value)}
                disabled={isEdit}
                className={clsx(inputCls, isEdit && 'opacity-60 cursor-not-allowed')}
              >
                {CATEGORY_ORDER.map((cat) => (
                  <optgroup
                    key={cat}
                    label={t(`esg.category_${cat}`, { defaultValue: CATEGORY_META[cat].label })}
                  >
                    {grouped[cat].map((m) => (
                      <option key={m.key} value={m.key}>
                        {t(`esg.metric_${m.key}`, { defaultValue: m.label })} ({m.unit})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="esg-period" className="block text-sm font-medium text-content-primary mb-1.5">
                {t('esg.field_period', { defaultValue: 'Period' })}
              </label>
              <input
                id="esg-period"
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                disabled={isEdit}
                className={clsx(inputCls, isEdit && 'opacity-60 cursor-not-allowed')}
              />
            </div>
          </div>

          {/* Value + target */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="esg-value" className="block text-sm font-medium text-content-primary mb-1.5">
                {t('esg.field_value', { defaultValue: 'Value' })}{' '}
                {selectedMetric && (
                  <span className="text-content-tertiary font-normal">({selectedMetric.unit})</span>
                )}{' '}
                <span className="text-semantic-error">*</span>
              </label>
              <input
                id="esg-value"
                type="number"
                step="any"
                min="0"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setTouched(true);
                }}
                className={clsx(
                  inputCls,
                  valueError && 'border-semantic-error focus:ring-red-300 focus:border-semantic-error',
                )}
                autoFocus
              />
              {valueError && (
                <p className="mt-1 text-xs text-semantic-error">
                  {t('esg.value_invalid', { defaultValue: 'Enter a value of zero or more' })}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="esg-target" className="block text-sm font-medium text-content-primary mb-1.5">
                {t('esg.field_target', { defaultValue: 'Target' })}{' '}
                <span className="text-content-tertiary font-normal">
                  ({t('common.optional', { defaultValue: 'optional' })})
                </span>
              </label>
              <input
                id="esg-target"
                type="number"
                step="any"
                min="0"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          {/* Note */}
          <div>
            <label htmlFor="esg-note" className="block text-sm font-medium text-content-primary mb-1.5">
              {t('esg.field_note', { defaultValue: 'Note' })}
            </label>
            <textarea
              id="esg-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue resize-none"
              placeholder={t('esg.note_placeholder', {
                defaultValue: 'Optional context for this reading...',
              })}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-light">
          <Button variant="ghost" onClick={onClose} disabled={saveMut.isPending}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={saveMut.isPending || !canSubmit}>
            {saveMut.isPending && (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent mr-2 shrink-0" />
            )}
            {isEdit
              ? t('common.save', { defaultValue: 'Save' })
              : t('esg.add_reading', { defaultValue: 'Add reading' })}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Recent readings table ─────────────────────────────────────────────── */

function RecentReadings({
  entries,
  metrics,
  onEdit,
  onDelete,
}: {
  entries: EsgEntry[];
  metrics: EsgMetricDefinition[];
  onEdit: (entry: EsgEntry) => void;
  onDelete: (entry: EsgEntry) => void;
}) {
  const { t } = useTranslation();
  const byKey = useMemo(() => {
    const map = new Map<string, EsgMetricDefinition>();
    for (const m of metrics) map.set(m.key, m);
    return map;
  }, [metrics]);

  if (entries.length === 0) return null;

  const recent = entries.slice(0, 12);

  return (
    <Card padding="none" className="overflow-x-auto">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border-light bg-surface-secondary/30 text-2xs font-medium text-content-tertiary uppercase tracking-wider min-w-[560px]">
        <span className="flex-1">{t('esg.col_metric', { defaultValue: 'Metric' })}</span>
        <span className="w-24">{t('esg.col_period', { defaultValue: 'Period' })}</span>
        <span className="w-24 text-right">{t('esg.col_value', { defaultValue: 'Value' })}</span>
        <span className="w-24 text-right">{t('esg.col_target', { defaultValue: 'Target' })}</span>
        <span className="w-16 text-right">{t('esg.col_actions', { defaultValue: 'Actions' })}</span>
      </div>
      {recent.map((entry) => {
        const def = byKey.get(entry.metric_key);
        const unit = def?.unit ?? '';
        const label = def
          ? t(`esg.metric_${entry.metric_key}`, { defaultValue: def.label })
          : entry.metric_key;
        return (
          <div
            key={entry.id}
            className="flex items-center gap-3 px-4 py-2.5 border-b border-border-light last:border-b-0 min-w-[560px] hover:bg-surface-secondary/40 transition-colors"
          >
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-content-primary truncate">{label}</span>
              {entry.note && (
                <span className="block text-2xs text-content-tertiary truncate">{entry.note}</span>
              )}
            </span>
            <span className="w-24 text-xs text-content-secondary tabular-nums">
              {formatPeriod(entry.period)}
            </span>
            <span className="w-24 text-right text-sm text-content-primary tabular-nums">
              {fmtNum(toNum(entry.value))}
              <span className="text-2xs text-content-tertiary ml-1">{unit}</span>
            </span>
            <span className="w-24 text-right text-xs text-content-tertiary tabular-nums">
              {entry.target !== null ? fmtNum(toNum(entry.target)) : '-'}
            </span>
            <span className="w-16 flex items-center justify-end gap-1">
              <button
                onClick={() => onEdit(entry)}
                aria-label={t('common.edit', { defaultValue: 'Edit' })}
                className="p-1.5 rounded-lg text-content-tertiary hover:bg-surface-secondary hover:text-content-primary transition-colors"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => onDelete(entry)}
                aria-label={t('common.delete', { defaultValue: 'Delete' })}
                className="p-1.5 rounded-lg text-content-tertiary hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </span>
          </div>
        );
      })}
    </Card>
  );
}

/* ── Main page ─────────────────────────────────────────────────────────── */

export function EsgPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const activeProjectId = useProjectContextStore((s) => s.activeProjectId);

  const [modalOpen, setModalOpen] = useState(false);
  const [presetMetric, setPresetMetric] = useState<string | null>(null);
  const [editEntry, setEditEntry] = useState<EsgEntry | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiGet<Project[]>('/v1/projects/'),
    staleTime: 5 * 60_000,
  });
  const projectId = activeProjectId || projects[0]?.id || '';

  const { data: metrics = [] } = useQuery({
    queryKey: ['esg-metrics'],
    queryFn: fetchEsgMetrics,
    staleTime: Infinity,
  });

  const {
    data: summary,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['esg-summary', projectId],
    queryFn: () => fetchEsgSummary(projectId),
    enabled: !!projectId,
  });

  const { data: entries = [] } = useQuery({
    queryKey: ['esg-entries', projectId],
    queryFn: () => fetchEsgEntries(projectId),
    enabled: !!projectId,
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['esg-summary', projectId] });
    qc.invalidateQueries({ queryKey: ['esg-entries', projectId] });
  }, [qc, projectId]);

  const { confirm, ...confirmProps } = useConfirm();

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteEsgEntry(id),
    onSuccess: () => {
      invalidate();
      addToast({ type: 'success', title: t('esg.reading_deleted', { defaultValue: 'Reading deleted' }) });
    },
    onError: (e: unknown) => {
      addToast({
        type: 'error',
        title: t('esg.delete_failed', { defaultValue: 'Could not delete reading' }),
        message: getErrorMessage(e),
      });
    },
  });

  const openAdd = useCallback((metricKey: string | null) => {
    setEditEntry(null);
    setPresetMetric(metricKey);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((entry: EsgEntry) => {
    setPresetMetric(null);
    setEditEntry(entry);
    setModalOpen(true);
  }, []);

  const handleDelete = useCallback(
    async (entry: EsgEntry) => {
      const def = metrics.find((m) => m.key === entry.metric_key);
      const label = def
        ? t(`esg.metric_${entry.metric_key}`, { defaultValue: def.label })
        : entry.metric_key;
      const ok = await confirm({
        title: t('esg.confirm_delete_title', { defaultValue: 'Delete reading?' }),
        message: t('esg.confirm_delete_msg', {
          defaultValue: 'Delete the {{label}} reading for {{period}}? This cannot be undone.',
          label,
          period: formatPeriod(entry.period),
        }),
        confirmLabel: t('common.delete', { defaultValue: 'Delete' }),
        variant: 'danger',
      });
      if (ok) deleteMut.mutate(entry.id);
    },
    [confirm, deleteMut, metrics, t],
  );

  const hasAnyReading = useMemo(
    () =>
      summary
        ? CATEGORY_ORDER.some((cat) =>
            (summary.by_category[cat] ?? []).some((m) => m.latest_value !== null),
          )
        : false,
    [summary],
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        srTitle={t('esg.title', { defaultValue: 'ESG Site Performance' })}
        subtitle={t('esg.subtitle', {
          defaultValue:
            'Track operational site ESG each period - energy, water, waste, site CO2e, local labour, training and safety - against your targets.',
        })}
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (!projectId) {
                addToast({
                  type: 'info',
                  title: t('esg.select_project_first_title', { defaultValue: 'Select a project first' }),
                  message: t('esg.select_project_first', {
                    defaultValue: 'Pick a project from the top bar, then add a reading.',
                  }),
                });
                return;
              }
              openAdd(null);
            }}
            className="shrink-0 whitespace-nowrap"
          >
            <Plus size={14} className="mr-1 shrink-0" />
            <span>{t('esg.add_reading', { defaultValue: 'Add reading' })}</span>
          </Button>
        }
      />

      {!projectId ? (
        <RequiresProject>{null}</RequiresProject>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl bg-surface-secondary" />
          ))}
        </div>
      ) : isError ? (
        <Card className="p-6">
          <p className="text-sm text-semantic-error">{getErrorMessage(error)}</p>
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="mt-3">
            {t('common.retry', { defaultValue: 'Retry' })}
          </Button>
        </Card>
      ) : (
        <>
          {/* Latest period strip */}
          {summary?.latest_period && (
            <div className="flex items-center gap-2 text-sm text-content-secondary">
              <Activity size={15} className="text-oe-blue shrink-0" />
              <span>
                {t('esg.latest_period', { defaultValue: 'Latest reporting period' })}:{' '}
                <span className="font-semibold text-content-primary">
                  {formatPeriod(summary.latest_period)}
                </span>
              </span>
            </div>
          )}

          {/* Pillars */}
          {CATEGORY_ORDER.map((cat) => {
            const cards = summary?.by_category[cat] ?? [];
            if (cards.length === 0) return null;
            const meta = CATEGORY_META[cat];
            const Icon = meta.icon;
            return (
              <section key={cat} className="space-y-3">
                <div className="flex items-center gap-2">
                  <Icon size={18} className={meta.accent} />
                  <h2 className="text-base font-semibold text-content-primary">
                    {t(`esg.category_${cat}`, { defaultValue: meta.label })}
                  </h2>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {cards.map((m) => (
                    <MetricCard key={m.metric_key} summary={m} onAdd={openAdd} />
                  ))}
                </div>
              </section>
            );
          })}

          {/* Recent readings */}
          {hasAnyReading ? (
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-content-primary">
                {t('esg.recent_readings', { defaultValue: 'Recent readings' })}
              </h2>
              <RecentReadings
                entries={entries}
                metrics={metrics}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            </section>
          ) : (
            <EmptyState
              icon={<Leaf size={28} strokeWidth={1.5} />}
              title={t('esg.no_data_title', { defaultValue: 'No ESG readings yet' })}
              description={t('esg.no_data_desc', {
                defaultValue:
                  'Record your first period reading to start tracking site energy, water, waste, labour and safety against targets.',
              })}
              action={{
                label: t('esg.add_reading', { defaultValue: 'Add reading' }),
                onClick: () => openAdd(null),
              }}
            />
          )}
        </>
      )}

      {modalOpen && projectId && (
        <ReadingModal
          metrics={metrics}
          projectId={projectId}
          editEntry={editEntry}
          presetMetric={presetMetric}
          onClose={() => setModalOpen(false)}
          onSaved={invalidate}
        />
      )}

      <ConfirmDialog {...confirmProps} />
    </div>
  );
}
