// Contrast of the design tokens in both themes (docs/etape-6b-retouches.md, D7, R1): WCAG AA.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`${selector} missing`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]),
  );
}

const light = block('@theme');
const dark = { ...light, ...block(":root[data-theme='dark']") };

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

function isOrange(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const max = Math.max(r!, g!, b!);
  const min = Math.min(r!, g!, b!);
  if (max - min < 60) return false; // greys
  const hue = (((g! - b!) / (max - min)) * 60 + 360) % 360; // only valid when r is the max
  return max === r && hue >= 15 && hue <= 50;
}

describe.each([
  ['clair', light],
  ['sombre', dark],
])('thème %s', (_, t) => {
  it('text on the background and on cards: AA (≥ 4.5:1)', () => {
    for (const fg of ['ink', 'muted', 'pen']) {
      for (const bg of ['paper', 'surface']) {
        expect(contrast(t[fg]!, t[bg]!), `${fg} sur ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('card tags (step 6c, Q6): text AA on their label (≥ 4.5:1)', () => {
    for (const fg of ['pen', 'tag-director', 'tag-divise']) {
      expect(contrast(t[fg]!, t.surface!), `${fg} sur surface`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(t['tag-old-ink']!, t['tag-old']!), 'vieux trésor').toBeGreaterThanOrEqual(4.5);
  });

  it('component borders (ink) ≥ 3:1', () => {
    expect(contrast(t.ink!, t.paper!)).toBeGreaterThanOrEqual(3);
  });

  it('cards one step apart from the background, never orange', () => {
    expect(t.surface).not.toBe(t.paper);
    for (const v of Object.values(t)) expect(isOrange(v), v).toBe(false);
  });
});

it('the dark theme redefines every colour token', () => {
  expect(Object.keys(block(":root[data-theme='dark']")).sort()).toEqual(
    [
      'ink',
      'muted',
      'paper',
      'pen',
      'rule',
      'surface',
      'tag-director',
      'tag-divise',
      'tag-old',
      'tag-old-ink',
    ].sort(),
  );
});
