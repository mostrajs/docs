# AGENTS.md

Operational guide for AI agents working in this repository.

This is the website of Mostra, `mostrajs.com`: the landing page and the documentation of the Mostra
packages, built with [Astro](https://astro.build) and [Fumadocs](https://fumadocs.dev). The text of the
CMS documentation is not written here: it lives in the README and `docs/` of
[mostrajs/cms](https://github.com/mostrajs/cms), and `scripts/sync-docs.ts` turns it into pages at every
build.

Rules are grouped by the authority they carry: `Always` is the default, `Ask First` needs the user's
explicit approval, `Never` has no exception. How a change lands and is deployed is in [SDLC.md](SDLC.md).

---

## Always

- **MUST check `git status`** before editing, and preserve existing user changes.
- **MUST match the task against every applicable row in the Skill Router.** A single task often maps to
  multiple rows; load them all and report any unavailable skill.
- **MUST write everything in English**: code, comments, variable names, documentation and the site's text.
- **MUST fix the text of a CMS docs page in mostrajs/cms**, in its README or `docs/`, following
  `codee-medusa-plugin-docs`. The pages under `content/docs/cms/` and the media under
  `public/docs-assets/` are generated; only the `meta.json` files, the sidebar's order and groups, belong
  to this repository. What the sync reads is [README.md](README.md), "What the sync reads".
- **MUST add a new page of `docs/` to the `meta.json` of its folder**, and a new folder of `docs/` to its
  parent's, with a `meta.json` of its own for its title. A page no `meta.json` names is built but left
  out of the sidebar; `yarn sync:docs` warns about it.
- **MUST check the Fumadocs docs before using its APIs.** They may differ from what you remember:
  - Writing pages: https://fumadocs.dev/docs/astro/markdown.md
  - Organizing pages and folders: https://fumadocs.dev/docs/astro/page-conventions.md
  - Customizing the UI: https://fumadocs.dev/docs/astro/guides/customize-ui.md
  - Theme and colors: https://fumadocs.dev/docs/ui/theme.md
  - Upgrading Fumadocs: https://fumadocs.dev/docs/astro/upgrade.md
  - Every other page: https://fumadocs.dev/llms.txt
- **MUST keep the landing page Astro.** A section is an `.astro` component that ships no JavaScript; a
  React island (`client:*`) is added only for what needs interaction in the browser.
- **MUST record non-obvious findings** as one kebab-case record in `.ai/lessons/` plus one row in the
  [.ai/lessons.md](.ai/lessons.md) catalog, per `codee-lessons`.
- **MUST commit a rename before the content change**, so git records it as `R` and not `RM`.
- **MUST keep one authoritative source per topic.** A rule is explained in full in one file; every other
  file carries the trigger and a link to it.

---

## Ask First

- **Before implementing anything.** Describing, analyzing, reviewing, and planning are the default. Create
  or edit files only after an explicit instruction to implement.
- **Before committing, pushing, or opening a PR.** Commit only when the user explicitly asks for it; one
  approved commit does not license the next. A merge into `develop` deploys to production (SDLC.md,
  "Deploy").
- **Before adding a dependency** of any kind.
- **Before changing mostrajs/cms**, such as its docs or its release workflow. It is another repository,
  with its own rules.

---

## Never

- **Never run `yarn install`, `yarn dev`, or another long-running or dependency-install command.** The user
  runs them; tell them what to run and what to check.
- **Never edit `content/docs/cms/**/*.mdx` or `public/docs-assets/`.** The next sync overwrites them.
- **Never put a secret in the repository**: a Netlify build hook URL, a token or an `.env` value.

---

## Validation Commands

| Check | Command |
|------|---------|
| Lint | `yarn lint` |
| Typecheck | `yarn typecheck` |
| Format | `yarn format:check` |
| Build, with the docs sync and its link check | `yarn build` |

`yarn sync:docs` alone syncs the docs from the latest release of mostrajs/cms. `CMS_DOCS_DIR=<path to a
checkout> yarn sync:docs` syncs them from a local checkout instead, to preview docs not released yet.

---

## Skill Router

Match every applicable row before acting. Use all listed skills; report any unavailable skill.

| Task | Skills |
|------|--------|
| Bug report, before proposing or writing a fix | `codee-root-cause` |
| TypeScript implementation or review, naming a function or a file, placing a helper | `codee-ts-code-conventions` |
| User-facing text on the site | `codee-ui-copy` |
| The text of a CMS docs page, in mostrajs/cms | `codee-medusa-plugin-docs`, `codee-technical-writing` |
| Write or restructure specifications | `codee-spec-writing` |
| Working notes | `codee-spec-notes` |
| Non-obvious finding worth recording, or looking one up | `codee-lessons` |
| Pull request description | `codee-generate-pr-description` |
| New agent skill | `codee-skill-creator` |
