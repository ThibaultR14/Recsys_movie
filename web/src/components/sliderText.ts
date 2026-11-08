/** Label of a slider notch: « moins de 2 000 notes », nothing at ∞ (null). */
export function capLabel(cap: number | null): string {
  return cap === null ? '' : `moins de ${cap.toLocaleString('fr-FR')} notes`;
}
