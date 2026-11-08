/** List of « what we don't do »: no bullets, every line starts with « × ». */
export function NoList({ items }: { items: string[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[16px]">
      {items.map((item) => (
        <li key={item}>
          <span aria-hidden="true">× </span>
          {item}
        </li>
      ))}
    </ul>
  );
}
