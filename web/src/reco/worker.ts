/**
 * Recommendation Web Worker (docs/etape-4-navigateur.md, D5): loads /data/ files, reads the
 * export, matches titles and computes the recommendations off the main thread.
 */
import { createHandler, type RecoRequest, type RecoResponse } from './workerCore';

interface WorkerScope {
  onmessage: ((event: MessageEvent<RecoRequest>) => void) | null;
  postMessage(message: RecoResponse): void;
}

const scope = self as unknown as WorkerScope;
const handle = createHandler((url) => fetch(url));

scope.onmessage = (event) => {
  void handle(event.data).then((response) => scope.postMessage(response));
};
