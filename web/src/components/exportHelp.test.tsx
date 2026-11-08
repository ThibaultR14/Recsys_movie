import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EXPORT_HELP as T } from '../content/exportHelp';
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
    expect(screen.getByText(T.letterboxd.etapes[0]!)).toBeInTheDocument();
    await userEvent.click(next);
    await userEvent.click(next);
    expect(step()).toHaveTextContent('étape 3 sur 3');
    expect(next).toBeDisabled();
    expect(screen.getByText(T.letterboxd.etapes[2]!)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'imdb' }));
    expect(step()).toHaveTextContent('étape 1 sur 4');
    for (let i = 0; i < 3; i++) await userEvent.click(next);
    expect(step()).toHaveTextContent('étape 4 sur 4');
    expect(screen.getByText(T.imdb.etapes[3]!)).toBeInTheDocument();
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
