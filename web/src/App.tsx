// Screen state machine (step 5, D2): accueil -> analyse -> resultats. Nothing is stored: a reload
// brings back the home screen. The model loads in the Web Worker as soon as the page opens.
// Pages (« comment ça marche », « à propos », « contact ») open from the URL anchor, over the
// current screen, which is kept (step 6b, D2).
import { useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import { APropos } from './pages/APropos';
import { Accueil } from './pages/Accueil';
import { Analyse } from './pages/Analyse';
import { CommentCaMarche } from './pages/CommentCaMarche';
import { Contact } from './pages/Contact';
import { isSectionHash, pageOfHash } from './pages/pages';
import { Resultats } from './pages/Resultats';
import { initialView, type ResultsView } from './pages/resultsView';
import { groupUnrecognized } from './pages/analysis';
import { MESSAGES, readUpload, type UploadResult } from './pages/readUpload';
import { RecoClient } from './reco/client';
import type { Choices, ImportSummary } from './reco/engine';
import type { InitResult, RecommendResult, Unrecognized } from './reco/workerCore';

/** What the interface needs from the worker (a RecoClient, or a fake one in tests). */
export type RecoApi = Pick<RecoClient, 'init' | 'importExport' | 'confirm' | 'recommend'>;

/** Number of films computed per slider position (8 cards, « encore des films » up to 48). */
export const N_RECOMMENDED = 48;
export const EXAMPLE_URL = `${import.meta.env.BASE_URL}exemple/letterboxd-exemple.zip`;

type Screen =
  | { name: 'accueil' }
  | { name: 'analyse'; summary: ImportSummary; unrecognized: Unrecognized[] }
  | { name: 'resultats'; nEntries: number; reco: RecommendResult; view: ResultsView };

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

/** Performance marks read by the Playwright timing test (nothing stored, nothing sent). */
function mark(name: string): void {
  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
    performance.mark(name);
  }
}

let defaultClient: RecoClient | null = null;
function getDefaultClient(): RecoClient {
  defaultClient ??= new RecoClient();
  return defaultClient;
}

// One init per client, even if React mounts twice (StrictMode).
const inits = new WeakMap<RecoApi, Promise<InitResult>>();
function initOnce(client: RecoApi): Promise<InitResult> {
  let p = inits.get(client);
  if (!p) {
    p = client.init();
    inits.set(client, p);
  }
  return p;
}

export function App({ client: injected }: { client?: RecoApi }) {
  const [client] = useState<RecoApi>(() => injected ?? getDefaultClient());
  const [screen, setScreen] = useState<Screen>({ name: 'accueil' });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [hash, setHash] = useState(currentHash);
  const page = pageOfHash(hash);

  useEffect(() => {
    initOnce(client).then(
      () => {
        mark('pepite:model-ready');
        setReady(true);
      },
      () => setError(MESSAGES.engineDown),
    );
  }, [client]);

  useEffect(() => {
    const onHash = () => setHash(currentHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (page && isSectionHash(hash)) document.getElementById(hash.slice(1))?.scrollIntoView?.();
    else window.scrollTo?.(0, 0);
  }, [screen.name, page, hash]);

  const startImport = async (read: () => Promise<UploadResult>) => {
    setError(undefined);
    setBusy(true);
    try {
      const upload = await read();
      if (!upload.ok) {
        setError(upload.message);
        return;
      }
      if (!ready) setStatus('on prépare nos fiches…');
      try {
        await initOnce(client);
      } catch {
        setError(MESSAGES.engineDown);
        return;
      }
      setStatus('on lit ton fichier…');
      mark('pepite:import-start');
      const { summary, unrecognized } = await client.importExport(upload.input);
      mark('pepite:import-end');
      if (summary.nEntries === 0) {
        setError(MESSAGES.notExport);
        return;
      }
      if (summary.nHistoryFilms === 0 && groupUnrecognized(unrecognized).toVerify.length === 0) {
        setError(MESSAGES.noneRecognized);
        return;
      }
      setScreen({ name: 'analyse', summary, unrecognized });
    } catch {
      setError(MESSAGES.notExport);
    } finally {
      setBusy(false);
      setStatus(undefined);
    }
  };

  const onFile = (file: File) => void startImport(() => readUpload(file));
  const onExample = () =>
    void startImport(async () => {
      const res = await fetch(EXAMPLE_URL);
      if (!res.ok) throw new Error(`exemple introuvable (${res.status})`);
      return { ok: true, input: { kind: 'zip', bytes: new Uint8Array(await res.arrayBuffer()) } };
    });

  const onSubmit = async (choices: Choices) => {
    if (screen.name !== 'analyse') return;
    setError(undefined);
    setBusy(true);
    try {
      await client.confirm(choices);
      const reco = await client.recommend({ n: N_RECOMMENDED });
      if (reco.nHistory === 0) {
        setError(MESSAGES.noneRecognized);
        return;
      }
      setScreen({
        name: 'resultats',
        nEntries: screen.summary.nEntries,
        reco,
        view: initialView(reco),
      });
    } catch (err) {
      setError(`oups : ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const backHome = () => {
    setError(undefined);
    setScreen({ name: 'accueil' });
  };

  if (page) {
    return (
      <Layout page={page} onBack={backHome}>
        {page === 'comment-ca-marche' && <CommentCaMarche />}
        {page === 'a-propos' && <APropos />}
        {page === 'contact' && <Contact />}
      </Layout>
    );
  }
  if (screen.name === 'analyse') {
    return (
      <Layout onBack={backHome}>
        <Analyse
          summary={screen.summary}
          unrecognized={screen.unrecognized}
          onSubmit={(c) => void onSubmit(c)}
          busy={busy}
          error={error}
        />
      </Layout>
    );
  }
  if (screen.name === 'resultats') {
    return (
      <Layout width="wide" onBack={backHome}>
        <Resultats
          nEntries={screen.nEntries}
          reco={screen.reco}
          view={screen.view}
          onViewChange={(view) => setScreen({ ...screen, view })}
        />
      </Layout>
    );
  }
  return (
    <Layout>
      <Accueil onFile={onFile} onExample={onExample} status={status} error={error} busy={busy} />
    </Layout>
  );
}
