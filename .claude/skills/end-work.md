# End Work

Finalize the release: update docs, bump version (once per session), build VSIX.

## Steps

1. Read `package.json` to get the current version
2. Run `git diff HEAD` to see what changed
3. Check `CHANGELOG.md` — if the top entry date is TODAY, version was already bumped this session → **skip steps 4-6, go straight to step 7**
4. Decide version bump based on changes:
   - **patch** (0.0.x) — bug fixes, small corrections
   - **minor** (0.x.0) — new features, new config options
   - **major** (x.0.0) — breaking changes
5. Update `"version"` in `package.json`
6. Add new entry at the top of `CHANGELOG.md` with today's date and a clear summary of actual changes. Update `README.md` if needed.
7. Run `npm run compile`
8. Run `npx vsce package`
9. Tell the user: current version, whether version was bumped or reused, and that the VSIX is ready