/**
 * Top 20 at the 8 positions (with the explanations, step 6b D6) for a real Letterboxd export (docs/etape-4, D5).
 * Same code as the Web Worker (createHandler). Prints to the terminal only; writes nothing.
 *
 *   npm run reco-report -- <export.zip | export folder> [--top 20]
 */
import { existsSync } from 'node:fs';
import type { ImportResult, InitResult, RecommendResult } from '../src/reco/workerCore';
import { citationPicks } from '../src/components/cardRules';
import { FAR_FROM_TASTE } from '../src/pages/resultsText';
import { exportInput, localHandler } from './local';

const SHOWN_CAPS = [null, 20000, 10000, 5000, 2000, 1000, 500, 200];

async function main() {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith('--'));
  const topAt = args.indexOf('--top');
  const top = topAt >= 0 ? Number(args[topAt + 1]) : 20;
  if (!path || !existsSync(path)) throw new Error('usage : reco-report <export.zip | dossier>');

  const call = localHandler();
  await call<InitResult>({ id: 1, type: 'init' });
  const imported = await call<ImportResult>({ id: 2, type: 'import', input: exportInput(path) });
  const reco = await call<RecommendResult>({ id: 3, type: 'recommend', n: top, caps: SHOWN_CAPS });

  const s = imported.summary;
  console.log(
    `\n${s.nEntries} films dans l'export · ${s.nHistoryFilms} utilisés pour les recos ` +
      `(exact ${s.counts.exact}, variante ${s.counts.probable_variant}) · ` +
      `non utilisés : flou ${s.counts.probable_fuzzy}, ambigu ${s.counts.ambiguous}, ` +
      `non trouvé ${s.counts.not_found} · ${reco.nExcluded} films exclus des recos`,
  );
  for (const pos of reco.positions) {
    const cap =
      pos.cap === null ? '∞ (ordre du modèle)' : `${pos.cap.toLocaleString('fr-FR')} notes max`;
    console.log(`\n── ${cap} · score relatif ${pos.relativeScore.toFixed(3)} ──`);
    pos.films.forEach((f, k) => {
      const rank = String(k + 1).padStart(2);
      const pop = f.popularity.toLocaleString('fr-FR').padStart(7);
      const why = f.seriesOf
        ? ` · série : ${f.seriesOf}`
        : f.because
          ? ` · ${f.because.kind === 'liked' ? 'aimé' : 'vu'} : ${f.because.titles.join(' / ')}`
          : '';
      console.log(
        `${rank}. ${f.title} (${f.year ?? '?'}) · ${pop} notes · score ${f.score.toFixed(4)}${why}`,
      );
    });
  }

  // Explanations (step 6b, D6), informative: on the first 8 cards of each notch, how many distinct
  // history films are cited, and how many cards have none (series notes and far notches apart).
  console.log('\n── explications, 8 premières cartes par cran (comptes seulement) ──');
  for (const pos of reco.positions) {
    const first = pos.films.slice(0, 8);
    const far = pos.relativeScore < FAR_FROM_TASTE;
    // same diversity rule as the grid (step 6b, R6, option A)
    const picks = citationPicks(first.map((f) => (far ? undefined : f.because?.items)));
    const cited = first.flatMap((f, i) => picks[i]!.map((k) => f.because!.titles[k]!));
    const counts = new Map<string, number>();
    for (const t of cited) counts.set(t, (counts.get(t) ?? 0) + 1);
    const most = Math.max(0, ...counts.values());
    const none = first.filter((f, i) => picks[i]!.length === 0 && !f.seriesOf).length;
    const one = picks.filter((p) => p.length === 1).length;
    console.log(
      `${pos.cap === null ? '∞' : pos.cap} : ${counts.size} films cités distincts, ` +
        `le plus cité sur ${most}/8 cartes, ${one} carte(s) avec un seul film, ` +
        `${none} carte(s) sans explication` +
        `${far ? ' (cran « loin de tes goûts » : explications masquées)' : ''}`,
    );
  }
  console.log(`temps des explications : ${(reco.explainMs ?? 0).toFixed(1)} ms`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
