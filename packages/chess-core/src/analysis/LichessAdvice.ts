import { winningChancesRaw } from './LichessAccuracy';

/**
 * Jugement des coups, portage à l'identique de
 * `lila/modules/tree/src/main/Advice.scala`.
 *
 * Deux chemins de jugement, dans l'ordre de Lichess (`Advice.apply = CpAdvice.orElse(MateAdvice)`) :
 *  1. `CpAdvice` — les deux scores sont des centipions : delta brut de chances
 *     ([-1,+1], SANS division par 2, SANS plafond), seuils .3/.2/.1 ;
 *  2. `MateAdvice` — une séquence de mat apparaît, se perd ou se prolonge :
 *     seuils propres en centipions (-999/-700/+700/+999).
 *
 * Les scores fournis doivent être exprimés **du point de vue du joueur qui a
 * joué** (positif = bon pour lui), signe incluant le champ `mate`
 * (`mate > 0` = c'est ce joueur qui mate), conformément à
 * `prevScore.invertIf(info.color.black)` côté Lichess.
 */
export type LichessJudgement = 'inaccuracy' | 'mistake' | 'blunder';

export type LichessMateSequence = 'created' | 'lost' | 'delayed';

/** Score POV joueur, tel que Stockfish l'a émis (cp OU mate, jamais les deux). */
export interface PovScore {
  cp?: number;
  mate?: number;
}

export interface AdviceResult {
  judgment?: LichessJudgement;
  mateSequence?: LichessMateSequence;
}

/** `winningChanceJudgements` de `CpAdvice`, même ordre, mêmes seuils. */
const WINNING_CHANCE_JUDGEMENTS: ReadonlyArray<readonly [number, LichessJudgement]> = [
  [0.3, 'blunder'],
  [0.2, 'mistake'],
  [0.1, 'inaccuracy'],
];

export const mateSequenceDescription: Record<LichessMateSequence, string> = {
  created: 'Le mat est désormais inévitable',
  lost: 'Séquence de mat perdue',
  delayed: 'Le mat se précise',
};

/** `CpAdvice.apply` : delta brut de chances, seuils .3/.2/.1. */
function cpAdvice(prev: PovScore, next: PovScore): LichessJudgement | undefined {
  if (prev.cp === undefined || next.cp === undefined) return undefined;

  const prevChances = winningChancesRaw(prev.cp);
  const nextChances = winningChancesRaw(next.cp);
  // Scores déjà en POV joueur (l'équivalent du `color.fold(-d, d)` de lila est
  // intégré dans cette convention) : la perte du joueur est positive quand
  // next < prev.
  const delta = prevChances - nextChances;

  // `find((d, _) => d <= delta)` : le premier seuil satisfait (le plus dur).
  for (const [threshold, judgment] of WINNING_CHANCE_JUDGEMENTS) {
    if (threshold <= delta) return judgment;
  }
  return undefined;
}

/** `MateSequence.apply` : la séquence de mat a-t-elle changé de nature ? */
function mateSequenceOf(prev: PovScore, next: PovScore): LichessMateSequence | undefined {
  const prevHasMate = typeof prev.mate === 'number';
  const nextHasMate = typeof next.mate === 'number';

  if (!prevHasMate && nextHasMate && next.mate! < 0) return 'created';
  if (prevHasMate && prev.mate! > 0 && !nextHasMate) return 'lost';
  if (prevHasMate && prev.mate! > 0 && nextHasMate && next.mate! < 0) return 'lost';
  if (prevHasMate && prev.mate! > 0 && nextHasMate && next.mate! > 0) return 'delayed';
  return undefined;
}

/** `MateAdvice.apply` : sévérité du jugement selon les centipions restants. */
function mateAdvice(prev: PovScore, next: PovScore): AdviceResult | undefined {
  const sequence = mateSequenceOf(prev, next);
  if (!sequence) return undefined;

  // `prevScore.cp.so(_.centipawns)` / `povScore.cp.so(_.centipawns)`
  // → 0 quand le score est un mat (les champs cp sont absents).
  const cpOrZero = (score: PovScore): number => score.cp ?? 0;

  const prevCp = cpOrZero(prev);
  const nextCp = cpOrZero(next);

  let judgment: LichessJudgement;
  switch (sequence) {
    case 'created':
      judgment =
        prevCp < -999 ? 'inaccuracy' : prevCp < -700 ? 'mistake' : 'blunder';
      break;
    case 'lost':
      judgment = nextCp > 999 ? 'inaccuracy' : nextCp > 700 ? 'mistake' : 'blunder';
      break;
    case 'delayed':
      return undefined; // `case MateDelayed => None`
  }

  return { judgment, mateSequence: sequence };
}

/**
 * `Advice.apply(prev, info)` : CpAdvice en priorité, sinon MateAdvice.
 * Retourne `undefined` quand Lichess ne jugerait pas le coup.
 */
export function judgeMove(prev: PovScore, next: PovScore): AdviceResult {
  const cp = cpAdvice(prev, next);
  if (cp !== undefined) return { judgment: cp };
  return mateAdvice(prev, next) ?? {};
}
