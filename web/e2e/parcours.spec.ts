// Step 5, G5: full path in a real browser with the synthetic example export.
import { expect, test } from '@playwright/test';
import {
  cards,
  exampleToResults,
  guardNetwork,
  PHONE,
  NOTHING_STORED,
  readStorage,
  violationsBothThemes,
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
  expect(await violationsBothThemes(page), 'axe: accueil').toEqual([]);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/1-accueil.png`, fullPage: true });

  // analysis
  await page.getByRole('link', { name: 'montre-moi un exemple →' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('on a lu tes 66 films.');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('on en a reconnu 61.');
  await expect(
    page.getByText('2 films sont sortis après 2023 : trop récents pour nous, désolé.'),
  ).toBeVisible();
  expect(await violationsBothThemes(page), 'axe: analyse').toEqual([]);
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
  await expect(page.getByTestId('public-rating')).toHaveCount(8);
  await expect(page.getByTestId('public-rating').first()).toContainText(/^★ \d,\d · [\d\s]+ notes/);
  await expect(
    page.getByText("(t'aimes bien andrei tarkovsky, wim wenders et wong kar-wai, non ?)"),
  ).toBeVisible();
  expect(await violationsBothThemes(page), 'axe: résultats').toEqual([]);
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

  // pages over the results (step 6b, D2): the notch and the cards are kept
  const notchBefore = await slider.inputValue();
  for (const [name, title] of [
    ['comment ça marche', 'comment ça marche.'],
    ['à propos', 'à propos.'],
    ['contact', 'contact.'],
  ] as const) {
    await page.getByRole('navigation').getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    expect(await violationsBothThemes(page), `axe: ${name}`).toEqual([]);
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/4-${name.replaceAll(' ', '-')}.png`, fullPage: true });
  }
  await expect(
    page
      .getByText('This product uses the TMDB API but is not endorsed or certified by TMDB.')
      .first(),
  ).toBeVisible();
  await page.goBack(); // contact -> à propos
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('à propos.');
  await expect(page.getByRole('img', { name: 'TMDB' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('contact.');
  await page.getByRole('link', { name: '← retour' }).click();
  await expect(cards(page)).toHaveCount(16);
  await expect(slider).toHaveValue(notchBefore);

  // privacy: nothing outside the site but posters, nothing stored
  expect(net.blocked, 'requêtes hors du site').toEqual([]);
  expect(net.posters.length).toBeGreaterThan(0);
  expect(await readStorage(page)).toEqual(NOTHING_STORED);
  expect(await page.context().cookies()).toEqual([]);
});

test('IMDb example CSV: title fallback to verify (unticked), series apart, results; privacy', async ({
  page,
  baseURL,
}) => {
  const net = await guardNetwork(page, baseURL!);
  await page.goto('/');
  await page.getByLabel(/glisse ton fichier ici/).setInputFiles('public/exemple/imdb-exemple.csv');
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toContainText('on a lu tes 68 films.');
  await expect(h1).toContainText('on en a reconnu 63.');
  const verify = page.getByRole('region', { name: 'à vérifier' });
  await expect(verify.getByRole('group')).toHaveCount(1);
  const cherbourg = verify.getByRole('group', {
    name: 'dans ton fichier : « Die Regenschirme von Cherbourg » (1964)',
  });
  for (const radio of await cherbourg.getByRole('radio').all())
    await expect(radio).not.toBeChecked();
  await expect(page.getByText('3 séries, épisodes ou jeux : on fait que les films.')).toBeVisible();
  await expect(
    page.getByText('1 film est sorti après 2023 : trop récent pour nous, désolé.'),
  ).toBeVisible();
  expect(await violationsBothThemes(page), 'axe: analyse imdb').toEqual([]);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/2-analyse-imdb.png`, fullPage: true });

  // choosing the candidate counts it, then results
  await cherbourg.getByRole('radio').first().check();
  await expect(h1).toContainText('on en a reconnu 64.');
  await page.getByRole('button', { name: 'voir mes films' }).click();
  await expect(cards(page)).toHaveCount(8);

  expect(net.blocked, 'requêtes hors du site').toEqual([]);
  expect(await readStorage(page)).toEqual(NOTHING_STORED);
});

test('theme: dark by default, light remembered under one key, removed when back to dark', async ({
  page,
  baseURL,
}) => {
  const net = await guardNetwork(page, baseURL!);
  await page.emulateMedia({ colorScheme: 'light' }); // dark even when the system is light (Q2)
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await bg()).toBe('rgb(22, 23, 27)');
  expect(await readStorage(page)).toEqual(NOTHING_STORED);

  await page.getByRole('button', { name: 'passer en clair' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await bg()).toBe('rgb(251, 250, 247)');
  expect(await readStorage(page)).toEqual({
    ...NOTHING_STORED,
    local: { 'pepite-theme': 'light' },
  });
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/1-accueil-clair.png`, fullPage: true });

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'passer en sombre' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await readStorage(page)).toEqual(NOTHING_STORED);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(net.blocked).toEqual([]);
});

test('direct links: a page anchor or a section anchor opens its page at load', async ({
  page,
  baseURL,
}) => {
  const net = await guardNetwork(page, baseURL!);
  await page.goto('/#contact');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('contact.');
  await page.goto('/#on-garde-rien');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('comment ça marche.');
  await expect(page.locator('#on-garde-rien')).toBeInViewport();
  await page.getByRole('link', { name: '← retour' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('pas encore vus.');
  expect(net.blocked).toEqual([]);
});

test('contact: copy, form -> mailto:, no request, nothing stored', async ({
  page,
  baseURL,
  context,
}) => {
  const net = await guardNetwork(page, baseURL!);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/#contact');
  const address = await page.locator('main code').textContent();
  await page.getByRole('button', { name: 'copier' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);

  // the mailto: opens the mail application (none in the test browser): the page stays
  await page.getByRole('radio', { name: 'film mal reconnu' }).check();
  await page.getByRole('textbox').fill('« Ran » (1985) pas reconnu');
  await page.getByRole('form', { name: 'écrire un mail' }).getByRole('button').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('contact.');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(net.blocked, 'requêtes hors du site').toEqual([]);
  expect(await readStorage(page)).toEqual(NOTHING_STORED);
});

test('drop zone: keyboard and a real file; IMDb watchlist message', async ({ page, baseURL }) => {
  const net = await guardNetwork(page, baseURL!);
  await page.goto('/');
  const input = page.getByLabel(/glisse ton fichier ici/);
  await page.keyboard.press('Tab'); // logo
  await page.keyboard.press('Tab'); // comment ça marche
  await page.keyboard.press('Tab'); // à propos
  await page.keyboard.press('Tab'); // contact
  await page.keyboard.press('Tab'); // theme
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await input.setInputFiles({
    name: 'WATCHLIST.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Position,Const,Created,Modified,Description,Title,URL,Title Type\n1,tt0111161,2024-01-01,,,X,u,Movie\n',
    ),
  });
  await expect(page.getByRole('alert')).toContainText("ça, c'est une liste imdb");
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
    // header: navigation and theme button on two lines at most under the logo (D2)
    const rows = await page.evaluate(() => {
      const els = [...document.querySelectorAll('header nav a, header button')];
      return new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size;
    });
    expect(rows, 'lignes de navigation').toBeLessThanOrEqual(2);
    const helpBtn = page.getByRole('button', { name: 'je sais pas où trouver mon export' });
    await helpBtn.click();
    await expect(page.getByRole('tablist', { name: 'où trouver ton export' })).toBeVisible();
    expect(await noHScroll(), 'accueil, aide ouverte').toBe(true);
    expect(await violationsBothThemes(page), 'axe: aide').toEqual([]);
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/1-aide-telephone.png`, fullPage: true });
    await page.getByRole('tab', { name: 'imdb' }).click();
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'suivant →' }).click();
    await expect(page.getByText('étape 4 sur 4')).toBeVisible();
    expect(await noHScroll(), 'aide imdb, étape 4').toBe(true);
    await page.getByRole('button', { name: 'passer en clair' }).click();
    await page.screenshot({ path: `${SHOTS}/1-aide-imdb-clair-telephone.png`, fullPage: true });
    await page.getByRole('button', { name: 'passer en sombre' }).click();
    await helpBtn.click();
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
    const dom: number[] = [];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    for (const value of ['5', '6', '7', '3', '1', '0', '4']) {
      const before = firstCard();
      const t0 = performance.now();
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      while (firstCard() === before) await new Promise((r) => setTimeout(r, 0));
      dom.push(performance.now() - t0);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      out.push(performance.now() - t0);
    }
    return { out, dom };
  });

  const report = {
    modelReadyMs: Math.round(modelReady),
    analysisMs: Math.round(analysis),
    notchMs: notch.out.map((x) => Math.round(x)),
    notchMaxMs: Math.round(Math.max(...notch.out)),
    // time until the new cards are in the DOM (React), before the two frames of the paint
    notchDomMs: notch.dom.map((x) => Math.round(x)),
  };
  console.log(JSON.stringify(report));
  test.info().annotations.push({ type: 'timings', description: JSON.stringify(report) });
  expect(report.modelReadyMs).toBeLessThanOrEqual(2000);
  expect(report.analysisMs).toBeLessThanOrEqual(300);
  expect(report.notchMaxMs).toBeLessThanOrEqual(50);
});
