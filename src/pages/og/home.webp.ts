import type { APIRoute } from "astro"
import { buildOgImageResponse } from "@/components/og-image"
import { homeDescription } from "@/lib/shared"

export const prerender = true

export const GET: APIRoute = () =>
  buildOgImageResponse({
    eyebrow: "mostrajs.com",
    title: "CMS for Medusa.js",
    description: homeDescription,
  })
