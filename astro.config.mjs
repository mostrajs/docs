// @ts-check
import { defineConfig } from "astro/config"
import tailwindcss from "@tailwindcss/vite"
import fumadocs from "@fumadocs/astro"

export default defineConfig({
  site: "https://mostrajs.com",
  // Each page is a file, docs/cms/fields.html, so that Netlify serves /docs/cms/fields as linked,
  // without redirecting it to a trailing slash.
  build: { format: "file" },
  integrations: [
    fumadocs({
      components: "./src/components/mdx.tsx",
      includeProcessedMarkdown: true,
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
})
