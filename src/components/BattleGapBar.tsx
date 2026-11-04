import { useState } from 'react'
import { battleStateAt, formatBattleGap, type QualifyingBattle } from '../lib/battle'
import { CarSide } from './CarSide'

interface BattleGapBarProps {
  battle: QualifyingBattle
  current: number
}

/**
 * The gap scale is deliberately non-linear. Live gaps in qualifying are usually
 * a few hundredths to a few tenths of a second, and a linear scale renders those
 * as a hairline. Exponential saturation amplifies the small gaps that matter
 * while keeping a full second inside the strip: 0.05s reads as ~50px and 1s as
 * ~325px, where a linear 60px/s scale would give 3px and 60px.
 */
const GAP_PX_MAX = 340
const GAP_PX_CURVE = 0.32
/** Keep a real gap visibly open so the two cars never appear to touch. */
const MIN_GAP_PX = 14
/**
 * The live delta jitters around zero at the crossing, so the lead can flip
 * several times within a few frames. Only hand the front over once the new
 * leader is at least this far ahead, otherwise the cars would flicker colours.
 */
const SWAP_HYSTERESIS_MS = 10

/** Amplified rail width for a live gap. Exactly 0 for no gap, never negative. */
function gapToPixels(gapMs: number): number {
  if (!(gapMs > 0)) return 0
  const seconds = gapMs / 1_000
  return Math.max(MIN_GAP_PX, GAP_PX_MAX * (1 - Math.exp(-seconds / GAP_PX_CURVE)))
}

/**
 * The battle gap as a race-style "follow" strip, rendered in the middle of the
 * scoreboard: the two cars move apart and together with the live gap, joined
 * by a line that stretches, with the gap value riding on top of it.
 */
export function BattleGapBar({ battle, current }: BattleGapBarProps) {
  const state = battleStateAt(battle.a.lap, battle.b.lap, current)
  const leader = state.lead === 'a' ? battle.a.driver : state.lead === 'b' ? battle.b.driver : null
  const gapPx = gapToPixels(state.gap)
  // Inset the painted line from the cars by the same amount at both ends, so it
  // reads as a connector rather than something glued to the bodywork. The inset
  // scales with the gap (so it stays 0 when the cars meet) and is folded into
  // the margins, keeping the cars' separation exactly `gapPx`.
  const inset = Math.min(8, gapPx * 0.2)
  const linePx = Math.max(0, gapPx - inset * 2)

  // The artwork's nose points left, so the left-hand car is the one in front.
  // Put the current leader there and let the other car chase: when the lead
  // changes, the two cars trade sides, so the overtake reads without the
  // leader ever sitting behind. The remembered side gives the swap hysteresis:
  // the live delta jitters around zero, and without it the cars would flicker.
  const [frontSide, setFrontSide] = useState<'a' | 'b'>('a')
  const nextFront: 'a' | 'b' =
    state.gap >= SWAP_HYSTERESIS_MS ? (state.delta > 0 ? 'b' : 'a') : frontSide
  if (nextFront !== frontSide) setFrontSide(nextFront)

  const bLeads = nextFront === 'b'
  const front = bLeads ? battle.b : battle.a
  const behind = bLeads ? battle.a : battle.b

  return (
    <div className="battle__gapbar">
      <strong className="battle__gapbar-value">
        {leader ? `${leader.acronym} +${formatBattleGap(state.gap)}` : 'Level'}
      </strong>
      <div className="battle__gapbar-pair" aria-hidden="true">
        <CarSide className="battle__gapbar-car" color={front.driver.color} />
        <span
          className="battle__gapbar-rail"
          style={{ width: `${linePx}px`, marginInline: `${inset}px` }}
        />
        <CarSide className="battle__gapbar-car" color={behind.driver.color} />
      </div>
    </div>
  )
}
