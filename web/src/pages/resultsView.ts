import { NO_FILTERS, type Filters } from '../reco/filters';
import type { RecommendResult } from '../reco/workerCore';

import { START_CATEGORY_CAP } from './categories';

/** Starting notch: « les moins connus » (step 8b, D1; the 2 000 notch of step 5). */
export const START_CAP = START_CATEGORY_CAP;
export const PAGE = 8;

/** What the user changed on the results screen; kept by App while a page is open (step 6b, D2). */
export interface ResultsView {
  index: number;
  visible: number;
  /** « affiner » (step 8b, D3): changing them recomputes the lists in the worker (D2). */
  filters: Filters;
  /** The « affiner » panel is open (kept while a page is open, like the rest). */
  refineOpen: boolean;
}

export function initialView(reco: RecommendResult): ResultsView {
  const caps = reco.positions.map((p) => p.cap);
  return {
    index: Math.max(0, caps.indexOf(START_CAP)),
    visible: PAGE,
    filters: NO_FILTERS,
    refineOpen: false,
  };
}
