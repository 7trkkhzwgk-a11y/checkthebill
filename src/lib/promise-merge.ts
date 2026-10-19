// Combines a document-read promise with the user's typed promise. Typed values win; both are kept visible.
export type MergeRow = { item: string | null; promised_amount: number | null; promised_on: string | null; notes?: string | null };
export type TypedFields = { item: string | null; amount: number | null; date: string | null; who_promised: string | null } | null;

export const NOTE_UNREAD = "Promise note (not read automatically): ";

export function mergeTypedIntoRow<R extends MergeRow>(row: R, source: string | null, typed: TypedFields, typedText: string): { row: R; source: string | null } {
  const notes: string[] = row.notes ? [row.notes] : [];
  if (!typed) return { row: { ...row, notes: [...notes, `${NOTE_UNREAD}${typedText}`].join(" · ") }, source };
  const next = { ...row };
  let nextSource = source;
  const pairs: [string, unknown, unknown, () => void][] = [
    ["Item", row.item, typed.item, () => { next.item = typed.item; }],
    ["Amount", row.promised_amount, typed.amount, () => { next.promised_amount = typed.amount; }],
    ["Date", row.promised_on, typed.date, () => { next.promised_on = typed.date; }],
    ["Who promised", source, typed.who_promised, () => { nextSource = typed.who_promised; }],
  ];
  for (const [label, doc, mine, apply] of pairs) {
    if (mine == null || mine === "") continue;
    if (doc != null && doc !== "" && String(doc) !== String(mine)) notes.push(`${label}: you typed ${mine}, document says ${doc}`);
    apply();
  }
  notes.push(`Your note: ${typedText}`);
  next.notes = notes.join(" · ");
  return { row: next, source: nextSource };
}
