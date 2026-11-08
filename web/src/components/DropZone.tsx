import { useId, useState, type DragEvent } from 'react';
import { ArrowNote } from './ArrowNote';

interface DropZoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
}

/** File drop zone: a real <label> bound to <input type="file">, plus drag and drop. The « c'est là »
 * note sits beside it and wraps under it on a phone. */
export function DropZone({ onFile, disabled = false }: DropZoneProps) {
  const id = useId();
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file && !disabled) onFile(file);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-7 gap-y-4">
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        data-testid="drop-zone"
        className={`flex max-w-[520px] min-w-0 flex-[1_1_380px] cursor-pointer flex-col gap-2 rounded-[3px] border-2 border-dashed bg-surface px-7 py-8 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-pen ${over ? 'border-pen' : 'border-ink'}`}
      >
        <span className="text-[18px] font-bold">glisse ton fichier ici</span>
        <span className="text-[15px] text-muted">
          l'export de letterboxd (le .zip) ou tes notes imdb (le .csv)
        </span>
        <input
          id={id}
          type="file"
          accept=".zip,.csv"
          disabled={disabled}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = '';
          }}
        />
      </label>
      <ArrowNote>c'est là</ArrowNote>
    </div>
  );
}
