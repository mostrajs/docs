/**
 * Copies the CMS documentation from mostrajs/cms into content/docs/cms as MDX pages.
 *
 * The plugin's README and docs/ stay the one source of the text, written as GitHub Markdown. This
 * script turns each file into a page - the H1 becomes the title, the first sentence the description, a
 * folder of docs/ a folder of the sidebar - and carries what GitHub renders over to the site:
 * - relative links become site routes, or GitHub pages for files that are not docs pages;
 * - the images and videos they point at are copied to public/docs-assets/cms;
 * - GitHub alerts (`> [!NOTE]`) become callouts, and HTML comments are dropped;
 * - the HTML elements both render the same way are kept, and what MDX would read as syntax is escaped.
 *
 * It fails, writing nothing, when a link points at a missing file or heading, when a page holds HTML
 * the site does not render, or when two files become one route.
 *
 * Source, by precedence:
 * - CMS_DOCS_DIR: a local checkout of mostrajs/cms, to preview unreleased docs;
 * - CMS_DOCS_REF: a branch or tag to clone;
 * - otherwise the latest release tag, v<major>.<minor>.<patch>.
 *
 * Usage: node scripts/sync-docs.ts
 */
import { execFile } from "node:child_process"
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const REPOSITORY_URL = "https://github.com/mostrajs/cms"
const EDIT_BRANCH = "develop"
const DOCS_ROUTE = "/docs/cms"
const ASSETS_ROUTE = "/docs-assets/cms"
const RELEASE_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/
const README_DROPPED_SECTIONS = ["License", "Author"]
const GIT_TIMEOUT_MS = 60_000
const GIT_MAX_ATTEMPTS = 3
const GIT_RETRY_DELAY_MS = 2_000
const GIT_TRANSIENT_ERROR =
  /could not resolve host|timed out|connection (reset|refused)|early eof|rpc failed|returned error: (429|502|503|504)/i

/** The files a link may point at that are copied to the site rather than linked on GitHub. */
const MEDIA_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp4",
  ".png",
  ".svg",
  ".webm",
  ".webp",
])

/** The HTML elements a page may hold: the ones GitHub renders that the site renders the same way. */
const HTML_ELEMENTS = new Set([
  "a",
  "br",
  "details",
  "div",
  "img",
  "kbd",
  "p",
  "picture",
  "source",
  "sub",
  "summary",
  "sup",
  "video",
])
const VOID_HTML_ELEMENTS = new Set(["br", "img", "source"])

/** The HTML attributes a page may use, by their name in HTML, with their name in JSX. */
const HTML_ATTRIBUTES = new Map([
  ["align", "align"],
  ["alt", "alt"],
  ["autoplay", "autoPlay"],
  ["controls", "controls"],
  ["height", "height"],
  ["href", "href"],
  ["loop", "loop"],
  ["media", "media"],
  ["muted", "muted"],
  ["name", "name"],
  ["open", "open"],
  ["playsinline", "playsInline"],
  ["poster", "poster"],
  ["preload", "preload"],
  ["src", "src"],
  ["srcset", "srcSet"],
  ["title", "title"],
  ["type", "type"],
  ["width", "width"],
])
const LINK_ATTRIBUTES = new Set(["href", "poster", "src", "srcset"])

/** The Fumadocs callout type each GitHub alert becomes. */
const ALERT_CALLOUT_TYPES: Record<string, string> = {
  NOTE: "info",
  TIP: "idea",
  IMPORTANT: "info",
  WARNING: "warn",
  CAUTION: "error",
}

const CODE_SPAN_PATTERN = /(`+)[\s\S]*?\1/g
// A private-use character, which no docs page contains, marks a placeholder.
const PLACEHOLDER_PATTERN = /(\d+)/g
const LINK_PATTERN = /(!?\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g
const HTML_TAG_PATTERN =
  /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'=<>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g
const HTML_ATTRIBUTE_PATTERN =
  /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g
// What is left of a tag once every readable tag is taken out, such as one with an unquoted value.
const UNREADABLE_HTML_PATTERN = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?=[\s/>])/
const ALERT_PATTERN = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/

const ROOT_DIR = path.resolve(import.meta.dirname, "..")
const OUTPUT_DIR = path.join(ROOT_DIR, "content/docs/cms")
const ASSETS_DIR = path.join(ROOT_DIR, "public/docs-assets/cms")

const runFile = promisify(execFile)

/** One file of the source repository that becomes a page. */
type SourcePage = {
  /** The path in the source repository, such as `docs/guides/caching.md`. */
  sourcePath: string
  /** The page's file under content/docs/cms without its extension, such as `guides/caching`. */
  pagePath: string
  /** The page's title when its H1 is not the one to show. */
  title?: string
  /** The `## ` sections left out of the page. */
  droppedSections: string[]
  markdown: string
}

/** The route and the heading anchors of each page, by its source path. */
type PageIndex = Map<string, { route: string; anchors: Set<string> }>

/** A line of a page with its HTML comments taken out. */
type MarkdownLine = {
  text: string
  /** True for a line of a fenced code block, its fences included. */
  inFence: boolean
}

/** An HTML tag of a page's prose. */
type HtmlTag = {
  closing: boolean
  /** The element's name as written. */
  element: string
  attributes: { name: string; value?: string }[]
  selfClosing: boolean
}

/** A relative link of a page, resolved against the repository. */
type RepositoryLink = {
  href: string
  /** The repository path the link points at; the page itself for an anchor alone. */
  targetPath: string
  anchor?: string
  /** False for a link that is an anchor alone. */
  hasFile: boolean
}

/**
 * Tells whether a git failure is worth another attempt: a network error, a timeout, or a 429 or 5xx
 * answer.
 *
 * @param error - What the git call threw.
 * @returns True for a transient failure.
 */
function isTransientGitError(error: unknown): boolean {
  const failure = error as {
    killed?: boolean
    stderr?: string
    message?: string
  }
  return (
    Boolean(failure.killed) ||
    GIT_TRANSIENT_ERROR.test(`${failure.stderr ?? ""} ${failure.message ?? ""}`)
  )
}

/**
 * Runs git and returns its standard output, retrying a transient failure a bounded number of times.
 *
 * @param args - The git arguments.
 * @returns The command's standard output.
 */
async function fetchGitOutput(args: string[]): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { stdout } = await runFile("git", args, {
        timeout: GIT_TIMEOUT_MS,
        encoding: "utf8",
      })
      return stdout
    } catch (error) {
      if (attempt >= GIT_MAX_ATTEMPTS || !isTransientGitError(error)) {
        throw new Error(
          `git ${args[0]} of ${REPOSITORY_URL} failed after ${attempt} attempt(s)`,
          {
            cause: error,
          }
        )
      }
      await new Promise((resolve) =>
        setTimeout(resolve, GIT_RETRY_DELAY_MS * attempt)
      )
    }
  }
}

/**
 * Reads the release tags of the source repository and returns the highest version.
 *
 * @returns The latest release tag, such as `v0.1.0`.
 */
async function fetchLatestReleaseTag(): Promise<string> {
  const output = await fetchGitOutput([
    "ls-remote",
    "--tags",
    "--refs",
    `${REPOSITORY_URL}.git`,
  ])
  const releases = output
    .split("\n")
    .map((line) => line.split("refs/tags/")[1]?.trim())
    .flatMap((tag) => {
      const version = tag?.match(RELEASE_TAG_PATTERN)
      return version ? [{ tag: tag!, parts: version.slice(1).map(Number) }] : []
    })

  if (releases.length === 0) {
    throw new Error(
      `${REPOSITORY_URL} has no release tag matching v<major>.<minor>.<patch>`
    )
  }

  releases.sort((left, right) => {
    const index = left.parts.findIndex(
      (part, partIndex) => part !== right.parts[partIndex]
    )
    return index === -1 ? 0 : left.parts[index] - right.parts[index]
  })

  return releases.at(-1)!.tag
}

/**
 * Finds the source of the docs, cloning the repository when no local checkout is given.
 *
 * @returns The source directory, the ref its links point at, and a cleanup for a temporary clone.
 */
async function fetchSourceDir(): Promise<{
  dir: string
  ref: string
  cleanup: () => Promise<void>
}> {
  const localDir = process.env.CMS_DOCS_DIR
  if (localDir) {
    return {
      dir: path.resolve(localDir),
      ref: EDIT_BRANCH,
      cleanup: async () => {},
    }
  }

  const ref = process.env.CMS_DOCS_REF || (await fetchLatestReleaseTag())
  const dir = await mkdtemp(path.join(tmpdir(), "mostra-cms-docs-"))
  await fetchGitOutput([
    "clone",
    "--quiet",
    "--depth",
    "1",
    "--branch",
    ref,
    `${REPOSITORY_URL}.git`,
    dir,
  ])

  return { dir, ref, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

/**
 * Reads the README and every Markdown file of docs/, its subfolders included, from the source
 * directory.
 *
 * @param sourceDir - The root of a mostrajs/cms checkout.
 * @returns The pages, the README first.
 */
async function fetchSourcePages(sourceDir: string): Promise<SourcePage[]> {
  const docsDir = path.join(sourceDir, "docs")
  const docFiles = (await readdir(docsDir, { recursive: true }))
    .map((filePath) => filePath.split(path.sep).join("/"))
    .filter((filePath) => filePath.endsWith(".md"))
    .sort()

  const readme: SourcePage = {
    sourcePath: "README.md",
    pagePath: "index",
    title: "Overview",
    droppedSections: README_DROPPED_SECTIONS,
    markdown: await readFile(path.join(sourceDir, "README.md"), "utf8"),
  }

  const docs = await Promise.all(
    docFiles.map(async (filePath) => ({
      sourcePath: `docs/${filePath}`,
      pagePath: filePath.replace(/\.md$/, ""),
      droppedSections: [],
      markdown: await readFile(path.join(docsDir, filePath), "utf8"),
    }))
  )

  return [readme, ...docs]
}

/**
 * Reads the `pages` of a folder's meta.json under content/docs/cms.
 *
 * @param folder - The folder relative to content/docs/cms; empty for the root.
 * @returns The folder's pages, or undefined when it has no meta.json or the file lists no pages.
 */
async function fetchMetaPages(folder: string): Promise<string[] | undefined> {
  try {
    const meta = JSON.parse(
      await readFile(path.join(OUTPUT_DIR, folder, "meta.json"), "utf8")
    ) as { pages?: string[] }
    return meta.pages
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

/**
 * Finds the pages the sidebar leaves out: a page, or a folder above it, that a meta.json with
 * `pages` does not name. A folder without such a meta.json shows all its pages.
 *
 * @param pages - Every page of the run.
 * @returns The page paths left out of the sidebar.
 */
async function fetchUnlistedPages(pages: SourcePage[]): Promise<string[]> {
  const listed = await Promise.all(
    pages.map(async (page) => {
      const segments = page.pagePath.split("/")
      // A folder's index page is the folder's own link, so it is listed with the folder.
      if (segments.length > 1 && segments.at(-1) === "index") segments.pop()

      for (let depth = 0; depth < segments.length; depth++) {
        const metaPages = await fetchMetaPages(
          segments.slice(0, depth).join("/")
        )
        if (metaPages?.includes(`./${segments.slice(depth).join("/")}`))
          return true
        if (!isListedInMeta(segments[depth], metaPages)) return false
      }
      return true
    })
  )

  return pages
    .filter((_page, index) => !listed[index])
    .map((page) => page.pagePath)
}

/**
 * Tells whether a folder's meta.json shows one of its pages or subfolders, as Fumadocs reads `pages`.
 *
 * @param name - The page's file name without its extension, or the subfolder's name.
 * @param metaPages - The folder's `pages`; undefined when it lists none.
 * @returns True when the sidebar shows the item.
 */
function isListedInMeta(
  name: string,
  metaPages: string[] | undefined
): boolean {
  if (!metaPages) return true
  if (metaPages.includes(`!${name}`)) return false
  return metaPages.some(
    (entry) =>
      entry === name ||
      entry === `./${name}` ||
      entry === `...${name}` ||
      entry === "..." ||
      entry === "z...a"
  )
}

/**
 * Turns a page's path into its route on the site; an `index` page is its folder's route.
 *
 * @param pagePath - The page's file under content/docs/cms without its extension.
 * @returns The route, such as `/docs/cms/guides`.
 */
function formatPageRoute(pagePath: string): string {
  const slug = pagePath.replace(/(^|\/)index$/, "")
  return slug ? `${DOCS_ROUTE}/${slug}` : DOCS_ROUTE
}

/**
 * Tells whether a line opens or closes a fenced code block.
 *
 * @param line - A Markdown line.
 * @returns True for a line starting with three or more backticks.
 */
function isFenceLine(line: string): boolean {
  return /^\s*```/.test(line)
}

/**
 * Splits the inline code spans out of a line, leaving a numbered placeholder in place of each, so
 * that prose rules never touch code.
 *
 * @param line - A Markdown line outside a fenced block.
 * @returns The line with placeholders, and the text each placeholder stands for, in order.
 */
function splitCodeSpans(line: string): { prose: string; kept: string[] } {
  const kept: string[] = []
  const prose = line.replace(CODE_SPAN_PATTERN, (codeSpan) => {
    kept.push(codeSpan)
    return formatPlaceholder(kept.length - 1)
  })
  return { prose, kept }
}

/**
 * Formats the placeholder that stands for a kept piece of a line.
 *
 * @param index - The position of the piece in its line's kept list.
 * @returns The placeholder.
 */
function formatPlaceholder(index: number): string {
  return `${index}`
}

/**
 * Formats a line back from its placeholders, putting each kept piece where its placeholder is.
 *
 * @param prose - The line with placeholders.
 * @param kept - The pieces the placeholders stand for.
 * @returns The whole line.
 */
function formatMaskedLine(prose: string, kept: string[]): string {
  return prose.replace(
    PLACEHOLDER_PATTERN,
    (_placeholder, index: string) => kept[Number(index)]
  )
}

/**
 * Lists the lines of a page with its HTML comments taken out, as GitHub hides them, and marks the
 * lines of fenced code blocks.
 *
 * @param markdown - The page's Markdown.
 * @returns The lines; a line that held only a comment is left out.
 */
function listMarkdownLines(markdown: string): MarkdownLine[] {
  const lines: MarkdownLine[] = []
  let inFence = false
  let inComment = false

  for (const line of markdown.split("\n")) {
    if (!inComment && isFenceLine(line)) {
      inFence = !inFence
      lines.push({ text: line, inFence: true })
      continue
    }
    if (inFence) {
      lines.push({ text: line, inFence: true })
      continue
    }

    const { prose, kept } = splitCodeSpans(line)
    const hadComment = inComment || prose.includes("<!--")
    let uncommented = ""
    let rest = prose

    while (rest !== "") {
      const marker = inComment ? "-->" : "<!--"
      const markerIndex = rest.indexOf(marker)
      if (markerIndex === -1) {
        if (!inComment) uncommented += rest
        break
      }
      if (!inComment) uncommented += rest.slice(0, markerIndex)
      rest = rest.slice(markerIndex + marker.length)
      inComment = !inComment
    }

    if (hadComment && uncommented.trim() === "") continue
    lines.push({ text: formatMaskedLine(uncommented, kept), inFence: false })
  }

  return lines
}

/**
 * Lists the prose of a page: its lines outside fenced blocks, with the code spans masked.
 *
 * @param markdown - The page's Markdown.
 * @returns One string per line, placeholders in place of code spans.
 */
function listProseLines(markdown: string): string[] {
  return listMarkdownLines(markdown)
    .filter((line) => !line.inFence)
    .map((line) => splitCodeSpans(line.text).prose)
}

/**
 * Parses an HTML tag matched by HTML_TAG_PATTERN.
 *
 * @param groups - The match: the whole tag, the closing slash, the name, the attributes, the
 *   self-closing slash.
 * @returns The tag.
 */
function parseHtmlTag(groups: string[]): HtmlTag {
  return {
    closing: groups[1] === "/",
    element: groups[2],
    attributes: [...groups[3].matchAll(HTML_ATTRIBUTE_PATTERN)].map(
      (attribute) => ({
        name: attribute[1].toLowerCase(),
        value: attribute[2] ?? attribute[3],
      })
    ),
    selfClosing: groups[4] === "/",
  }
}

/**
 * Splits a `srcset` value into its candidates.
 *
 * @param srcset - The attribute's value, such as `a.png 1x, a@2x.png 2x`.
 * @returns Each candidate's URL and its descriptor, empty when it has none.
 */
function splitSrcset(srcset: string): { url: string; descriptor: string }[] {
  return srcset
    .split(",")
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== "")
    .map((candidate) => {
      const [url, ...descriptor] = candidate.split(/\s+/)
      return { url, descriptor: descriptor.join(" ") }
    })
}

/**
 * Lists the link targets of a page, outside code: Markdown links and images, and the link attributes
 * of its HTML.
 *
 * @param markdown - The page's Markdown.
 * @returns The targets as written in the source.
 */
function listLinkTargets(markdown: string): string[] {
  return listProseLines(markdown).flatMap((prose) => [
    ...[...prose.matchAll(LINK_PATTERN)].map((match) => match[2]),
    ...[...prose.matchAll(HTML_TAG_PATTERN)].flatMap((match) =>
      parseHtmlTag(match).attributes.flatMap((attribute) => {
        if (!LINK_ATTRIBUTES.has(attribute.name) || !attribute.value) return []
        return attribute.name === "srcset"
          ? splitSrcset(attribute.value).map((candidate) => candidate.url)
          : [attribute.value]
      })
    ),
  ])
}

/**
 * Turns inline Markdown into the plain text a reader sees.
 *
 * @param markdown - Inline Markdown, such as a heading's text.
 * @returns The text without links, code marks and emphasis.
 */
function formatPlainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+/g, "")
    .replace(/\*\*|__/g, "")
    .trim()
}

/**
 * Turns a heading's text into its anchor, as github-slugger does for Fumadocs and GitHub.
 *
 * @param headingText - The heading's inline Markdown, without the leading `#`.
 * @returns The anchor without the `#`.
 */
function formatHeadingSlug(headingText: string): string {
  return formatPlainText(headingText)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-")
}

/**
 * Lists the anchors of every heading in a page, numbering repeats the way github-slugger does.
 *
 * @param markdown - The page's Markdown.
 * @returns The anchors, without the `#`.
 */
function listHeadingSlugs(markdown: string): Set<string> {
  const slugs = new Set<string>()
  const occurrences = new Map<string, number>()

  for (const line of listMarkdownLines(markdown)) {
    const heading = !line.inFence && line.text.match(/^#{1,6}\s+(.*)$/)
    if (!heading) continue

    const slug = formatHeadingSlug(heading[1])
    const count = occurrences.get(slug) ?? 0
    occurrences.set(slug, count + 1)
    slugs.add(count === 0 ? slug : `${slug}-${count}`)
  }

  return slugs
}

/**
 * Builds the index the links are checked and rewritten against: each source path with its route and
 * its anchors.
 *
 * @param pages - Every page of the run.
 * @returns The pages by their source path.
 */
function buildPageIndex(pages: SourcePage[]): PageIndex {
  return new Map(
    pages.map((page) => [
      page.sourcePath,
      {
        route: formatPageRoute(page.pagePath),
        anchors: listHeadingSlugs(page.markdown),
      },
    ])
  )
}

/**
 * Splits a relative link into the repository path it points at and its anchor. A link starting with
 * `/` is read from the repository's root, as GitHub reads it.
 *
 * @param href - The link's target as written in the source.
 * @param page - The page holding the link.
 * @returns The link resolved against the repository.
 */
function splitHref(href: string, page: SourcePage): RepositoryLink {
  const [filePart, anchor] = href.split("#") as [string, string | undefined]
  const filePath = normalizeHrefPath(filePart)
  const targetPath = !filePath
    ? page.sourcePath
    : filePath.startsWith("/")
      ? path.posix.normalize(filePath.slice(1))
      : path.posix.normalize(
          path.posix.join(path.posix.dirname(page.sourcePath), filePath)
        )
  return { href, targetPath, anchor, hasFile: filePath !== "" }
}

/**
 * Brings the file part of a link to the path it names, decoding escapes such as `%20`.
 *
 * @param filePart - The link's target before its anchor.
 * @returns The decoded path, or the text as written when it holds a malformed escape.
 */
function normalizeHrefPath(filePart: string): string {
  try {
    return decodeURI(filePart)
  } catch {
    return filePart
  }
}

/**
 * Tells whether a link target carries a scheme, such as `https:` or `mailto:`.
 *
 * @param href - The link's target.
 * @returns True for a link that leaves the repository.
 */
function isAbsoluteHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href)
}

/**
 * Tells whether a repository path is an image or a video the site serves itself.
 *
 * @param targetPath - A path in the source repository.
 * @returns True for a file with a media extension.
 */
function isMediaPath(targetPath: string): boolean {
  return MEDIA_EXTENSIONS.has(path.posix.extname(targetPath).toLowerCase())
}

/**
 * Lists the links of a page that stay in the repository, resolved against it.
 *
 * @param page - The source page.
 * @returns The relative links, in their order.
 */
function listRepositoryLinks(page: SourcePage): RepositoryLink[] {
  return listLinkTargets(page.markdown)
    .filter((href) => !isAbsoluteHref(href))
    .map((href) => splitHref(href, page))
}

/**
 * Lists the images and videos the pages point at, which the site copies.
 *
 * @param pages - Every page of the run.
 * @returns The repository paths of the media files, each once.
 */
function listMediaPaths(pages: SourcePage[]): string[] {
  return [
    ...new Set(
      pages.flatMap((page) =>
        listRepositoryLinks(page)
          .filter((link) => link.hasFile && isMediaPath(link.targetPath))
          .map((link) => link.targetPath)
      )
    ),
  ]
}

/**
 * Finds which of the files the pages link to exist in the source directory.
 *
 * @param sourceDir - The root of a mostrajs/cms checkout.
 * @param pages - Every page of the run.
 * @returns The repository paths that exist; a path outside the repository never does.
 */
async function fetchExistingPaths(
  sourceDir: string,
  pages: SourcePage[]
): Promise<Set<string>> {
  const targetPaths = new Set(
    pages.flatMap((page) =>
      listRepositoryLinks(page)
        .filter((link) => link.hasFile)
        .map((link) => link.targetPath)
    )
  )

  const existing = await Promise.all(
    [...targetPaths].map(async (targetPath) => {
      if (targetPath === ".." || targetPath.startsWith("../")) return undefined
      try {
        await stat(path.join(sourceDir, targetPath))
        return targetPath
      } catch {
        return undefined
      }
    })
  )

  return new Set(existing.filter((targetPath) => targetPath !== undefined))
}

/**
 * Finds the links of a page that point at a file the repository does not have, or at a heading its
 * target page does not have.
 *
 * @param page - The source page.
 * @param pageIndex - Every page by its source path.
 * @param existingPaths - The linked repository paths that exist.
 * @returns One message per broken link, empty when every link resolves.
 */
function findBrokenLinks(
  page: SourcePage,
  pageIndex: PageIndex,
  existingPaths: Set<string>
): string[] {
  return listRepositoryLinks(page).flatMap((link) => {
    const target = pageIndex.get(link.targetPath)
    if (link.hasFile && !target && !existingPaths.has(link.targetPath)) {
      return [
        `${page.sourcePath}: "${link.href}" points at no file of the repository`,
      ]
    }
    if (target && link.anchor && !target.anchors.has(link.anchor)) {
      return [
        `${page.sourcePath}: "${link.href}" points at no heading of ${link.targetPath}`,
      ]
    }
    return []
  })
}

/**
 * Finds the HTML of a page the site does not carry over: an element or an attribute outside the
 * allowed lists, or a tag the sync cannot read.
 *
 * @param page - The source page.
 * @returns One message per problem, empty when every tag is carried over.
 */
function findHtmlProblems(page: SourcePage): string[] {
  return listProseLines(page.markdown).flatMap((prose) => {
    const tagProblems = [...prose.matchAll(HTML_TAG_PATTERN)]
      .map(parseHtmlTag)
      .filter((tag) => !tag.closing)
      .flatMap((tag) => [
        ...(HTML_ELEMENTS.has(tag.element.toLowerCase())
          ? []
          : [
              `${page.sourcePath}: <${tag.element}> is no HTML element the site renders; put it in a code span`,
            ]),
        ...tag.attributes
          .filter((attribute) => !HTML_ATTRIBUTES.has(attribute.name))
          .map(
            (attribute) =>
              `${page.sourcePath}: the ${attribute.name} attribute of <${tag.element}> is not carried to the site`
          ),
      ])
    const unreadable = prose
      .replace(HTML_TAG_PATTERN, "")
      .match(UNREADABLE_HTML_PATTERN)

    return unreadable
      ? [
          ...tagProblems,
          `${page.sourcePath}: "${unreadable[0]}" opens a tag the sync cannot read; quote its attribute values`,
        ]
      : tagProblems
  })
}

/**
 * Finds the files that would become the same route, such as `docs/guides.md` and
 * `docs/guides/index.md`.
 *
 * @param pages - Every page of the run.
 * @returns One message per shared route, empty when every route is unique.
 */
function findRouteCollisions(pages: SourcePage[]): string[] {
  const sourcePathsByRoute = new Map<string, string[]>()
  for (const page of pages) {
    const route = formatPageRoute(page.pagePath)
    sourcePathsByRoute.set(route, [
      ...(sourcePathsByRoute.get(route) ?? []),
      page.sourcePath,
    ])
  }

  return [...sourcePathsByRoute]
    .filter(([, sourcePaths]) => sourcePaths.length > 1)
    .map(
      ([route, sourcePaths]) =>
        `${sourcePaths.join(" and ")} would both become ${route}`
    )
}

/**
 * Turns a link of a source page into the link the site serves: a docs page becomes its route, an
 * image or a video its copy on the site, any other file of the repository its page on GitHub.
 *
 * @param href - The link's target as written in the source.
 * @param page - The page holding the link.
 * @param pageIndex - Every page by its source path.
 * @param sourceRef - The branch or tag the files came from.
 * @returns The target for the site.
 */
function prepareHref(
  href: string,
  page: SourcePage,
  pageIndex: PageIndex,
  sourceRef: string
): string {
  if (isAbsoluteHref(href)) return href

  const { targetPath, anchor, hasFile } = splitHref(href, page)
  if (!hasFile) return href
  if (isMediaPath(targetPath)) return encodeURI(`${ASSETS_ROUTE}/${targetPath}`)

  const suffix = anchor ? `#${anchor}` : ""
  const target = pageIndex.get(targetPath)
  return target
    ? `${target.route}${suffix}`
    : `${REPOSITORY_URL}/blob/${sourceRef}/${encodeURI(targetPath)}${suffix}`
}

/**
 * Prepares an HTML tag for MDX: its attributes under their JSX names, its links rewritten, and a void
 * element self-closed.
 *
 * @param tag - A tag whose element and attributes are allowed.
 * @param mapHref - Turns a link target into the site's.
 * @returns The tag as JSX; empty for the closing tag of a void element.
 */
function prepareHtmlTag(
  tag: HtmlTag,
  mapHref: (href: string) => string
): string {
  const element = tag.element.toLowerCase()
  const isVoid = VOID_HTML_ELEMENTS.has(element)
  if (tag.closing) return isVoid ? "" : `</${element}>`

  const attributes = tag.attributes.map((attribute) => {
    const name = HTML_ATTRIBUTES.get(attribute.name) ?? attribute.name
    if (attribute.value === undefined) return ` ${name}`

    const value = !LINK_ATTRIBUTES.has(attribute.name)
      ? attribute.value
      : attribute.name === "srcset"
        ? splitSrcset(attribute.value)
            .map((candidate) =>
              [mapHref(candidate.url), candidate.descriptor]
                .filter((part) => part !== "")
                .join(" ")
            )
            .join(", ")
        : mapHref(attribute.value)
    return value.includes('"') ? ` ${name}='${value}'` : ` ${name}="${value}"`
  })

  return `<${element}${attributes.join("")}${tag.selfClosing || isVoid ? " /" : ""}>`
}

/**
 * Makes prose safe for MDX by escaping the characters it reads as JSX or expressions.
 *
 * @param text - Prose outside code.
 * @returns The text with `{`, `}` and `<` escaped.
 */
function sanitizeMdxProse(text: string): string {
  return text.replace(/[{}<]/g, (character) => `\\${character}`)
}

/**
 * Prepares one line outside a fenced block for MDX: rewrites its links, turns its HTML into JSX and
 * escapes its prose, leaving its code spans as they are.
 *
 * @param line - A Markdown line.
 * @param mapHref - Turns a link target into the site's.
 * @returns The line for the MDX page.
 */
function prepareLine(line: string, mapHref: (href: string) => string): string {
  const { prose: codeless, kept } = splitCodeSpans(line)
  const prose = codeless.replace(HTML_TAG_PATTERN, (...groups: string[]) => {
    kept.push(prepareHtmlTag(parseHtmlTag(groups), mapHref))
    return formatPlaceholder(kept.length - 1)
  })
  let result = ""
  let lastIndex = 0

  for (const match of prose.matchAll(LINK_PATTERN)) {
    result += sanitizeMdxProse(prose.slice(lastIndex, match.index))
    result += `${sanitizeMdxProse(match[1])}${mapHref(match[2])}${match[3]}`
    lastIndex = match.index + match[0].length
  }
  result += sanitizeMdxProse(prose.slice(lastIndex))

  return formatMaskedLine(result, kept)
}

/**
 * Prepares the body of a page for MDX, line by line, turning each GitHub alert into a callout.
 *
 * @param lines - The page's lines.
 * @param mapHref - Turns a link target into the site's.
 * @returns The lines of the MDX body.
 */
function prepareBody(
  lines: MarkdownLine[],
  mapHref: (href: string) => string
): string[] {
  const body: string[] = []

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const alert = !line.inFence && line.text.match(ALERT_PATTERN)
    if (!alert) {
      body.push(line.inFence ? line.text : prepareLine(line.text, mapHref))
      continue
    }

    const quoted: string[] = []
    while (
      index + 1 < lines.length &&
      !lines[index + 1].inFence &&
      lines[index + 1].text.startsWith(">")
    ) {
      index++
      quoted.push(lines[index].text.replace(/^>\s?/, ""))
    }

    body.push(
      `<Callout type="${ALERT_CALLOUT_TYPES[alert[1]]}">`,
      "",
      ...prepareBody(listMarkdownLines(quoted.join("\n")), mapHref),
      "",
      "</Callout>"
    )
  }

  return body
}

/**
 * Splits a page into the text of its H1 and its other lines, without the sections it drops.
 *
 * @param page - The source page.
 * @returns The H1's text, empty when there is none, and the remaining lines.
 */
function splitTitle(page: SourcePage): {
  heading: string
  lines: MarkdownLine[]
} {
  const lines: MarkdownLine[] = []
  let heading = ""
  let dropping = false

  for (const line of listMarkdownLines(page.markdown)) {
    if (!line.inFence && !heading && /^#\s+/.test(line.text)) {
      heading = formatPlainText(line.text.replace(/^#\s+/, ""))
      continue
    }
    if (!line.inFence && /^##\s+/.test(line.text)) {
      dropping = page.droppedSections.includes(
        formatPlainText(line.text.replace(/^##\s+/, ""))
      )
    }
    if (!dropping) lines.push(line)
  }

  return { heading, lines }
}

/**
 * Finds the first sentence of a page's first paragraph of prose, for its description.
 *
 * @param lines - The page's lines without its H1.
 * @returns The sentence as plain text, or undefined when the page opens with no prose.
 */
function findDescription(lines: MarkdownLine[]): string | undefined {
  const paragraph = lines
    .map((line) => line.text)
    .join("\n")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find(
      (block) =>
        block !== "" &&
        !/^(#|```|\||[-*] |\d+\. |>|<)/.test(block) &&
        !/^`[^`]*`$/.test(block)
    )
  if (!paragraph) return undefined

  const text = formatPlainText(paragraph.replace(/\s*\n\s*/g, " "))
  return text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text
}

/**
 * Prepares the MDX file of a page: its front matter and its body.
 *
 * @param page - The source page.
 * @param pageIndex - Every page by its source path.
 * @param sourceRef - The branch or tag the files came from.
 * @returns The content of the MDX file.
 */
function preparePageFile(
  page: SourcePage,
  pageIndex: PageIndex,
  sourceRef: string
): string {
  const { heading, lines } = splitTitle(page)
  const description = findDescription(lines)
  const body = prepareBody(lines, (href) =>
    prepareHref(href, page, pageIndex, sourceRef)
  )

  const frontMatter = [
    "---",
    `title: ${JSON.stringify(page.title ?? heading)}`,
    ...(description ? [`description: ${JSON.stringify(description)}`] : []),
    `source: ${JSON.stringify(page.sourcePath)}`,
    "---",
  ]

  return `${[...frontMatter, ...body].join("\n").trimEnd()}\n`
}

/**
 * Finds what stops a page from being synced: a missing title, a broken link, or HTML the site does
 * not carry over.
 *
 * @param page - The source page.
 * @param pageIndex - Every page by its source path.
 * @param existingPaths - The linked repository paths that exist.
 * @returns One message per problem, empty when the page can be synced.
 */
function findPageProblems(
  page: SourcePage,
  pageIndex: PageIndex,
  existingPaths: Set<string>
): string[] {
  const missingTitle = !page.title && !splitTitle(page).heading
  return [
    ...(missingTitle
      ? [`${page.sourcePath}: has no H1 to take the title from`]
      : []),
    ...findBrokenLinks(page, pageIndex, existingPaths),
    ...findHtmlProblems(page),
  ]
}

/**
 * Syncs the pages and the media they show, then reports the pages the sidebar does not name. Writes
 * nothing when a page has a problem.
 */
async function main(): Promise<void> {
  const source = await fetchSourceDir()

  try {
    const pages = await fetchSourcePages(source.dir)
    const pageIndex = buildPageIndex(pages)
    const existingPaths = await fetchExistingPaths(source.dir, pages)
    const problems = [
      ...findRouteCollisions(pages),
      ...pages.flatMap((page) =>
        findPageProblems(page, pageIndex, existingPaths)
      ),
    ]

    if (problems.length > 0) {
      console.error(
        `sync-docs: ${problems.length} problem(s) in ${REPOSITORY_URL}@${source.ref}:`
      )
      for (const problem of problems) console.error(`  - ${problem}`)
      process.exitCode = 1
      return
    }

    await mkdir(OUTPUT_DIR, { recursive: true })
    for (const filePath of await readdir(OUTPUT_DIR, { recursive: true })) {
      if (filePath.endsWith(".mdx")) await rm(path.join(OUTPUT_DIR, filePath))
    }
    for (const page of pages) {
      const outputPath = path.join(OUTPUT_DIR, `${page.pagePath}.mdx`)
      await mkdir(path.dirname(outputPath), { recursive: true })
      await writeFile(outputPath, preparePageFile(page, pageIndex, source.ref))
    }

    const mediaPaths = listMediaPaths(pages)
    await rm(ASSETS_DIR, { recursive: true, force: true })
    for (const mediaPath of mediaPaths) {
      const outputPath = path.join(ASSETS_DIR, mediaPath)
      await mkdir(path.dirname(outputPath), { recursive: true })
      await copyFile(path.join(source.dir, mediaPath), outputPath)
    }

    const unlisted = await fetchUnlistedPages(pages)
    if (unlisted.length > 0) {
      console.warn(
        `sync-docs: not named by a meta.json of content/docs/cms, so not in the sidebar: ${unlisted.join(", ")}`
      )
    }

    console.log(
      `sync-docs: ${pages.length} pages and ${mediaPaths.length} media files from ${REPOSITORY_URL}@${source.ref}`
    )
  } finally {
    await source.cleanup()
  }
}

await main()
