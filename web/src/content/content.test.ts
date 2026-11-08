import { describe, expect, it } from 'vitest';
import * as apropos from './apropos';
import { becauseText } from './cards';
import * as ccm from './commentCaMarche';
import * as contact from './contact';
import * as exportHelp from './exportHelp';
import * as nav from './nav';
import { isPending, pending } from './pending';
import * as theme from './theme';

/** Becomes true in R7 (docs/etape-6b-retouches.md, D8): no placeholder may remain. */
const BLOCKING = false;

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

function pendingTexts(): string[] {
  return [apropos, ccm, contact, exportHelp, nav, theme].flatMap(strings).filter(isPending);
}

describe('interface texts (Claude Web)', () => {
  it('pending() is recognisable', () => {
    expect(pending('x.y')).toBe('[texte à venir : x.y]');
    expect(isPending(pending('x.y'))).toBe(true);
    expect(isPending('salut.')).toBe(false);
  });

  it(
    BLOCKING ? 'no placeholder left' : 'lists the placeholders left (not blocking before R7)',
    () => {
      const left = pendingTexts();
      if (BLOCKING) expect(left).toEqual([]);
      else console.log(`textes à venir : ${left.length}`);
    },
  );

  it('because text: liked or seen, one or two titles', () => {
    expect(becauseText('liked', ['Stalker'])).toBe("(parce que t'as aimé « Stalker »)");
    expect(becauseText('liked', ['Stalker', 'Paris, Texas'])).toBe(
      "(parce que t'as aimé « Stalker » et « Paris, Texas »)",
    );
    expect(becauseText('seen', ['Stalker', 'Ran'])).toBe(
      "(parce que t'as vu « Stalker » et « Ran »)",
    );
  });
});
