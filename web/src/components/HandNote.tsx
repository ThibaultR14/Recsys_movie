import type { ReactNode } from 'react';

interface HandNoteProps {
  children: ReactNode;
  /** Tilt in degrees (design system: -1.5 to -4). */
  rotate?: number;
  /** Font size in px (design system: 20 to 26). */
  size?: number;
  as?: 'span' | 'p';
  className?: string;
}

/** Handwritten annotation: Caveat, blue pen, slightly tilted. Never for text that must be read. */
export function HandNote({
  children,
  rotate = -2,
  size = 22,
  as = 'span',
  className = '',
}: HandNoteProps) {
  const Tag = as;
  return (
    <Tag
      className={`m-0 inline-block font-hand leading-tight text-pen ${className}`}
      style={{ fontSize: size, transform: `rotate(${rotate}deg)`, transformOrigin: 'left' }}
    >
      {children}
    </Tag>
  );
}
