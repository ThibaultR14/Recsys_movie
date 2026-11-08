/**
 * Promise API over the recommendation Web Worker, for the interface (step 5).
 *
 *   const reco = new RecoClient();
 *   await reco.init();
 *   const { summary, unrecognized } = await reco.importExport({ kind: 'zip', bytes });
 *   await reco.confirm({ [unrecognized[0].index]: unrecognized[0].candidates[0].item });
 *   const { positions } = await reco.recommend({ n: 50 });
 */
import type { Choices, ExportInput } from './engine';
import type {
  ConfirmResult,
  ImportResult,
  InitResult,
  RecoRequest,
  RecoResponse,
  RecommendResult,
} from './workerCore';

/** Minimal Worker shape (a real Worker, or a fake one in tests). */
export interface WorkerLike {
  postMessage(message: RecoRequest, transfer?: Transferable[]): void;
  onmessage: ((event: { data: RecoResponse }) => void) | null;
}

/** Omit<…, 'id'> applied to each member of the request union. */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

type Pending = { resolve: (value: never) => void; reject: (reason: Error) => void };

export class RecoClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly worker: WorkerLike = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    }) as unknown as WorkerLike,
  ) {
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.ok) p.resolve(data.result as never);
      else p.reject(new Error(data.error));
    };
  }

  private send<T>(request: WithoutId<RecoRequest>, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: never) => void, reject });
      this.worker.postMessage({ ...request, id } as RecoRequest, transfer);
    });
  }

  init(): Promise<InitResult> {
    return this.send({ type: 'init' });
  }

  /** The ZIP bytes are transferred to the worker (not copied). */
  importExport(input: ExportInput): Promise<ImportResult> {
    const transfer = input.kind === 'zip' ? [input.bytes.buffer as ArrayBuffer] : [];
    return this.send({ type: 'import', input }, transfer);
  }

  /** Choices of the analysis screen (entry index -> item or null); replaces earlier choices. */
  confirm(choices: Choices): Promise<ConfirmResult> {
    return this.send({ type: 'confirm', choices });
  }

  recommend(options: { n?: number; caps?: (number | null)[] } = {}): Promise<RecommendResult> {
    return this.send({ type: 'recommend', ...options });
  }
}
