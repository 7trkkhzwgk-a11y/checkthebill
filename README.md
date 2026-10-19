# Checkthebill

Build "BillShield": an app that checks a bill against what was promised, flags the line that doesn't add up, and drafts one ready-to-send message.

1. Email login using Lovable Cloud. Every table has user_id. Row-level security on every table: a user can only see and edit their own rows.

2. "New check" page: upload two files (image or PDF):

   - BILL: card statement or vendor invoice

   - PROMISE: refund confirmation, contract, or agreed price list

   Save files in PRIVATE storage. Tables store only the file link.

3. On the server (never in the browser), send both files to AI with this instruction: "Extract every line as structured data only: date, description, amount, type (charge/credit), reference numbers, bank reference. Do not calculate anything." Before saving, mask card numbers, account numbers, phone numbers, addresses, personal names and patient names.

4. Show the extracted lines in an editable table titled "Check these lines". The user can fix any wrong value, then clicks "Looks right" to continue. Nothing is calculated before this click.

Tables:

- bills (id, user_id, issuer, file_link, uploaded_at)

- promises (id, user_id, bill_id, source, item, promised_amount, reference_no, bank_ref, promised_on, file_link)

- line_items (id, user_id, bill_id, date, description, amount, type, flagged, flag_reason)

- messages (id, user_id, line_id references line_items, sent_to, draft_text, final_text, words_changed, sent, sent_at)

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://checkthebill.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/be404924-c563-4a5b-beaa-ebdcf544021f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
