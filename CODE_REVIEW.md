# Code review

Review rules for this repository. They apply whether the reviewer is a human or a skill, and they sit on
top of, never instead of, the conventions skills named in the Skill Router in [AGENTS.md](AGENTS.md).

The stack under review: an Astro site with Fumadocs, React islands and Tailwind CSS, in TypeScript,
deployed statically on Netlify; its CMS docs synced from mostrajs/cms at build.

## Review priorities

Read the diff in this order. A finding high on the list outranks a finding lower down when review time is
short.

1. **Correctness against the spec.** For anything non-trivial there is a spec under `.ai/specs/`. Check the
   change against it, not against a guess at the intent.
2. **The docs source.** The text of the CMS docs belongs to mostrajs/cms; the site only renders it.
3. **What the visitor gets.** Pages that render, links that resolve, and no JavaScript a page does not need.
4. **Convention compliance.** TypeScript conventions and UI copy.
5. **Clarity.** Naming that states what a value represents; JSDoc where the conventions require it.

## Repo-specific checks

- **A file under `content/docs/cms/` other than a `meta.json`, or under `public/docs-assets/`, in the
  diff - blocker.** It is generated; the text and the media are fixed in mostrajs/cms.
- **A rule of the docs' Markdown that `scripts/sync-docs.ts` depends on, changed on one side only -
  blocker.** The rules are the table in [README.md](README.md), "What the sync reads"; a change to them
  lands with the matching change in `codee-medusa-plugin-docs`.
- **A React island on the landing page without interaction to justify it - major.** A section that only
  shows content is an `.astro` component.
- **A link to a route the site does not build - major.**
- **JSDoc discipline** per `codee-ts-code-conventions`.
- **UI copy** per `codee-ui-copy`.
- **English only** in code, comments, identifiers, documentation and the site's text.
- **Scope.** No refactors outside the task.
- **Secrets.** No build hook URL, token, or `.env` content in code, comments, or commit messages.

## The validation gate in review

A change is not reviewable as complete until the gate in [SDLC.md](SDLC.md) has been run and its result
reported. Naming a check that was not run, with the reason, is a complete answer. Silence is not.

## Severity

| Severity | Meaning | Effect |
|---|---|---|
| **Blocker** | A broken build or page, a check from the list above, a security defect, or a contradiction of an active spec | Request changes. |
| **Major** | A real defect a visitor meets, or a convention breach that will propagate | Request changes, unless the author states why it is deferred. |
| **Minor** | Naming, comment density, small clarity wins | Note it; does not hold the commit. |

When signals conflict, pick the higher severity and say why.

## Reporting a review

State what you actually checked and what you ran. A finding without a concrete failure path is a question,
not a finding.
