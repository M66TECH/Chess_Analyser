import { describe, it, expect } from 'vitest';
import { EvalCache } from '../cache/EvalCache';
import type { EngineEvaluation } from '../events/GameEventBus';

const FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

function evaluation(overrides: Partial<EngineEvaluation> = {}): EngineEvaluation {
  return { depth: 18, cp: 24, pv: ['e7e5'], multiPv: 1, ...overrides };
}

describe('EvalCache', () => {
  it('normalise le FEN en ignorant uniquement le compteur de coups', () => {
    const cache = new EvalCache();
    expect(cache.normalizeFen('8/8/8/8/8/8/8/8 w - - 0 1'))
      .toBe(cache.normalizeFen('8/8/8/8/8/8/8/8 w - - 0 42'));
    expect(cache.normalizeFen('8/8/8/8/8/8/8/8 w - - 12 1'))
      .not.toBe(cache.normalizeFen('8/8/8/8/8/8/8/8 w - - 13 1'));
  });

  it('fonctionne sans IndexedDB grâce au cache mémoire', async () => {
    const cache = new EvalCache();
    await cache.set(FEN, evaluation());
    const found = await cache.get(FEN);
    expect(found?.cp).toBe(24);
  });

  it('refuse de mémoriser une évaluation trop peu profonde', async () => {
    const cache = new EvalCache();
    await cache.set(FEN, evaluation({ depth: 4 }));
    expect(await cache.get(FEN)).toBeUndefined();
  });

  it('retourne undefined pour une position inconnue', async () => {
    const cache = new EvalCache();
    expect(await cache.get(FEN)).toBeUndefined();
  });
});
