/**
 * « télécharger la liste (csv) » (docs/etape-8b-ux-resultats.md, D6): the list shown, in the
 * Letterboxd list-import format, made in the browser (nothing is sent). UTF-8 without BOM, comma
 * without space, RFC 4180 quotes, CRLF line ends; columns tmdbID, imdbID, Title, Year.
 */
export interface CsvFilm {
  tmdbId: number | null;
  imdbId?: string | null;
  title: string;
  year: number | null;
}

export const CSV_HEADER = ['tmdbID', 'imdbID', 'Title', 'Year'];

/** RFC 4180: quoted when it holds a comma, a quote or a line break; quotes doubled. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function listCsv(films: readonly CsvFilm[]): string {
  const rows = [
    CSV_HEADER,
    ...films.map((f) => [
      f.tmdbId == null ? '' : String(f.tmdbId),
      f.imdbId ?? '',
      f.title,
      f.year == null ? '' : String(f.year),
    ]),
  ];
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/** Lower case, no accents, anything else -> « - », no double dash: « Agnès Varda » -> agnes-varda. */
export function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** pepite-<part>-AAAA-MM-JJ.csv, local date; `part` = the category (D6) or films-de-<name>. */
export function csvFileName(part: string, date: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;
  return `pepite-${part}-${day}.csv`;
}

export function personPart(name: string): string {
  return `films-de-${slug(name)}`;
}

/** Saves `text` as a file through a temporary object URL (the browser's download, no request). */
export function saveText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
