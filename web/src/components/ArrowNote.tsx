import type { ReactNode } from 'react';

/** Handwritten note with a small drawn arrow pointing left (« c'est là »). */
export function ArrowNote({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 font-hand text-[26px] text-pen ${className}`}
      style={{ transform: 'rotate(-3deg)' }}
    >
      <svg
        aria-hidden="true"
        width="56"
        height="28"
        viewBox="0 0 56 28"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M54 6 C 40 2, 20 4, 6 18" />
        <path d="M6 8 L 5 19 L 16 20" />
      </svg>
      {children}
    </span>
  );
}
