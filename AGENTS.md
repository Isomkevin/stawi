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
- Protected areas (/app, /coop, /direct) wrap their layout in RoleGate; in mock mode it auto-signs in the demo role so every screen is reviewable.
- Invoice UI shared between co-op and direct dashboards lives in src/features/shared (table, new-invoice sheet, detail view) to avoid drift.
- All reads go through queryOptions in src/lib/queries.ts so keys stay consistent across screens.
