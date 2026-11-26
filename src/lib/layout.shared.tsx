import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"
import { appName, cmsRepository } from "./shared"

/**
 * Builds the options the home and docs layouts share: the site's name and its GitHub link.
 *
 * @returns The shared layout options.
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: appName,
    },
    githubUrl: cmsRepository.url,
  }
}
