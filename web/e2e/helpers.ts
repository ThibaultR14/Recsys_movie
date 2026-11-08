import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

export const SHOTS = 'test-data/screenshots';
mkdirSync(SHOTS, { recursive: true });

export const PHONE = { width: 375, height: 812 };

/**
 * Intercepts every request: only the local origin and image.tmdb.org go through; anything else is
 * aborted and recorded (step 5, privacy criterion).
 */
export async function guardNetwork(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const blocked: string[] = [];
  const posters: string[] = [];
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.protocol === 'data:' || url.protocol === 'blob:') {
      return route.continue();
    }
    if (url.origin === 'https://image.tmdb.org') {
      posters.push(url.href);
      return route.continue();
    }
    blocked.push(url.href);
    return route.abort();
  });
  return { blocked, posters };
}

/** Example export -> analysis screen (Milk confirmed) -> results. */
export async function exampleToResults(page: Page) {
  await page.getByRole('link', { name: 'montre-moi un exemple →' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('on a lu tes 66 films.');
  const milk = page.getByRole('group', { name: 'dans ton fichier : « Milk » (2008)' });
  await milk.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'voir mes films' }).click();
  await expect(page.getByRole('list', { name: 'films recommandés' })).toBeVisible();
}

export function cards(page: Page) {
  return page.getByRole('list', { name: 'films recommandés' }).getByRole('listitem');
}

/** axe-core: violations of impact « serious » or « critical » (criterion: none). */
export async function seriousViolations(page: Page) {
  const res = await new AxeBuilder({ page }).analyze();
  return res.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** Wait for fonts and lazy posters in view, for stable screenshots. */
export async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const imgs = [...document.images].filter(
      (i) => i.getBoundingClientRect().top < innerHeight * 2,
    );
    await Promise.all(
      imgs.map((i) =>
        i.complete
          ? null
          : new Promise((r) => {
              i.addEventListener('load', r, { once: true });
              i.addEventListener('error', r, { once: true });
              setTimeout(r, 3000);
            }),
      ),
    );
  });
}

/** axe in the dark theme (default), then in the light one, then back to dark (step 6b, D7). */
export async function violationsBothThemes(page: Page): Promise<string[]> {
  const dark = (await seriousViolations(page)).map((v) => `sombre: ${v}`);
  await page.getByRole('button', { name: 'passer en clair' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const light = (await seriousViolations(page)).map((v) => `clair: ${v}`);
  await page.getByRole('button', { name: 'passer en sombre' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  return [...dark, ...light];
}

/** Everything the browser could keep: the theme key is the only one allowed (D7). */
export function readStorage(page: Page) {
  return page.evaluate(async () => ({
    local: { ...localStorage },
    session: sessionStorage.length,
    idb: (await indexedDB.databases()).length,
    cookies: document.cookie,
  }));
}

export const NOTHING_STORED = { local: {}, session: 0, idb: 0, cookies: '' };
