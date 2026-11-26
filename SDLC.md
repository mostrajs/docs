# Software delivery process

## Purpose

This file documents how work reaches `develop` and how `develop` reaches `mostrajs.com`. Humans read the
process here; the agent rules are in [AGENTS.md](AGENTS.md).

This repository runs the process **without autonomous agents**. No skill claims work, commits, or merges on
its own; every outward action is taken by a human or after explicit approval, per `Ask First` in
[AGENTS.md](AGENTS.md).

The site has no version of its own: nothing installs it, so there are no changesets, tags or releases. A
merge into `develop` is the release.

## Roles

- **Author** - the human or agent who writes the change.
- **Reviewer** - reads the diff before the commit. The rules in [CODE_REVIEW.md](CODE_REVIEW.md) apply
  whether the reviewer is a human or a skill.
- **Maintainer** - owns this document, and decides what is merged into `develop`.

## Work lifecycle

| Stage | What happens | Driven by | Done when |
|---|---|---|---|
| Shaping | An idea is talked through before anything is built. Non-trivial work gets a spec. | A human, `codee-spec-writing` | A decision, or a spec draft |
| Implement | On a topic branch, make the change and run the validation gate. | `codee-root-cause` for a bug | Gate passes |
| Verify | Open the PR's Netlify deploy preview and walk through the changed pages. | A human | Works on the preview |
| Review | Read the diff against [CODE_REVIEW.md](CODE_REVIEW.md) while it is still uncommitted. | A human, or a skill | No blocker left |
| Land | Commit on the topic branch and merge it into `develop` when asked. | A human | Merged and deployed |

## Landing a change

CI in `.github/workflows/ci.yml` runs the gate on every pull request into `develop`, and
`.github/workflows/pr-labeler.yml` labels it by its branch prefix (`.github/labeler.yml`).

Branches:

- `develop` - the default branch and the production branch on Netlify. There is no `main`.
- Topic branches - `feat/<name>`, `fix/<name>`, `refactor/<name>`, `chore/<name>`, `docs/<name>`,
  `deps/<name>`; the prefix gives the PR its label.

A topic branch reaches `develop` through a PR: `yarn pr:create` opens it, titled with the branch's first
commit subject - a conventional commit - and with `.ai/pr-description.md` from
`codee-generate-pr-description` as its body when it exists. The template in
`.github/PULL_REQUEST_TEMPLATE.md` asks for What, Why, How and Testing.

A change that renames files carries the rename in its own commit, before the content edits.

An agent commits only when the person asks it to, and says where the change went.

## Validation gate

Every change passes the full gate before it lands, in this order:

- `yarn lint`
- `yarn typecheck`
- `yarn format:check`
- `yarn build`

Any non-zero exit fails the gate and blocks the commit. The build is the gate's main check: it syncs the
CMS docs, fails on a link to a missing page or heading, and renders every page.

## Deploy

Netlify builds the site with `netlify.toml`:

1. **Every pull request** gets a deploy preview, a URL of its own, which the Verify stage uses.
2. **Every push to `develop`** - a merged PR - builds and publishes production.
3. **A release of mostrajs/cms** changes the docs without a change here. Until its release workflow calls
   the site's Netlify build hook, the maintainer starts the build by hand in Netlify, "Trigger deploy".

The docs always come from the latest release tag of mostrajs/cms (`scripts/sync-docs.ts`), so text merged
into its `develop` reaches the site only with its next release.

A broken deploy is rolled back in Netlify by publishing the previous deploy, then fixed in a PR.
