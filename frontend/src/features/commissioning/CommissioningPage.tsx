// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import React, { useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ClipboardCheck,
  Plus,
  X,
  ChevronRight,
  Check,
  Ban,
  Circle,
  CircleSlash,
  AlertTriangle,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  Button,
  Card,
  Badge,
  EmptyState,
  SkeletonTable,
  ConfirmDialog,
} from '@/shared/ui';
import { PageHeader } from '@/shared/ui/PageHeader';
import { RequiresProject } from '@/shared/auth/RequiresProject';
import { useConfirm } from '@/shared/hooks/useConfirm';
import { apiGet } from '@/shared/lib/api';
import { useToastStore } from '@/stores/useToastStore';
import { useProjectContextStore } from '@/stores/useProjectContextStore';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  fetchSystems,
  createSystem,
  deleteSystem,
  commissionSystem,
  fetchCxStats,
  fetchChecklists,
  createChecklist,
  fetchItems,
  createItem,
  setItemResult,
  fetchIssues,
  createIssue,
  updateIssue,
  type CxSystem,
  type CxSystemStatus,
  type CxSystemType,
  type CxChecklist,
  type CxChecklistItem,
  type ChecklistKind,
  type ItemResult,
  type IssueSeverity,
  type ReadinessLevel,
  type CreateSystemPayload,
} from './api';

/* ── Config maps ───────────────────────────────────────────────────────── */

const SYSTEM_TYPES: CxSystemType[] = [
  'hvac',
  'electrical',
  'fire',
  'plumbing',
  'mechanical',
  'controls',
  'elevator',
  'security',
  'other',
];

const TYPE_LABELS: Record<CxSystemType, string> = {
  hvac: 'HVAC',
  electrical: 'Electrical',
  fire: 'Fire protection',
  plumbing: 'Plumbing',
  mechanical: 'Mechanical',
  controls: 'Controls / BMS',
  elevator: 'Elevator',
  security: 'Security',
  other: 'Other',
};

const STATUS_CONFIG: Record<
  CxSystemStatus,
  { variant: 'neutral' | 'blue' | 'success' | 'warning'; label: string }
> = {
  not_started: { variant: 'neutral', label: 'Not started' },
  in_progress: { variant: 'warning', label: 'In progress' },
  tests_complete: { variant: 'blue', label: 'Tests complete' },
  commissioned: { variant: 'success', label: 'Commissioned' },
};

const LEVEL_DOT: Record<ReadinessLevel, string> = {
  green: 'bg-semantic-success',
  amber: 'bg-semantic-warning',
  red: 'bg-semantic-error',
};

const LEVEL_BAR: Record<ReadinessLevel, string> = {
  green: 'bg-semantic-success',
  amber: 'bg-semantic-warning',
  red: 'bg-semantic-error',
};

const SEVERITY_VARIANT: Record<IssueSeverity, 'neutral' | 'blue' | 'warning' | 'error'> = {
  low: 'neutral',
  medium: 'blue',
  high: 'warning',
  critical: 'error',
};

const inputCls =
  'h-9 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';

/** App RBAC roles that may run the gated commission action (manager+). */
function canCommissionRole(role: string | null | undefined): boolean {
  const r = (role ?? 'viewer').trim().toLowerCase();
  const admins = new Set(['admin', 'superuser', 'owner']);
  const managers = new Set(['manager']);
  return admins.has(r) || managers.has(r);
}

/* ── Readiness light ───────────────────────────────────────────────────── */

function ReadinessLight({ system }: { system: CxSystem }) {
  const { t } = useTranslation();
  const readiness = system.readiness;
  const level: ReadinessLevel = readiness?.readiness_level ?? 'red';
  const pct = readiness && readiness.defined ? Math.round(readiness.readiness_pct) : null;

  return (
    <div className="flex items-center gap-2 w-40 shrink-0">
      <span
        className={clsx('h-2.5 w-2.5 rounded-full shrink-0', LEVEL_DOT[level])}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <div className="h-1.5 w-full rounded-full bg-surface-tertiary overflow-hidden">
          <div
            className={clsx('h-full rounded-full transition-all', LEVEL_BAR[level])}
            style={{ width: `${pct ?? 0}%` }}
          />
        </div>
      </div>
      <span className="text-2xs tabular-nums text-content-tertiary w-9 text-right shrink-0">
        {pct === null
          ? t('commissioning.no_tests_short', { defaultValue: 'n/a' })
          : `${pct}%`}
      </span>
    </div>
  );
}

/* ── Item row (pass / fail / na) ───────────────────────────────────────── */

const RESULTS: { key: ItemResult; icon: typeof Check; on: string; off: string; label: string }[] = [
  {
    key: 'pass',
    icon: Check,
    on: 'bg-semantic-success text-white border-semantic-success',
    off: 'text-semantic-success border-border hover:bg-semantic-success-bg',
    label: 'Pass',
  },
  {
    key: 'fail',
    icon: Ban,
    on: 'bg-semantic-error text-white border-semantic-error',
    off: 'text-semantic-error border-border hover:bg-semantic-error-bg',
    label: 'Fail',
  },
  {
    key: 'na',
    icon: CircleSlash,
    on: 'bg-content-tertiary text-white border-content-tertiary',
    off: 'text-content-tertiary border-border hover:bg-surface-secondary',
    label: 'N/A',
  },
];

function ItemRow({
  item,
  onResult,
  disabled,
}: {
  item: CxChecklistItem;
  onResult: (itemId: string, result: ItemResult) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border-light last:border-b-0">
      <span className="flex-1 min-w-0 text-sm text-content-primary">{item.description}</span>
      <div className="flex items-center gap-1 shrink-0">
        {RESULTS.map(({ key, icon: Icon, on, off, label }) => {
          const active = item.status === key;
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onResult(item.id, key)}
              aria-pressed={active}
              title={t(`commissioning.result_${key}`, { defaultValue: label })}
              className={clsx(
                'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-2xs font-medium transition-colors disabled:opacity-50',
                active ? on : off,
              )}
            >
              <Icon size={12} />
              {t(`commissioning.result_${key}`, { defaultValue: label })}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Checklists panel ──────────────────────────────────────────────────── */

function ChecklistBlock({
  checklist,
  onAfterChange,
}: {
  checklist: CxChecklist;
  onAfterChange: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [newItem, setNewItem] = useState('');

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['cx-items', checklist.id],
    queryFn: () => fetchItems(checklist.id),
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['cx-items', checklist.id] });
    onAfterChange();
  }, [qc, checklist.id, onAfterChange]);

  const resultMut = useMutation({
    mutationFn: ({ itemId, result }: { itemId: string; result: ItemResult }) =>
      setItemResult(itemId, { status: result }),
    onSuccess: invalidate,
    onError: (e: Error) =>
      addToast({ type: 'error', title: t('commissioning.result_failed', { defaultValue: 'Could not save result' }), message: e.message }),
  });

  const addItemMut = useMutation({
    mutationFn: (description: string) => createItem(checklist.id, { description }),
    onSuccess: () => {
      setNewItem('');
      invalidate();
    },
    onError: (e: Error) =>
      addToast({ type: 'error', title: t('commissioning.add_item_failed', { defaultValue: 'Could not add item' }), message: e.message }),
  });

  const passed = items.filter((i) => i.status === 'pass').length;

  return (
    <div className="rounded-lg border border-border-light bg-surface-primary p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant={checklist.kind === 'functional' ? 'blue' : 'neutral'} size="sm">
            {t(`commissioning.kind_${checklist.kind}`, {
              defaultValue: checklist.kind === 'functional' ? 'Functional' : 'Prefunctional',
            })}
          </Badge>
          <span className="text-sm font-medium text-content-primary truncate">{checklist.title}</span>
        </div>
        <span className="text-2xs text-content-tertiary tabular-nums shrink-0">
          {passed}/{items.length} {t('commissioning.passed', { defaultValue: 'passed' })}
        </span>
      </div>

      {isLoading ? (
        <div className="h-8 animate-pulse rounded bg-surface-secondary" />
      ) : items.length === 0 ? (
        <p className="text-xs text-content-quaternary py-1">
          {t('commissioning.no_items', { defaultValue: 'No checks yet. Add the first one below.' })}
        </p>
      ) : (
        <div>
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              disabled={resultMut.isPending}
              onResult={(itemId, result) => resultMut.mutate({ itemId, result })}
            />
          ))}
        </div>
      )}

      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newItem.trim()) addItemMut.mutate(newItem.trim());
        }}
      >
        <input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder={t('commissioning.add_item_placeholder', { defaultValue: 'Add a check...' })}
          className={inputCls}
        />
        <Button type="submit" variant="secondary" size="sm" disabled={!newItem.trim() || addItemMut.isPending}>
          <Plus size={14} />
        </Button>
      </form>
    </div>
  );
}

function ChecklistsPanel({ systemId, onAfterChange }: { systemId: string; onAfterChange: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [newKind, setNewKind] = useState<ChecklistKind>('functional');
  const [newTitle, setNewTitle] = useState('');

  const { data: checklists = [], isLoading } = useQuery({
    queryKey: ['cx-checklists', systemId],
    queryFn: () => fetchChecklists(systemId),
  });

  const addMut = useMutation({
    mutationFn: () => createChecklist(systemId, { kind: newKind, title: newTitle.trim() }),
    onSuccess: () => {
      setNewTitle('');
      qc.invalidateQueries({ queryKey: ['cx-checklists', systemId] });
    },
    onError: (e: Error) =>
      addToast({ type: 'error', title: t('commissioning.add_checklist_failed', { defaultValue: 'Could not add checklist' }), message: e.message }),
  });

  return (
    <div className="space-y-2">
      <p className="text-2xs font-semibold uppercase tracking-wide text-content-tertiary">
        {t('commissioning.checklists', { defaultValue: 'Checklists' })}
      </p>
      {isLoading ? (
        <div className="h-10 animate-pulse rounded bg-surface-secondary" />
      ) : checklists.length === 0 ? (
        <p className="text-xs text-content-quaternary">
          {t('commissioning.no_checklists', {
            defaultValue: 'No checklists yet. Add a functional checklist so this system can be scored.',
          })}
        </p>
      ) : (
        <div className="space-y-2">
          {checklists.map((c) => (
            <ChecklistBlock key={c.id} checklist={c} onAfterChange={onAfterChange} />
          ))}
        </div>
      )}

      <form
        className="flex items-center gap-2 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (newTitle.trim()) addMut.mutate();
        }}
      >
        <select
          value={newKind}
          onChange={(e) => setNewKind(e.target.value as ChecklistKind)}
          className={inputCls + ' w-40 shrink-0'}
          aria-label={t('commissioning.checklist_kind', { defaultValue: 'Checklist kind' })}
        >
          <option value="functional">{t('commissioning.kind_functional', { defaultValue: 'Functional' })}</option>
          <option value="prefunctional">
            {t('commissioning.kind_prefunctional', { defaultValue: 'Prefunctional' })}
          </option>
        </select>
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder={t('commissioning.add_checklist_placeholder', { defaultValue: 'New checklist title...' })}
          className={inputCls}
        />
        <Button type="submit" variant="secondary" size="sm" disabled={!newTitle.trim() || addMut.isPending}>
          <Plus size={14} className="mr-1" />
          {t('commissioning.add', { defaultValue: 'Add' })}
        </Button>
      </form>
    </div>
  );
}

/* ── Issues panel ──────────────────────────────────────────────────────── */

function IssuesPanel({ systemId, onAfterChange }: { systemId: string; onAfterChange: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [desc, setDesc] = useState('');
  const [severity, setSeverity] = useState<IssueSeverity>('medium');

  const { data: issues = [], isLoading } = useQuery({
    queryKey: ['cx-issues', systemId],
    queryFn: () => fetchIssues(systemId),
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['cx-issues', systemId] });
    onAfterChange();
  }, [qc, systemId, onAfterChange]);

  const addMut = useMutation({
    mutationFn: () => createIssue(systemId, { description: desc.trim(), severity }),
    onSuccess: () => {
      setDesc('');
      setSeverity('medium');
      invalidate();
    },
    onError: (e: Error) =>
      addToast({ type: 'error', title: t('commissioning.add_issue_failed', { defaultValue: 'Could not add issue' }), message: e.message }),
  });

  const closeMut = useMutation({
    mutationFn: (issueId: string) => updateIssue(issueId, { status: 'closed' }),
    onSuccess: invalidate,
    onError: (e: Error) =>
      addToast({ type: 'error', title: t('commissioning.close_issue_failed', { defaultValue: 'Could not close issue' }), message: e.message }),
  });

  return (
    <div className="space-y-2">
      <p className="text-2xs font-semibold uppercase tracking-wide text-content-tertiary">
        {t('commissioning.issues', { defaultValue: 'Issues' })}
      </p>
      {isLoading ? (
        <div className="h-10 animate-pulse rounded bg-surface-secondary" />
      ) : issues.length === 0 ? (
        <p className="text-xs text-content-quaternary">
          {t('commissioning.no_issues', { defaultValue: 'No issues logged.' })}
        </p>
      ) : (
        <div className="space-y-1">
          {issues.map((issue) => (
            <div
              key={issue.id}
              className="flex items-center gap-2 rounded-lg bg-surface-secondary/60 px-3 py-2 text-sm"
            >
              <Badge variant={SEVERITY_VARIANT[issue.severity]} size="sm">
                {t(`commissioning.severity_${issue.severity}`, { defaultValue: issue.severity })}
              </Badge>
              <span
                className={clsx(
                  'flex-1 min-w-0 truncate',
                  issue.status === 'closed' && 'line-through text-content-tertiary',
                )}
              >
                {issue.description}
              </span>
              {issue.status === 'open' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => closeMut.mutate(issue.id)}
                  disabled={closeMut.isPending}
                >
                  <Check size={13} className="mr-1" />
                  {t('commissioning.close', { defaultValue: 'Close' })}
                </Button>
              ) : (
                <Badge variant="success" size="sm">
                  {t('commissioning.closed', { defaultValue: 'Closed' })}
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}

      <form
        className="flex items-center gap-2 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (desc.trim()) addMut.mutate();
        }}
      >
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as IssueSeverity)}
          className={inputCls + ' w-32 shrink-0'}
          aria-label={t('commissioning.severity', { defaultValue: 'Severity' })}
        >
          {(['low', 'medium', 'high', 'critical'] as IssueSeverity[]).map((s) => (
            <option key={s} value={s}>
              {t(`commissioning.severity_${s}`, { defaultValue: s })}
            </option>
          ))}
        </select>
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={t('commissioning.add_issue_placeholder', { defaultValue: 'Describe an issue...' })}
          className={inputCls}
        />
        <Button type="submit" variant="secondary" size="sm" disabled={!desc.trim() || addMut.isPending}>
          <Plus size={14} className="mr-1" />
          {t('commissioning.add', { defaultValue: 'Add' })}
        </Button>
      </form>
    </div>
  );
}

/* ── System card ───────────────────────────────────────────────────────── */

const SystemCard = React.memo(function SystemCard({
  system,
  canCommission,
  onCommission,
  onDelete,
  onAfterChange,
}: {
  system: CxSystem;
  canCommission: boolean;
  onCommission: (system: CxSystem) => void;
  onDelete: (system: CxSystem) => void;
  onAfterChange: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const statusCfg = STATUS_CONFIG[system.status] ?? STATUS_CONFIG.not_started;
  const readiness = system.readiness;
  const commissionable =
    canCommission && system.status !== 'commissioned' && !!readiness?.can_commission;

  return (
    <div className="border-b border-border-light last:border-b-0">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface-secondary/50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <ChevronRight
          size={14}
          className={clsx('text-content-tertiary transition-transform shrink-0', expanded && 'rotate-90')}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-content-primary truncate">{system.name}</span>
            {system.tag && (
              <span className="text-2xs font-mono text-content-tertiary shrink-0">{system.tag}</span>
            )}
          </div>
          <span className="text-2xs text-content-tertiary">
            {t(`commissioning.type_${system.system_type}`, {
              defaultValue: TYPE_LABELS[system.system_type as CxSystemType] ?? system.system_type,
            })}
            {system.location ? ` · ${system.location}` : ''}
          </span>
        </div>

        <ReadinessLight system={system} />

        <Badge variant={statusCfg.variant} size="sm" className="hidden sm:inline-flex">
          {t(`commissioning.status_${system.status}`, { defaultValue: statusCfg.label })}
        </Badge>

        {readiness && readiness.open_critical_issues > 0 && (
          <span
            title={t('commissioning.open_critical_tooltip', {
              defaultValue: 'Open critical issues block commissioning',
            })}
            className="hidden md:inline-flex"
          >
            <Badge variant="error" size="sm">
              <AlertTriangle size={11} className="mr-0.5" />
              {readiness.open_critical_issues}
            </Badge>
          </span>
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-4 pl-11 space-y-4 animate-fade-in">
          {/* Actions + blockers */}
          <div className="flex flex-wrap items-center gap-2">
            {system.status === 'commissioned' ? (
              <Badge variant="success" size="sm">
                <ShieldCheck size={12} className="mr-1" />
                {t('commissioning.commissioned_on', {
                  defaultValue: 'Commissioned',
                })}
              </Badge>
            ) : commissionable ? (
              <Button variant="primary" size="sm" onClick={() => onCommission(system)}>
                <ShieldCheck size={14} className="mr-1" />
                {t('commissioning.commission', { defaultValue: 'Commission system' })}
              </Button>
            ) : (
              canCommission && (
                <span
                  className="inline-flex items-center gap-1.5 text-2xs text-content-tertiary"
                  title={readiness?.blocking_reasons.join(' ') ?? ''}
                >
                  <Circle size={11} className="text-semantic-warning" />
                  {t('commissioning.not_ready', { defaultValue: 'Not ready to commission' })}
                </span>
              )
            )}
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => onDelete(system)}>
              <Trash2 size={13} className="mr-1" />
              {t('commissioning.delete', { defaultValue: 'Delete' })}
            </Button>
          </div>

          {readiness && readiness.blocking_reasons.length > 0 && system.status !== 'commissioned' && (
            <div className="rounded-lg border border-semantic-warning/30 bg-semantic-warning-bg/40 px-3 py-2">
              <p className="text-2xs font-semibold uppercase tracking-wide text-[#b45309] mb-1">
                {t('commissioning.blockers', { defaultValue: 'Before commissioning' })}
              </p>
              <ul className="list-disc pl-4 space-y-0.5">
                {readiness.blocking_reasons.map((r, i) => (
                  <li key={i} className="text-xs text-content-secondary">
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChecklistsPanel systemId={system.id} onAfterChange={onAfterChange} />
            <IssuesPanel systemId={system.id} onAfterChange={onAfterChange} />
          </div>
        </div>
      )}
    </div>
  );
});

/* ── Create system modal ───────────────────────────────────────────────── */

function CreateSystemModal({
  onClose,
  onSubmit,
  isPending,
}: {
  onClose: () => void;
  onSubmit: (data: Omit<CreateSystemPayload, 'project_id'>) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [systemType, setSystemType] = useState<CxSystemType>('hvac');
  const [tag, setTag] = useState('');
  const [location, setLocation] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-lg animate-fade-in">
      <div
        className="w-full max-w-lg bg-surface-elevated rounded-xl shadow-xl border border-border animate-card-in mx-4"
        role="dialog"
        aria-label={t('commissioning.new_system', { defaultValue: 'New system' })}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
          <h2 className="text-lg font-semibold text-content-primary">
            {t('commissioning.new_system', { defaultValue: 'New system' })}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('common.close', { defaultValue: 'Close' })}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-content-tertiary hover:bg-surface-secondary"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-content-primary mb-1.5">
              {t('commissioning.field_name', { defaultValue: 'System name' })}{' '}
              <span className="text-semantic-error">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('commissioning.name_placeholder', {
                defaultValue: 'e.g. AHU-1 Air Handling Unit',
              })}
              className={inputCls}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-content-primary mb-1.5">
                {t('commissioning.field_type', { defaultValue: 'System type' })}
              </label>
              <select
                value={systemType}
                onChange={(e) => setSystemType(e.target.value as CxSystemType)}
                className={inputCls}
              >
                {SYSTEM_TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`commissioning.type_${ty}`, { defaultValue: TYPE_LABELS[ty] })}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-content-primary mb-1.5">
                {t('commissioning.field_tag', { defaultValue: 'Tag' })}
              </label>
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder={t('commissioning.tag_placeholder', { defaultValue: 'e.g. AHU-1' })}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-content-primary mb-1.5">
              {t('commissioning.field_location', { defaultValue: 'Location' })}
            </label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={t('commissioning.location_placeholder', {
                defaultValue: 'e.g. Roof plant room',
              })}
              className={inputCls}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-light">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            variant="primary"
            disabled={isPending || !name.trim()}
            onClick={() =>
              onSubmit({
                name: name.trim(),
                system_type: systemType,
                tag: tag.trim() || undefined,
                location: location.trim() || undefined,
              })
            }
          >
            <Plus size={16} className="mr-1.5" />
            {t('commissioning.create_system', { defaultValue: 'Create system' })}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Stat card ─────────────────────────────────────────────────────────── */

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col rounded-xl border border-border-light bg-surface-elevated/90 p-3 shadow-xs">
      <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">{label}</span>
      <span className="mt-1 text-2xl font-bold tabular-nums text-content-primary">{value}</span>
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────────────────────── */

export function CommissioningPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const activeProjectId = useProjectContextStore((s) => s.activeProjectId);
  const userRole = useAuthStore((s) => s.userRole);
  const commissionAllowed = canCommissionRole(userRole);

  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CxSystemStatus | ''>('');

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiGet<{ id: string; name: string }[]>('/v1/projects/'),
    staleTime: 5 * 60_000,
  });
  const projectId = activeProjectId || projects[0]?.id || '';

  const {
    data: systems = [],
    isLoading,
  } = useQuery({
    queryKey: ['cx-systems', projectId, statusFilter],
    queryFn: () => fetchSystems({ project_id: projectId, status: statusFilter || undefined }),
    enabled: !!projectId,
  });

  const { data: stats } = useQuery({
    queryKey: ['cx-stats', projectId],
    queryFn: () => fetchCxStats(projectId),
    enabled: !!projectId,
  });

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['cx-systems'] });
    qc.invalidateQueries({ queryKey: ['cx-stats'] });
  }, [qc]);

  const createMut = useMutation({
    mutationFn: (data: Omit<CreateSystemPayload, 'project_id'>) =>
      createSystem({ ...data, project_id: projectId }),
    onSuccess: () => {
      setShowCreate(false);
      invalidateAll();
      addToast({ type: 'success', title: t('commissioning.system_created', { defaultValue: 'System created' }) });
    },
    onError: (e: Error) =>
      addToast({ type: 'error', title: t('commissioning.create_failed', { defaultValue: 'Could not create system' }), message: e.message }),
  });

  const commissionMut = useMutation({
    mutationFn: (id: string) => commissionSystem(id),
    onSuccess: () => {
      invalidateAll();
      addToast({ type: 'success', title: t('commissioning.commissioned', { defaultValue: 'System commissioned' }) });
    },
    onError: (e: Error) =>
      addToast({ type: 'error', title: t('commissioning.commission_failed', { defaultValue: 'Could not commission system' }), message: e.message }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteSystem(id),
    onSuccess: invalidateAll,
    onError: (e: Error) =>
      addToast({ type: 'error', title: t('commissioning.delete_failed', { defaultValue: 'Could not delete system' }), message: e.message }),
  });

  const { confirm, ...confirmProps } = useConfirm();

  const handleCommission = useCallback(
    async (system: CxSystem) => {
      const ok = await confirm({
        title: t('commissioning.confirm_commission_title', { defaultValue: 'Commission this system?' }),
        message: t('commissioning.confirm_commission_msg', {
          defaultValue:
            'This marks "{{name}}" as commissioned. It is only allowed once every functional check has passed and no critical issue is open.',
          name: system.name,
        }),
        confirmLabel: t('commissioning.commission', { defaultValue: 'Commission system' }),
        variant: 'warning',
      });
      if (ok) commissionMut.mutate(system.id);
    },
    [confirm, commissionMut, t],
  );

  const handleDelete = useCallback(
    async (system: CxSystem) => {
      const ok = await confirm({
        title: t('commissioning.confirm_delete_title', { defaultValue: 'Delete this system?' }),
        message: t('commissioning.confirm_delete_msg', {
          defaultValue: 'This permanently deletes "{{name}}" and all of its checklists and issues.',
          name: system.name,
        }),
        confirmLabel: t('commissioning.delete', { defaultValue: 'Delete' }),
        variant: 'danger',
      });
      if (ok) deleteMut.mutate(system.id);
    },
    [confirm, deleteMut, t],
  );

  const statusTabs = useMemo(
    () =>
      [
        { key: '' as CxSystemStatus | '', label: t('commissioning.tab_all', { defaultValue: 'All' }) },
        ...(['not_started', 'in_progress', 'tests_complete', 'commissioned'] as CxSystemStatus[]).map((s) => ({
          key: s as CxSystemStatus | '',
          label: t(`commissioning.status_${s}`, { defaultValue: STATUS_CONFIG[s].label }),
        })),
      ],
    [t],
  );

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        srTitle={t('commissioning.title', { defaultValue: 'Commissioning' })}
        subtitle={t('commissioning.subtitle', {
          defaultValue:
            'Track each building system through prefunctional and functional checks, log issues, and commission a system only when every functional test has passed and no critical issue is open.',
        })}
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (!projectId) {
                addToast({
                  type: 'info',
                  title: t('commissioning.select_project_first', { defaultValue: 'Select a project first' }),
                });
                return;
              }
              setShowCreate(true);
            }}
          >
            <Plus size={14} className="mr-1" />
            {t('commissioning.new_system', { defaultValue: 'New system' })}
          </Button>
        }
      />

      {projectId && stats && stats.total_systems > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label={t('commissioning.stat_systems', { defaultValue: 'Systems' })} value={stats.total_systems} />
          <StatCard
            label={t('commissioning.stat_commissioned', { defaultValue: 'Commissioned' })}
            value={stats.commissioned}
          />
          <StatCard
            label={t('commissioning.stat_avg_readiness', { defaultValue: 'Avg readiness' })}
            value={`${Math.round(stats.average_readiness_pct)}%`}
          />
          <StatCard
            label={t('commissioning.stat_open_critical', { defaultValue: 'Open critical' })}
            value={stats.open_critical_issues}
          />
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {statusTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={clsx(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap',
              statusFilter === tab.key
                ? 'bg-oe-blue-subtle text-oe-blue-text'
                : 'text-content-secondary hover:bg-surface-secondary hover:text-content-primary',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!projectId ? (
        <RequiresProject>{null}</RequiresProject>
      ) : isLoading ? (
        <SkeletonTable rows={5} columns={4} />
      ) : systems.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck size={28} strokeWidth={1.5} />}
          title={
            statusFilter
              ? t('commissioning.no_results', { defaultValue: 'No systems in this state' })
              : t('commissioning.no_systems', { defaultValue: 'No systems yet' })
          }
          description={t('commissioning.no_systems_hint', {
            defaultValue: 'Add each commissionable system, then build its functional checklist.',
          })}
          action={
            !statusFilter
              ? {
                  label: t('commissioning.new_system', { defaultValue: 'New system' }),
                  onClick: () => setShowCreate(true),
                }
              : undefined
          }
        />
      ) : (
        <Card padding="none" className="overflow-hidden">
          {systems.map((system) => (
            <SystemCard
              key={system.id}
              system={system}
              canCommission={commissionAllowed}
              onCommission={handleCommission}
              onDelete={handleDelete}
              onAfterChange={invalidateAll}
            />
          ))}
        </Card>
      )}

      {showCreate && (
        <CreateSystemModal
          onClose={() => setShowCreate(false)}
          onSubmit={(data) => createMut.mutate(data)}
          isPending={createMut.isPending}
        />
      )}

      <ConfirmDialog {...confirmProps} />
    </div>
  );
}
