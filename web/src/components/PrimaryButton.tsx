import type { ButtonHTMLAttributes } from 'react';

/** The one main action of a screen: white, 2 px ink border, 3 px corners, bold 16 px, 48 px high. */
export function PrimaryButton({
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`h-12 cursor-pointer rounded-[3px] border-2 border-ink bg-white px-6 text-[16px] font-bold text-ink hover:text-pen focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pen disabled:cursor-wait disabled:opacity-60 ${className}`}
      {...props}
    />
  );
}
