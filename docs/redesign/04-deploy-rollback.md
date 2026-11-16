# Premium redesign — deployment & rollback

## Gate

Nothing reaches the live site before the owner writes, for the exact candidate
commit shown to them: **"מאשר למזג ולהעלות את העיצוב החדש לאתר החי"**.
Green tests are not approval. No auto-merge.

## After approval

1. Confirm the PR head is still the approved commit, and that `main` has not
   moved in a conflicting way (`git fetch origin main`, `git log origin/main`).
   If `main` moved: rebase/merge, re-run every check; a material visual or
   behavioural change goes back to the owner.
2. Required checks on the merge result: lint (cap 33), `tsc`, `npm test`,
   production build, browser regression suite, screenshot review.
3. Merge the PR the normal way (no force push, no bypass of protections).
   The push to `main` triggers `deploy-pages.yml` (build → Pages deploy).
4. Watch the workflow run to completion and the Pages deployment status
   (`gh api repos/orikenenb-lgtm/kerem-orders/deployments?environment=github-pages`
   → statuses → `success` for the merge commit). A green merge or build is not
   proof the site changed.
5. Non-destructive smoke test of the live site: home, catalogue, images,
   links, search, mobile view. Anything that writes (orders, signup, Rivhit)
   stays in the test environment unless the owner authorises a specific test.

## Rollback (redesign only)

Two levels, both affect only this redesign:

* **Colours only (fastest):** set `ff_premium_theme: false` in
  `landing/lib/featureFlags.ts`, commit to `main` → redeploy. The skin returns
  to the previous palette; the new component layouts stay.
* **Full rollback (recommended for any functional problem):**
  ```
  git fetch origin main
  git checkout -b revert-premium-redesign origin/main
  git revert -m 1 <MERGE_COMMIT>        # a merge commit
  #   or, for a squash merge:  git revert <SQUASH_COMMIT>
  git push -u origin revert-premium-redesign
  # open a PR, merge it the normal way → deploy-pages rebuilds main
  ```
  Then confirm the Pages deployment of the revert commit is `success` and
  re-run the live smoke test. Never force-push, never rewrite history, never
  restore a database (none was changed).

The redesign touches no database, function, secret or setting, so a code
revert fully restores the previous site.
