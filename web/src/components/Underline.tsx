import type { ReactNode } from 'react';

/** Hand-drawn wavy underline (blue pen, 3 px, round caps) under a key word of a title. */
export function Underline({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-block">
      {children}
      <svg
        aria-hidden="true"
        data-testid="underline"
        viewBox="0 0 300 14"
        preserveAspectRatio="none"
        className="absolute bottom-[-8px] left-0 h-[14px] w-full"
      >
        <path
          d="M2 9 C 60 3, 120 12, 180 6 S 270 4, 298 8"
          fill="none"
          stroke="currentColor"
          className="text-pen"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
