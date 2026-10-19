# Contributing to Workroom

Small, focused contributions are welcome. Use Node.js 24 or newer and `npm ci`.
Run `npm run dev` for the browser and runtime together. Run `npm test` and
`npm run build` before submitting changes. Interface changes should also pass
`npm run test:e2e`; the README explains browser installation.

Keep credentials in an ignored `.env`, never in client code or fixtures. Commit
the lockfile when changing dependencies. Tests use temporary SQLite databases;
never point them at your own workspace database.

Keep demo behavior visibly labeled. Do not claim model calls, tool execution, or
deployment occurred unless the runtime performed it. Preserve human review gates
when adding backends. Format source with `npm run format`.

Before committing, configure a public display name and GitHub `noreply` email if
you want to keep personal details out of Git metadata. Inspect the author and
committer locally with `git log -1 --format=fuller` before pushing.
