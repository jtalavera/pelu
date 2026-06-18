---
description: Implement a user story end-to-end: branch, build, test, commit, push, PR. Accepts a path to an HU file or a plain-text feature description.
---

You are implementing a user story for the Femme/Pelu project. The argument passed to this skill is either:
- a file path to a user story file (e.g. `requirements/user_stories/HU-30-foo.md`), or
- a plain-text description of the feature to build.

Follow these steps exactly, in order:

## 1 - Read the requirements

If a file path was provided, read that file now and extract:
- The user story ID (e.g. `HU-30`)
- All acceptance criteria

If a plain-text description was provided, treat it as the full spec and derive a short slug for the branch name.

## 2 - Branch setup

```bash
git checkout main
git pull origin main
git checkout -b feat/<HU-ID>_<short-slug>
```

Use the user story ID and a 2-4 word kebab-case slug derived from the title (e.g. `feat/HU-30_new-feature`).

## 3 - Implement

Build the feature according to the acceptance criteria. Keep these project rules in mind:

**i18n (mandatory):** Every user-visible string - labels, buttons, placeholders, aria-label, confirmations, error messages - must use `t()` from `useTranslation()`. Add every new key to **both** `src/frontend/src/i18n/locales/en.json` and `es.json` before using it in JSX. Never hardcode copy.

**Backend errors:** Use `SCREAMING_SNAKE_CASE` error codes. Add translations under `femme.apiErrors.*` in both locale files. Translate with `translateApiError()` on the frontend.

**Logging:** Every REST endpoint must log at INFO on request (path, method, tenant) and on response (status). ERROR for non-2xx.

**Formatting:** After editing any Java file run `./gradlew spotlessApply --no-daemon`.

**Design system:** Use components from `src/frontend/design-system/components/` whenever possible. If new reusable UI logic is needed, propose adding it to the design system instead of implementing it inline.

**Tests:** Every acceptance criterion must be covered by a Playwright test in `e2e/`. If an existing Playwright test covers the modified feature, update it. If a criterion genuinely cannot be covered with Playwright, flag it and ask before proceeding.

## 4 - CI/CD checks (run before committing)

Run all of the following and fix any failures before moving on:

```bash
# Frontend
cd src/frontend && npx tsc --noEmit && npm run test

# Backend
cd src/backend && ./gradlew spotlessCheck --no-daemon && ./gradlew test --no-daemon
```

## 5 - Automated test
Every user story MUST have an automated test implemented in playwright that validates all the acceptance criteria.
If there are no explicit acceptance criteria, propose no more than 5 based on the requirement and existing standards in similar features.

Run the generated test, fix the implementation or the test code as needed. Itereate until it succedes

## 6 - Commit and push

Stage only the files changed for this story. Write a conventional-commit message:

```
feat(<HU-ID>): <imperative summary>

```

Then push:

```bash
git push -u origin feat/<HU-ID>_<short-slug>
```

## 7 - Open a PR

```bash
gh pr create \
  --base main \
  --title "feat(<HU-ID>): <summary>" \
  --body "..."
```

PR body must include:
- A **Summary** section (bullet list of what was built, referencing acceptance criteria)
- A **Test plan** section (checklist of manual + automated tests)
- The footer: Generated with Claude Code

Return the PR URL when done.
