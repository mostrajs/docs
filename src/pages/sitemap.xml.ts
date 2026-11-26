import type { APIRoute } from "astro"
import { source } from "@/lib/source"

export const prerender = true

/**
 * Formats one address of the sitemap, escaping what XML reads as markup.
 *
 * @param url - An absolute address of the site.
 * @returns The `<url>` entry.
 */
function formatSitemapEntry(url: string): string {
  const escaped = url.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  return `  <url><loc>${escaped}</loc></url>`
}

/**
 * Serves the sitemap search engines read: the home page and every docs page.
 *
 * @param context - The request context, whose `site` is the site's address from the Astro config.
 * @returns The sitemap as XML.
 */
export const GET: APIRoute = ({ site }) => {
  const routes = ["/", ...source.getPages().map((page) => page.url)]
  const entries = routes.map((route) =>
    formatSitemapEntry(new URL(route, site).href)
  )

  return new Response(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...entries,
      "</urlset>",
      "",
    ].join("\n"),
    { headers: { "Content-Type": "application/xml; charset=utf-8" } }
  )
}
