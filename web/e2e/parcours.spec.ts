// Step 5, G5: full path in a real browser with the synthetic example export.
import { expect, test } from '@playwright/test';
import {
  cards,
  exampleToResults,
  guardNetwork,
  PHONE,
  seriousViolations,
  settle,
  SHOTS,
} from './helpers';

test('full path: example -> analysis -> results -> slider -> more films; privacy; accessibility', async ({
  page,
  baseURL,
}) => {
  const net = await guardNetwork(page, baseURL!);
  await page.goto('/');

  // home
  await expect(page.getByRole('heading', { level: 1 })).toContainText('pas encore vus.');
  expect(await seriousViolations(page), 'axe: accueil').toEqual([]);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/1-accueil.png`, fullPage: true });

  // analysis
  await page.getByRole('link', { name: 'montre-moi un exemple →' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('on a lu tes 66 films.');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('on en a reconnu 61.');
  await expect(
    page.getByText('2 films sont sortis après 2023 : trop récents pour nous, désolé.'),
  ).toBeVisible();
  expect(await seriousViolations(page), 'axe: analyse').toEqual([]);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/2-analyse.png`, fullPage: true });
  const milk = page.getByRole('group', { name: 'dans ton fichier : « Milk » (2008)' });
  await milk.getByRole('radio').first().check();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('on en a reconnu 62.');
  await page.getByRole('button', { name: 'voir mes films' }).click();

  // results: start at 2 000, 8 cards
  const slider = page.getByRole('slider', { name: 'plutôt connu ou plutôt pépite ?' });
  await expect(slider).toHaveValue('4');
  await expect(cards(page)).toHaveCount(8);
  await expect(
    page.getByText("(t'aimes bien andrei tarkovsky, wim wenders et wong kar-wai, non ?)"),
  ).toBeVisible();
  expect(await seriousViolations(page), 'axe: résultats').toEqual([]);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/3-resultats.png`, fullPage: true });

  // « ✱ pépite »: at most one stamp per block of 8 cards (D6); counts recorded at ∞, 2 000, 500
  const stamps = () => page.getByText('✱ pépite').count();
  const stampCounts: Record<string, number> = { '2000': await stamps() };

  // slider on 3 notches with the keyboard (native range: arrow keys)
  const first = () => cards(page).first().textContent();
  const seen = new Set([await first()]);
  await slider.focus();
  for (const [key, value, sentence] of [
    ['ArrowRight', '5', "voilà huit films que t'as sûrement jamais vus."],
    ['ArrowRight', '6', "voilà huit films que t'as sûrement jamais vus."],
    ['Home', '0', 'voilà des classiques qui devraient te plaire.'],
  ] as const) {
    await page.keyboard.press(key);
    await expect(slider).toHaveValue(value);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(sentence);
    seen.add(await first());
    stampCounts[{ '5': '1000', '6': '500', '0': '∞' }[value]] = await stamps();
  }
  expect(seen.size).toBe(4); // a different first film at each notch
  for (const n of Object.values(stampCounts)) expect(n).toBeLessThanOrEqual(1);
  test.info().annotations.push({ type: 'stamps', description: JSON.stringify(stampCounts) });
  console.log(JSON.stringify({ stamps: stampCounts }));
  await expect(page.getByText(/^moins de/)).toHaveCount(0); // nothing shown at ∞

  // more films
  await page.getByRole('button', { name: 'encore des films' }).click();
  await expect(cards(page)).toHaveCount(16);
  expect(await stamps()).toBeLessThanOrEqual(2);

  // card link
  const link = cards(page).first().getByRole('link');
  await expect(link).toHaveAttribute('href', /^https:\/\/letterboxd\.com\/tmdb\/\d+\/$/);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

  // about page
  await page.getByRole('button', { name: '← changer de fichier' }).click();
  await page.getByRole('link', { name: 'qui on est' }).click();
  await expect(
    page
      .getByText('This product uses the TMDB API but is not endorsed or certified by TMDB.')
      .first(),
  ).toBeVisible();
  await expect(page.getByRole('img', { name: 'TMDB' })).toBeVisible();
  expect(await seriousViolations(page), 'axe: à propos').toEqual([]);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/4-a-propos.png`, fullPage: true });

  // privacy: nothing outside the site but posters, nothing stored
  expect(net.blocked, 'requêtes hors du site').toEqual([]);
  expect(net.posters.length).toBeGreaterThan(0);
  const storage = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    idb: (await indexedDB.databases()).length,
    cookies: document.cookie,
  }));
  expect(storage).toEqual({ local: 0, session: 0, idb: 0, cookies: '' });
  expect(await page.context().cookies()).toEqual([]);
});

test('drop zone: keyboard and a real file; IMDb CSV message', async ({ page, baseURL }) => {
  const net = await guardNetwork(page, baseURL!);
  await page.goto('/');
  const input = page.getByLabel(/glisse ton fichier ici/);
  await page.keyboard.press('Tab'); // logo
  await page.keyboard.press('Tab'); // comment ça marche
  await page.keyboard.press('Tab'); // qui on est
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await input.setInputFiles({
    name: 'ratings.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Const,Your Rating,Date Rated,Title,URL,Title Type\ntt0111161,9,2024-01-01,X,u,Movie\n',
    ),
  });
  await expect(page.getByRole('alert')).toHaveText('les exports imdb arrivent bientôt.');
  await input.setInputFiles('public/exemple/letterboxd-exemple.zip');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('on a lu tes 66 films.');
  expect(net.blocked).toEqual([]);
});

test.describe('phone (375 × 812)', () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test("one column, no horizontal scroll, « c'est là » under the drop zone", async ({
    page,
    baseURL,
  }) => {
    const net = await guardNetwork(page, baseURL!);
    await page.goto('/');
    const noHScroll = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await noHScroll(), 'accueil').toBe(true);
    const zone = await page.getByTestId('drop-zone').boundingBox();
    const note = await page.getByText("c'est là").boundingBox();
    expect(note!.y).toBeGreaterThanOrEqual(zone!.y + zone!.height);
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/1-accueil-telephone.png`, fullPage: true });

    await page.getByRole('link', { name: 'montre-moi un exemple →' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('on a lu tes 66 films.');
    expect(await noHScroll(), 'analyse').toBe(true);
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/2-analyse-telephone.png`, fullPage: true });

    await page
      .getByRole('group', { name: 'dans ton fichier : « Milk » (2008)' })
      .getByRole('radio')
      .first()
      .check();
    await page.getByRole('button', { name: 'voir mes films' }).click();
    await expect(cards(page)).toHaveCount(8);
    expect(await noHScroll(), 'résultats').toBe(true);
    const xs = new Set(
      await cards(page).evaluateAll((els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().left)),
      ),
    );
    expect(xs.size, 'une seule colonne').toBe(1);
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/3-resultats-telephone.png`, fullPage: true });

    // touch targets >= 44 px
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('button, a, input[type=range], label:has(input)')]
        .map((e) => ({ e, r: e.getBoundingClientRect() }))
        .filter(
          ({ e, r }) => r.height > 0 && r.height < 44 && !e.closest('[data-testid=film-card]'),
        )
        .map(
          ({ e, r }) =>
            `${e.tagName} « ${e.textContent?.trim().slice(0, 30)} » ${Math.round(r.height)} px`,
        ),
    );
    expect(small).toEqual([]);
    expect(net.blocked).toEqual([]);
  });
});

test('timings: model ready, analysis of the example, slider notch to display', async ({
  page,
  baseURL,
}) => {
  await guardNetwork(page, baseURL!);
  await page.goto('/'); // fresh context: empty cache
  await page.waitForFunction(
    () => performance.getEntriesByName('pepite:model-ready').length > 0,
    null,
    {
      timeout: 10_000,
    },
  );
  const modelReady = await page.evaluate(
    () => performance.getEntriesByName('pepite:model-ready')[0]!.startTime,
  );

  await exampleToResults(page);
  const analysis = await page.evaluate(
    () => performance.measure('a', 'pepite:import-start', 'pepite:import-end').duration,
  );

  // slider: change event -> first card replaced and painted (two animation frames)
  const notch = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>('input[type=range]')!;
    const firstCard = () => document.querySelector('[data-testid=film-card]')?.textContent;
    const out: number[] = [];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    for (const value of ['5', '6', '7', '3', '1', '0', '4']) {
      const before = firstCard();
      const t0 = performance.now();
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      while (firstCard() === before) await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      out.push(performance.now() - t0);
    }
    return out;
  });

  const report = {
    modelReadyMs: Math.round(modelReady),
    analysisMs: Math.round(analysis),
    notchMs: notch.map((x) => Math.round(x)),
    notchMaxMs: Math.round(Math.max(...notch)),
  };
  console.log(JSON.stringify(report));
  test.info().annotations.push({ type: 'timings', description: JSON.stringify(report) });
  expect(report.modelReadyMs).toBeLessThanOrEqual(2000);
  expect(report.analysisMs).toBeLessThanOrEqual(300);
  expect(report.notchMaxMs).toBeLessThanOrEqual(50);
});
