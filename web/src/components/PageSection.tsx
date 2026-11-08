import type { ReactNode } from 'react';
import { RichText } from './RichText';

/** A titled section of a text page (« comment ça marche », « à propos », « contact »). */
export function PageSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="flex scroll-mt-6 flex-col gap-3">
      <h2 id={`${id}-titre`} className="m-0 text-[20px] font-bold">
        {title}
      </h2>
      <div className="flex flex-col gap-3 text-[16px] leading-relaxed">{children}</div>
    </section>
  );
}

/** Page title, same size as the screens' titles. */
export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="m-0 text-[clamp(26px,3.4vw,38px)] leading-[1.35] font-normal">{children}</h1>
  );
}

/** Paragraphs of a text page. */
export function Paragraphs({ items }: { items: readonly string[] }) {
  return (
    <>
      {items.map((p) => (
        <p key={p} className="m-0">
          <RichText text={p} />
        </p>
      ))}
    </>
  );
}
