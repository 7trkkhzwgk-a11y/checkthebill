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