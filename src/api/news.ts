/**
 * The paddock's headlines, read from the publishers' own RSS feeds.
 *
 * RSS is XML, and none of these feeds send CORS headers, so the browser cannot
 * read them from the publishers directly. Every feed is therefore requested
 * from `/news/<id>`, which `vite.config.ts` proxies in development and
 * `vercel.json` proxies in production. That keeps the request same-origin and
 * means no third-party RSS-to-JSON service is needed: the XML is parsed here,
 * with the browser's own DOMParser.
 */

export interface NewsItem {
  /** Unique per story, so React keys survive a refetch. */
  key: string
  title: string
  url: string
  source: string
  /** Publication time in epoch milliseconds, or null when the feed omitted it. */
  published: number | null
  summary: string
}

interface NewsSource {
  /** Path segment under `/news`; mirrored by the two proxies. */
  id: string
  name: string
}

/**
 * The outlets the app reads. Each one is fetched over a single `/news/<id>`
 * path, so the client never names a third-party host and the proxies stay a
 * plain id-to-URL map.
 */
const NEWS_SOURCES: readonly NewsSource[] = [
  { id: 'autosport', name: 'Autosport' },
  { id: 'motorsport', name: 'Motorsport.com' },
  { id: 'racefans', name: 'RaceFans' },
  { id: 'bbc', name: 'BBC Sport' },
  { id: 'therace', name: 'The Race' },
]

const NEWS_BASE = (import.meta.env.VITE_NEWS_BASE as string | undefined) ?? '/news'

/** Headlines kept after merging — more than either view has room for. */
const MAX_ITEMS = 60

/** How long a merged list is reused before the feeds are read again. */
const CACHE_MS = 10 * 60 * 1000

const parser = new DOMParser()

/**
 * The first child with one of these local names. Feeds mix prefixes and cases
 * (`dc:date`, `content:encoded`), and the local name is the stable part.
 */
function child(element: Element, ...names: string[]): Element | null {
  for (const name of names) {
    for (const node of element.children) {
      if (node.localName === name) return node
    }
  }
  return null
}

function textOf(element: Element, ...names: string[]): string {
  return child(element, ...names)?.textContent?.trim() ?? ''
}

/**
 * Feed summaries carry markup — `<br>`, paragraphs, links, entities — so they
 * are run through the HTML parser and reduced to plain text. Block-level tags
 * become a space first, otherwise `</p><p>` would glue two sentences together,
 * and publishers' trailing calls to action are trimmed off.
 */
const BLOCK_TAGS =
  /<\/?(?:br|p|div|li|ul|ol|h[1-6]|blockquote|figure|figcaption|table|tr|td|section)\b[^>]*>/gi

function plainText(value: string): string {
  if (!value) return ''
  const stripped = value.replace(BLOCK_TAGS, ' ')
  const text = parser.parseFromString(stripped, 'text/html').body.textContent ?? ''
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*(?:keep reading|read more|continue reading)\.?$/i, '')
    .replace(/\s*the post .+? appeared first on .+?\.?$/i, '')
    .trim()
}

/** RSS puts the URL in the element, Atom in an `href` attribute. */
function linkOf(entry: Element): string {
  const link = child(entry, 'link')
  const href = link?.getAttribute('href') ?? link?.textContent?.trim() ?? ''
  if (href) return href

  const guid = child(entry, 'guid')
  return guid?.getAttribute('isPermaLink') === 'false' ? '' : (guid?.textContent?.trim() ?? '')
}

function itemsFrom(xml: string, source: NewsSource): NewsItem[] {
  const doc = parser.parseFromString(xml, 'application/xml')
  // An unparseable body means we were served an error page rather than a feed.
  if (doc.querySelector('parsererror')) return []

  // Every element is scanned by local name rather than by tag, so a feed that
  // namespaces its entries (Atom's `atom:entry`) is picked up too.
  const entries = [...doc.getElementsByTagName('*')].filter(
    (element) => element.localName === 'item' || element.localName === 'entry',
  )

  return entries.flatMap((entry) => {
    const title = plainText(textOf(entry, 'title'))
    const url = linkOf(entry)
    if (!title || !url) return []

    const published = Date.parse(textOf(entry, 'pubDate', 'published', 'updated', 'date'))

    return [
      {
        key: `${source.id}:${url}`,
        title,
        url,
        source: source.name,
        published: Number.isNaN(published) ? null : published,
        summary: plainText(textOf(entry, 'description', 'summary', 'encoded', 'content')),
      },
    ]
  })
}

async function readFeed(source: NewsSource): Promise<NewsItem[]> {
  const response = await fetch(`${NEWS_BASE}/${source.id}`)
  if (!response.ok) throw new Error(`${source.name} returned status ${response.status}`)
  return itemsFrom(await response.text(), source)
}

/** Case and punctuation are noise when comparing two pieces of copy. */
function fingerprint(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** Below this length, a shared standfirst is a coincidence rather than a copy. */
const SYNDICATED_SUMMARY = 80

/**
 * Autosport and Motorsport.com are the same newsroom, and they run the same
 * story under two different headlines. A story is therefore identified by its
 * headline where that matches, and by its standfirst where it does not.
 */
function dedupe(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const keys = [fingerprint(item.title)]
    if (item.summary.length > SYNDICATED_SUMMARY) keys.push(`summary:${fingerprint(item.summary)}`)
    if (keys.some((key) => seen.has(key))) return false
    for (const key of keys) seen.add(key)
    return true
  })
}

function byNewest(a: NewsItem, b: NewsItem): number {
  return (b.published ?? 0) - (a.published ?? 0)
}

let cached: { at: number; items: NewsItem[] } | null = null
let inflight: Promise<NewsItem[]> | null = null

/**
 * Every source's latest headlines, merged and sorted newest first.
 *
 * The home panel and the full section show the same list at different lengths,
 * so the merged result is cached in memory and the in-flight promise is shared:
 * switching tabs must not re-read five feeds. That sharing is also why this
 * ignores the caller's AbortSignal — a component unmounting must not cancel the
 * load for the next one, or cache an empty list behind it.
 */
export function latestNews(): Promise<NewsItem[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.items)
  if (inflight) return inflight

  inflight = Promise.allSettled(NEWS_SOURCES.map(readFeed))
    .then((results) => {
      const reached = results.filter((result) => result.status === 'fulfilled')
      const items = dedupe(reached.flatMap((result) => result.value))
        .sort(byNewest)
        .slice(0, MAX_ITEMS)

      // One unreachable feed should not empty the panel, but all of them
      // failing is a real error, and worth a retry.
      if (items.length === 0) throw new Error('The news feeds could not be reached.')

      cached = { at: Date.now(), items }
      return items
    })
    .finally(() => {
      inflight = null
    })

  return inflight
}
