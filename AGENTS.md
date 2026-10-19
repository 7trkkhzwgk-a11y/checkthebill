<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Document structuring runs only through authenticated server functions and all extracted text passes maskSensitive before saving — why: privacy rules require no AI calls or unmasked extracted data from the browser.
- Uploaded files live in the private "documents" bucket under <user_id>/; tables store only the storage path — why: per-user storage RLS.
- Extraction schemas and normalization live in a browser-safe shared module used by the server persistence boundary — why: deterministic transaction filtering and identifier-safe masking must be independently testable.
- Extraction validates required-but-nullable fields after a complete provider JSON response and surfaces provider errors before validation — why: malformed output must never hide actionable service failures or reach persistence.
- Lab invoices and price lists whose extracted text matches a known document layout (src/lib/dandy.ts) are parsed by deterministic code with no AI call; every other document keeps the local four-page text batches and locally rendered scan images sent via sequential authenticated server calls, with masked price-list caches in owner-scoped tables — why: a code-readable layout needs no AI at all, which removes rate limits and token cost while leaving privacy rules and comparison maths unchanged.
- Confirmations, comparisons, flags and message-state writes use authenticated server functions; comparison snapshots are persisted before drafting — why: no unconfirmed calculations, authoritative owner checks, and recoverable AI failures.
- Comparison arithmetic uses Decimal and an explicit UTC comparison date; pure comparison and word-edit functions have rule tests — why: exact monetary differences and reproducible day/word counts.
- AI message generation and result-page Q&A use a shared server-only Groq helper and receive a strict computed-facts projection, never document text; provider token counts are recorded per check — why: numeric integrity, privacy and accurate usage accounting.
- Currency formatting, recipient presentation and whole-token numeric validation live in a browser-safe shared module; extraction stores printed currency and PNR, and message versions only upgrade untouched unsent drafts on explicit request — why: consistent exact formatting without inventing details or overwriting user decisions.
- Message presentation rehydrates refund routing from saved promise bank references and keeps invoice issuer selection separate; a shared request helper and draft guard enforce one exact ask — why: stale display names or AI prose must not mix merchant and bank instructions.
- Invoice/price-list mode: item-level rows carry order_no, tax_amount (order level), total_amount; bills carry printed orders_subtotal and sales_tax; matching, quantity ("(x2)", bilateral teeth), comparability (+Alloy/N/A/range/no price) and below-list notes all live in src/lib/comparison.ts as pure functions with tests — why: all maths and matching must be deterministic code, never AI.
- Password reset lives on a public route (src/routes/reset-password.tsx) that only offers a new-password form when the browser arrived from a link marked type=recovery, and saving sends just the new password — why: recovery sessions must not ask for the old one, and a bare visit must not look like a successful reset.

- Invoice matching checks fixed name aliases before fuzzy scoring, using saved contract prices; staged dispositions and distinct-order tax reconciliation stay in shared pure comparison helpers; invoice-results owns exclusive buckets, Decimal summaries and a deterministic combined review draft — why: summaries and messages must use identical exact facts without changing refund rules or inventing contract prices.
- Existing confirmed lab snapshots are refreshed from saved confirmed rows using their saved match overrides and comparison date, never from uploads or AI; untouched review drafts refresh from current review findings and attach once to the first unmatched line — why: older checks receive corrected results and messages without re-extraction or overwriting user-edited/sent messages.
- Dandy price-list parsing retains section prefixes and section markers in notes, with versioned owner-scoped caches; matching strips only those generated prefixes and nearest-name suggestions never select a price — why: section counts and workflow distinctions remain inspectable without contaminating calculations or messages.
