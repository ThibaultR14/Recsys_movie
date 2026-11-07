/**
 * Top 20 at the ∞, 2 000 and 500 positions for a real Letterboxd export (docs/etape-4, D5).
 * Same code as the Web Worker (createHandler). Prints to the terminal only; writes nothing.
 *
 *   npm run reco-report -- <export.zip | export folder> [--top 20]
 */
import { existsSync } from 'node:fs';
import type { ImportResult, InitResult, RecommendResult } from '../src/reco/workerCore';
import { exportInput, localHandler } from './local';

const SHOWN_CAPS = [null, 2000, 500];

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
      console.log(
        `${rank}. ${f.title} (${f.year ?? '?'}) · ${pop} notes · score ${f.score.toFixed(4)}`,
      );
    });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
