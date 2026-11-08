import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EXPORT_HELP as T } from '../content/exportHelp';
import { APROPOS } from '../content/apropos';
import { COMMENT_CA_MARCHE } from '../content/commentCaMarche';
import { plainText, textParts } from '../content/richText';
import { CommentCaMarche } from '../pages/CommentCaMarche';
import { ExportHelp } from './ExportHelp';
import * as drawings from './help/illustrations';

const step = () => screen.getByText(/^étape \d sur \d$/);

describe('ExportHelp (step 6b, D4)', () => {
  it('tabs: Letterboxd first, arrows / Home / End move the selection and the focus', async () => {
    render(<ExportHelp />);
    const [lb, imdb] = screen.getAllByRole('tab');
    expect(lb).toHaveAttribute('aria-selected', 'true');
    expect(lb).toHaveAttribute('tabindex', '0');
    expect(imdb).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('letterboxd');
    lb!.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(imdb).toHaveFocus();
    expect(imdb).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('imdb');
    await userEvent.keyboard('{ArrowRight}');
    expect(lb).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(imdb).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(lb).toHaveFocus();
  });

  it('steps: 3 for Letterboxd, 4 for IMDb; buttons disabled at the ends; announced', async () => {
    render(<ExportHelp />);
    const prev = screen.getByRole('button', { name: T.precedent });
    const next = screen.getByRole('button', { name: T.suivant });
    expect(step()).toHaveTextContent('étape 1 sur 3');
    expect(step().parentElement).toHaveAttribute('aria-live', 'polite');
    expect(prev).toBeDisabled();
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveTextContent(plainText(T.letterboxd.etapes[0]!));
    // the sites' real English labels are marked lang="en" (R7)
    expect(within(panel).getByText('settings')).toHaveAttribute('lang', 'en');
    await userEvent.click(next);
    await userEvent.click(next);
    expect(step()).toHaveTextContent('étape 3 sur 3');
    expect(next).toBeDisabled();
    expect(screen.getByRole('tabpanel')).toHaveTextContent(plainText(T.letterboxd.etapes[2]!));

    await userEvent.click(screen.getByRole('tab', { name: 'imdb' }));
    expect(step()).toHaveTextContent('étape 1 sur 4');
    for (let i = 0; i < 3; i++) await userEvent.click(next);
    expect(step()).toHaveTextContent('étape 4 sur 4');
    expect(screen.getByRole('tabpanel')).toHaveTextContent(plainText(T.imdb.etapes[3]!));
    // each tab keeps its step
    await userEvent.click(screen.getByRole('tab', { name: 'letterboxd' }));
    expect(step()).toHaveTextContent('étape 3 sur 3');
  });

  it('drawings: decorative, no words but the file extension, ≤ 3 KB each and 25 KB in all', () => {
    const sizes = Object.entries(drawings).map(([name, Drawing]) => {
      const svg = renderToStaticMarkup(<Drawing />);
      expect(svg, name).toContain('aria-hidden="true"');
      const words = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
      for (const w of words) expect(['.zip', '.csv', '…']).toContain(w);
      expect(svg).not.toMatch(/#[0-9a-f]{6}|rgb\(|<image/i); // tokens only, no picture
      return [name, svg.length] as const;
    });
    expect(sizes).toHaveLength(7);
    for (const [name, n] of sizes) expect(n, name).toBeLessThanOrEqual(3000);
    const total = sizes.reduce((t, [, n]) => t + n, 0);
    console.log(
      `SVG de l'aide : ${total} octets (${sizes.map(([k, n]) => `${k} ${n}`).join(', ')})`,
    );
    expect(total).toBeLessThanOrEqual(25_000);
  });
});

describe('richText', () => {
  it('splits the {en:…} marks, plainText removes them', () => {
    const t = 'va dans « {en:data} », puis « {en:export your data} ».';
    expect(textParts(t)).toEqual([
      { text: 'va dans « ', en: false },
      { text: 'data', en: true },
      { text: ' », puis « ', en: false },
      { text: 'export your data', en: true },
      { text: ' ».', en: false },
    ]);
    expect(plainText(t)).toBe('va dans « data », puis « export your data ».');
    expect(textParts('rien')).toEqual([{ text: 'rien', en: false }]);
  });
});

describe('richText links (R9)', () => {
  it('{a:url|label} and {a-en:url|label}; https only', () => {
    expect(textParts('le code : {a:https://x.org/y|le code est sur github}.')).toEqual([
      { text: 'le code : ', en: false },
      { text: 'le code est sur github', en: false, href: 'https://x.org/y' },
      { text: '.', en: false },
    ]);
    expect(textParts('« {a-en:https://doi.org/1|A Title} »')[1]).toEqual({
      text: 'A Title',
      en: true,
      href: 'https://doi.org/1',
    });
    expect(plainText('« {a-en:https://doi.org/1|A Title} », {en:data}')).toBe('« A Title », data');
    expect(() => textParts('{a:javascript:alert(1)|x}')).toThrow();
    expect(() => textParts('{a:https://x.org}')).toThrow();
  });

  it('every link of the content is well formed (https, label)', () => {
    const all = [
      ...APROPOS.intro,
      ...APROPOS.pourquoi,
      ...COMMENT_CA_MARCHE.inspirations.liste,
      ...T.letterboxd.etapes,
      ...T.imdb.etapes,
    ];
    const links = all.flatMap((t) => textParts(t).filter((p) => p.href));
    expect(links.map((l) => l.href)).toEqual([
      'https://github.com/ThibaultR14/Recsys_movie',
      'https://letterboxd.samlearner.com',
      'https://www.criticker.com',
      'https://doi.org/10.1109/ICDM.2008.22',
      'https://doi.org/10.1145/3109859.3109912',
      'https://doi.org/10.1145/2827872',
    ]);
  });

  it('rendered: new tab, rel noopener, English titles with lang="en"', () => {
    render(<CommentCaMarche />);
    const region = screen.getByRole('region', { name: 'inspirations' });
    const links = within(region).getAllByRole('link');
    expect(links).toHaveLength(5);
    for (const a of links) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
      expect(a).toHaveTextContent('(nouvel onglet)');
    }
    const hu = within(region).getByRole('link', { name: /Collaborative Filtering/ });
    expect(hu).toHaveAttribute('lang', 'en');
    expect(within(region).getByRole('link', { name: /^criticker/ })).not.toHaveAttribute('lang');
    expect(within(region).getAllByRole('listitem')).toHaveLength(6);
  });
});
