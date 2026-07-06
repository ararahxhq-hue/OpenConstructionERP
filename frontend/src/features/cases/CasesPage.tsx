// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// CasesPage - the "Cases" hub.
//
// At /cases it lists every discovered case as a card (title, description, step
// count, time and any progress). At /cases/:playbookId it hands off to the
// PlaybookRunner stepper. One component serves both so the route stays a single
// lazy chunk.
//
// The PRIMARY organizing axis is company type: the "I work as..." selector at
// the top narrows the whole list to the cases actually built for that kind of
// work (general contractor, subcontractor, cost consultant, designer,
// developer/client, project manager, BIM consultant, owner/operator). The
// discipline chips from categories.ts stay as a secondary filter, and a plain
// text search narrows further still. A project picker lets a user pin the
// cases relevant to one of their real projects and, once pinned, show only
// that shortlist - a lightweight, local (no backend) "playbook library for
// this job".

import { useMemo, useState, type ComponentType } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Route,
  ArrowRight,
  Clock,
  ListChecks,
  Layers,
  Search,
  Pin,
  PinOff,
  Briefcase,
  FolderKanban,
  type LucideProps,
} from 'lucide-react';
import { Badge, EmptyState } from '@/shared/ui';
import { projectsApi } from '@/features/projects/api';
import { PLAYBOOKS, getPlaybook } from './playbooks';
import { PlaybookRunner } from './PlaybookRunner';
import { useCasesStore } from './useCasesStore';
import { completedCount } from './progress';
import { CATEGORY_META, tintFor, NEUTRAL_TINT } from './categories';
import { COMPANY_TYPE_META, COMPANY_TYPE_BY_ID, tintForCompany } from './companyTypes';
import { iconFor } from './icons';
import type { Playbook, CaseCategory, CompanyType } from './types';

export function CasesPage() {
  const { playbookId } = useParams<{ playbookId?: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Detail mode: a specific case is open in the runner.
  if (playbookId) {
    const playbook = getPlaybook(playbookId);
    if (!playbook) {
      return (
        <div className="py-8 animate-fade-in">
          <EmptyState
            icon={<Route size={28} />}
            title={t('cases.not_found_title', { defaultValue: 'Case not found' })}
            description={t('cases.not_found_body', {
              defaultValue: 'This case does not exist or was removed. Browse the full list instead.',
            })}
            action={{
              label: t('cases.back_to_list', { defaultValue: 'All cases' }),
              onClick: () => navigate('/cases'),
            }}
          />
        </div>
      );
    }
    return <PlaybookRunner playbook={playbook} />;
  }

  // List mode.
  return <CasesList />;
}

function CasesList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const runs = useCasesStore((s) => s.runs);
  const companyType = useCasesStore((s) => s.companyType);
  const setCompanyType = useCasesStore((s) => s.setCompanyType);
  const pinProjectId = useCasesStore((s) => s.pinProjectId);
  const setPinProjectId = useCasesStore((s) => s.setPinProjectId);
  const pins = useCasesStore((s) => s.pins);
  const togglePin = useCasesStore((s) => s.togglePin);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<CaseCategory | 'all'>('all');
  const [showOnlyPinned, setShowOnlyPinned] = useState(false);

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const sortedProjects = useMemo(
    () => [...(projects ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  );
  const pinnedIds = pinProjectId ? (pins[pinProjectId] ?? []) : [];

  // Best progress for a card = the furthest a user got on this case across any
  // run (unscoped or scoped to a sample project).
  const bestDoneFor = useMemo(() => {
    return (pb: Playbook): number => {
      let best = 0;
      for (const [k, prog] of Object.entries(runs)) {
        if (k === pb.id || k.startsWith(`${pb.id}::`)) {
          best = Math.max(best, completedCount(prog, pb));
        }
      }
      return best;
    };
  }, [runs]);

  // Only surface company-type cards and category chips that actually have at
  // least one matching case, so a filter never offers an empty bucket. Both
  // are scoped by the OTHER active filter so the counts always describe what
  // clicking that chip would actually show.
  const casesForCategory = useMemo(
    () => PLAYBOOKS.filter((p) => activeCategory === 'all' || p.category === activeCategory),
    [activeCategory],
  );
  const casesForCompany = useMemo(
    () => PLAYBOOKS.filter((p) => !companyType || p.companyTypes.includes(companyType)),
    [companyType],
  );
  const availableCompanyTypes = useMemo(() => {
    const present = new Set(casesForCategory.flatMap((p) => p.companyTypes));
    return COMPANY_TYPE_META.filter((c) => present.has(c.id));
  }, [casesForCategory]);
  const availableCategories = useMemo(() => {
    const present = new Set(casesForCompany.map((p) => p.category));
    return CATEGORY_META.filter((c) => present.has(c.id));
  }, [casesForCompany]);

  // Filter by company type, category chip, the pinned-for-project shortlist
  // and a plain title/description text search. All narrow the same list.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PLAYBOOKS.filter((pb) => {
      if (companyType && !pb.companyTypes.includes(companyType)) return false;
      if (activeCategory !== 'all' && pb.category !== activeCategory) return false;
      if (showOnlyPinned && !pinnedIds.includes(pb.id)) return false;
      if (!q) return true;
      const haystack = `${t(pb.titleKey, { defaultValue: pb.titleDefault })} ${t(pb.descKey, {
        defaultValue: pb.descDefault,
      })}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [query, activeCategory, companyType, showOnlyPinned, pinnedIds, t]);

  const handlePickCompany = (id: CompanyType) => {
    setCompanyType(companyType === id ? null : id);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-oe-blue/10 text-oe-blue ring-1 ring-inset ring-oe-blue/20">
          <Route size={20} strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-content-primary">
            {t('cases.page_title', { defaultValue: 'Cases' })}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-content-secondary">
            {t('cases.page_subtitle', {
              defaultValue:
                'Guided, end-to-end playbooks that walk you through several modules in order. Pick a case, optionally choose a sample project to learn on, and follow each step.',
            })}
          </p>
        </div>
      </div>

      {PLAYBOOKS.length > 0 && (
        <>
          {/* ── Primary filter: "I work as..." company-type selector ─────── */}
          <div>
            <div className="mb-2.5 flex items-center gap-2">
              <Briefcase size={14} className="text-content-tertiary" aria-hidden="true" />
              <h2 className="text-xs font-semibold uppercase tracking-wide text-content-secondary">
                {t('cases.company_selector.heading', { defaultValue: 'I work as...' })}
              </h2>
              <span className="text-2xs text-content-tertiary">
                {t('cases.company_selector.subtitle', {
                  defaultValue: 'Pick your role to see the cases built for it.',
                })}
              </span>
            </div>
            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8"
              role="group"
              aria-label={t('cases.company_selector.heading', { defaultValue: 'I work as...' })}
            >
              {COMPANY_TYPE_META.map((c) => {
                const Icon = c.icon;
                const active = companyType === c.id;
                const count = casesForCategory.filter((p) => p.companyTypes.includes(c.id)).length;
                const disabled = !availableCompanyTypes.some((a) => a.id === c.id) && !active;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handlePickCompany(c.id)}
                    aria-pressed={active}
                    disabled={disabled}
                    className={clsx(
                      'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-oe-blue/40',
                      active
                        ? clsx(c.tint.chip, 'shadow-sm')
                        : 'border-border-light bg-surface-primary text-content-secondary hover:border-oe-blue/30 hover:text-content-primary',
                      disabled && 'cursor-not-allowed opacity-40',
                    )}
                  >
                    <span
                      className={clsx(
                        'flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-inset',
                        active ? 'bg-white/40 ring-white/40 dark:bg-black/10' : c.tint.tile,
                      )}
                      aria-hidden="true"
                    >
                      <Icon size={16} strokeWidth={1.9} />
                    </span>
                    <span className="text-2xs font-semibold leading-tight">
                      {t(c.labelKey, { defaultValue: c.labelDefault })}
                    </span>
                    <span className="text-2xs tabular-nums opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>
            {companyType && (
              <button
                type="button"
                onClick={() => setCompanyType(null)}
                className="mt-2 text-2xs font-medium text-oe-blue hover:underline"
              >
                {t('cases.company_selector.all', { defaultValue: 'All roles' })}
              </button>
            )}
          </div>

          {/* ── Project pin bar ───────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border-light bg-surface-secondary/40 p-3">
            <FolderKanban size={15} className="shrink-0 text-content-tertiary" aria-hidden="true" />
            <label htmlFor="cases-pin-project" className="sr-only">
              {t('cases.project_pin.picker_label', { defaultValue: 'Project' })}
            </label>
            <select
              id="cases-pin-project"
              value={pinProjectId}
              onChange={(e) => {
                setPinProjectId(e.target.value);
                if (!e.target.value) setShowOnlyPinned(false);
              }}
              className="h-8 rounded-lg border border-border bg-surface-primary px-2.5 text-xs text-content-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-oe-blue/40"
            >
              <option value="">
                {t('cases.project_pin.picker_none', { defaultValue: 'No project selected' })}
              </option>
              {sortedProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowOnlyPinned((v) => !v)}
              disabled={!pinProjectId}
              aria-pressed={showOnlyPinned}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                showOnlyPinned
                  ? 'border-oe-blue/40 bg-oe-blue/10 text-oe-blue'
                  : 'border-border-light bg-surface-primary text-content-secondary hover:border-oe-blue/30 hover:text-content-primary',
              )}
            >
              <Pin size={12} aria-hidden="true" />
              {t('cases.project_pin.show_pinned', { defaultValue: 'Cases for this project' })}
              {pinProjectId && (
                <span className="tabular-nums opacity-70">{pinnedIds.length}</span>
              )}
            </button>
            {!pinProjectId && (
              <span className="text-2xs text-content-tertiary">
                {t('cases.project_pin.pick_project_first', {
                  defaultValue: 'Pick a project above to pin cases to it.',
                })}
              </span>
            )}
          </div>

          {/* ── Secondary filter: search + discipline chips ──────────────── */}
          <div className="space-y-3">
            <div className="relative max-w-md">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('cases.search_placeholder', { defaultValue: 'Search cases...' })}
                aria-label={t('cases.search_placeholder', { defaultValue: 'Search cases...' })}
                className="w-full rounded-lg border border-border-light bg-surface-primary py-2 pl-9 pr-3 text-sm text-content-primary placeholder:text-content-tertiary focus:border-oe-blue/50 focus:outline-none focus:ring-2 focus:ring-oe-blue/20"
              />
            </div>
            <div>
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-content-tertiary">
                {t('cases.filter.discipline_label', { defaultValue: 'Discipline' })}
              </p>
              <div className="flex flex-wrap gap-2">
                <CategoryChip
                  active={activeCategory === 'all'}
                  onClick={() => setActiveCategory('all')}
                  label={t('cases.cat.all', { defaultValue: 'All' })}
                  count={casesForCompany.length}
                  icon={Layers}
                  activeClass={NEUTRAL_TINT.chip}
                />
                {availableCategories.map((c) => {
                  const count = casesForCompany.filter((p) => p.category === c.id).length;
                  return (
                    <CategoryChip
                      key={c.id}
                      active={activeCategory === c.id}
                      onClick={() => setActiveCategory(c.id)}
                      label={t(c.labelKey, { defaultValue: c.labelDefault })}
                      count={count}
                      icon={c.icon}
                      activeClass={c.tint.chip}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Cards ───────────────────────────────────────────────────────── */}
      {PLAYBOOKS.length === 0 ? (
        <EmptyState
          icon={<Route size={28} />}
          title={t('cases.empty_title', { defaultValue: 'No cases yet' })}
          description={t('cases.empty_body', {
            defaultValue: 'Guided playbooks will appear here as they are added.',
          })}
        />
      ) : showOnlyPinned && visible.length === 0 ? (
        <EmptyState
          icon={<Pin size={28} />}
          title={t('cases.project_pin.empty_title', { defaultValue: 'No cases pinned yet' })}
          description={t('cases.project_pin.empty_body', {
            defaultValue: 'Pin a case to this project from its card, and it will show up here.',
          })}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Search size={28} />}
          title={t('cases.no_matches_title', { defaultValue: 'No matching cases' })}
          description={t('cases.no_matches_body', {
            defaultValue: 'Try a different search or category.',
          })}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((pb) => {
            const Icon = iconFor(pb.icon);
            const tint = tintFor(pb.category);
            const total = pb.steps.length;
            const done = bestDoneFor(pb);
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const started = done > 0;
            const complete = total > 0 && done === total;
            const pinned = pinProjectId ? pinnedIds.includes(pb.id) : false;
            return (
              <div
                key={pb.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/cases/${pb.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/cases/${pb.id}`);
                  }
                }}
                className={clsx(
                  'group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-border-light bg-surface-primary p-5 pl-6 text-left',
                  'shadow-xs transition-all hover:-translate-y-0.5 hover:border-oe-blue/40 hover:shadow-md',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-oe-blue/40',
                )}
              >
                {/* Soft left rail tints the card by discipline (positioned so it
                    never fights the card border). */}
                <span
                  aria-hidden="true"
                  className={clsx('absolute inset-y-0 left-0 w-1', tint.accent)}
                />
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span
                    className={clsx(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset',
                      tint.tile,
                    )}
                  >
                    <Icon size={19} strokeWidth={1.9} />
                  </span>
                  <div className="flex items-center gap-1.5">
                    {complete ? (
                      <Badge variant="success" size="sm">
                        {t('cases.card.done_badge', { defaultValue: 'Done' })}
                      </Badge>
                    ) : started ? (
                      <Badge variant="blue" size="sm">
                        {t('cases.card.in_progress', { defaultValue: 'In progress' })}
                      </Badge>
                    ) : null}
                    {pinProjectId && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePin(pinProjectId, pb.id);
                        }}
                        aria-pressed={pinned}
                        title={
                          pinned
                            ? t('cases.project_pin.unpin', { defaultValue: 'Unpin from project' })
                            : t('cases.project_pin.pin', { defaultValue: 'Pin to project' })
                        }
                        aria-label={
                          pinned
                            ? t('cases.project_pin.unpin', { defaultValue: 'Unpin from project' })
                            : t('cases.project_pin.pin', { defaultValue: 'Pin to project' })
                        }
                        className={clsx(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-oe-blue/40',
                          pinned
                            ? 'border-oe-blue/40 bg-oe-blue/10 text-oe-blue'
                            : 'border-border-light bg-surface-primary text-content-tertiary hover:border-oe-blue/30 hover:text-content-primary',
                        )}
                      >
                        {pinned ? <Pin size={13} /> : <PinOff size={13} />}
                      </button>
                    )}
                  </div>
                </div>

                <h2 className="text-sm font-semibold leading-snug text-content-primary">
                  {t(pb.titleKey, { defaultValue: pb.titleDefault })}
                </h2>
                <p className="mt-1.5 flex-1 text-xs leading-relaxed text-content-secondary">
                  {t(pb.descKey, { defaultValue: pb.descDefault })}
                </p>

                {/* Company-type hint: who this case is built for. */}
                <div
                  className="mt-3 flex flex-wrap items-center gap-1"
                  aria-label={pb.companyTypes
                    .map((id) => COMPANY_TYPE_BY_ID[id]?.labelDefault ?? id)
                    .join(', ')}
                >
                  {pb.companyTypes.slice(0, 4).map((id) => {
                    const meta = COMPANY_TYPE_BY_ID[id];
                    if (!meta) return null;
                    const CIcon = meta.icon;
                    const companyTint = tintForCompany(id);
                    return (
                      <span
                        key={id}
                        title={t(meta.labelKey, { defaultValue: meta.labelDefault })}
                        className={clsx(
                          'flex h-5 w-5 items-center justify-center rounded-md ring-1 ring-inset',
                          companyTint.tile,
                        )}
                        aria-hidden="true"
                      >
                        <CIcon size={11} strokeWidth={2} />
                      </span>
                    );
                  })}
                </div>

                {/* Progress bar (only once started) */}
                {started && (
                  <div className="mt-3">
                    <div
                      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-secondary"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={total}
                      aria-valuenow={done}
                      aria-valuetext={t('cases.steps_progress', {
                        defaultValue: '{{done}} of {{total}} steps',
                        done,
                        total,
                      })}
                      aria-label={t('cases.progress_label', { defaultValue: 'Case progress' })}
                    >
                      <div
                        className="h-full rounded-full bg-oe-blue transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p
                      aria-hidden="true"
                      className="mt-1 text-2xs text-content-tertiary tabular-nums"
                    >
                      {t('cases.steps_progress', {
                        defaultValue: '{{done}} of {{total}} steps',
                        done,
                        total,
                      })}
                    </p>
                  </div>
                )}

                {/* Footer meta + CTA */}
                <div className="mt-4 flex items-center justify-between gap-2 border-t border-border-light pt-3">
                  <div className="flex items-center gap-3 text-2xs text-content-tertiary">
                    <span className="inline-flex items-center gap-1">
                      <ListChecks size={12} aria-hidden="true" />
                      {t('cases.card.steps', { defaultValue: '{{count}} steps', count: total })}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock size={12} aria-hidden="true" />
                      {t('cases.card.minutes', {
                        defaultValue: 'about {{count}} min',
                        count: pb.estMinutes,
                      })}
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-oe-blue">
                    {started
                      ? t('cases.card.continue', { defaultValue: 'Continue' })
                      : t('cases.card.open', { defaultValue: 'Open' })}
                    <ArrowRight
                      size={13}
                      className="transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A single discipline filter chip with an icon, label and case count. */
function CategoryChip({
  active,
  onClick,
  label,
  count,
  icon: Icon,
  activeClass,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  icon: ComponentType<LucideProps>;
  /** Soft tint classes applied when the chip is the active filter. */
  activeClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? activeClass
          : 'border-border-light bg-surface-primary text-content-secondary hover:border-oe-blue/30 hover:text-content-primary',
      )}
    >
      <Icon size={13} strokeWidth={2} aria-hidden="true" />
      {label}
      <span className={clsx('ml-0.5 tabular-nums', active ? 'opacity-70' : 'text-content-tertiary')}>
        {count}
      </span>
    </button>
  );
}
