/**
 * Model files written by pipeline/export.py (docs/etape-4-navigateur.md, D1): embeddings.bin,
 * yty.bin, popularity.bin, model-meta.json. Little-endian binaries.
 */

export interface ModelMeta {
  format_version: number;
  n_items: number;
  dims: number;
  regularization: number;
  alpha: number;
  beta: number;
  /** Step 6c (D2): rated films with a percentile below this are left out of the fold-in. */
  foldin_drop_below?: number;
  /** …unless fewer than this many films would remain. */
  foldin_min_kept?: number;
  slider: { variant: string; positions: (number | null)[] };
  movie_ids: number[];
  non_recommendable_item_idx: number[];
  embeddings_sha256: string;
}

export interface ModelFiles {
  meta: ModelMeta;
  nItems: number;
  dims: number;
  /** Dequantised item vectors, row-major (item * dims + d), float32 like Python `dequantize`. */
  vectors: Float32Array;
  /** YᵀY of the dequantised vectors (yty.bin, float32) widened to float64. */
  yty: Float64Array;
  /** Slider popularity (hybrid, popularity.bin). */
  popularity: Uint32Array;
  /** 1 if the film may be recommended. */
  recommendable: Uint8Array;
}

const MAGIC = 'PEPE';
const FORMAT_VERSION = 1;
const HEADER_BYTES = 16;

export class ModelFilesError extends Error {}

export interface Embeddings {
  nItems: number;
  dims: number;
  q: Int8Array;
  scales: Float32Array;
}

/** embeddings.bin: "PEPE", uint32 version, uint32 n_items, uint32 dims, int8[n*d], float32[n]. */
export function parseEmbeddings(buffer: ArrayBuffer): Embeddings {
  if (buffer.byteLength < HEADER_BYTES)
    throw new ModelFilesError('embeddings.bin : fichier tronqué');
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  const version = view.getUint32(4, true);
  const nItems = view.getUint32(8, true);
  const dims = view.getUint32(12, true);
  if (magic !== MAGIC || version !== FORMAT_VERSION) {
    throw new ModelFilesError(`embeddings.bin : en-tête inattendu (${magic} v${version})`);
  }
  const expected = HEADER_BYTES + nItems * dims + 4 * nItems;
  if (buffer.byteLength !== expected) {
    throw new ModelFilesError(`embeddings.bin : ${buffer.byteLength} octets, ${expected} attendus`);
  }
  const q = new Int8Array(buffer, HEADER_BYTES, nItems * dims);
  const scalesStart = HEADER_BYTES + nItems * dims;
  const scales = new Float32Array(nItems);
  for (let i = 0; i < nItems; i++) scales[i] = view.getFloat32(scalesStart + 4 * i, true);
  return { nItems, dims, q, scales };
}

/** y = q * scale, rounded to float32 (identical to numpy float32 multiplication). */
export function dequantize({ nItems, dims, q, scales }: Embeddings): Float32Array {
  const out = new Float32Array(nItems * dims);
  for (let i = 0; i < nItems; i++) {
    const s = scales[i]!;
    for (let d = 0; d < dims; d++) out[i * dims + d] = q[i * dims + d]! * s;
  }
  return out;
}

function littleEndianFloat32(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const out = new Float32Array(buffer.byteLength / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(4 * i, true);
  return out;
}

function littleEndianUint32(buffer: ArrayBuffer): Uint32Array {
  const view = new DataView(buffer);
  const out = new Uint32Array(buffer.byteLength / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getUint32(4 * i, true);
  return out;
}

/** Assemble and check the four files; `catalogItems` = n of catalog.json (consistency check). */
export function buildModelFiles(
  meta: ModelMeta,
  embeddings: ArrayBuffer,
  yty: ArrayBuffer,
  popularity: ArrayBuffer,
  catalogItems?: number,
): ModelFiles {
  const emb = parseEmbeddings(embeddings);
  const pop = littleEndianUint32(popularity);
  const ytyF32 = littleEndianFloat32(yty);
  const problems: string[] = [];
  if (meta.format_version !== FORMAT_VERSION) problems.push(`format ${meta.format_version}`);
  if (meta.n_items !== emb.nItems) problems.push('n_items (embeddings.bin)');
  if (meta.dims !== emb.dims) problems.push('dims');
  if (pop.length !== emb.nItems) problems.push('popularity.bin');
  if (ytyF32.length !== emb.dims * emb.dims) problems.push('yty.bin');
  if (catalogItems !== undefined && catalogItems !== emb.nItems) problems.push('catalog.json');
  if (problems.length > 0) {
    throw new ModelFilesError(`fichiers du modèle incohérents : ${problems.join(', ')}`);
  }
  const recommendable = new Uint8Array(emb.nItems).fill(1);
  for (const i of meta.non_recommendable_item_idx) recommendable[i] = 0;
  return {
    meta,
    nItems: emb.nItems,
    dims: emb.dims,
    vectors: dequantize(emb),
    yty: Float64Array.from(ytyF32),
    popularity: pop,
    recommendable,
  };
}

export type FetchFn = (url: string) => Promise<Response>;

export async function fetchModelFiles(fetchFn: FetchFn, base = '/data/') {
  const [meta, embeddings, yty, popularity] = await Promise.all([
    fetchFn(`${base}model-meta.json`).then((r) => r.json() as Promise<ModelMeta>),
    fetchFn(`${base}embeddings.bin`).then((r) => r.arrayBuffer()),
    fetchFn(`${base}yty.bin`).then((r) => r.arrayBuffer()),
    fetchFn(`${base}popularity.bin`).then((r) => r.arrayBuffer()),
  ]);
  return { meta, embeddings, yty, popularity };
}
