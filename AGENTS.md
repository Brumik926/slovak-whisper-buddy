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

- Live voice runs through a persistent WebSocket relay at `/api/live` (src/lib/live-relay.server.ts, dispatched in src/server.ts and live-vite-plugin.ts in dev); the relay verifies the signed-in owner from the token in `app.start` before opening a paid Gateway session — browser sockets cannot send auth headers.
- Single-owner access: the first signed-in account claims `allowed_owner` via `claim_owner()`; all RLS policies require `is_owner()` so other accounts see nothing.
- Learning happens in two places: live delegation tools (remember/search) in the relay, and `finishConversation` server fn that saves the transcript and extracts memories + summary after each call.
