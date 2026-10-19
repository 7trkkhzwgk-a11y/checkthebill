# Fixed invoice aliases
- [x] Apply exact aliases before fuzzy matching, preserving quantities, included and staged rules.
- [x] Verify dispute item filtering with synthetic tests; refresh untouched saved review drafts; 125 tests pass and build OK.
- [x] Verify saved results while signed in: aliases for existing contract rows work, but the saved price list lacks both Signature workflow entries, so 11 wax-rim bundle lines remain review. Reconciliation remains correct; review draft excludes matched/staged/included lines.
- [ ] Resolve missing Signature workflow entries in the saved price list before claiming the real invoice matching fix complete.

# Groq migration
- [x] Move all document reading, drafts and chat to server-only Groq with requested models.
- [x] Read PDF text in code, batch text pages, render scans locally, and persist reusable price lists.
- [x] Add bounded rate-limit retries and per-check token usage on results; preserve deterministic rules.
- [x] 94 tests pass; browser verified four-page text batches, scan images and clear missing-key state.
- [x] Verify real Groq extraction, cache reuse, drafts, chat and saved token totals: refund mode read both files through Groq (4,196 tokens recorded), the code-read price list is cached and reused, and results show the saved total.

# Published invoice reading
- [x] Split lab invoice PDFs into single-page private uploads and sequential server requests with progress.
- [x] Extract and privately cache price lists separately; combine masked pages before saving the check.
- [x] Show step-specific failures; 90 tests pass and the saved ten-page invoice reads back with matching printed Orders subtotal.
- [x] Published update requested; published page reading verified through page 8, then stopped with the explicit insufficient-credit error on page 9. Preview completed all ten pages. Further live AI verification paused pending credit recovery or the requested Groq migration.

# Message routing regression
- [x] Correct refund recipients and exact single requests; keep vendor recipients separate.
- [x] Re-test merchant refunds, bank refunds and vendor messages: 84 tests passed; signed-in merchant draft generation/read-back and lab message verified. Bank saved recipient verified; its previously edited/declined draft was preserved.

# Confirmed checks and dispute messages
- [x] Save confirmed edits and run deterministic matching, maths, flagging and contact routing on the server.
- [x] Persist results and AI drafts; add sent/not-sending tracking and word-edit counts.
- [x] Add the results page and connect Looks right.
- [x] Test each matching rule and verify the signed-in confirmation-to-message flow.

# Result and message polish
- [x] Use actual contact names and currency formatting throughout results.
- [x] Generate subject-first concise messages with exact computed numbers and identifiers; preserve sent or edited messages.
- [x] Test currency and numeric integrity rules and verify the signed-in result/message flow.

# Extraction failure
- [x] Repair the required-but-nullable AI extraction schema without changing comparison or messages.
- [x] Return complete extraction results and show clear AI/upload errors.
- [x] Test both-file requests and verify signed-in image/PDF uploads through review.

# Chat, history and navigation
- [x] Add Ask a question on the result page answering from saved computed facts only.
- [x] Add History page listing past checks with date, issuer, flag, missing amount and message status.
- [x] Add New check · History · Log out to the top navigation.

# Password reset
- [x] Add Forgot password on the sign-in page and a public reset-password page.
- [x] Test the reset link rules and verify the request, page states and save call.

# Lab invoice fixes
- [x] Preserve order references through review, results and messages.
- [x] Handle included items, grouped confirmations and crown material matching.
- [x] Show unmatched lines separately and top-level reconciliation.
- [x] Run rule tests and verify the signed-in review-to-result flow.

# Lab result summary and buckets
- [x] Count tax once per order and reconcile items, tax, credits and total.
- [x] Classify every item once; suppress all staged-item comparison maths.
- [x] Show calculated summary and collapsed buckets, with included items hidden initially.
- [x] Save one short billing-team message covering all unmatched review items.
- [x] Test the rules: 80 tests passed.
- [x] Verify the signed-in result and saved billing-team message, including exact items/tax/credits/total reconciliation.

# Code-only document reading
- [x] Detect Dandy lab invoices and price lists and parse item, credit and price rows in code — no AI call, no tokens.
- [x] Combine all text pages before parsing so a line wrapped across a page break is never lost.
- [x] Cache the code-read price list privately and reuse it; results show "Read by code – 0 AI tokens".
- [x] Test the parser rules: 110 tests passed.
- [x] Verify the signed-in ten-page invoice end to end: 120 lines, items/tax/credits/total reconciliation ✓, buckets correct, 0 AI tokens; refund mode still reads via AI and records its tokens.