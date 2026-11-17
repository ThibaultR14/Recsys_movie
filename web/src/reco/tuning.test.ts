// Variants of the settings (docs/etape-8-analyse-reglages.md): analysis and dev switches only; no
// tuning = production, computed exactly as before.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { describeTuning, parseDevTuning } from '../dev/devTuning';
import {
  capEstimated,
  classicsBonus,
  importExport,
  itemQuality,
  loadEngine,
  qualityPercentile,
  recommend,
  tunedLambda,
} from './engine';
import { qualityPool } from './recommend';

describe('parseDevTuning', () => {
  it('no switch -> production (undefined)', () => {
    expect(parseDevTuning('')).toBeUndefined();
    expect(parseDevTuning('?autre=1')).toBeUndefined();
  });

  it('reads every switch', () => {
    expect(parseDevTuning('?calibration=0&qualite=0&recents=0')).toEqual({
      calibration: false,
      quality: false,
      recent: 'not-recommended',
    });
    expect(parseDevTuning('?lambda=0,5')).toEqual({ lambda: 0.5 });
    expect(parseDevTuning('?lambda=0.1;0.1;0.1;0.3;0.5;0.7;0.9;0.9')).toEqual({
      lambda: [0.1, 0.1, 0.1, 0.3, 0.5, 0.7, 0.9, 0.9],
    });
    expect(parseDevTuning('?qualite=0.2&recents=aucun')).toEqual({ gamma: 0.2, recent: 'off' });
    expect(parseDevTuning('?classiques=0.5&centile=99&classiques_estimes=1')).toEqual({
      classics: { gamma: 0.5, percentile: 99, estimated: true },
    });
    expect(parseDevTuning('?classiques=1')).toEqual({ classics: { gamma: 1, percentile: 99 } });
    expect(parseDevTuning('?classiques=0')).toEqual({ classics: { gamma: 0, percentile: 99 } });
  });

  it('switches back to the settings before R6e, one by one or all at once', () => {
    expect(
      parseDevTuning(
        '?plafond_estimes=0&tampon_estimes=1&explication_estimes=1&q_estimes=catalogue',
      ),
    ).toEqual({
      estimatedPerRow: false,
      estimatedStamp: true,
      estimatedExplain: true,
      estimatedQuality: 'catalog',
    });
    expect(parseDevTuning('?avant=1')).toEqual({
      lambda: 0.9,
      classics: { gamma: 0, percentile: 99 },
      estimatedPerRow: false,
      estimatedStamp: true,
      estimatedExplain: true,
      estimatedQuality: 'catalog',
    });
    expect(describeTuning(parseDevTuning('?avant=1')!)).toContain('sans bonus des classiques');
  });

  it('?crans=8: the 8-notch slider (step 8b, D1)', () => {
    expect(parseDevTuning('?crans=8')).toEqual({ allNotches: true });
    expect(parseDevTuning('?crans=3')).toBeUndefined();
    expect(describeTuning({ allNotches: true })).toBe('curseur à 8 crans');
  });

  it('describes the switches for the banner', () => {
    expect(describeTuning({ calibration: false, lambda: 0.5 })).toBe(
      'sans calibration · λ 0,5 (≤ 5 000)',
    );
  });
});

describe('capEstimated (step 8, R6e)', () => {
  it('at most one estimated film per row of 8; the others open the next rows', () => {
    const items = [100, 101, 1, 2, 102, 3, 4, 5, 6, 7, 8, 9, 10, 11, 103, 12, 13, 14];
    const out = capEstimated(items, 100, 1, 8, 16);
    expect(out).toHaveLength(16);
    expect(out[0]).toBe(100);
    expect(out[8]).toBe(101);
    for (let r = 0; r < 2; r++) {
      expect(out.slice(r * 8, r * 8 + 8).filter((i) => i >= 100).length).toBeLessThanOrEqual(1);
    }
  });

  it('stops when only waiting estimated films remain (same as Python)', () => {
    expect(capEstimated([100, 101, 102, 1], 100, 1, 8, 8)).toEqual([100, 1]);
  });
});

describe('tunedLambda', () => {
  const calibration = {
    mode: 'share',
    pool: 150,
    n_list: 48,
    alpha: 0.01,
    lambda_by_position: [0.1, 0.1, 0.1, 0.9, 0.9, 0.9, 0.9, 0.9],
    positions: [null, 20000, 10000, 5000, 2000, 1000, 500, 200],
  } as Parameters<typeof tunedLambda>[0];

  it('production table without tuning; one value changes the notches <= 5 000 only', () => {
    const caps = calibration.positions;
    expect(caps.map(tunedLambda(calibration, undefined))).toEqual(calibration.lambda_by_position);
    expect(caps.map(tunedLambda(calibration, { lambda: 0.5 }))).toEqual([
      0.1, 0.1, 0.1, 0.5, 0.5, 0.5, 0.5, 0.5,
    ]);
    expect(caps.map(tunedLambda(calibration, { calibration: false }))).toEqual(Array(8).fill(0));
  });
});

describe('qualityPool with the classics bonus (synthetic)', () => {
  it('same pool as a full sort, the early stop stays exact', () => {
    let seed = 11;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const n = 400;
    const scores = Float64Array.from({ length: n }, () => rand() * 2 - 0.5);
    const quality = Array.from({ length: n }, () => Math.round(rand() * 1600 - 800));
    const popularity = Uint32Array.from({ length: n }, () => Math.floor(rand() * 5000));
    const ranked = Int32Array.from(
      [...Array(n).keys()].sort((a, b) => scores[b]! - scores[a]! || a - b),
    );
    const classics = { gamma: 1, threshold: 0.4, maxItem: 300 };
    for (const cap of [null, 2000]) {
      const got = qualityPool(
        ranked,
        scores,
        popularity,
        cap,
        quality,
        0.1,
        1000,
        40,
        0.8,
        classics,
      );
      const cand = [...ranked].filter((i) => cap === null || popularity[i]! <= cap);
      const d = scores[cand[0]!]! > 0 ? scores[cand[0]!]! : 1;
      const adj = (i: number) => {
        const q = quality[i]! / 1000;
        return scores[i]! / d + 0.1 * q + (i < 300 ? Math.max(0, q - 0.4) : 0);
      };
      const want = [...cand].sort((a, b) => adj(b) - adj(a) || a - b).slice(0, 40);
      expect(got.items).toEqual(want);
    }
  });
});

const DATA = fileURLToPath(new URL('../../public/data/', import.meta.url));
const EXAMPLE = fileURLToPath(
  new URL('../../public/exemple/letterboxd-exemple.zip', import.meta.url),
);
const ready =
  existsSync(EXAMPLE) &&
  ['embeddings.bin', 'yty.bin', 'popularity.bin', 'model-meta.json', 'catalog.json'].every((f) =>
    existsSync(DATA + f),
  );

async function fileFetch(url: string): Promise<Response> {
  return new Response(readFileSync(DATA + url.replace('/data/', '')));
}

describe.skipIf(!ready)('tuning on the real files (example export)', async () => {
  const engine = ready ? await loadEngine(fileFetch) : undefined!;
  const matched = ready
    ? importExport(engine, { kind: 'zip', bytes: new Uint8Array(readFileSync(EXAMPLE)) }).matched
    : [];
  const items = (r: ReturnType<typeof recommend>) => r.positions.map((p) => p.items);

  it('an empty tuning is the production result', () => {
    const base = recommend(engine, matched, { n: 48 });
    expect(items(recommend(engine, matched, { n: 48, tuning: {} }))).toEqual(items(base));
    expect(
      items(
        recommend(engine, matched, {
          n: 48,
          tuning: { lambda: [...engine.model.meta.calibration!.lambda_by_position] },
        }),
      ),
    ).toEqual(items(base));
  });

  it('without calibration: each pool cut to 48, in score order', () => {
    const r = recommend(engine, matched, {
      n: 48,
      tuning: { calibration: false, estimatedPerRow: false },
    });
    r.positions.forEach((p, k) => expect(p.items).toEqual(r.pools[k]!.items.slice(0, 48)));
  });

  it('recents: no estimated film recommended; off: none in the profile either', () => {
    const n = engine.catalog.n_trained!;
    const a = recommend(engine, matched, { n: 48, tuning: { recent: 'not-recommended' } });
    expect(a.positions.every((p) => p.items.every((i) => i < n))).toBe(true);
    expect(a.foldInItems.some((i) => i >= n)).toBe(true);
    const b = recommend(engine, matched, { n: 48, tuning: { recent: 'off' } });
    expect(b.foldInItems.every((i) => i < n)).toBe(true);
  });

  it('classics bonus at gamma_c = 0 changes nothing; the threshold is a q percentile', () => {
    const base = recommend(engine, matched, { n: 48 });
    const r = recommend(engine, matched, {
      n: 48,
      tuning: { classics: { gamma: 0.5, percentile: 99 } },
    });
    expect(items(r)).toEqual(items(base)); // the production bonus, re-derived
    expect(qualityPercentile(engine, 99)).toBeGreaterThan(qualityPercentile(engine, 95));
  });

  it('R6e production: classics bonus of model-meta (threshold = q percentile 99, trained only)', () => {
    const c = classicsBonus(engine)!;
    expect(c.gamma).toBe(0.5);
    expect(c.threshold).toBe(qualityPercentile(engine, 99));
    expect(c.maxItem).toBe(engine.catalog.n_trained);
    expect(classicsBonus(engine, { classics: { gamma: 0, percentile: 99 } })).toBeUndefined();
  });

  it('R6e production: at most one estimated film per row of 8; the switch lifts the cap', () => {
    const nT = engine.catalog.n_trained!;
    const base = recommend(engine, matched, { n: 48 });
    for (const p of base.positions) {
      expect(p.items).toHaveLength(48);
      for (let r = 0; r < 6; r++) {
        expect(p.items.slice(r * 8, r * 8 + 8).filter((i) => i >= nT).length).toBeLessThanOrEqual(
          1,
        );
      }
    }
    const off = recommend(engine, matched, { n: 48, tuning: { estimatedPerRow: false } });
    expect(off.positions.some((p, k) => p.items.join() !== base.positions[k]!.items.join())).toBe(
      true,
    );
  });

  it('R6e: the old line of the estimated films only changes their q', () => {
    const nT = engine.catalog.n_trained!;
    const q = engine.catalog.quality!;
    const old = itemQuality(engine, { estimatedQuality: 'catalog' })!;
    expect(old.slice(0, nT)).toEqual(q.slice(0, nT));
    const line = engine.model.meta.quality!.tmdb!;
    expect(line.slope).toBeLessThan(line.catalog_line!.slope);
    let higher = 0;
    for (let i = nT; i < q.length; i++) if (old[i]! > q[i]!) higher++;
    expect(higher).toBeGreaterThan(0);
  });
});
