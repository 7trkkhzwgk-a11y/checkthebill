# Confirmed checks and dispute messages
\n+# Message routing regression
- [ ] Correct refund recipients and exact single requests; keep vendor recipients separate.
- [ ] Re-test merchant refunds, bank refunds and vendor messages, including saved-result flow.
\n+# Confirmed checks and dispute messages
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
- [ ] Verify the signed-in result and saved message — blocked: no authorized session; requesting user's account could not be matched.