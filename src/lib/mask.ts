// Masks sensitive numbers in extracted text before it is saved.
// Names, patient names and addresses are masked by the AI step (it is told to
// replace them with [NAME] / [ADDRESS]); this pass is a deterministic safety net.

export function maskSensitive(input: string | null | undefined, mode: "text" | "identifier" = "text"): string | null {
  if (input == null) return null;
  let s = String(input);

  // IDs are not payment credentials, even when they contain 13–19 digits.
  if (mode === "identifier") return s;
  const identifiers: string[] = [];
  s = s.replace(/\b(?:transaction|refund|cancellation|invoice|bank\s+reference|reference|pnr)(?:\s*(?:id|no\.?|number|#))?\s*[:#]?\s*[A-Z0-9][A-Z0-9_-]*/gi, (value) => {
    identifiers.push(value);
    return `\uE000${String.fromCharCode(0xE100 + identifiers.length - 1)}\uE001`;
  });

  // Card numbers: 13-19 digits, optionally separated by spaces/dashes. Keep last 4.
  s = s.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => {
    const digits = m.replace(/\D/g, "");
    return `•••• ${digits.slice(-4)}`;
  });

  // Phone numbers: +1 (555) 123-4567, 555-123-4567, 555.123.4567
  s = s.replace(
    /(?:\+?\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g,
    "[PHONE]",
  );

  // Account numbers: labelled "acct/account/a/c" followed by digits.
  s = s.replace(
    /\b(acct|account|a\/c|iban|routing)(\s*(?:no\.?|number|#)?\s*[:#]?\s*)((?:[A-Z]{2}\d{2}[A-Z0-9]*|\d[\d -]*\d))\b/gi,
    (_m, label: string, sep: string, num: string) => {
      const clean = num.replace(/[^A-Z0-9]/gi, "");
      return `${label}${sep}•••• ${clean.slice(-4)}`;
    },
  );

  // Already-masked card forms like XXXX1234 / ****1234 normalise to •••• 1234
  s = s.replace(/[X*•]{4,}[ -]?(\d{4})\b/gi, "•••• $1");

  return s.replace(/\uE000([\uE100-\uF8FF])\uE001/g, (_m, key: string) => identifiers[key.charCodeAt(0) - 0xE100] ?? "");
}
