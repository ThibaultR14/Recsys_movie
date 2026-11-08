/**
 * Export help drawings (docs/etape-6b-retouches.md, D4): schematic, hand-drawn, fanzine style.
 * No screenshot, no logo, no brand colour, no real page reproduced; no words either (the menu names
 * are in the step text, in the user's language). Ink + blue pen tokens: both themes.
 * Decorative: the step text carries the information (aria-hidden).
 */
import type { ReactNode } from 'react';

const INK = 'fill-none stroke-ink';
const PEN = 'fill-none stroke-pen';

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 320 190"
      aria-hidden="true"
      focusable="false"
      className="block h-auto w-full max-w-[420px]"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** A browser-ish window: slightly wobbly frame and a top bar. */
function Window() {
  return (
    <g className={INK} strokeWidth={2}>
      <path d="M12 14 L306 12 L308 176 L11 178 Z" />
      <path d="M12 36 L307 35" />
      <circle cx="26" cy="25" r="3" />
      <circle cx="37" cy="25" r="3" />
    </g>
  );
}

/** Lines of "text": short strokes. */
function Lines({
  x,
  y,
  widths,
  gap = 12,
}: {
  x: number;
  y: number;
  widths: number[];
  gap?: number;
}) {
  return (
    <g className={INK} strokeWidth={2} opacity={0.55}>
      {widths.map((w, i) => (
        <path key={i} d={`M${x} ${y + i * gap} h${w}`} />
      ))}
    </g>
  );
}

/** Hand-drawn pen loop around a target. */
function Loop({ cx, cy, rx, ry }: { cx: number; cy: number; rx: number; ry: number }) {
  return (
    <path
      className={PEN}
      strokeWidth={3}
      d={`M${cx - rx} ${cy} C${cx - rx} ${cy - ry * 1.3} ${cx + rx} ${cy - ry * 1.2} ${cx + rx} ${cy} S${cx - rx * 0.6} ${cy + ry * 1.4} ${cx - rx * 0.9} ${cy - ry * 0.4}`}
    />
  );
}

/** Pen arrow from (x1, y1) to (x2, y2), curved. */
function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const mx = (x1 + x2) / 2;
  const my = Math.min(y1, y2) - 18;
  const a = Math.atan2(y2 - my, x2 - mx);
  const head = (da: number) => `${x2 - 11 * Math.cos(a + da)} ${y2 - 11 * Math.sin(a + da)}`;
  return (
    <g className={PEN} strokeWidth={3}>
      <path d={`M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`} />
      <path d={`M${head(0.5)} L${x2} ${y2} L${head(-0.5)}`} />
    </g>
  );
}

/** A file with a folded corner and its extension. */
function FileIcon({ x, y, ext }: { x: number; y: number; ext: string }) {
  return (
    <g>
      <path
        className={INK}
        strokeWidth={2}
        d={`M${x} ${y} h38 l16 16 v58 h-54 Z M${x + 38} ${y} v16 h16`}
      />
      <text
        x={x + 27}
        y={y + 52}
        textAnchor="middle"
        className="fill-ink font-mono text-[15px] font-bold"
      >
        {ext}
      </text>
    </g>
  );
}

/** The site's drop zone, small and dashed. */
function MiniDrop({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={120}
        height={74}
        rx={3}
        className={INK}
        strokeWidth={2}
        strokeDasharray="6 5"
      />
      <Lines x={x + 18} y={y + 30} widths={[84, 56]} gap={14} />
    </g>
  );
}

/** Avatar + open menu at the top right, one entry looped. */
function MenuFromAvatar({ looped }: { looped: number }) {
  const ys = [62, 84, 106, 128];
  return (
    <>
      <Window />
      <Lines x={28} y={58} widths={[90, 130, 70]} gap={18} />
      <circle cx="286" cy="25" r="7" className={INK} strokeWidth={2} />
      <path d="M190 44 h104 v100 h-104 Z" className={`${INK} fill-surface`} strokeWidth={2} />
      <Lines x={204} y={ys[0]!} widths={[60, 72, 50, 66]} gap={22} />
      <Loop cx={238} cy={ys[looped]!} rx={46} ry={11} />
      <Arrow x1={110} y1={160} x2={186} y2={ys[looped]! + 6} />
    </>
  );
}

export function LetterboxdSettings() {
  return (
    <Frame>
      <MenuFromAvatar looped={2} />
    </Frame>
  );
}

export function LetterboxdExport() {
  return (
    <Frame>
      <Window />
      <g className={INK} strokeWidth={2}>
        <path d="M28 52 h44 M84 52 h44 M140 52 h52 M204 52 h40" opacity={0.55} />
      </g>
      <Loop cx={204} cy={52} rx={20} ry={9} />
      <Lines x={28} y={86} widths={[160, 120]} gap={16} />
      <rect x={28} y={126} width={126} height={30} rx={3} className={INK} strokeWidth={2} />
      <path d="M44 141 h94" className={INK} strokeWidth={2} />
      <Arrow x1={250} y1={170} x2={162} y2={140} />
    </Frame>
  );
}

export function DropZip() {
  return (
    <Frame>
      <FileIcon x={34} y={58} ext=".zip" />
      <Arrow x1={98} y1={92} x2={168} y2={100} />
      <MiniDrop x={176} y={60} />
    </Frame>
  );
}

export function ImdbRatings() {
  return (
    <Frame>
      <MenuFromAvatar looped={1} />
    </Frame>
  );
}

export function ImdbExport() {
  return (
    <Frame>
      <Window />
      <Lines x={28} y={54} widths={[120]} />
      {[78, 106, 134, 162].map((y) => (
        <g key={y}>
          <rect x={28} y={y - 10} width={14} height={20} className={INK} strokeWidth={2} />
          <Lines x={52} y={y} widths={[110]} />
        </g>
      ))}
      <text x={276} y={58} textAnchor="middle" className="fill-ink font-mono text-[18px] font-bold">
        …
      </text>
      <Loop cx={276} cy={53} rx={16} ry={10} />
      <path d="M206 70 h90 v34 h-90 Z" className={`${INK} fill-surface`} strokeWidth={2} />
      <Lines x={218} y={87} widths={[56]} />
      <Arrow x1={180} y1={150} x2={214} y2={96} />
    </Frame>
  );
}

export function ImdbWait() {
  return (
    <Frame>
      <Window />
      <Lines x={28} y={56} widths={[100]} />
      <rect x={28} y={74} width={262} height={34} rx={3} className={INK} strokeWidth={2} />
      <Lines x={40} y={91} widths={[120]} />
      <g className={PEN} strokeWidth={3}>
        <circle cx="262" cy="91" r="10" />
        <path d="M262 85 v6 l5 3" />
      </g>
      <g className={PEN} strokeWidth={3}>
        <path d="M140 150 a16 16 0 1 1 6 12" />
        <path d="M134 160 l12 3 l1 -12" />
      </g>
      <Lines x={176} y={150} widths={[60]} />
    </Frame>
  );
}

export function DropCsv() {
  return (
    <Frame>
      <FileIcon x={34} y={58} ext=".csv" />
      <Arrow x1={98} y1={92} x2={168} y2={100} />
      <MiniDrop x={176} y={60} />
    </Frame>
  );
}
