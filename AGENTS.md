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

## Lovable (frontend)

Leave the managed block above unchanged.

- Protected `/app`, `/coop`, and `/direct` layouts use `RoleGate`; mock mode auto-signs in the demo role.
- Shared invoice UI stays in `src/features/shared`; reads use `src/lib/queries.ts` query options.
- `/coop/shipments` uses API-backed list/detail state keyed by `?id=`; mock data remains available.
- Ask Stawi mounts once in the co-op layout as a floating modal so its conversation survives co-op navigation.
- Live mode comes from root `.env`; sessions are kept per browser tab.
- Lovable edits frontend files only, not `backend/` or `docs/`.

## Other coding agents

Backend/docs agents own `backend/` and `docs/`; see `CLAUDE.md` and `.cursorrules`. They must not edit the frontend.
