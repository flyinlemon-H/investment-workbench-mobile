# Discussion technical anchor guard

Rollback baseline: `8078ad793f27732ec6007f4f3f363bfa338292fc`.

The confirmed production class is a valid AI judgment for `600487.SS` with no
complete program-owned daily-bar anchor. Natural Discussion remains available.
Archive preparation now calls the same readiness helper used by import preview
and candidate preflight. It checks the daily-bar date, finite positive close,
explicit incomplete-bar flag, and program/reference date consistency.

Import can recognize a valid AI judgment while keeping Confirm disabled. An old
anchorless context is never updated with newly refreshed data: the user explicitly
starts a new Discussion and prepares its conclusion again. Final protected-context
hash comparison and complete persisted-state validation remain fail-closed.

The existing import status region is live and focusable. Failed confirmation
scrolls it into view and focuses it. Known anchor and protected-context errors
have Chinese messages; stale-tab wording remains distinct. Internal failure codes
remain on the commit error. A rejected preflight never calls saveCandidate; a
storage failure counts as an attempted save, not a proven physical write.

## Scope

Runtime edits are limited to `src/discussion-state-contract.js` and
`src/ui-render.js`. Current State schema, AI top-level/field allowlists,
technicalDataStatus input-only behavior, symbol/source-version binding, semantic
guards, program-owned dates/references, and history behavior remain unchanged.
Market universe, DailyMarketUpdate, StorageManager, Plan V2 Definition/Runtime,
PlanReview semantics, holdings, and Allocation are unchanged.

## Validation

- Focused Discussion, archive, UI, plan workflow and empty/multi-tab storage: 114/114.
- Plan foundation, compatibility, Definition, PlanReview, Discussion plan workflow,
  and empty-storage protection: 243/243.
- Full JavaScript: 625/625 (production baseline 612).
- Python: 18/18.
- Actual application browser acceptance: 1280x900 and 390x844.
- Browser cases: natural Discussion without anchor; early archive block; old-modal
  preview block; refresh/restart requirement; successful save and history; changed
  anchor rejection; generic storage failure; stale-tab feedback.
- Long preview content forces Confirm below the original status region. Failure
  brings the whole status message into the viewport without manual scrolling.
- Both viewports: no horizontal overflow and no page script errors.

Browser acceptance uses synthetic stocks in new browser contexts, blocks external
requests, and calls the real application handlers. It does not call DeepSeek,
write Supabase, or change a user's production Current State.

Reproduce with `node --test tests/*.test.js`,
`python -m unittest discover -s tests -p "test_*.py"`, and the loopback server
`python tests/serve_browser_acceptance.py`. With Playwright and Chrome configured,
run `node tests/discussion_anchor_browser_acceptance.cjs <evidence-directory>`.

Release uses separate source, asset-version, and manifest commits. Production push
requires explicit authorization; production read-only smoke follows authorization.
