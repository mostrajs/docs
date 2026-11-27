import type { APIRoute, GetStaticPaths, InferGetStaticPropsType } from "astro"
import { buildOgImageResponse } from "@/components/og-image"
import { source } from "@/lib/source"

export const prerender = true

export const getStaticPaths = (() => {
  return source.getPages().map((page) => ({
    params: { slug: decodeURI(page.slugs.join("/")) || undefined },
    props: { page },
  }))
}) satisfies GetStaticPaths

export const GET: APIRoute<InferGetStaticPropsType<typeof getStaticPaths>> = ({
  props: { page },
}) =>
  buildOgImageResponse({
    eyebrow: "Documentation",
    title: page.data.title,
    description: page.data.description,
  })
