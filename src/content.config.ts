import { defineCollection } from "astro:content"
import { z } from "astro/zod"
import { metaLoader, pageLoader } from "@fumadocs/astro/loaders"
import { pageSchema } from "fumadocs-core/source/schema"

export const collections = {
  docs: defineCollection({
    loader: pageLoader(),
    // `source` is the file in mostrajs/cms a synced page comes from, for its "Edit on GitHub" link.
    schema: pageSchema.extend({ source: z.string().optional() }),
  }),
  meta: defineCollection({ loader: metaLoader() }),
}
