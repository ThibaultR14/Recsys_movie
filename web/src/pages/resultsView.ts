import type { RecommendResult } from '../reco/workerCore';

/** Starting notch (mid-right, like the mockup at 70 %). */
export const START_CAP = 2000;
export const PAGE = 8;

/** What the user changed on the results screen; kept by App while a page is open (step 6b, D2). */
export interface ResultsView {
  index: number;
  visible: number;
  noDocs: boolean;
}

export function initialView(reco: RecommendResult): ResultsView {
  const caps = reco.positions.map((p) => p.cap);
  return { index: Math.max(0, caps.indexOf(START_CAP)), visible: PAGE, noDocs: false };
}
