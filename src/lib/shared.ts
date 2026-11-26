import { createGetUrl } from "fumadocs-core/source"

export const appName = "Mostra"
export const docsRoute = "/docs"
/** The CMS docs, which every link to the docs opens: `/docs` itself only redirects here. */
export const cmsDocsRoute = `${docsRoute}/cms`
export const docsImageRoute = "/og/docs"

/** The repository the CMS docs are written in, and the branch their edits go to. */
export const cmsRepository = {
  url: "https://github.com/mostrajs/cms",
  editBranch: "develop",
}

const getImageUrl = createGetUrl(docsImageRoute)

/**
 * Builds the route of a docs page's Open Graph image.
 *
 * @param page - The page's slugs and locale.
 * @returns The route's segments and its URL.
 */
export function buildPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, "image.webp"]

  return { segments, url: getImageUrl(segments, page.locale) }
}
