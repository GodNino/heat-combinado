# Learning reporting update (026)

Apply `026_consistent_learning_progress.sql` before deploying the matching UI. It is idempotent and changes reports only: no attempt, assignment, menu, membership or retake data is rewritten.

- Completion is the count of latest completed item quizzes across the current menu. Updated quizzes remain completed but require review.
- Accuracy is sum(correct) / sum(total) across those latest results. Uncompleted items are excluded; no results displays no accuracy, not 0%.
- Review means below 80% or the saved question snapshot differs from the current questions. Price/photo-only changes do not trigger review.
- `get_quiz_progress`, `team_member_progress` and `team_learning_roster` share the private `learning_results` helper.
- Team wrappers reuse the deployed `team_member_detail` and `team_roster` authorization. Production uses `can_manage(rid,'team')`; the original repository migrations use owner checks. This update preserves either configuration. The helper is not executable by authenticated or anonymous clients.
- Home, Progress and employee PDFs use `lib/learning.ts`; Team roster totals use the same answer-weighted rule in SQL.
- The new endpoints are additive; rolling back the UI does not require deleting stored data or functions. The original team endpoints remain available.

Validation: learning unit tests, PGlite reporting/authorization regressions, existing test suite, TypeScript/production build, and rendered employee PDF inspection. Prior navigation and allergy-PDF changes from master are preserved.
