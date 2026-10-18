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

- Document AI extraction runs only in server functions (src/lib/checks.functions.ts → extract.server.ts) and all text passes maskSensitive before saving — why: privacy rules require no AI calls or unmasked data from the browser.
- Uploaded files live in the private "documents" bucket under <user_id>/; tables store only the storage path — why: per-user storage RLS.
- Extraction schemas and normalization live in a browser-safe shared module used by the server persistence boundary — why: deterministic transaction filtering and identifier-safe masking must be independently testable.
- Extraction uses a strict required-but-nullable AI output schema and consumes the upstream stream privately before returning a complete DTO; capture upstream errors before output validation — why: optional schema fields are rejected and validation errors otherwise hide actionable service failures.
- Confirmations, comparisons, flags and message-state writes use authenticated server functions; comparison snapshots are persisted before drafting — why: no unconfirmed calculations, authoritative owner checks, and recoverable AI failures.
- Comparison arithmetic uses Decimal and an explicit UTC comparison date; pure comparison and word-edit functions have rule tests — why: exact monetary differences and reproducible day/word counts.
- AI message generation and result-page Q&A (ask.server.ts) use request-local server-only Responses helpers and receive a strict computed-facts projection, never document text — why: numeric integrity, privacy and gateway request correlation.
- Currency formatting, recipient presentation and whole-token numeric validation live in a browser-safe shared module; extraction stores printed currency and PNR, and message versions only upgrade untouched unsent drafts on explicit request — why: consistent exact formatting without inventing details or overwriting user decisions.
