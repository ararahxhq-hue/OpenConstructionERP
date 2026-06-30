/**
 * Generic client / partner portal landing (magic-link surface).
 *
 * The single role-appropriate destination for a portal magic link. Previously
 * EVERY role's magic URL pointed at /portal/payments (the subcontractor payment
 * portal), so a client / investor / consultant landed on a page that was not
 * theirs. This page consumes the token, then either:
 *
 *   - navigates to the inviter-chosen `redirect_path` when the link carried one
 *     (the inviter was deliberate), or
 *   - renders a role-aware landing: every role sees their accessible projects
 *     and progress reports; clients / investors / consultants also see executed
 *     change orders; building users also see the tickets they filed.
 *
 * Subcontractors / suppliers are routed straight to /portal/payments (their
 * magic URL defaults there and is unaffected); if one lands here anyway, a
 * shortcut takes them to the payment portal.
 *
 * Auth model mirrors PortalPaymentsPage: magic-link SESSION token (NOT the
 * internal JWT), kept in sessionStorage. Renders WITHOUT the internal app shell
 * since it is reachable by external parties.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Loader2,
  AlertCircle,
  KeyRound,
  ArrowLeft,
  FileText,
  GitPullRequestArrow,
  LifeBuoy,
  Receipt,
} from 'lucide-react';
import { Badge, Card, EmptyState, SkeletonTable } from '@/shared/ui';
import { DateDisplay } from '@/shared/ui/DateDisplay';
import { useAuthStore } from '@/stores/useAuthStore';
import { PortalProgressReportsTab } from './PortalProgressReportsTab';
import {
  consumePortalMagicLink,
  getPortalSessionToken,
  getMyPortalProfile,
  listMyChangeOrders,
  listMyTickets,
  type PortalChangeOrder,
  type PortalTicket,
} from './api';
import { PORTAL_PAYMENTS_PATH } from './portalLanding';

type Tab = 'progress' | 'change_orders' | 'tickets';

// Roles that see executed change orders on their landing.
const CHANGE_ORDER_ROLES = new Set(['client', 'investor', 'consultant']);
// Roles that see the tickets they filed on their landing.
const TICKET_ROLES = new Set(['client', 'building_user']);

export function PortalHomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const magicToken = params.get('token');

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const escapeTo = isAuthenticated ? '/' : '/login';

  const [authed, setAuthed] = useState<boolean>(() => !!getPortalSessionToken());
  const [authError, setAuthError] = useState<string | null>(null);
  const [consuming, setConsuming] = useState<boolean>(!!magicToken);

  // Guards the one-time consume against StrictMode's double-invoke / any
  // remount - mirrors PortalPaymentsPage. The first call consumes the link and
  // opens the session; a duplicate would get "already consumed" and flip the
  // UI to a false error even though a valid session token was just stored.
  const consumedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!magicToken) return;
    if (consumedTokenRef.current === magicToken) return;
    consumedTokenRef.current = magicToken;
    setConsuming(true);
    setAuthError(null);
    consumePortalMagicLink(magicToken)
      .then((res) => {
        setAuthed(true);
        // An explicit, inviter-chosen redirect wins: drop the user straight on
        // the page meant for them. Strip the token first so it never rides in
        // history. Guard against an open-redirect by only honouring same-origin
        // app paths ("/..." but not "//host" or a full URL).
        const target = res.redirect_path?.trim();
        if (target && target.startsWith('/') && !target.startsWith('//')) {
          navigate(target, { replace: true });
        }
      })
      .catch((err: unknown) => {
        // A valid session token already landed (duplicate consume where the
        // first succeeded) - trust it rather than show the loser's error.
        if (getPortalSessionToken()) {
          setAuthed(true);
          return;
        }
        setAuthError(err instanceof Error ? err.message : 'Sign-in failed');
      })
      .finally(() => {
        setConsuming(false);
        const next = new URLSearchParams(params);
        next.delete('token');
        setParams(next, { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [magicToken]);

  if (consuming) {
    return (
      <CenteredShell>
        <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="animate-spin text-oe-blue" size={28} />
          <p className="text-sm text-content-secondary">
            {t('homeportal.signing_in', { defaultValue: 'Signing you in...' })}
          </p>
        </Card>
      </CenteredShell>
    );
  }

  if (!authed) {
    return (
      <CenteredShell>
        <Card padding="none" className="w-full max-w-md">
          <EmptyState
            icon={authError ? <AlertCircle size={22} /> : <KeyRound size={22} />}
            title={
              authError
                ? t('homeportal.signin_failed', { defaultValue: 'Sign-in failed' })
                : t('homeportal.signin_title', {
                    defaultValue: 'Sign in to your portal',
                  })
            }
            description={
              authError ??
              t('homeportal.signin_prompt', {
                defaultValue: 'Open the secure link from your invitation email to continue.',
              })
            }
          />
        </Card>
        <Link
          to={escapeTo}
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-oe-blue transition-colors hover:underline"
        >
          <ArrowLeft size={14} />
          {t('homeportal.back_to_app', { defaultValue: 'Back to OpenConstructionERP' })}
        </Link>
      </CenteredShell>
    );
  }

  return (
    <CenteredShell>
      <PortalHomeContent />
    </CenteredShell>
  );
}

function PortalHomeContent() {
  const { t } = useTranslation();

  const profileQ = useQuery({
    queryKey: ['portal-home', 'me'],
    queryFn: () => getMyPortalProfile(),
    staleTime: 60_000,
  });

  const role = profileQ.data?.portal_role ?? '';
  const showChangeOrders = CHANGE_ORDER_ROLES.has(role);
  const showTickets = TICKET_ROLES.has(role);

  const tabs = (
    [
      {
        id: 'progress' as Tab,
        label: t('homeportal.tab_progress', { defaultValue: 'Progress Reports' }),
        icon: FileText,
        show: true,
      },
      {
        id: 'change_orders' as Tab,
        label: t('homeportal.tab_change_orders', { defaultValue: 'Change Orders' }),
        icon: GitPullRequestArrow,
        show: showChangeOrders,
      },
      {
        id: 'tickets' as Tab,
        label: t('homeportal.tab_tickets', { defaultValue: 'My Tickets' }),
        icon: LifeBuoy,
        show: showTickets,
      },
    ] as { id: Tab; label: string; icon: React.ElementType; show: boolean }[]
  ).filter((it) => it.show);

  const [tab, setTab] = useState<Tab>('progress');

  if (profileQ.isLoading) {
    return (
      <Card padding="lg" className="flex w-full max-w-2xl flex-col items-center gap-3 text-center">
        <Loader2 className="animate-spin text-oe-blue" size={24} />
        <p className="text-sm text-content-secondary">
          {t('homeportal.loading_profile', { defaultValue: 'Loading your portal...' })}
        </p>
      </Card>
    );
  }
  if (profileQ.isError) {
    return (
      <Card padding="none" className="w-full max-w-2xl">
        <EmptyState
          icon={<AlertCircle size={22} />}
          title={t('homeportal.profile_error', { defaultValue: 'Could not load your portal' })}
          description={t('homeportal.profile_error_desc', {
            defaultValue: 'Please refresh the page or reopen your invitation link.',
          })}
          action={{
            label: t('common.retry', { defaultValue: 'Retry' }),
            onClick: () => {
              void profileQ.refetch();
            },
          }}
        />
      </Card>
    );
  }

  return (
    <div className="w-full max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-content-primary">
          {t('homeportal.title', { defaultValue: 'Your portal' })}
        </h1>
        <p className="mt-1 text-sm text-content-secondary">
          {t('homeportal.subtitle', {
            defaultValue: 'Everything shared with you, in one place.',
          })}
        </p>
      </div>

      {/* Subcontractors / suppliers belong on the payment portal; if one lands
          here, offer a one-click shortcut. */}
      {(role === 'subcontractor' || role === 'supplier') && (
        <Card padding="sm" className="border-oe-blue/30 bg-oe-blue-subtle/40">
          <Link
            to={PORTAL_PAYMENTS_PATH}
            className="inline-flex items-center gap-2 text-sm font-medium text-oe-blue hover:underline"
          >
            <Receipt size={16} />
            {t('homeportal.go_to_payments', {
              defaultValue: 'Go to your payment applications',
            })}
          </Link>
        </Card>
      )}

      {tabs.length > 1 ? (
        <nav className="flex gap-1 border-b border-border-light">
          {tabs.map((it) => {
            const Icon = it.icon;
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => setTab(it.id)}
                className={clsx(
                  '-mb-px flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                  tab === it.id
                    ? 'border-oe-blue text-oe-blue'
                    : 'border-transparent text-content-secondary hover:text-content-primary',
                )}
              >
                <Icon size={14} />
                {it.label}
              </button>
            );
          })}
        </nav>
      ) : null}

      {/* Default to progress reports for any role whose active tab is not
          available (e.g. a one-tab role). */}
      {tab === 'change_orders' && showChangeOrders ? (
        <ChangeOrdersTab />
      ) : tab === 'tickets' && showTickets ? (
        <TicketsTab />
      ) : (
        <PortalProgressReportsTab />
      )}
    </div>
  );
}

function CenteredShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface-secondary px-4 py-6">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center">{children}</div>
    </div>
  );
}

/* ── Change orders ─────────────────────────────────────────────────────────*/

const CO_STATUS_VARIANT: Record<string, 'neutral' | 'blue' | 'warning' | 'success' | 'error'> = {
  approved: 'success',
  executed: 'success',
  rejected: 'error',
  closed: 'neutral',
};

function money(amount: string | null, currency: string): string {
  if (amount === null) return '—';
  return currency ? `${currency} ${amount}` : amount;
}

function ChangeOrdersTab() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['portal-home', 'change-orders'],
    queryFn: () => listMyChangeOrders({ limit: 100 }),
  });
  const items = q.data?.items ?? [];

  if (q.isLoading) {
    return (
      <Card padding="md">
        <SkeletonTable rows={4} columns={3} />
      </Card>
    );
  }
  if (q.error) {
    return (
      <Card padding="none">
        <EmptyState
          icon={<AlertCircle size={22} />}
          title={t('homeportal.co_load_failed', {
            defaultValue: 'Could not load change orders',
          })}
          description={q.error instanceof Error ? q.error.message : ''}
          action={{
            label: t('common.retry', { defaultValue: 'Retry' }),
            onClick: () => void q.refetch(),
          }}
        />
      </Card>
    );
  }
  if (items.length === 0) {
    return (
      <Card padding="none">
        <EmptyState
          icon={<GitPullRequestArrow size={22} />}
          title={t('homeportal.co_empty', { defaultValue: 'No change orders shared yet' })}
          description={t('homeportal.co_empty_desc', {
            defaultValue: 'Executed change orders shared with you will appear here.',
          })}
        />
      </Card>
    );
  }
  return (
    <ul className="space-y-3">
      {items.map((co) => (
        <ChangeOrderCard key={co.id} co={co} />
      ))}
    </ul>
  );
}

function ChangeOrderCard({ co }: { co: PortalChangeOrder }) {
  const { t } = useTranslation();
  return (
    <li className="rounded-xl border border-border bg-surface-primary p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="font-mono text-2xs text-content-tertiary">{co.code}</span>
          <p className="truncate text-sm font-medium text-content-primary">{co.title}</p>
        </div>
        <Badge variant={CO_STATUS_VARIANT[co.status] ?? 'neutral'} dot>
          {t(`homeportal.co_status_${co.status}`, { defaultValue: co.status })}
        </Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-2xs uppercase tracking-wide text-content-tertiary">
            {t('homeportal.co_amount', { defaultValue: 'Approved amount' })}
          </dt>
          <dd className="font-medium text-content-primary">
            {money(co.approved_amount, co.currency)}
          </dd>
        </div>
        <div>
          <dt className="text-2xs uppercase tracking-wide text-content-tertiary">
            {t('homeportal.co_time', { defaultValue: 'Time impact' })}
          </dt>
          <dd className="text-content-secondary">
            {co.approved_time_days !== null
              ? t('homeportal.co_days', {
                  defaultValue: '{{count}} days',
                  count: co.approved_time_days,
                })
              : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-2xs uppercase tracking-wide text-content-tertiary">
            {t('homeportal.co_approved_at', { defaultValue: 'Approved' })}
          </dt>
          <dd className="text-content-secondary">
            {co.approved_at ? <DateDisplay value={co.approved_at} /> : '—'}
          </dd>
        </div>
      </dl>
    </li>
  );
}

/* ── Tickets ───────────────────────────────────────────────────────────────*/

const TICKET_STATUS_VARIANT: Record<string, 'neutral' | 'blue' | 'warning' | 'success' | 'error'> = {
  new: 'blue',
  in_progress: 'warning',
  resolved: 'success',
  closed: 'neutral',
};

function TicketsTab() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['portal-home', 'tickets'],
    queryFn: () => listMyTickets({ limit: 100 }),
  });
  const items = q.data?.items ?? [];

  if (q.isLoading) {
    return (
      <Card padding="md">
        <SkeletonTable rows={4} columns={3} />
      </Card>
    );
  }
  if (q.error) {
    return (
      <Card padding="none">
        <EmptyState
          icon={<AlertCircle size={22} />}
          title={t('homeportal.tk_load_failed', { defaultValue: 'Could not load tickets' })}
          description={q.error instanceof Error ? q.error.message : ''}
          action={{
            label: t('common.retry', { defaultValue: 'Retry' }),
            onClick: () => void q.refetch(),
          }}
        />
      </Card>
    );
  }
  if (items.length === 0) {
    return (
      <Card padding="none">
        <EmptyState
          icon={<LifeBuoy size={22} />}
          title={t('homeportal.tk_empty', { defaultValue: 'No tickets yet' })}
          description={t('homeportal.tk_empty_desc', {
            defaultValue: 'Service tickets you file will appear here.',
          })}
        />
      </Card>
    );
  }
  return (
    <ul className="space-y-3">
      {items.map((tk) => (
        <TicketCard key={tk.id} ticket={tk} />
      ))}
    </ul>
  );
}

function TicketCard({ ticket }: { ticket: PortalTicket }) {
  const { t } = useTranslation();
  return (
    <li className="rounded-xl border border-border bg-surface-primary p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="font-mono text-2xs text-content-tertiary">{ticket.ticket_number}</span>
          <p className="truncate text-sm font-medium text-content-primary">{ticket.title}</p>
        </div>
        <Badge variant={TICKET_STATUS_VARIANT[ticket.status] ?? 'neutral'} dot>
          {t(`homeportal.tk_status_${ticket.status}`, { defaultValue: ticket.status })}
        </Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-content-tertiary">
        <span>
          {t('homeportal.tk_reported', { defaultValue: 'Reported' })}:{' '}
          <DateDisplay value={ticket.reported_at} />
        </span>
        {ticket.sla_due_at ? (
          <span>
            {t('homeportal.tk_sla', { defaultValue: 'SLA due' })}:{' '}
            <DateDisplay value={ticket.sla_due_at} />
          </span>
        ) : null}
      </div>
    </li>
  );
}
