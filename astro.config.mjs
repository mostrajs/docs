// @ts-check
import { defineConfig } from "astro/config"
import tailwindcss from "@tailwindcss/vite"
import fumadocs from "@fumadocs/astro"

export default defineConfig({
  site: "https://mostrajs.com",
  redirects: {
    "/docs": "/docs/cms",
  },
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
