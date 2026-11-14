import type { Tuning } from '../reco/engine';
import { describeTuning } from './devTuning';

/** Dev-only banner listing the active switches (rendered behind `import.meta.env.DEV`). */
export function DevBanner({ tuning }: { tuning: Tuning }) {
  return (
    <p
      role="note"
      className="fixed right-3 bottom-3 z-50 m-0 max-w-[90vw] rounded border border-rule bg-surface px-3 py-2 text-[13px] text-ink shadow"
    >
      <strong>dev</strong> : {describeTuning(tuning)}
    </p>
  );
}
