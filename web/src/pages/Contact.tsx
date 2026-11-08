import { useId, useRef, useState, type FormEvent } from 'react';
import { PageSection, PageTitle, Paragraphs } from '../components/PageSection';
import { PrimaryButton } from '../components/PrimaryButton';
import {
  CONTACT as T,
  CONTACT_EMAIL,
  CONTACT_SUBJECTS,
  MESSAGE_MAX,
  type ContactSubject,
} from '../content/contact';
import { mailtoHref } from './contactMail';

interface ContactProps {
  /** Opens the mailto: link (window.location by default; injected in tests). */
  navigate?: (href: string) => void;
}

const linkClass = 'text-ink underline hover:text-pen';

/** « contact » (D3): the address as selectable text + copy, and a form that opens a mailto:. */
export function Contact({ navigate = (href) => window.location.assign(href) }: ContactProps) {
  const addressRef = useRef<HTMLElement>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [subject, setSubject] = useState<ContactSubject | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const messageId = useId();
  const helpId = useId();
  const countId = useId();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setCopyStatus(T.copie);
    } catch {
      // no clipboard (insecure context, refused): select the address for ctrl+c
      const el = addressRef.current;
      const sel = window.getSelection();
      if (el && sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      setCopyStatus(T.copieEchec);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const label = CONTACT_SUBJECTS.find((s) => s.id === subject)?.label;
    if (!label) return setError(T.erreurSujet);
    if (!message.trim()) return setError(T.erreurMessage);
    setError('');
    navigate(mailtoHref(CONTACT_EMAIL, label, message.trim()));
  };

  return (
    <div className="flex max-w-[680px] flex-col gap-12 pt-4">
      <PageTitle>{T.titre}</PageTitle>
      <div className="flex flex-col gap-3 text-[16px] leading-relaxed">
        <Paragraphs items={T.intro} />
      </div>

      <PageSection id="adresse" title={T.adresseLabel}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <code ref={addressRef} className="font-mono text-[18px] font-bold select-all">
            {CONTACT_EMAIL}
          </code>
          <button
            type="button"
            onClick={() => void copy()}
            className={`min-h-11 cursor-pointer bg-transparent p-0 text-[15px] ${linkClass}`}
          >
            {T.copier}
          </button>
        </div>
        <p className="m-0 min-h-[1.5em] text-[15px] text-muted" aria-live="polite">
          {copyStatus}
        </p>
      </PageSection>

      <form
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-6"
        aria-label="écrire un mail"
      >
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="mb-2 p-0 text-[16px] font-bold">{T.sujetLegende}</legend>
          {CONTACT_SUBJECTS.map((s) => (
            <label key={s.id} className="flex min-h-11 w-fit cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="sujet"
                value={s.id}
                checked={subject === s.id}
                onChange={() => setSubject(s.id)}
                className="size-5 accent-pen"
              />
              {s.label}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-2">
          <label htmlFor={messageId} className="text-[16px] font-bold">
            {T.messageLabel}
          </label>
          <p id={helpId} className="m-0 text-[15px] text-muted">
            {T.aideMessage}
          </p>
          <textarea
            id={messageId}
            value={message}
            maxLength={MESSAGE_MAX}
            rows={7}
            aria-describedby={`${helpId} ${countId}`}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full rounded-[3px] border-2 border-ink bg-surface p-3 font-mono text-[16px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pen"
          />
          <p id={countId} className="m-0 text-right text-[13px] text-muted">
            {message.length} / {MESSAGE_MAX}
          </p>
        </div>

        {error && (
          <p role="alert" className="m-0 text-[16px] font-bold">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-3">
          <PrimaryButton type="submit" className="w-fit">
            {T.bouton}
          </PrimaryButton>
          <p className="m-0 text-[15px] text-muted">{T.pasDeMail}</p>
        </div>
      </form>
    </div>
  );
}
