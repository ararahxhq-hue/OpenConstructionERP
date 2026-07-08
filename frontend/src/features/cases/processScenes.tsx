// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Process scenes - a richer, step-specific illustration of the WORK a case step
// actually does, drawn as a small before -> after progression rather than a
// single object. Where StepScene draws one recognisable object keyed off the
// step's lucide icon, a process scene shows the process itself: rooms with snags
// driven to a zero list, inspections closing out an NCR register, loose
// documents gathered into one indexed set, a signed certificate handed over.
//
// Keyed by an explicit `scene` id set on the PlaybookStep (see types.ts), so a
// case opts in step by step. The runner falls back to StepScene when a step has
// no `scene`, so every other case is untouched. Same visual language as
// StepScene / caseScenes: the shared `0 0 120 84` viewBox, the faint blueprint
// grid, the shared `C` palette and one `accent` highlight, on an always-light
// tile so the artwork reads the same in light and dark.
//
// This is the reference set for the "Hand over and close out" case; other cases
// adopt it by adding their own scenes here and pointing their steps at them.

import { type ReactElement } from 'react';
import clsx from 'clsx';
import { C, Sheet, HeaderBand, RowBar, Chip, Badge, Stamp, Signature } from './stepSceneParts';
import { Grid, VB } from './StepScene';

/** A scene takes the one accent colour and returns its artwork group. */
type Scene = (accent: string) => ReactElement;

/** Reusable rightward sequence arrow (before -> after), in the accent colour. */
function FlowArrow({ x, y, accent }: { x: number; y: number; accent: string }): ReactElement {
  return (
    <path
      d={`M${x} ${y} h13 M${x + 9} ${y - 4} l5 4 l-5 4`}
      stroke={accent}
      strokeWidth={2.2}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/**
 * Bespoke per-step process scenes, keyed by the step's `scene` id. Every scene
 * uses the shared `C` palette for fills and one `accent` highlight, so the
 * linework matches the StepScene / CaseScene sets exactly.
 */
export const PROCESS_SCENES: Record<string, Scene> = {
  // Clear the punch list: a floor plan whose snags (open = red pins, done =
  // green checks) are worked down to a punch list that reads zero open.
  'punchlist-to-zero': (accent) => (
    <>
      {/* Floor plan walked room by room */}
      <Sheet x={10} y={16} w={44} h={52} fill={C.panel} />
      <path d="M32 16 V68 M10 42 H54" stroke={C.grey1} strokeWidth={1.2} fill="none" />
      <Badge cx={21} cy={29} r={4.2} fill={C.green} glyph="check" shadow={false} />
      <Badge cx={44} cy={30} r={4.2} fill={C.green} glyph="check" shadow={false} />
      <circle cx={21} cy={55} r={3.4} fill={C.red} stroke={C.white} strokeWidth={1} />
      <circle cx={43} cy={56} r={3.4} fill={C.red} stroke={C.white} strokeWidth={1} />
      <FlowArrow x={58} y={42} accent={accent} />
      {/* Punch list driven to zero (0 open, every row ticked) */}
      <Sheet x={76} y={14} w={38} h={56} />
      <HeaderBand x={76} y={14} w={38} h={10} fill={C.blue} />
      <Chip x={98} y={16} w={13} h={6} r={2} fill={C.green} label="0" />
      <Badge cx={84} cy={35} r={3.8} fill={C.green} glyph="check" shadow={false} />
      <RowBar x={91} y={33.5} w={18} h={3} fill={C.grey3} />
      <Badge cx={84} cy={46} r={3.8} fill={C.green} glyph="check" shadow={false} />
      <RowBar x={91} y={44.5} w={14} h={3} fill={C.grey3} />
      <Badge cx={84} cy={57} r={3.8} fill={C.green} glyph="check" shadow={false} />
      <RowBar x={91} y={55.5} w={16} h={3} fill={C.grey3} />
    </>
  ),

  // Confirm quality is closed: every inspection point passed on the left, and on
  // the right an NCR register with nothing left open (a big closing check).
  'quality-closed': (accent) => (
    <>
      {/* Inspection checklist, every point signed off */}
      <Sheet x={12} y={16} w={42} h={54} />
      <rect x={26} y={11} width={16} height={8} rx={3} fill={C.grey1} stroke="none" />
      <Badge cx={22} cy={33} r={4.2} fill={C.green} glyph="check" shadow={false} />
      <RowBar x={29} y={31.5} w={20} h={3} fill={C.grey3} />
      <Badge cx={22} cy={45} r={4.2} fill={C.green} glyph="check" shadow={false} />
      <RowBar x={29} y={43.5} w={17} h={3} fill={C.grey3} />
      <Badge cx={22} cy={57} r={4.2} fill={C.green} glyph="check" shadow={false} />
      <RowBar x={29} y={55.5} w={19} h={3} fill={C.grey3} />
      <FlowArrow x={58} y={42} accent={accent} />
      {/* NCR register - nothing open */}
      <Sheet x={76} y={20} w={38} h={44} />
      <HeaderBand x={76} y={20} w={38} h={10} fill={C.green} />
      <Chip x={80} y={22} w={17} h={6} r={2} fill={C.white} label="NCR" labelFill={C.green} />
      <Badge cx={95} cy={48} r={12} fill={C.green} glyph="check" />
    </>
  ),

  // Assemble the documents: loose as-built drawings, certificates and manuals
  // (distinct coloured headers) gathered into one indexed handover folder.
  'gather-handover-docs': (accent) => (
    <>
      {/* Loose documents of different kinds */}
      <Sheet x={12} y={12} w={24} h={19} shadow={false} />
      <HeaderBand x={12} y={12} w={24} h={6} fill={C.blueLight} />
      <RowBar x={16} y={22} w={15} h={2.6} fill={C.grey3} />
      <Sheet x={15} y={37} w={24} h={19} shadow={false} />
      <HeaderBand x={15} y={37} w={24} h={6} fill={C.ochre} />
      <RowBar x={19} y={47} w={15} h={2.6} fill={C.grey3} />
      <Sheet x={40} y={25} w={24} h={19} shadow={false} />
      <HeaderBand x={40} y={25} w={24} h={6} fill={C.green} />
      <RowBar x={44} y={35} w={15} h={2.6} fill={C.grey3} />
      <FlowArrow x={66} y={44} accent={accent} />
      {/* Indexed handover folder */}
      <path d="M80 37 h11 l3 -4 h15 a2 2 0 0 1 2 2 v3 H80 z" fill={C.ochre} stroke="none" />
      <path
        d="M78 41 h38 l-5 21 a2.5 2.5 0 0 1 -2.4 1.8 H83 a2.5 2.5 0 0 1 -2.4 -1.8 z"
        fill={C.amber}
        stroke="none"
      />
      <RowBar x={88} y={49} w={20} h={2.6} fill={C.white} opacity={0.85} />
      <RowBar x={88} y={54} w={15} h={2.6} fill={C.white} opacity={0.7} />
      <Badge cx={110} cy={40} r={6.5} fill={C.green} glyph="check" />
    </>
  ),

  // Issue the handover: a signed, stamped close-out certificate is passed across
  // to the client and operator, with the works signed off.
  'issue-signed-handover': (accent) => (
    <>
      {/* Signed and stamped close-out certificate */}
      <Sheet x={12} y={12} w={42} h={50} />
      <HeaderBand x={12} y={12} w={42} h={10} fill={C.blue} />
      <RowBar x={18} y={15} w={20} h={3} fill={C.white} opacity={0.9} />
      <RowBar x={19} y={30} w={30} h={3} fill={C.grey3} />
      <RowBar x={19} y={38} w={26} h={3} fill={C.grey3} />
      <Signature x={19} y={52} w={22} color={C.blue} />
      <Stamp cx={46} cy={34} r={7} color={C.green} />
      <FlowArrow x={58} y={40} accent={accent} />
      {/* Handed over: client and operator shake on it, works signed off */}
      <path d="M74 52 h14 l6 5 -6 5 H74 z" fill={C.blue} stroke="none" />
      <path d="M114 52 h-14 l-6 5 6 5 h14 z" fill={C.ochre} stroke="none" />
      <rect x={88} y={50} width={20} height={14} rx={5} fill={C.grey3} stroke={C.grey1} strokeWidth={1.2} />
      <path d="M94 54 v6 M99 54 v6 M104 54 v6" stroke={accent} strokeWidth={1.4} fill="none" />
      <Badge cx={98} cy={34} r={9} fill={C.green} glyph="check" />
    </>
  ),
};

/** True when a step's `scene` id has a bespoke process scene to render. */
export function hasProcessScene(sceneId: string | undefined): boolean {
  return Boolean(sceneId && PROCESS_SCENES[sceneId]);
}

interface StepProcessSceneProps {
  /** The step's `scene` id; selects the bespoke process scene. */
  sceneId: string;
  /** Accent colour (hex) for the one highlight per scene. Defaults to oe-blue. */
  accent?: string;
  /** Extra classes for the tile (height / width / rounding). */
  className?: string;
  /** Accessible label; the scene is decorative when omitted. */
  title?: string;
}

/**
 * Renders the bespoke process scene for a step in the same tile frame as
 * StepScene (same viewBox, blueprint grid and slate linework). Returns `null`
 * when the id has no scene, so callers fall back to StepScene.
 */
export function StepProcessScene({
  sceneId,
  accent = '#2563eb',
  className,
  title,
}: StepProcessSceneProps): ReactElement | null {
  const scene = PROCESS_SCENES[sceneId];
  if (!scene) return null;
  return (
    <div
      className={clsx(
        'relative flex items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-white to-slate-50 ring-1 ring-inset ring-slate-900/[0.06]',
        className,
      )}
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
    >
      <svg
        viewBox={VB}
        className="h-full w-full p-3 text-slate-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <Grid />
        {scene(accent)}
      </svg>
    </div>
  );
}
