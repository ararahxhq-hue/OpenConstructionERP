// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Truck,
  Plus,
  X,
  Check,
  Ban,
  Trash2,
  Clock,
  Package,
  Calendar,
  DoorOpen,
  MapPin,
  CheckCircle2,
  LogIn,
} from 'lucide-react';
import {
  Button,
  Card,
  Badge,
  EmptyState,
  Breadcrumb,
  SkeletonTable,
  RecoveryCard,
} from '@/shared/ui';
import { PageHeader } from '@/shared/ui/PageHeader';
import { DismissibleInfo } from '@/shared/ui/DismissibleInfo';
import { RequiresProject } from '@/shared/auth/RequiresProject';
import { apiGet, getErrorMessage } from '@/shared/lib/api';
import { useActiveProjectId } from '@/shared/hooks/useActiveProjectId';
import { useToastStore } from '@/stores/useToastStore';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  fetchGates,
  fetchLaydownZones,
  fetchDeliveries,
  fetchSiteLogisticsStats,
  createGate,
  deleteGate,
  createLaydownZone,
  deleteLaydownZone,
  createDelivery,
  updateDelivery,
  deleteDelivery,
  approveDelivery,
  rejectDelivery,
  type Gate,
  type LaydownZone,
  type DeliveryBooking,
  type DeliveryStatus,
  type CreateDeliveryPayload,
} from './api';

/* ── Constants & helpers ───────────────────────────────────────────────── */

interface Project {
  id: string;
  name: string;
}

const inputCls =
  'h-10 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue';

const STATUS_ORDER: DeliveryStatus[] = [
  'requested',
  'approved',
  'arrived',
  'completed',
  'rejected',
];

const STATUS_CONFIG: Record<DeliveryStatus, { label: string; cls: string }> = {
  requested: {
    label: 'Requested',
    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  },
  approved: {
    label: 'Approved',
    cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  },
  arrived: {
    label: 'Arrived',
    cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  },
  completed: {
    label: 'Completed',
    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  },
  rejected: {
    label: 'Rejected',
    cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
};

/**
 * Delivery times are stored as the wall-clock the user booked (see the backend
 * ``_ensure_aware`` note). Format in UTC so the board shows exactly what was
 * entered, on any viewer's machine.
 */
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
}

function fmtDateHeader(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function normalizeRole(role: string | null | undefined): string {
  const r = (role ?? 'viewer').trim().toLowerCase();
  const aliases: Record<string, string> = {
    estimator: 'editor',
    quantity_surveyor: 'editor',
    qs: 'editor',
    user: 'editor',
    superuser: 'admin',
    owner: 'admin',
    readonly: 'viewer',
    guest: 'viewer',
  };
  return aliases[r] ?? r;
}

/* ── Book / edit delivery modal ────────────────────────────────────────── */

interface DeliveryFormState {
  gate_id: string;
  supplier_name: string;
  contact_name: string;
  contact_phone: string;
  vehicle_type: string;
  materials_desc: string;
  window_start: string;
  window_end: string;
  po_ref: string;
  notes: string;
}

function defaultForm(): DeliveryFormState {
  const start = new Date();
  start.setHours(start.getHours() + 1, 0, 0, 0);
  const end = new Date(start);
  end.setHours(start.getHours() + 1);
  return {
    gate_id: '',
    supplier_name: '',
    contact_name: '',
    contact_phone: '',
    vehicle_type: '',
    materials_desc: '',
    window_start: toLocalInput(start),
    window_end: toLocalInput(end),
    po_ref: '',
    notes: '',
  };
}

function BookDeliveryModal({
  gates,
  onClose,
  onSubmit,
  isPending,
  errorMessage,
}: {
  gates: Gate[];
  onClose: () => void;
  onSubmit: (form: DeliveryFormState) => void;
  isPending: boolean;
  errorMessage?: string | null;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<DeliveryFormState>(defaultForm);
  const [touched, setTouched] = useState(false);

  const set = <K extends keyof DeliveryFormState>(key: K, value: DeliveryFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const supplierError = touched && form.supplier_name.trim().length === 0;
  const windowError =
    touched && !!form.window_start && !!form.window_end && form.window_end <= form.window_start;
  const canSubmit =
    form.supplier_name.trim().length > 0 &&
    !!form.window_start &&
    !!form.window_end &&
    form.window_end > form.window_start;

  const submit = () => {
    setTouched(true);
    if (canSubmit) onSubmit(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-lg animate-fade-in">
      <div
        className="w-full max-w-2xl bg-surface-elevated rounded-xl shadow-xl border border-border animate-card-in mx-4 max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-label={t('siteLogistics.book_delivery', { defaultValue: 'Book delivery' })}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
          <h2 className="text-lg font-semibold text-content-primary">
            {t('siteLogistics.book_delivery', { defaultValue: 'Book delivery' })}
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
          {errorMessage && (
            <div
              className="rounded-lg border border-semantic-error/30 bg-semantic-error/5 px-3 py-2 text-sm text-semantic-error"
              role="alert"
            >
              {errorMessage}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-content-primary mb-1.5">
                {t('siteLogistics.field_supplier', { defaultValue: 'Supplier' })}{' '}
                <span className="text-semantic-error">*</span>
              </label>
              <input
                value={form.supplier_name}
                onChange={(e) => {
                  set('supplier_name', e.target.value);
                  setTouched(true);
                }}
                placeholder={t('siteLogistics.supplier_placeholder', {
                  defaultValue: 'e.g. Ready-Mix Concrete Ltd',
                })}
                className={clsx(
                  inputCls,
                  supplierError && 'border-semantic-error focus:ring-red-300',
                )}
                autoFocus
              />
              {supplierError && (
                <p className="mt-1 text-xs text-semantic-error">
                  {t('siteLogistics.supplier_required', {
                    defaultValue: 'Supplier is required',
                  })}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-content-primary mb-1.5">
                {t('siteLogistics.field_gate', { defaultValue: 'Gate' })}
              </label>
              <select
                value={form.gate_id}
                onChange={(e) => set('gate_id', e.target.value)}
                className={inputCls}
                aria-label={t('siteLogistics.field_gate', { defaultValue: 'Gate' })}
              >
                <option value="">
                  {t('siteLogistics.gate_unassigned', { defaultValue: 'No gate yet' })}
                </option>
                {gates.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.open_time}-{g.close_time})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-content-primary mb-1.5">
                {t('siteLogistics.field_window_start', { defaultValue: 'Window start' })}{' '}
                <span className="text-semantic-error">*</span>
              </label>
              <input
                type="datetime-local"
                value={form.window_start}
                onChange={(e) => {
                  set('window_start', e.target.value);
                  setTouched(true);
                }}
                className={clsx(inputCls, windowError && 'border-semantic-error')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-primary mb-1.5">
                {t('siteLogistics.field_window_end', { defaultValue: 'Window end' })}{' '}
                <span className="text-semantic-error">*</span>
              </label>
              <input
                type="datetime-local"
                value={form.window_end}
                onChange={(e) => {
                  set('window_end', e.target.value);
                  setTouched(true);
                }}
                className={clsx(inputCls, windowError && 'border-semantic-error')}
              />
            </div>
          </div>
          {windowError && (
            <p className="text-xs text-semantic-error">
              {t('siteLogistics.window_order_error', {
                defaultValue: 'The end must be after the start',
              })}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-content-primary mb-1.5">
                {t('siteLogistics.field_vehicle', { defaultValue: 'Vehicle type' })}
              </label>
              <input
                value={form.vehicle_type}
                onChange={(e) => set('vehicle_type', e.target.value)}
                placeholder={t('siteLogistics.vehicle_placeholder', {
                  defaultValue: 'e.g. 32t tipper, flatbed, mixer',
                })}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-primary mb-1.5">
                {t('siteLogistics.field_po', { defaultValue: 'PO reference' })}
              </label>
              <input
                value={form.po_ref}
                onChange={(e) => set('po_ref', e.target.value)}
                placeholder={t('siteLogistics.po_placeholder', { defaultValue: 'e.g. PO-1042' })}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-content-primary mb-1.5">
              {t('siteLogistics.field_materials', { defaultValue: 'Materials' })}
            </label>
            <input
              value={form.materials_desc}
              onChange={(e) => set('materials_desc', e.target.value)}
              placeholder={t('siteLogistics.materials_placeholder', {
                defaultValue: 'e.g. 12 m3 C30/37, rebar cages',
              })}
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-content-primary mb-1.5">
                {t('siteLogistics.field_contact_name', { defaultValue: 'Contact name' })}
              </label>
              <input
                value={form.contact_name}
                onChange={(e) => set('contact_name', e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-primary mb-1.5">
                {t('siteLogistics.field_contact_phone', { defaultValue: 'Contact phone' })}
              </label>
              <input
                value={form.contact_phone}
                onChange={(e) => set('contact_phone', e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-content-primary mb-1.5">
              {t('siteLogistics.field_notes', { defaultValue: 'Notes' })}
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue resize-none"
              placeholder={t('siteLogistics.notes_placeholder', {
                defaultValue: 'Access, offloading, escort...',
              })}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-light">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button variant="primary" onClick={submit} disabled={isPending || !canSubmit}>
            {isPending ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent mr-2 shrink-0" />
            ) : (
              <Truck size={16} className="mr-1.5 shrink-0" />
            )}
            <span>{t('siteLogistics.book_delivery', { defaultValue: 'Book delivery' })}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Delivery row ──────────────────────────────────────────────────────── */

function DeliveryRow({
  delivery,
  gate,
  canApprove,
  canEdit,
  canDelete,
  busy,
  onApprove,
  onReject,
  onAdvance,
  onDelete,
}: {
  delivery: DeliveryBooking;
  gate: Gate | undefined;
  canApprove: boolean;
  canEdit: boolean;
  canDelete: boolean;
  busy: boolean;
  onApprove: (d: DeliveryBooking) => void;
  onReject: (d: DeliveryBooking) => void;
  onAdvance: (d: DeliveryBooking, status: DeliveryStatus) => void;
  onDelete: (d: DeliveryBooking) => void;
}) {
  const { t } = useTranslation();
  const cfg = STATUS_CONFIG[delivery.status] ?? STATUS_CONFIG.requested;

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border-light last:border-b-0 hover:bg-surface-secondary/40 transition-colors">
      {/* Time window */}
      <div className="flex items-center gap-1.5 w-32 shrink-0 font-mono text-sm text-content-secondary tabular-nums">
        <Clock size={13} className="text-content-tertiary shrink-0" />
        {fmtTime(delivery.window_start)}–{fmtTime(delivery.window_end)}
      </div>

      {/* Supplier + materials */}
      <div className="flex-1 min-w-[8rem]">
        <p className="text-sm font-medium text-content-primary truncate">
          {delivery.supplier_name}
        </p>
        {delivery.materials_desc && (
          <p className="text-2xs text-content-tertiary truncate">{delivery.materials_desc}</p>
        )}
      </div>

      {/* Gate */}
      <div className="hidden md:flex items-center gap-1 w-28 shrink-0 text-xs text-content-tertiary truncate">
        {gate ? (
          <>
            <DoorOpen size={12} className="shrink-0" />
            {gate.name}
          </>
        ) : (
          <span className="italic">{t('siteLogistics.gate_none', { defaultValue: 'No gate' })}</span>
        )}
      </div>

      {/* Vehicle */}
      <div className="hidden lg:block w-28 shrink-0 text-xs text-content-tertiary truncate">
        {delivery.vehicle_type || '-'}
      </div>

      {/* Status chip */}
      <Badge variant="neutral" size="sm" className={cfg.cls}>
        {t(`siteLogistics.status_${delivery.status}`, { defaultValue: cfg.label })}
      </Badge>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {canApprove && (delivery.status === 'requested' || delivery.status === 'rejected') && (
          <Button variant="primary" size="sm" disabled={busy} onClick={() => onApprove(delivery)}>
            <Check size={13} className="mr-1" />
            {t('siteLogistics.action_approve', { defaultValue: 'Approve' })}
          </Button>
        )}
        {canApprove && (delivery.status === 'requested' || delivery.status === 'approved') && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onReject(delivery)}>
            <Ban size={13} className="mr-1" />
            {t('siteLogistics.action_reject', { defaultValue: 'Reject' })}
          </Button>
        )}
        {canEdit && delivery.status === 'approved' && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onAdvance(delivery, 'arrived')}
            title={t('siteLogistics.action_mark_arrived', { defaultValue: 'Mark arrived' })}
          >
            <LogIn size={13} className="mr-1" />
            {t('siteLogistics.action_mark_arrived', { defaultValue: 'Mark arrived' })}
          </Button>
        )}
        {canEdit && delivery.status === 'arrived' && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onAdvance(delivery, 'completed')}
            title={t('siteLogistics.action_mark_completed', { defaultValue: 'Mark completed' })}
          >
            <CheckCircle2 size={13} className="mr-1" />
            {t('siteLogistics.action_mark_completed', { defaultValue: 'Mark completed' })}
          </Button>
        )}
        {canDelete && (
          <button
            onClick={() => onDelete(delivery)}
            disabled={busy}
            aria-label={t('common.delete', { defaultValue: 'Delete' })}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-content-tertiary hover:bg-semantic-error/10 hover:text-semantic-error transition-colors disabled:opacity-40"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Delivery board ────────────────────────────────────────────────────── */

function DeliveryBoard({
  projectId,
  gates,
  onBook,
}: {
  projectId: string;
  gates: Gate[];
  onBook: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const role = normalizeRole(useAuthStore((s) => s.userRole));
  const canApprove = role === 'manager' || role === 'admin';
  const canEdit = role === 'editor' || role === 'manager' || role === 'admin';
  const canDelete = role === 'manager' || role === 'admin';

  const [day, setDay] = useState('');
  const [gateFilter, setGateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<DeliveryStatus | ''>('');

  const gateById = useMemo(() => {
    const m = new Map<string, Gate>();
    for (const g of gates) m.set(g.id, g);
    return m;
  }, [gates]);

  const {
    data: deliveries = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['site-logistics-deliveries', projectId, day, gateFilter, statusFilter],
    queryFn: () =>
      fetchDeliveries(projectId, {
        day: day || undefined,
        gate_id: gateFilter || undefined,
        status: statusFilter || undefined,
      }),
    enabled: !!projectId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['site-logistics-deliveries'] });
    qc.invalidateQueries({ queryKey: ['site-logistics-stats'] });
  };

  const decisionMut = useMutation({
    mutationFn: ({ action, id }: { action: 'approve' | 'reject'; id: string }) =>
      action === 'approve' ? approveDelivery(id) : rejectDelivery(id),
    onSuccess: (_data, vars) => {
      invalidate();
      addToast({
        type: 'success',
        title:
          vars.action === 'approve'
            ? t('siteLogistics.approved', { defaultValue: 'Delivery approved' })
            : t('siteLogistics.rejected', { defaultValue: 'Delivery rejected' }),
      });
    },
    onError: (e: unknown) => {
      addToast({
        type: 'error',
        title: t('siteLogistics.decision_failed', { defaultValue: 'Could not update delivery' }),
        message: getErrorMessage(e),
      });
    },
  });

  const advanceMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: DeliveryStatus }) =>
      updateDelivery(id, { status }),
    onSuccess: () => {
      invalidate();
    },
    onError: (e: unknown) => {
      addToast({
        type: 'error',
        title: t('siteLogistics.decision_failed', { defaultValue: 'Could not update delivery' }),
        message: getErrorMessage(e),
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteDelivery(id),
    onSuccess: () => {
      invalidate();
      addToast({ type: 'success', title: t('siteLogistics.deleted', { defaultValue: 'Delivery removed' }) });
    },
    onError: (e: unknown) => {
      addToast({
        type: 'error',
        title: t('siteLogistics.delete_failed', { defaultValue: 'Could not remove delivery' }),
        message: getErrorMessage(e),
      });
    },
  });

  const busy = decisionMut.isPending || advanceMut.isPending || deleteMut.isPending;

  // Group deliveries by calendar day (they arrive chronologically from the API).
  const grouped = useMemo(() => {
    const groups = new Map<string, DeliveryBooking[]>();
    for (const d of deliveries) {
      const key = dateKey(d.window_start);
      const bucket = groups.get(key);
      if (bucket) bucket.push(d);
      else groups.set(key, [d]);
    }
    return Array.from(groups.entries());
  }, [deliveries]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Calendar
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary pointer-events-none"
          />
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className={inputCls + ' pl-9 w-auto'}
            aria-label={t('siteLogistics.filter_day', { defaultValue: 'Filter by day' })}
          />
        </div>
        {day && (
          <Button variant="ghost" size="sm" onClick={() => setDay('')}>
            {t('siteLogistics.clear_day', { defaultValue: 'All days' })}
          </Button>
        )}
        {gates.length > 0 && (
          <select
            value={gateFilter}
            onChange={(e) => setGateFilter(e.target.value)}
            className={inputCls + ' w-auto'}
            aria-label={t('siteLogistics.filter_gate', { defaultValue: 'Filter by gate' })}
          >
            <option value="">{t('siteLogistics.all_gates', { defaultValue: 'All gates' })}</option>
            {gates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-1 overflow-x-auto">
          <button
            onClick={() => setStatusFilter('')}
            className={clsx(
              'rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
              statusFilter === ''
                ? 'bg-oe-blue-subtle text-oe-blue-text'
                : 'text-content-secondary hover:bg-surface-secondary',
            )}
          >
            {t('siteLogistics.status_all', { defaultValue: 'All' })}
          </button>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={clsx(
                'rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
                statusFilter === s
                  ? 'bg-oe-blue-subtle text-oe-blue-text'
                  : 'text-content-secondary hover:bg-surface-secondary',
              )}
            >
              {t(`siteLogistics.status_${s}`, { defaultValue: STATUS_CONFIG[s].label })}
            </button>
          ))}
        </div>
      </div>

      {/* Board */}
      {isLoading ? (
        <SkeletonTable rows={5} columns={4} />
      ) : isError ? (
        <RecoveryCard error={error} onRetry={() => refetch()} />
      ) : deliveries.length === 0 ? (
        <EmptyState
          icon={<Truck size={28} strokeWidth={1.5} />}
          title={
            day || gateFilter || statusFilter
              ? t('siteLogistics.no_matching_deliveries', { defaultValue: 'No matching deliveries' })
              : t('siteLogistics.no_deliveries', { defaultValue: 'No deliveries booked yet' })
          }
          description={
            day || gateFilter || statusFilter
              ? t('siteLogistics.no_matching_hint', {
                  defaultValue: 'Try clearing the day, gate or status filters.',
                })
              : t('siteLogistics.no_deliveries_hint', {
                  defaultValue:
                    'Book your first delivery to start planning what arrives on site and when.',
                })
          }
          action={
            !day && !gateFilter && !statusFilter
              ? {
                  label: t('siteLogistics.book_delivery', { defaultValue: 'Book delivery' }),
                  onClick: onBook,
                }
              : undefined
          }
        />
      ) : (
        <div className="space-y-5">
          {grouped.map(([key, items]) => (
            <div key={key}>
              <div className="flex items-center gap-2 mb-2">
                <Calendar size={14} className="text-content-tertiary" />
                <h3 className="text-sm font-semibold text-content-secondary">
                  {fmtDateHeader(items[0]!.window_start)}
                </h3>
                <span className="text-2xs text-content-tertiary tabular-nums">
                  {t('siteLogistics.delivery_count', {
                    defaultValue: '{{count}} deliveries',
                    count: items.length,
                  })}
                </span>
              </div>
              <Card padding="none" className="overflow-hidden">
                {items.map((d) => (
                  <DeliveryRow
                    key={d.id}
                    delivery={d}
                    gate={d.gate_id ? gateById.get(d.gate_id) : undefined}
                    canApprove={canApprove}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    busy={busy}
                    onApprove={(x) => decisionMut.mutate({ action: 'approve', id: x.id })}
                    onReject={(x) => decisionMut.mutate({ action: 'reject', id: x.id })}
                    onAdvance={(x, status) => advanceMut.mutate({ id: x.id, status })}
                    onDelete={(x) => deleteMut.mutate(x.id)}
                  />
                ))}
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Gates panel ───────────────────────────────────────────────────────── */

function GatesPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const role = normalizeRole(useAuthStore((s) => s.userRole));
  const canEdit = role === 'editor' || role === 'manager' || role === 'admin';
  const canDelete = role === 'manager' || role === 'admin';

  const [name, setName] = useState('');
  const [openTime, setOpenTime] = useState('07:00');
  const [closeTime, setCloseTime] = useState('18:00');
  const [capacity, setCapacity] = useState(1);

  const { data: gates = [], isLoading } = useQuery({
    queryKey: ['site-logistics-gates', projectId],
    queryFn: () => fetchGates(projectId),
    enabled: !!projectId,
  });

  const createMut = useMutation({
    mutationFn: () =>
      createGate({
        project_id: projectId,
        name: name.trim(),
        open_time: openTime,
        close_time: closeTime,
        capacity_per_slot: capacity,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['site-logistics-gates'] });
      qc.invalidateQueries({ queryKey: ['site-logistics-stats'] });
      setName('');
      addToast({ type: 'success', title: t('siteLogistics.gate_added', { defaultValue: 'Gate added' }) });
    },
    onError: (e: unknown) => {
      addToast({
        type: 'error',
        title: t('siteLogistics.gate_add_failed', { defaultValue: 'Could not add gate' }),
        message: getErrorMessage(e),
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteGate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['site-logistics-gates'] });
      qc.invalidateQueries({ queryKey: ['site-logistics-stats'] });
    },
    onError: (e: unknown) => {
      addToast({
        type: 'error',
        title: t('siteLogistics.gate_delete_failed', { defaultValue: 'Could not delete gate' }),
        message: getErrorMessage(e),
      });
    },
  });

  return (
    <div className="space-y-4">
      {canEdit && (
        <Card padding="none" className="p-4">
          <p className="text-sm font-medium text-content-primary mb-3">
            {t('siteLogistics.add_gate', { defaultValue: 'Add a gate' })}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('siteLogistics.gate_name_placeholder', { defaultValue: 'Gate name' })}
              className={inputCls + ' col-span-2 sm:col-span-1'}
              aria-label={t('siteLogistics.gate_name', { defaultValue: 'Gate name' })}
            />
            <label className="flex items-center gap-1.5 text-xs text-content-tertiary">
              <span className="shrink-0">{t('siteLogistics.open', { defaultValue: 'Open' })}</span>
              <input
                type="time"
                value={openTime}
                onChange={(e) => setOpenTime(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-content-tertiary">
              <span className="shrink-0">{t('siteLogistics.close', { defaultValue: 'Close' })}</span>
              <input
                type="time"
                value={closeTime}
                onChange={(e) => setCloseTime(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-content-tertiary">
              <span className="shrink-0">{t('siteLogistics.slots', { defaultValue: 'Slots' })}</span>
              <input
                type="number"
                min={1}
                max={100}
                value={capacity}
                onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))}
                className={inputCls}
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              variant="primary"
              size="sm"
              disabled={name.trim().length === 0 || closeTime <= openTime || createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              <Plus size={14} className="mr-1" />
              {t('siteLogistics.add_gate', { defaultValue: 'Add a gate' })}
            </Button>
          </div>
          {closeTime <= openTime && (
            <p className="mt-2 text-xs text-semantic-error">
              {t('siteLogistics.gate_hours_error', {
                defaultValue: 'Closing time must be after opening time',
              })}
            </p>
          )}
        </Card>
      )}

      {isLoading ? (
        <SkeletonTable rows={3} columns={3} />
      ) : gates.length === 0 ? (
        <EmptyState
          icon={<DoorOpen size={28} strokeWidth={1.5} />}
          title={t('siteLogistics.no_gates', { defaultValue: 'No gates yet' })}
          description={t('siteLogistics.no_gates_hint', {
            defaultValue: 'Add the site access gates so deliveries can be scheduled against them.',
          })}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {gates.map((g) => (
            <GateCard
              key={g.id}
              gate={g}
              canDelete={canDelete}
              onDelete={() => deleteMut.mutate(g.id)}
              busy={deleteMut.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GateCard({
  gate,
  canDelete,
  onDelete,
  busy,
}: {
  gate: Gate;
  canDelete: boolean;
  onDelete: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card padding="none" className="p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <DoorOpen size={16} className="text-oe-blue shrink-0" />
          <span className="text-sm font-semibold text-content-primary truncate">{gate.name}</span>
        </div>
        {canDelete && (
          <button
            onClick={onDelete}
            disabled={busy}
            aria-label={t('common.delete', { defaultValue: 'Delete' })}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-content-tertiary hover:bg-semantic-error/10 hover:text-semantic-error transition-colors disabled:opacity-40"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-content-secondary">
        <Clock size={12} className="text-content-tertiary" />
        {gate.open_time} – {gate.close_time}
      </div>
      <div className="text-xs text-content-tertiary">
        {t('siteLogistics.capacity_slots', {
          defaultValue: '{{count}} vehicle(s) per slot',
          count: gate.capacity_per_slot,
        })}
      </div>
      {gate.notes && <p className="text-2xs text-content-tertiary">{gate.notes}</p>}
    </Card>
  );
}

/* ── Laydown zones panel ───────────────────────────────────────────────── */

function LaydownPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const role = normalizeRole(useAuthStore((s) => s.userRole));
  const canEdit = role === 'editor' || role === 'manager' || role === 'admin';
  const canDelete = role === 'manager' || role === 'admin';

  const [name, setName] = useState('');
  const [capacityDesc, setCapacityDesc] = useState('');
  const [usageNote, setUsageNote] = useState('');

  const { data: zones = [], isLoading } = useQuery({
    queryKey: ['site-logistics-zones', projectId],
    queryFn: () => fetchLaydownZones(projectId),
    enabled: !!projectId,
  });

  const createMut = useMutation({
    mutationFn: () =>
      createLaydownZone({
        project_id: projectId,
        name: name.trim(),
        capacity_desc: capacityDesc.trim() || undefined,
        usage_note: usageNote.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['site-logistics-zones'] });
      qc.invalidateQueries({ queryKey: ['site-logistics-stats'] });
      setName('');
      setCapacityDesc('');
      setUsageNote('');
      addToast({ type: 'success', title: t('siteLogistics.zone_added', { defaultValue: 'Laydown zone added' }) });
    },
    onError: (e: unknown) => {
      addToast({
        type: 'error',
        title: t('siteLogistics.zone_add_failed', { defaultValue: 'Could not add zone' }),
        message: getErrorMessage(e),
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteLaydownZone(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['site-logistics-zones'] });
      qc.invalidateQueries({ queryKey: ['site-logistics-stats'] });
    },
    onError: (e: unknown) => {
      addToast({
        type: 'error',
        title: t('siteLogistics.zone_delete_failed', { defaultValue: 'Could not delete zone' }),
        message: getErrorMessage(e),
      });
    },
  });

  return (
    <div className="space-y-4">
      {canEdit && (
        <Card padding="none" className="p-4">
          <p className="text-sm font-medium text-content-primary mb-3">
            {t('siteLogistics.add_zone', { defaultValue: 'Add a laydown zone' })}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('siteLogistics.zone_name_placeholder', { defaultValue: 'Zone name' })}
              className={inputCls}
              aria-label={t('siteLogistics.zone_name', { defaultValue: 'Zone name' })}
            />
            <input
              value={capacityDesc}
              onChange={(e) => setCapacityDesc(e.target.value)}
              placeholder={t('siteLogistics.zone_capacity_placeholder', {
                defaultValue: 'Capacity e.g. 200 m2 / 40 t',
              })}
              className={inputCls}
            />
            <input
              value={usageNote}
              onChange={(e) => setUsageNote(e.target.value)}
              placeholder={t('siteLogistics.zone_usage_placeholder', {
                defaultValue: 'Usage note e.g. rebar only',
              })}
              className={inputCls}
            />
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              variant="primary"
              size="sm"
              disabled={name.trim().length === 0 || createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              <Plus size={14} className="mr-1" />
              {t('siteLogistics.add_zone', { defaultValue: 'Add a laydown zone' })}
            </Button>
          </div>
        </Card>
      )}

      {isLoading ? (
        <SkeletonTable rows={3} columns={3} />
      ) : zones.length === 0 ? (
        <EmptyState
          icon={<Package size={28} strokeWidth={1.5} />}
          title={t('siteLogistics.no_zones', { defaultValue: 'No laydown zones yet' })}
          description={t('siteLogistics.no_zones_hint', {
            defaultValue: 'Map out where materials can be stored and staged on site.',
          })}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {zones.map((z) => (
            <LaydownCard
              key={z.id}
              zone={z}
              canDelete={canDelete}
              onDelete={() => deleteMut.mutate(z.id)}
              busy={deleteMut.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LaydownCard({
  zone,
  canDelete,
  onDelete,
  busy,
}: {
  zone: LaydownZone;
  canDelete: boolean;
  onDelete: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card padding="none" className="p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MapPin size={16} className="text-emerald-600 shrink-0" />
          <span className="text-sm font-semibold text-content-primary truncate">{zone.name}</span>
        </div>
        {canDelete && (
          <button
            onClick={onDelete}
            disabled={busy}
            aria-label={t('common.delete', { defaultValue: 'Delete' })}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-content-tertiary hover:bg-semantic-error/10 hover:text-semantic-error transition-colors disabled:opacity-40"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {zone.capacity_desc && (
        <div className="text-xs text-content-secondary">
          {t('siteLogistics.zone_capacity', { defaultValue: 'Capacity' })}: {zone.capacity_desc}
        </div>
      )}
      {zone.usage_note && <p className="text-2xs text-content-tertiary">{zone.usage_note}</p>}
    </Card>
  );
}

/* ── Main page ─────────────────────────────────────────────────────────── */

type TabKey = 'deliveries' | 'gates' | 'laydown';

export function SiteLogisticsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const activeProjectId = useActiveProjectId();

  const [tab, setTab] = useState<TabKey>('deliveries');
  const [showBook, setShowBook] = useState(false);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiGet<Project[]>('/v1/projects/'),
    staleTime: 5 * 60_000,
  });

  const projectId = activeProjectId || projects[0]?.id || '';
  const projectName = projects.find((p) => p.id === projectId)?.name || '';

  // Gates power the board's gate lookup, the filters and the booking form.
  const { data: gates = [] } = useQuery({
    queryKey: ['site-logistics-gates', projectId],
    queryFn: () => fetchGates(projectId),
    enabled: !!projectId,
  });

  const { data: stats } = useQuery({
    queryKey: ['site-logistics-stats', projectId],
    queryFn: () => fetchSiteLogisticsStats(projectId),
    enabled: !!projectId,
  });

  const bookMut = useMutation({
    mutationFn: (payload: CreateDeliveryPayload) => createDelivery(payload),
    onSuccess: (created) => {
      setShowBook(false);
      qc.invalidateQueries({ queryKey: ['site-logistics-deliveries'] });
      qc.invalidateQueries({ queryKey: ['site-logistics-stats'] });
      addToast({
        type: 'success',
        title: t('siteLogistics.booked', { defaultValue: 'Delivery booked' }),
        message: created?.supplier_name,
      });
    },
    onError: (e: unknown) => {
      addToast({
        type: 'error',
        title: t('siteLogistics.book_failed', { defaultValue: 'Could not book delivery' }),
        message: getErrorMessage(e),
      });
    },
  });

  const handleBook = (form: DeliveryFormState) => {
    if (!projectId) return;
    bookMut.mutate({
      project_id: projectId,
      gate_id: form.gate_id || null,
      supplier_name: form.supplier_name.trim(),
      contact_name: form.contact_name.trim() || undefined,
      contact_phone: form.contact_phone.trim() || undefined,
      vehicle_type: form.vehicle_type.trim() || undefined,
      materials_desc: form.materials_desc.trim() || undefined,
      window_start: form.window_start,
      window_end: form.window_end,
      po_ref: form.po_ref.trim() || undefined,
      notes: form.notes.trim() || undefined,
    });
  };

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    {
      key: 'deliveries',
      label: t('siteLogistics.tab_deliveries', { defaultValue: 'Deliveries' }),
      icon: <Truck size={14} />,
    },
    {
      key: 'gates',
      label: t('siteLogistics.tab_gates', { defaultValue: 'Gates' }),
      icon: <DoorOpen size={14} />,
    },
    {
      key: 'laydown',
      label: t('siteLogistics.tab_laydown', { defaultValue: 'Laydown zones' }),
      icon: <Package size={14} />,
    },
  ];

  const statCards = stats
    ? [
        { label: t('siteLogistics.stat_total', { defaultValue: 'Deliveries' }), value: stats.total_deliveries },
        {
          label: t('siteLogistics.status_requested', { defaultValue: 'Requested' }),
          value: stats.by_status?.requested ?? 0,
        },
        {
          label: t('siteLogistics.status_approved', { defaultValue: 'Approved' }),
          value: stats.by_status?.approved ?? 0,
        },
        {
          label: t('siteLogistics.stat_upcoming', { defaultValue: 'Upcoming' }),
          value: stats.upcoming_approved,
        },
        { label: t('siteLogistics.tab_gates', { defaultValue: 'Gates' }), value: stats.gate_count },
      ]
    : [];

  return (
    <div className="space-y-5 animate-fade-in">
      <Breadcrumb
        items={[
          ...(projectName ? [{ label: projectName, to: `/projects/${projectId}` }] : []),
          { label: t('siteLogistics.title', { defaultValue: 'Site Logistics & Delivery' }) },
        ]}
      />

      <PageHeader
        srTitle={t('siteLogistics.title', { defaultValue: 'Site Logistics & Delivery' })}
        subtitle={t('siteLogistics.subtitle', {
          defaultValue:
            'Plan what arrives on site: book deliveries into gate time slots, keep laydown zones tidy, and approve or reject each booking so gates never double-book.',
        })}
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (!projectId) {
                addToast({
                  type: 'info',
                  title: t('siteLogistics.select_project_first_title', {
                    defaultValue: 'Select a project first',
                  }),
                  message: t('siteLogistics.select_project_first', {
                    defaultValue: 'Pick a project from the top bar, then book a delivery.',
                  }),
                });
                return;
              }
              setShowBook(true);
            }}
            className="shrink-0 whitespace-nowrap"
          >
            <Truck size={14} className="mr-1 shrink-0" />
            <span>{t('siteLogistics.book_delivery', { defaultValue: 'Book delivery' })}</span>
          </Button>
        }
      />

      <DismissibleInfo
        storageKey="site-logistics"
        title={t('siteLogistics.intro_title', {
          defaultValue: 'One plan for everything arriving on site',
        })}
      >
        {t('siteLogistics.intro_body', {
          defaultValue:
            'Set up your access gates and their opening hours, map your laydown zones, then book deliveries into gate slots. Bookings that fall outside a gate’s hours are refused, and two approved deliveries can never clash on the same gate, so the gate marshal always has a clean, ordered schedule.',
        })}
      </DismissibleInfo>

      {/* Summary stats */}
      {projectId && stats && stats.total_deliveries + stats.gate_count > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {statCards.map((c) => (
            <div
              key={c.label}
              className="flex flex-col rounded-xl border border-border-light bg-surface-elevated/90 p-3 shadow-xs"
            >
              <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                {c.label}
              </span>
              <span className="mt-1 text-2xl font-bold tabular-nums text-content-primary">
                {c.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border-light">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === tb.key
                ? 'border-oe-blue text-oe-blue'
                : 'border-transparent text-content-secondary hover:text-content-primary',
            )}
          >
            {tb.icon}
            {tb.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {!projectId ? (
        <RequiresProject>{null}</RequiresProject>
      ) : tab === 'deliveries' ? (
        <DeliveryBoard projectId={projectId} gates={gates} onBook={() => setShowBook(true)} />
      ) : tab === 'gates' ? (
        <GatesPanel projectId={projectId} />
      ) : (
        <LaydownPanel projectId={projectId} />
      )}

      {/* Book delivery modal */}
      {showBook && projectId && (
        <BookDeliveryModal
          gates={gates}
          onClose={() => {
            bookMut.reset();
            setShowBook(false);
          }}
          onSubmit={handleBook}
          isPending={bookMut.isPending}
          errorMessage={bookMut.error ? getErrorMessage(bookMut.error) : null}
        />
      )}
    </div>
  );
}
