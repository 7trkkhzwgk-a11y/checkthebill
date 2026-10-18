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
