/**
 * Markdown rendering for the preview tab: GFM (tables, task lists, strikethrough,
 * autolinks, footnotes), raw HTML disabled, the result sanitized, and relative
 * images resolved through the host's file API as blob URLs.
 */
import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'

const md = new MarkdownIt({
  html: false, // the source is untrusted; rendering raw HTML buys us nothing here
  linkify: true,
  breaks: false,
})
  .use(taskLists, { enabled: true, label: true })
  .use((instance) => {
    // External links open in a new tab and cannot reach back through window.opener.
    const render = instance.renderer.rules.link_open ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options))
    instance.renderer.rules.link_open = (tokens, index, options, env, self) => {
      const token = tokens[index]!
      const href = String(token.attrGet('href') ?? '')
      if (/^https?:/i.test(href)) {
        token.attrSet('target', '_blank')
        token.attrSet('rel', 'noreferrer noopener')
      }
      return render(tokens, index, options, env, self)
    }
  })

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(md.render(source), { ADD_ATTR: ['target'] })
}

function relative(url: string): boolean {
  return url !== '' && !/^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(url)
}

function resolvePath(baseDir: string, url: string): string {
  const parts = `${baseDir}/${url}`.split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (part === '..') stack.pop()
    else if (part !== '.' && part !== '') stack.push(part)
  }
  return stack.join('/')
}

/**
 * Replaces relative `<img src>` with blob URLs read through the host, so previews
 * show local images without exposing the filesystem. Failures leave the alt text.
 */
export async function resolveImages(
  container: HTMLElement,
  baseDir: string,
  readBytes: ((path: string) => Promise<Uint8Array | null>) | undefined,
): Promise<void> {
  if (readBytes === undefined) return
  /* One object URL per image, revoked when this container resolves again: an
     image blob lives as long as the document otherwise (tab switches leak). */
  const previous = (container as unknown as { __wbBlobUrls?: string[] }).__wbBlobUrls ?? []
  for (const url of previous) URL.revokeObjectURL(url)
  const created: string[] = []
  ;(container as unknown as { __wbBlobUrls?: string[] }).__wbBlobUrls = created
  const images = [...container.querySelectorAll('img')]
  await Promise.all(
    images.map(async (image) => {
      const source = image.getAttribute('src') ?? ''
      if (!relative(source)) return
      const bytes = await readBytes(resolvePath(baseDir, source)).catch(() => null)
      if (bytes === null || bytes === undefined) {
        image.replaceWith(Object.assign(document.createElement('span'), { textContent: `[${image.getAttribute('alt') ?? source}]`, className: 'wb-md-missing' }))
        return
      }
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      const type = source.toLowerCase().endsWith('.png') ? 'image/png' : source.toLowerCase().match(/\.jpe?g$/) ? 'image/jpeg' : 'application/octet-stream'
      const blobUrl = URL.createObjectURL(new Blob([copy], { type }))
      created.push(blobUrl)
      image.src = blobUrl
    }),
  )
}

/** Highlights fenced code blocks in place (shiki is async, so this runs post-render). */
export async function highlightCodeBlocks(container: HTMLElement, highlight: (lang: string, code: string) => Promise<string | null>): Promise<void> {
  const blocks = [...container.querySelectorAll('pre > code')]
  await Promise.all(
    blocks.map(async (block) => {
      const language = /language-([\w-]+)/.exec(block.className)?.[1]
      if (language === undefined) return
      const html = await highlight(language, block.textContent ?? '')
      if (html === null) return
      block.parentElement!.outerHTML = html
    }),
  )
}
