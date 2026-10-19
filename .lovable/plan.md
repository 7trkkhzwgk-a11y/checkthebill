# Typed promises

- Add a document/text choice to the Promise section, leaving uploads unchanged.
- Structure typed promises privately with AI, preserving stated amounts, tax/cess rates, inclusive/exclusive tax and dates without calculation.
- Save masked structured fields, show “Promise you entered (no document)”, and allow edits before Looks right.
- Add deterministic price/refund and tax comparisons for typed promises only; show expected tax, billed tax and differences without changing existing rules.
- Draft messages using “I was informed that…” and one request for the company to confirm the promise and resolve discrepancies.
- Test the stated examples and re-run saved IRCTC and Dandy checks.

## Technical details
- Add nullable owner-scoped promise metadata; existing rows and document extraction remain unchanged.
- Reuse authenticated reading, persistence and confirmation boundaries. Keep typed tax arithmetic in a pure Decimal helper with tests.