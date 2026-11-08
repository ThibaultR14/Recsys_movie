import { useId } from 'react';
import { capLabel } from './sliderText';

interface SliderProps {
  /** Popularity caps from model-meta.json, ∞ (null) first. */
  positions: readonly (number | null)[];
  index: number;
  onChange: (index: number) => void;
}

/** « plutôt connu ou plutôt pépite ? »: native range input, one notch per popularity cap. */
export function Slider({ positions, index, onChange }: SliderProps) {
  const id = useId();
  const label = capLabel(positions[index] ?? null);
  return (
    <div className="flex max-w-[560px] flex-col gap-2">
      <label htmlFor={id} className="text-[15px] font-bold">
        plutôt connu ou plutôt pépite ?
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={positions.length - 1}
        step={1}
        value={index}
        aria-valuetext={label || 'les classiques'}
        onChange={(e) => onChange(Number(e.target.value))}
        className="m-0 h-11 w-full cursor-pointer accent-pen"
      />
      <div className="flex justify-between gap-4 text-[14px] text-muted">
        <span>les classiques</span>
        <span className="text-right">les trucs que personne connaît</span>
      </div>
      <p className="m-0 min-h-[1.4em] text-[14px]" aria-hidden="true" data-testid="cap-label">
        {label}
      </p>
    </div>
  );
}
