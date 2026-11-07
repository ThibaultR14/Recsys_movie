// Placeholder until the interface (step 5). The button loads the model in the Web Worker and shows
// the loading time (step 4 check in a real browser); no user data involved.
import { useState } from 'react';
import { RecoClient } from './reco/client';

export function App() {
  const [status, setStatus] = useState<string>('');

  const testEngine = async () => {
    setStatus('chargement du modèle…');
    const t0 = performance.now();
    try {
      const init = await new RecoClient().init();
      const ms = Math.round(performance.now() - t0);
      setStatus(`modèle prêt : ${init.nItems.toLocaleString('fr-FR')} films, en ${ms} ms.`);
    } catch (err) {
      setStatus(`oups, le modèle n'a pas pu se charger : ${(err as Error).message}`);
    }
  };

  return (
    <main>
      <h1>pépite</h1>
      <p>en construction : le site arrive bientôt.</p>
      <button type="button" onClick={() => void testEngine()}>
        tester le moteur
      </button>
      <p aria-live="polite">{status}</p>
    </main>
  );
}
