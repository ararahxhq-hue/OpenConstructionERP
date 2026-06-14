import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  Building2,
  Box,
  Layers3,
  Calculator,
  CheckCircle2,
  Users,
  HardHat,
  BarChart3,
  ArrowRight,
  ArrowUpRight,
  type LucideIcon,
} from 'lucide-react';

/**
 * QuantitiesWorkflowRibbon - a compact map of the whole project journey shown
 * at the top of the Quantity Takeoff page. It answers three questions for the
 * user at a glance: where am I now, what do I do here, and what comes next.
 *
 * The quantities stage (collect, filter and group) is the current, highlighted
 * step. Around it sit the upstream set-up and model/drawing capture and the
 * downstream estimate, validate, source-and-tender (finding builders), build
 * and control stages. Every step links to its module so the ribbon doubles as
 * navigation across the platform.
 *
 * i18n: every string carries an inline English default via t(key, { defaultValue }).
 */

type StepState = 'past' | 'current' | 'next';

interface JourneyPhase {
  key: string;
  name: string;
  modules: string;
  icon: LucideIcon;
  route?: string;
  state: StepState;
}

export function QuantitiesWorkflowRibbon() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const phases: JourneyPhase[] = [
    {
      key: 'setup',
      name: t('quantities.flow.setup', { defaultValue: 'Set up' }),
      modules: t('quantities.flow.setup_sub', { defaultValue: 'project & team' }),
      icon: Building2,
      route: '/projects',
      state: 'past',
    },
    {
      key: 'capture',
      name: t('quantities.flow.capture', { defaultValue: 'Capture' }),
      modules: t('quantities.flow.capture_sub', {
        defaultValue: 'drawings, CAD, BIM',
      }),
      icon: Box,
      route: '/bim',
      state: 'past',
    },
    {
      key: 'quantify',
      name: t('quantities.flow.quantify', { defaultValue: 'Quantify' }),
      modules: t('quantities.flow.quantify_sub', {
        defaultValue: 'collect, filter & group',
      }),
      icon: Layers3,
      state: 'current',
    },
    {
      key: 'estimate',
      name: t('quantities.flow.estimate', { defaultValue: 'Estimate' }),
      modules: t('quantities.flow.estimate_sub', { defaultValue: 'price the BOQ' }),
      icon: Calculator,
      route: '/boq',
      state: 'next',
    },
    {
      key: 'validate',
      name: t('quantities.flow.validate', { defaultValue: 'Validate' }),
      modules: t('quantities.flow.validate_sub', { defaultValue: 'rules & checks' }),
      icon: CheckCircle2,
      route: '/validation',
      state: 'next',
    },
    {
      key: 'tender',
      name: t('quantities.flow.tender', { defaultValue: 'Source & tender' }),
      modules: t('quantities.flow.tender_sub', {
        defaultValue: 'find builders, bids',
      }),
      icon: Users,
      route: '/tendering',
      state: 'next',
    },
    {
      key: 'build',
      name: t('quantities.flow.build', { defaultValue: 'Build' }),
      modules: t('quantities.flow.build_sub', {
        defaultValue: 'site, RFIs, progress',
      }),
      icon: HardHat,
      route: '/daily-diary',
      state: 'next',
    },
    {
      key: 'control',
      name: t('quantities.flow.control', { defaultValue: 'Control & report' }),
      modules: t('quantities.flow.control_sub', {
        defaultValue: 'cost, invoices, reports',
      }),
      icon: BarChart3,
      route: '/project-controls',
      state: 'next',
    },
  ];

  return (
    <section
      aria-label={t('quantities.flow.aria', {
        defaultValue: 'Where quantity takeoff fits in the project workflow',
      })}
      className="rounded-xl border border-border-light bg-surface-secondary/40 p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-content-primary">
          {t('quantities.flow.title', { defaultValue: 'Your project journey' })}
        </h3>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-oe-blue/10 px-2.5 py-0.5 text-2xs font-medium text-oe-blue">
          <span className="h-1.5 w-1.5 rounded-full bg-oe-blue" aria-hidden />
          {t('quantities.flow.you_are_here_q', {
            defaultValue: 'You are here: Quantify',
          })}
        </span>
      </div>

      {/* Lifecycle track - every phase links to its module, the current one
          (Quantify) is highlighted. Scrolls horizontally on narrow screens. */}
      <ol className="flex items-stretch gap-1 overflow-x-auto pb-1">
        {phases.map((phase, i) => {
          const Icon = phase.icon;
          const isCurrent = phase.state === 'current';
          const isPast = phase.state === 'past';
          const clickable = Boolean(phase.route) && !isCurrent;
          const node = (
            <div
              className={clsx(
                'flex h-full min-w-[8.5rem] items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors',
                isCurrent
                  ? 'border-oe-blue bg-oe-blue/10 ring-1 ring-oe-blue/30'
                  : 'border-border-light bg-surface-primary',
                clickable && 'cursor-pointer hover:border-oe-blue/40 hover:bg-oe-blue/5',
                isPast && !isCurrent && 'opacity-80',
              )}
            >
              <span
                className={clsx(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                  isCurrent
                    ? 'bg-oe-blue text-white'
                    : 'bg-surface-tertiary text-content-secondary',
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span
                  className={clsx(
                    'block text-xs font-semibold',
                    isCurrent ? 'text-oe-blue' : 'text-content-primary',
                  )}
                >
                  {phase.name}
                </span>
                <span className="block text-2xs text-content-tertiary">
                  {phase.modules}
                </span>
              </span>
            </div>
          );
          return (
            <li key={phase.key} className="flex items-center gap-1">
              {clickable ? (
                <button
                  type="button"
                  onClick={() => phase.route && navigate(phase.route)}
                  className="h-full rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-oe-blue/40"
                >
                  {node}
                </button>
              ) : (
                node
              )}
              {i < phases.length - 1 && (
                <ArrowRight
                  className="h-4 w-4 shrink-0 text-content-tertiary/50"
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* Now / Next - what to do here and what comes after. */}
      <div className="mt-3 grid gap-3 border-t border-border-light pt-3 sm:grid-cols-2">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wide text-content-tertiary">
            {t('quantities.flow.now_label', { defaultValue: 'What you do here' })}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-content-secondary">
            {t('quantities.flow.now_body', {
              defaultValue:
                'Collect your project quantities, then filter and group them into the structure your BOQ needs. Pick a method below to start.',
            })}
          </p>
        </div>
        <div className="sm:border-l sm:border-border-light sm:pl-3">
          <p className="text-2xs font-semibold uppercase tracking-wide text-content-tertiary">
            {t('quantities.flow.next_label', { defaultValue: 'Up next' })}
          </p>
          <button
            type="button"
            onClick={() => navigate('/boq')}
            className="group mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-oe-blue hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-oe-blue/40"
          >
            {t('quantities.flow.next_body', {
              defaultValue: 'Estimate: turn your quantities into a priced BOQ',
            })}
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </button>
        </div>
      </div>
    </section>
  );
}
