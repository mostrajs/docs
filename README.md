# mostrajs.com

The website of Mostra: the landing page and the documentation of the Mostra packages, built with
[Astro](https://astro.build) and [Fumadocs](https://fumadocs.dev), and deployed on Netlify.

## Where the docs come from

The text of the CMS docs is written in the README and `docs/` of
[mostrajs/cms](https://github.com/mostrajs/cms). `scripts/sync-docs.ts` copies it into
`content/docs/cms/` as MDX pages before every `yarn dev` and `yarn build`:

- by default from the latest release tag of mostrajs/cms;
- from a branch or tag with `CMS_DOCS_REF=<ref>`;
- from a local checkout with `CMS_DOCS_DIR=<path>`, to preview docs not released yet.

The sidebar's order and groups are the `meta.json` files under `content/docs/cms/`, which belong to this
repository; the pages next to them are generated and not committed.

### What the sync reads

The docs are GitHub Markdown, so they read the same on GitHub and on the site. The sync turns:

| In mostrajs/cms | On the site |
|---|---|
| `README.md` | The Overview page, without its License and Author sections |
| `docs/<page>.md` | `/docs/cms/<page>` |
| `docs/<folder>/<page>.md` | `/docs/cms/<folder>/<page>`, in a sidebar folder; `docs/<folder>/index.md` is the folder's own page |
| The H1 | The page's title |
| The first sentence of the first paragraph | The page's description, in its meta tags |
| A relative link to a docs page, with its anchor | The page's route |
| A relative link to an image or a video (`.png`, `.jpg`, `.gif`, `.webp`, `.avif`, `.svg`, `.mp4`, `.webm`, `.mov`) | A copy of the file under `/docs-assets/cms/` |
| A relative link to any other file of the repository | The file on GitHub, at the synced tag |
| A GitHub alert, `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]` | A callout |
| An HTML comment | Nothing, as on GitHub |
| HTML: `a`, `br`, `details`, `div`, `img`, `kbd`, `p`, `picture`, `source`, `sub`, `summary`, `sup`, `video`, with quoted attribute values | The same HTML |

A video goes in with `<video src="./media/demo.mp4" controls></video>`; Markdown has no syntax for one.

The sync fails, and writes nothing, on a link to a file or a heading that does not exist, on HTML
outside the list above (a component name in prose belongs in a code span), on an attribute such as
`class` or `style` that GitHub strips, and on two files that would become one route, such as
`docs/guides.md` and `docs/guides/index.md`. It warns about a page that no `meta.json` names, which is
built but left out of the sidebar.

## Development

```bash
corepack enable
yarn install
yarn dev
```

To preview the docs of a local checkout of mostrajs/cms next to this one:

```bash
CMS_DOCS_DIR=../medusa-plugin-cms yarn dev
```

## Contributing

- [SDLC.md](SDLC.md) - how a change lands and is deployed, and the validation gate.
- [CODE_REVIEW.md](CODE_REVIEW.md) - what a review checks and how severe a finding is.
- [AGENTS.md](AGENTS.md) - the rules AI agents follow here.
