import { useState } from 'react';
import { FilmGrid } from '../components/FilmGrid';
import { Slider } from '../components/Slider';
import type { RecommendResult } from '../reco/workerCore';

export const START_CAP = 2000;
const PAGE = 8;

interface ResultatsProps {
  nEntries: number;
  reco: RecommendResult;
}

/** Screen 3: recommendations and the slider (completed in G4). */
export function Resultats({ nEntries, reco }: ResultatsProps) {
  const caps = reco.positions.map((p) => p.cap);
  const [index, setIndex] = useState(() => Math.max(0, caps.indexOf(START_CAP)));
  const position = reco.positions[index];
  return (
    <div className="flex flex-col gap-14 pt-6">
      <div className="flex max-w-[760px] flex-col gap-7">
        <h1 className="m-0 text-[clamp(26px,3.4vw,38px)] leading-[1.35] font-normal">
          on a lu tes {nEntries} films.
        </h1>
        <Slider positions={caps} index={index} onChange={setIndex} />
      </div>
      {position && <FilmGrid films={position.films.slice(0, PAGE)} cap={position.cap} />}
    </div>
  );
}
