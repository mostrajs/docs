import { readFileSync } from "node:fs"
import path from "node:path"
import { ImageResponse } from "takumi-js/response"

const BRAND_BLUE = "#1D4ED8"
const OG_WIDTH = 1200
const OG_HEIGHT = 630

// Read once at build: every image of the run shows the same wordmark.
const wordmark = `data:image/png;base64,${readFileSync(
  path.join(process.cwd(), "src/assets/mostra-wordmark.png")
).toString("base64")}`

export type OgImageProps = {
  /** The line over the title, such as `CMS docs`. */
  eyebrow: string
  title: string
  description?: string
}

/**
 * The link preview of a page: the Mostra wordmark on the brand blue, with the page's title and
 * description.
 *
 * @param props - What the image says.
 * @returns The image's element tree.
 */
export function OgImage({ eyebrow, title, description }: OgImageProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: "72px",
        backgroundColor: BRAND_BLUE,
        color: "white",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "28px" }}>
        <img src={wordmark} width={194} height={40} alt="Mostra" />
        <p
          style={{
            margin: 0,
            fontSize: "30px",
            color: "rgba(255,255,255,0.75)",
          }}
        >
          {eyebrow}
        </p>
      </div>
      <p
        style={{
          margin: 0,
          marginTop: "auto",
          fontSize: "84px",
          fontWeight: 800,
          lineHeight: 1.05,
        }}
      >
        {title}
      </p>
      {description && (
        <p
          style={{
            margin: 0,
            marginTop: "24px",
            fontSize: "38px",
            lineHeight: 1.3,
            color: "rgba(255,255,255,0.85)",
          }}
        >
          {description}
        </p>
      )}
    </div>
  )
}

/**
 * Renders a link preview as a WebP image of the size Open Graph expects.
 *
 * @param props - What the image says.
 * @returns The image response.
 */
export function buildOgImageResponse(props: OgImageProps): ImageResponse {
  return new ImageResponse(<OgImage {...props} />, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    format: "webp",
  })
}
