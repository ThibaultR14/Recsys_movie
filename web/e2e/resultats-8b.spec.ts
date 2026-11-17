// Step 8b (docs/etape-8b-ux-resultats.md, U6): « affiner », « des films de… » and the CSV in a real
// browser: nothing outside the site but the posters, nothing stored, axe in both themes, 360 px.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  NOTHING_STORED,
  SHOTS,
  cards,
  exampleToResults,
  guardNetwork,
  readStorage,
  settle,
  violationsBothThemes,
} from './helpers';

const notBusy = (page: Page) =>
  expect(page.locator('[aria-busy]').filter({ has: page.getByRole('list') })).toHaveAttribute(
    'aria-busy',
    'false',
  );

async function download(page: Page) {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'télécharger la liste (csv)' }).click(),
  ]);
  const text = readFileSync((await file.path())!, 'utf-8');
  return { name: file.suggestedFilename(), text, lines: text.trimEnd().split('\r\n') };
}

test('affiner, des films de…, télécharger: worker only, nothing sent, nothing stored', async ({
  page,
  baseURL,
}) => {
  const net = await guardNetwork(page, baseURL!);
  await page.goto('/');
  await exampleToResults(page);
  const live = page.locator('[aria-live=polite]').last();
  await expect(live).toHaveText('les moins connus : 8 films');

  // « affiner »: a disclosure; a genre and an era; the count, the « × » chips
  const affiner = page.getByRole('button', { name: 'affiner' });
  await expect(affiner).toHaveAttribute('aria-expanded', 'false');
  await affiner.click();
  await expect(page.getByRole('group', { name: 'genres' })).toBeVisible();
  const before = await cards(page).first().textContent();
  await page.getByRole('group', { name: 'genres' }).getByRole('button', { name: 'drame' }).click();
  await page
    .getByRole('group', { name: 'époque' })
    .getByRole('button', { name: 'années 90' })
    .click();
  await notBusy(page);
  await expect(page.getByRole('button', { name: 'affiner (2)' })).toBeVisible();
  await expect(live).toHaveText('les moins connus, 2 filtres : 8 films');
  await expect(page.getByRole('button', { name: 'retirer le filtre drame' })).toBeVisible();
  expect(await cards(page).first().textContent()).not.toBe(before);
  for (const year of await cards(page).getByTestId('byline').allTextContents()) {
    expect(Number(year.match(/(\d{4})$/)?.[1])).toBeGreaterThanOrEqual(1990);
  }
  // the other categories keep the filters, without a new computation
  await page.locator('label', { hasText: 'les pépites' }).click();
  await expect(live).toHaveText('les pépites, 2 filtres : 8 films');
  await page.locator('label', { hasText: 'les moins connus' }).click();
  expect(await violationsBothThemes(page), 'axe: panneau ouvert').toEqual([]);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/8b-affiner.png`, fullPage: true });

  // the CSV of the list shown: 48 films, in order, Letterboxd import format
  const csv = await download(page);
  expect(csv.name).toMatch(/^pepite-moins-connus-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(csv.text.charCodeAt(0)).not.toBe(0xfeff);
  expect(csv.lines[0]).toBe('tmdbID,imdbID,Title,Year');
  expect(csv.lines).toHaveLength(49);
  const firstTitle = (await cards(page).first().getByTestId('card-title').textContent())!;
  expect(csv.lines[1]).toContain(firstTitle.includes(',') ? `"${firstTitle}"` : firstTitle);

  // « tout effacer »
  await page.getByRole('button', { name: 'tout effacer' }).click();
  await notBusy(page);
  await expect(page.getByRole('button', { name: 'affiner' })).toBeVisible();

  // « des films de… »: combobox, keyboard, the person's grid, back to the recommendations
  const box = page.getByRole('combobox', { name: 'des films de…' });
  await box.fill('kubri');
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(box).toHaveAttribute('aria-expanded', 'true');
  expect(await violationsBothThemes(page), 'axe: suggestions').toEqual([]);
  // axe switched the theme with the buttons: back in the field (the suggestions reopen)
  await box.focus();
  await expect(page.getByRole('listbox')).toBeVisible();
  await box.press('Enter');
  await expect(
    page.getByRole('heading', { level: 2, name: "les films de Stanley Kubrick que t'as pas vus" }),
  ).toBeVisible();
  await expect(cards(page).first()).toContainText('Stanley Kubrick');
  const person = await download(page);
  expect(person.name).toMatch(/^pepite-films-de-stanley-kubrick-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(person.lines.length).toBeGreaterThan(1);
  await page.getByRole('button', { name: '← revenir à tes recos' }).click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);

  expect(net.blocked, 'requêtes hors du site').toEqual([]);
  expect(await readStorage(page)).toEqual(NOTHING_STORED);
});

test('phone 360 px: categories, panel and search fit, touch targets >= 44 px', async ({
  page,
  baseURL,
}) => {
  const net = await guardNetwork(page, baseURL!);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await exampleToResults(page);
  await page.getByRole('button', { name: 'affiner' }).click();
  await page.getByRole('button', { name: 'autres langues' }).click();
  await page.getByRole('combobox', { name: 'des films de…' }).fill('ku');
  const noHScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(noHScroll, 'pas de défilement horizontal').toBe(true);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('button, a, input, label:has(input), [role=option]')]
      // a radio or a checkbox inside its <label>: the label is the touch target
      .filter(
        (e) =>
          !(
            e instanceof HTMLInputElement &&
            (e.type === 'radio' || e.type === 'checkbox') &&
            e.closest('label')
          ),
      )
      .map((e) => ({ e, r: e.getBoundingClientRect() }))
      .filter(({ e, r }) => r.height > 0 && r.height < 44 && !e.closest('[data-testid=film-card]'))
      .map(({ e, r }) => `${e.tagName} « ${e.textContent?.trim().slice(0, 30)} » ${r.height}`),
  );
  expect(small).toEqual([]);
  expect(await violationsBothThemes(page), 'axe: téléphone').toEqual([]);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/8b-telephone-360.png`, fullPage: true });
  expect(net.blocked).toEqual([]);
});
