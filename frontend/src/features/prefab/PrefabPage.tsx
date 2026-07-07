import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  Boxes,
  Plus,
  X,
  ArrowRight,
  Search,
  Trash2,
  Calendar,
  FileText,
  ShieldCheck,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import {
  Button,
  Badge,
  EmptyState,
  Breadcrumb,
  DateDisplay,
  ConfirmDialog,
  RecoveryCard,
  SkeletonTable,
} from '@/shared/ui';
import { PageHeader } from '@/shared/ui/PageHeader';
import { DismissibleInfo } from '@/shared/ui/DismissibleInfo';
import { RequiresProject } from '@/shared/auth/RequiresProject';
import { useConfirm } from '@/shared/hooks/useConfirm';
import { apiGet } from '@/shared/lib/api';
import { useToastStore } from '@/stores/useToastStore';
import { useProjectContextStore } from '@/stores/useProjectContextStore';
import {
  fetchPrefabBoard,
  fetchPrefabStats,
  fetchUnitEvents,
  createPrefabUnit,
  advancePrefabUnit,
  deletePrefabUnit,
  nextStage,
  STAGE_ORDER,
  POST_QA_STAGES,
  UNIT_TYPES,
  type PrefabUnit,
  type PrefabStage,
  type PrefabUnitType,
  type PrefabBoardColumn,
  type CreatePrefabUnitPayload,
} from './api';

/* ── Constants ─────────────────────────────────────────────────────────── */

interface Project {
  id: string;
  name: string;
}

interface StageMeta {
  label: string;
  dot: string;
  badge: string;
  column: string;
}

const STAGE_META: Record<PrefabStage, StageMeta> = {
  design: {
    label: 'Design',
    dot: 'bg-slate-400',
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    column: 'border-slate-300 dark:border-slate-700',
  },
  approved_for_production: {
    label: 'Approved for production',
    dot: 'bg-indigo-400',
    badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    column: 'border-indigo-300 dark:border-indigo-800',
  },
  in_production: {
    label: 'In production',
    dot: 'bg-amber-400',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    column: 'border-amber-300 dark:border-amber-800',
  },
  qa: {
    label: 'QA',
    dot: 'bg-purple-400',
    badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    column: 'border-purple-300 dark:border-purple-800',
  },
  dispatched: {
    label: 'Dispatched',
    dot: 'bg-blue-400',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    column: 'border-blue-300 dark:border-blue-800',
  },
  delivered: {
    label: 'Delivered',
    dot: 'bg-teal-400',
    badge: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
    column: 'border-teal-300 dark:border-teal-800',
  },
  installed: {
    label: 'Installed',
    dot: 'bg-green-500',
    badge: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    column: 'border-green-300 dark:border-green-800',
  },
};

const DEFAULT_STAGE_META: StageMeta = {
  label: 'Unknown',
  dot: 'bg-gray-400',
  badge: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  column: 'border-gray-300 dark:border-gray-700',
};

const UNIT_TYPE_LABELS: Record<PrefabUnitType, string> = {
  pod: 'Pod',
  panel: 'Panel',
  module: 'Module',
  skid: 'Skid',
  volumetric: 'Volumetric',
  other: 'Other',
};

function stageMeta(stage: string): StageMeta {
  return (STAGE_META as Record<string, StageMeta>)[stage] ?? DEFAULT_STAGE_META;
}

const inputCls =
  'h-10 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';

/* ── Create Unit Modal ─────────────────────────────────────────────────── */

interface UnitFormData {
  ref: string;
  unit_type: PrefabUnitType;
  target_install_date: string;
  drawing_ref: string;
  notes: string;
}

const EMPTY_FORM: UnitFormData = {
  ref: '',
  unit_type: 'module',
  target_install_date: '',
  drawing_ref: '',
  notes: '',
};

function CreateUnitModal({
  onClose,
  onSubmit,
  isPending,
}: {
  onClose: () => void;
  onSubmit: (data: UnitFormData) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<UnitFormData>(EMPTY_FORM);
  const [touched, setTouched] = useState(false);

  const set = <K extends keyof UnitFormData>(key: K, value: UnitFormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const refError = touched && form.ref.trim().length === 0;
  const canSubmit = form.ref.trim().length > 0;

  const handleSubmit = () => {
    setTouched(true);
    if (canSubmit) onSubmit(form);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-lg animate-fade-in">
      <div
        className="w-full max-w-lg bg-surface-elevated rounded-xl shadow-xl border border-border animate-card-in mx-4 max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-label={t('prefab.new_unit', { defaultValue: 'New Unit' })}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
          <h2 className="text-lg font-semibold text-content-primary">
            {t('prefab.new_unit', { defaultValue: 'New Unit' })}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('common.close', { defaultValue: 'Close' })}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-content-tertiary hover:bg-surface-secondary hover:text-content-primary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-content-primary mb-1.5">
                {t('prefab.field_ref', { defaultValue: 'Unit reference' })}{' '}
                <span className="text-semantic-error">*</span>
              </label>
              <input
                value={form.ref}
                onChange={(e) => {
                  set('ref', e.target.value);
                  setTouched(true);
                }}
                placeholder={t('prefab.ref_placeholder', { defaultValue: 'e.g. POD-L03-14' })}
                className={clsx(
                  inputCls,
                  refError && 'border-semantic-error focus:ring-red-300 focus:border-semantic-error',
                )}
                autoFocus
              />
              {refError && (
                <p className="mt-1 text-xs text-semantic-error">
                  {t('prefab.ref_required', { defaultValue: 'A unit reference is required' })}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-content-primary mb-1.5">
                {t('prefab.field_type', { defaultValue: 'Unit type' })}
              </label>
              <select
                value={form.unit_type}
                onChange={(e) => set('unit_type', e.target.value as PrefabUnitType)}
                className={inputCls + ' appearance-none'}
              >
                {UNIT_TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`prefab.type_${ty}`, { defaultValue: UNIT_TYPE_LABELS[ty] })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-content-primary mb-1.5">
                {t('prefab.field_target_install', { defaultValue: 'Target install date' })}
              </label>
              <input
                type="date"
                value={form.target_install_date}
                onChange={(e) => set('target_install_date', e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-primary mb-1.5">
                {t('prefab.field_drawing_ref', { defaultValue: 'Drawing reference' })}
              </label>
              <input
                value={form.drawing_ref}
                onChange={(e) => set('drawing_ref', e.target.value)}
                placeholder={t('prefab.drawing_placeholder', { defaultValue: 'e.g. A-201 Rev C' })}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-content-primary mb-1.5">
              {t('prefab.field_notes', { defaultValue: 'Notes' })}
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue resize-none"
              placeholder={t('prefab.notes_placeholder', {
                defaultValue: 'Optional notes for this unit...',
              })}
            />
          </div>

          <p className="text-2xs text-content-tertiary">
            {t('prefab.create_starts_in_design', {
              defaultValue:
                'New units start in Design. Move them forward stage by stage from the board.',
            })}
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-light">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={isPending || !canSubmit}>
            {isPending ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent mr-2 shrink-0" />
            ) : (
              <Plus size={16} className="mr-1.5 shrink-0" />
            )}
            <span>{t('prefab.create_unit', { defaultValue: 'Create unit' })}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Unit Card ─────────────────────────────────────────────────────────── */

const UnitCard = React.memo(function UnitCard({
  unit,
  onOpen,
}: {
  unit: PrefabUnit;
  onOpen: (u: PrefabUnit) => void;
}) {
  const { t } = useTranslation();
  const typeLabel = t(`prefab.type_${unit.unit_type}`, {
    defaultValue: (UNIT_TYPE_LABELS as Record<string, string>)[unit.unit_type] ?? unit.unit_type,
  });
  return (
    <button
      onClick={() => onOpen(unit)}
      className="w-full text-left rounded-lg border border-border-light bg-surface-primary p-3 shadow-xs hover:shadow-sm hover:border-oe-blue/40 transition-all"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-mono font-semibold text-content-primary truncate">
          {unit.ref}
        </span>
        <Badge variant="neutral" size="sm">
          {typeLabel}
        </Badge>
      </div>
      {unit.notes && (
        <p className="mt-1 text-2xs text-content-tertiary line-clamp-2">{unit.notes}</p>
      )}
      <div className="mt-2 flex items-center gap-3 text-2xs text-content-tertiary">
        {unit.target_install_date && (
          <span className="inline-flex items-center gap-1">
            <Calendar size={11} />
            <DateDisplay value={unit.target_install_date} />
          </span>
        )}
        {unit.drawing_ref && (
          <span className="inline-flex items-center gap-1 truncate">
            <FileText size={11} />
            {unit.drawing_ref}
          </span>
        )}
      </div>
    </button>
  );
});

/* ── Unit Detail Drawer (timeline + advance control) ───────────────────── */

function UnitDetailDrawer({
  unit,
  onClose,
  onAdvance,
  onDelete,
  isAdvancing,
}: {
  unit: PrefabUnit;
  onClose: () => void;
  onAdvance: (note: string) => void;
  onDelete: () => void;
  isAdvancing: boolean;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');

  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ['prefab-events', unit.id],
    queryFn: () => fetchUnitEvents(unit.id),
  });

  const meta = stageMeta(unit.status);
  const next = nextStage(unit.status);
  const nextMeta = next ? stageMeta(next) : null;
  const hasPassedQa = POST_QA_STAGES.includes(unit.status as PrefabStage) || unit.status === 'qa';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 animate-fade-in" onClick={onClose}>
      <div
        className="h-full w-full max-w-md bg-surface-primary shadow-2xl border-l border-border flex flex-col animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-mono font-semibold text-content-primary truncate">
                {unit.ref}
              </span>
              <Badge variant="neutral" size="sm" className={meta.badge}>
                {t(`prefab.stage_${unit.status}`, { defaultValue: meta.label })}
              </Badge>
            </div>
            <p className="text-2xs text-content-tertiary mt-0.5">
              {t(`prefab.type_${unit.unit_type}`, {
                defaultValue:
                  (UNIT_TYPE_LABELS as Record<string, string>)[unit.unit_type] ?? unit.unit_type,
              })}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close', { defaultValue: 'Close' })}
            className="p-1 rounded hover:bg-surface-secondary shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Facts */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-2xs uppercase tracking-wide text-content-tertiary">
                {t('prefab.field_target_install', { defaultValue: 'Target install date' })}
              </p>
              <p className="text-content-primary">
                {unit.target_install_date ? (
                  <DateDisplay value={unit.target_install_date} />
                ) : (
                  '-'
                )}
              </p>
            </div>
            <div>
              <p className="text-2xs uppercase tracking-wide text-content-tertiary">
                {t('prefab.field_drawing_ref', { defaultValue: 'Drawing reference' })}
              </p>
              <p className="text-content-primary truncate">{unit.drawing_ref || '-'}</p>
            </div>
          </div>
          {unit.notes && (
            <div>
              <p className="text-2xs uppercase tracking-wide text-content-tertiary mb-1">
                {t('prefab.field_notes', { defaultValue: 'Notes' })}
              </p>
              <p className="text-sm text-content-secondary whitespace-pre-wrap">{unit.notes}</p>
            </div>
          )}

          {/* QA gate hint */}
          {hasPassedQa ? (
            <div className="flex items-start gap-2 rounded-lg border border-green-300/40 bg-green-50 dark:bg-green-900/15 px-3 py-2 text-xs text-green-700 dark:text-green-300">
              <ShieldCheck size={15} className="mt-0.5 shrink-0" />
              <span>
                {t('prefab.qa_passed_hint', {
                  defaultValue: 'QA passed. This unit is cleared for dispatch, delivery and install.',
                })}
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300/40 bg-amber-50 dark:bg-amber-900/15 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <ShieldCheck size={15} className="mt-0.5 shrink-0" />
              <span>
                {t('prefab.qa_pending_hint', {
                  defaultValue:
                    'This unit must pass QA before it can be dispatched, delivered or installed.',
                })}
              </span>
            </div>
          )}

          {/* Advance control */}
          <div className="rounded-lg border border-border-light bg-surface-secondary/40 p-3">
            <p className="text-2xs uppercase tracking-wide text-content-tertiary mb-2">
              {t('prefab.advance_stage', { defaultValue: 'Advance stage' })}
            </p>
            {next && nextMeta ? (
              <>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue resize-none mb-2"
                  placeholder={t('prefab.advance_note_placeholder', {
                    defaultValue: 'Optional note for the audit trail...',
                  })}
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => onAdvance(note.trim())}
                  disabled={isAdvancing}
                  className="w-full"
                >
                  {isAdvancing ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent mr-2 shrink-0" />
                  ) : (
                    <ArrowRight size={14} className="mr-1.5 shrink-0" />
                  )}
                  {t('prefab.advance_to', {
                    defaultValue: 'Advance to {{stage}}',
                    stage: t(`prefab.stage_${next}`, { defaultValue: nextMeta.label }),
                  })}
                </Button>
              </>
            ) : (
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300">
                <CheckCircle2 size={16} className="shrink-0" />
                {t('prefab.fully_installed', {
                  defaultValue: 'This unit is installed - the lifecycle is complete.',
                })}
              </div>
            )}
          </div>

          {/* Production event timeline */}
          <div>
            <p className="text-2xs uppercase tracking-wide text-content-tertiary mb-2">
              {t('prefab.timeline', { defaultValue: 'Production timeline' })}
            </p>
            {eventsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded bg-surface-tertiary" />
                ))}
              </div>
            ) : events.length === 0 ? (
              <p className="text-xs text-content-quaternary">
                {t('prefab.no_events', { defaultValue: 'No production events yet.' })}
              </p>
            ) : (
              <ol className="relative border-l border-border-light ml-1.5 space-y-3">
                {events.map((ev) => {
                  const evMeta = stageMeta(ev.stage);
                  return (
                    <li key={ev.id} className="ml-4">
                      <span
                        className={clsx(
                          'absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface-primary',
                          evMeta.dot,
                        )}
                      />
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="neutral" size="sm" className={evMeta.badge}>
                          {t(`prefab.stage_${ev.stage}`, { defaultValue: evMeta.label })}
                        </Badge>
                        <span className="inline-flex items-center gap-1 text-2xs text-content-tertiary">
                          <Clock size={11} />
                          <DateDisplay value={ev.at} format="datetime" />
                        </span>
                      </div>
                      {ev.note && (
                        <p className="mt-1 text-xs text-content-secondary">{ev.note}</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border shrink-0">
          <Button variant="ghost" size="sm" onClick={onDelete} className="text-semantic-error">
            <Trash2 size={14} className="mr-1" />
            {t('common.delete', { defaultValue: 'Delete' })}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.close', { defaultValue: 'Close' })}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ─────────────────────────────────────────────────────────── */

export function PrefabPage() {
  const { t } = useTranslation();
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const activeProjectId = useProjectContextStore((s) => s.activeProjectId);

  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<PrefabUnit | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiGet<Project[]>('/v1/projects/'),
    staleTime: 5 * 60_000,
  });

  const projectId = routeProjectId || activeProjectId || projects[0]?.id || '';
  const projectName = projects.find((p) => p.id === projectId)?.name || '';

  const {
    data: board,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['prefab-board', projectId],
    queryFn: () => fetchPrefabBoard(projectId),
    enabled: !!projectId,
  });

  const { data: stats } = useQuery({
    queryKey: ['prefab-stats', projectId],
    queryFn: () => fetchPrefabStats(projectId),
    enabled: !!projectId,
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['prefab-board', projectId] });
    qc.invalidateQueries({ queryKey: ['prefab-stats', projectId] });
  }, [qc, projectId]);

  const createMut = useMutation({
    mutationFn: (data: CreatePrefabUnitPayload) => createPrefabUnit(data),
    onSuccess: (created) => {
      setShowCreate(false);
      invalidate();
      addToast({
        type: 'success',
        title: t('prefab.created', { defaultValue: 'Unit created' }),
        message: created?.ref,
      });
    },
    onError: (e: Error) => {
      addToast({
        type: 'error',
        title: t('prefab.create_failed', { defaultValue: 'Could not create unit' }),
        message: e.message,
      });
    },
  });

  const advanceMut = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      advancePrefabUnit(id, note ? { note } : {}),
    onSuccess: (updated) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['prefab-events', updated.id] });
      setSelected(updated);
      addToast({
        type: 'success',
        title: t('prefab.advanced', { defaultValue: 'Stage advanced' }),
        message: t(`prefab.stage_${updated.status}`, {
          defaultValue: stageMeta(updated.status).label,
        }),
      });
    },
    onError: (e: Error) => {
      addToast({
        type: 'error',
        title: t('prefab.advance_failed', { defaultValue: 'Could not advance stage' }),
        message: e.message,
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePrefabUnit(id),
    onSuccess: () => {
      invalidate();
      setSelected(null);
      addToast({ type: 'success', title: t('prefab.deleted', { defaultValue: 'Unit deleted' }) });
    },
    onError: (e: Error) => {
      addToast({
        type: 'error',
        title: t('prefab.delete_failed', { defaultValue: 'Could not delete unit' }),
        message: e.message,
      });
    },
  });

  const { confirm, ...confirmProps } = useConfirm();

  const handleCreate = useCallback(
    (formData: UnitFormData) => {
      if (!projectId) return;
      createMut.mutate({
        project_id: projectId,
        ref: formData.ref.trim(),
        unit_type: formData.unit_type,
        target_install_date: formData.target_install_date || undefined,
        drawing_ref: formData.drawing_ref.trim() || undefined,
        notes: formData.notes.trim() || undefined,
      });
    },
    [createMut, projectId],
  );

  const handleDelete = useCallback(
    async (unit: PrefabUnit) => {
      const ok = await confirm({
        title: t('prefab.confirm_delete_title', { defaultValue: 'Delete unit?' }),
        message: t('prefab.confirm_delete_msg', {
          defaultValue: 'This permanently removes {{ref}} and its production history.',
          ref: unit.ref,
        }),
        confirmLabel: t('common.delete', { defaultValue: 'Delete' }),
        variant: 'danger',
      });
      if (ok) deleteMut.mutate(unit.id);
    },
    [confirm, deleteMut, t],
  );

  // Filter columns by the client-side search box.
  const columns = useMemo<PrefabBoardColumn[]>(() => {
    const src: PrefabBoardColumn[] =
      board?.columns ?? STAGE_ORDER.map((stage) => ({ stage, count: 0, units: [] }));
    if (!search.trim()) return src;
    const q = search.toLowerCase();
    return src.map((col) => {
      const units = col.units.filter(
        (u) =>
          u.ref.toLowerCase().includes(q) ||
          Boolean(u.drawing_ref && u.drawing_ref.toLowerCase().includes(q)) ||
          Boolean(u.notes && u.notes.toLowerCase().includes(q)),
      );
      return { ...col, units, count: units.length };
    });
  }, [board, search]);

  const total = stats?.total ?? board?.total ?? 0;

  return (
    <div className="space-y-5 animate-fade-in">
      <Breadcrumb
        items={[
          ...(projectName ? [{ label: projectName, to: `/projects/${projectId}` }] : []),
          { label: t('prefab.title', { defaultValue: 'Off-site / Prefab' }) },
        ]}
      />

      <PageHeader
        srTitle={t('prefab.title', { defaultValue: 'Off-site / Prefab' })}
        subtitle={t('prefab.subtitle', {
          defaultValue:
            'Track every off-site unit from design to installation, with a hard quality gate before anything ships.',
        })}
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (!projectId) {
                addToast({
                  type: 'info',
                  title: t('prefab.select_project_first_title', {
                    defaultValue: 'Select a project first',
                  }),
                  message: t('prefab.select_project_first', {
                    defaultValue: 'Pick a project from the top bar, then add a unit.',
                  }),
                });
                return;
              }
              setShowCreate(true);
            }}
            className="shrink-0 whitespace-nowrap"
          >
            <Plus size={14} className="mr-1 shrink-0" />
            <span>{t('prefab.new_unit', { defaultValue: 'New Unit' })}</span>
          </Button>
        }
      />

      <DismissibleInfo
        storageKey="prefab"
        title={t('prefab.intro_title', {
          defaultValue: 'One register for everything made off-site',
        })}
      >
        {t('prefab.intro_body', {
          defaultValue:
            'Design for Manufacture and Assembly: register pods, panels, volumetric modules and skids, then move each one along the production line - design, approved, in production, QA, dispatched, delivered, installed. A unit can never be dispatched, delivered or installed until it has passed QA, and every stage change is recorded.',
        })}
      </DismissibleInfo>

      {/* Summary cards */}
      {projectId && total > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <div className="flex flex-col rounded-xl border border-border-light bg-surface-elevated/90 p-3 shadow-xs">
            <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {t('prefab.stat_total', { defaultValue: 'Total' })}
            </span>
            <span className="mt-1 text-2xl font-bold tabular-nums text-content-primary">
              {total}
            </span>
          </div>
          {STAGE_ORDER.map((stage) => (
            <div
              key={stage}
              className="flex flex-col rounded-xl border border-border-light bg-surface-elevated/90 p-3 shadow-xs"
            >
              <span className="inline-flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                <span className={clsx('h-2 w-2 rounded-full', stageMeta(stage).dot)} />
                <span className="truncate">
                  {t(`prefab.stage_${stage}`, { defaultValue: stageMeta(stage).label })}
                </span>
              </span>
              <span className="mt-1 text-2xl font-bold tabular-nums text-content-primary">
                {stats?.by_status?.[stage] ?? 0}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      {projectId && (
        <div className="relative max-w-sm">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('prefab.search_placeholder', { defaultValue: 'Search units...' })}
            className={inputCls + ' pl-9'}
          />
        </div>
      )}

      {/* Board */}
      {!projectId ? (
        <RequiresProject>{null}</RequiresProject>
      ) : isLoading ? (
        <SkeletonTable rows={4} columns={4} />
      ) : isError ? (
        <RecoveryCard error={error} onRetry={() => refetch()} />
      ) : total === 0 ? (
        <EmptyState
          icon={<Boxes size={28} strokeWidth={1.5} />}
          title={t('prefab.no_units', { defaultValue: 'No units yet' })}
          description={t('prefab.no_units_hint', {
            defaultValue: 'Register your first off-site unit to start tracking production.',
          })}
          action={{
            label: t('prefab.new_unit', { defaultValue: 'New Unit' }),
            onClick: () => setShowCreate(true),
          }}
        />
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-3 min-w-max">
            {columns.map((col) => {
              const meta = stageMeta(col.stage);
              const isGate = col.stage === 'dispatched';
              return (
                <React.Fragment key={col.stage}>
                  {isGate && (
                    <div
                      className="flex flex-col items-center gap-1 px-1 pt-8"
                      title={t('prefab.qa_gate_tooltip', {
                        defaultValue: 'Quality gate: units must pass QA before this point',
                      })}
                    >
                      <ShieldCheck size={16} className="text-purple-400 shrink-0" />
                      <div className="flex-1 w-px border-l-2 border-dashed border-purple-300 dark:border-purple-700" />
                    </div>
                  )}
                  <div className="w-64 shrink-0">
                    <div
                      className={clsx(
                        'flex items-center justify-between rounded-t-lg border-t-2 bg-surface-secondary/40 px-3 py-2',
                        meta.column,
                      )}
                    >
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-content-primary">
                        <span className={clsx('h-2 w-2 rounded-full', meta.dot)} />
                        {t(`prefab.stage_${col.stage}`, { defaultValue: meta.label })}
                      </span>
                      <span className="text-2xs tabular-nums px-1.5 py-0.5 rounded-full bg-surface-tertiary text-content-tertiary">
                        {col.count}
                      </span>
                    </div>
                    <div className="rounded-b-lg border border-t-0 border-border-light bg-surface-secondary/20 p-2 space-y-2 min-h-[120px]">
                      {col.units.length === 0 ? (
                        <p className="text-2xs text-content-quaternary text-center py-6">
                          {t('prefab.empty_stage', { defaultValue: 'Nothing here' })}
                        </p>
                      ) : (
                        col.units.map((u) => (
                          <UnitCard key={u.id} unit={u} onOpen={setSelected} />
                        ))
                      )}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateUnitModal
          onClose={() => setShowCreate(false)}
          onSubmit={handleCreate}
          isPending={createMut.isPending}
        />
      )}

      {/* Detail drawer */}
      {selected && (
        <UnitDetailDrawer
          unit={selected}
          onClose={() => setSelected(null)}
          onAdvance={(note) => advanceMut.mutate({ id: selected.id, note })}
          onDelete={() => handleDelete(selected)}
          isAdvancing={advanceMut.isPending}
        />
      )}

      <ConfirmDialog {...confirmProps} />
    </div>
  );
}
