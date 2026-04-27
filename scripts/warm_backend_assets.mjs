import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const rocomPath = path.join(root, 'backend/internal/data/static/rocom-world.json')

const requestedBaseURL = process.env.DKTOOL_BASE_URL?.replace(/\/$/, '') || ''
const allowPreview = /^(1|true|yes|on)$/i.test(process.env.DKTOOL_ALLOW_PREVIEW_WARM || '')
const includeRocomDetailImages = /^(1|true|yes|on)$/i.test(process.env.DKTOOL_WARM_DETAIL_IMAGES || '')
const enableTileCoverage = /^(1|true|yes|on)$/i.test(process.env.DKTOOL_WARM_TILE_COVERAGE || '')
const skipDirectAssets = /^(1|true|yes|on)$/i.test(process.env.DKTOOL_WARM_SKIP_DIRECT_ASSETS || '')
const warmSettleMs = Number(process.env.DKTOOL_WARM_TILE_SETTLE_MS || 180)
const virtualTimeBudget = Number(process.env.DKTOOL_WARM_VIRTUAL_TIME_BUDGET || 5000)
const scopes = normalizeScopes(process.argv.slice(2))

function normalizeScopes(rawScopes) {
  if (!rawScopes.length) {
    return new Set(['all'])
  }

  const values = rawScopes
    .flatMap((item) => item.split(','))
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)

  return new Set(values.length ? values : ['all'])
}

function includesScope(scope) {
  return scopes.has('all') || scopes.has(scope)
}

function buildInitialRocomTileKeys() {
  const keys = []

  for (let y = 2035; y <= 2044; y += 1) {
    for (let x = 2036; x <= 2045; x += 1) {
      keys.push(`/api/assets/tile/rocom/4010_v3_7f2d9c/12/${y}_${x}.png`)
    }
  }

  for (let y = 1017; y <= 1022; y += 1) {
    for (let x = 1017; x <= 1022; x += 1) {
      keys.push(`/api/assets/tile/rocom/4010_v3_7f2d9c/11/${y}_${x}.png`)
    }
  }

  return keys
}

function buildRocomIconKeys(payload) {
  const keys = new Set()

  for (const group of payload.map?.layerGroups ?? []) {
    for (const layer of group.layers ?? []) {
      if (layer.icon?.startsWith('/api/assets/')) {
        keys.add(layer.icon)
      }
    }
  }

  for (const point of payload.map?.points ?? []) {
    if (point.layerIcon?.startsWith('/api/assets/')) {
      keys.add(point.layerIcon)
    }
  }

  return [...keys]
}

function buildRocomDetailImageKeys(payload) {
  const keys = new Set()

  for (const point of payload.map?.points ?? []) {
    for (const imageURL of point.imageUrls ?? []) {
      const normalized = proxyRocomImageURL(imageURL)
      if (normalized) {
        keys.add(normalized)
      }
    }
  }

  return [...keys]
}

function proxyRocomImageURL(sourceURL) {
  if (!sourceURL?.trim()) return ''
  return `/api/assets/image/rocom/${Buffer.from(sourceURL.trim()).toString('base64url')}`
}

async function fetchJSON(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`)
  }
  return response.json()
}

async function resolveBaseURL() {
  if (requestedBaseURL) {
    return assertWarmableBaseURL(requestedBaseURL)
  }

  const candidates = ['http://127.0.0.1:8080', 'http://127.0.0.1:4273', 'http://127.0.0.1:4173']
  let previewCandidate = ''

  for (const candidate of candidates) {
    try {
      const response = await fetch(`${candidate}/api/healthz`)
      if (!response.ok) continue
      const payload = await response.json()
      if (payload.mode === 'preview-shim' && payload.assetPersistence !== 'sqlite') {
        previewCandidate = candidate
        continue
      }
      return candidate
    } catch {
      // Try the next candidate.
    }
  }

  if (previewCandidate && allowPreview) {
    console.warn(`warning: ${previewCandidate} is preview-shim and will not persist warmed assets into SQLite`)
    return previewCandidate
  }

  if (previewCandidate) {
    throw new Error(`found only preview-shim at ${previewCandidate}; start the Go backend on :8080 or set DKTOOL_ALLOW_PREVIEW_WARM=1`)
  }

  return 'http://127.0.0.1:8080'
}

async function assertWarmableBaseURL(baseURL) {
  const payload = await fetchJSON(`${baseURL}/api/healthz`)
  if (payload.mode === 'preview-shim' && payload.assetPersistence !== 'sqlite' && !allowPreview) {
    throw new Error(`${baseURL} is preview-shim; warming there will not persist to SQLite. Start the Go backend or set DKTOOL_ALLOW_PREVIEW_WARM=1`)
  }
  if (payload.mode === 'preview-shim' && payload.assetPersistence !== 'sqlite') {
    console.warn(`warning: ${baseURL} is preview-shim and will not persist warmed assets into SQLite`)
  }
  return baseURL
}

function resolveChromeBinary() {
  const candidates = [
    process.env.DKTOOL_CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error('Chrome/Chromium binary not found; set DKTOOL_CHROME_BIN to a headless-capable browser executable')
}

function sanitizeLabel(value) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase()
}

async function warmBrowserRoute(chromeBin, route, screenshotDir) {
  const target = path.join(screenshotDir, `${sanitizeLabel(route.label)}.png`)
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=1440,900',
    `--virtual-time-budget=${virtualTimeBudget}`,
    `--screenshot=${target}`,
    route.url
  ]

  await execFileAsync(chromeBin, args, {
    timeout: Math.max(virtualTimeBudget + 15000, 20000),
    maxBuffer: 8 << 20
  })
}

async function warmAsset(baseURL, assetPath) {
  const response = await fetch(`${baseURL}${assetPath}`)
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }
  await response.arrayBuffer()
}

async function runPool(items, workerCount, worker) {
  const queue = [...items]
  const errors = []
  let completed = 0

  async function consume() {
    while (queue.length > 0) {
      const item = queue.shift()
      if (!item) return
      try {
        await worker(item)
        completed += 1
        if (completed % 10 === 0 || completed === items.length) {
          console.log(`warmed ${completed}/${items.length}`)
        }
      } catch (error) {
        errors.push({ item, error })
        console.error(`failed: ${typeof item === 'string' ? item : item.label} -> ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, workerCount) }, () => consume()))

  if (errors.length > 0) {
    process.exitCode = 1
  }
}

async function fetchAssetStats(baseURL) {
  try {
    return await fetchJSON(`${baseURL}/api/asset-stats`)
  } catch {
    return null
  }
}

async function collectExtractionRoutes(baseURL) {
  const payload = await fetchJSON(`${baseURL}/api/map-view?mode=extraction`)
  const routes = []

  for (const map of payload.maps ?? []) {
    const detail = await fetchJSON(`${baseURL}/api/map-view?mode=extraction&map=${map.slug}`)
    const variant = detail.currentVariant || detail.variants?.[0]?.slug || 'regular'
    const floors = detail.floors?.length ? detail.floors : [{ slug: 'all' }]
    for (const floor of floors) {
      const query = new URLSearchParams({
        mode: 'extraction',
        map: map.slug,
        variant,
        floor: floor.slug
      })
      if (enableTileCoverage) {
        query.set('warmTiles', '1')
        query.set('warmSettleMs', String(warmSettleMs))
      }
      routes.push({
        label: `extraction-${map.slug}-${floor.slug}`,
        url: `${baseURL}/?${query.toString()}`
      })
    }
  }

  return routes
}

async function collectWarfareRoutes(baseURL) {
  const payload = await fetchJSON(`${baseURL}/api/map-view?mode=warfare`)
  const routes = []

  for (const map of payload.maps ?? []) {
    const detail = await fetchJSON(`${baseURL}/api/map-view?mode=warfare&map=${map.slug}`)
    for (const variant of detail.variants ?? []) {
      const query = new URLSearchParams({
        mode: 'warfare',
        map: map.slug,
        variant: variant.slug
      })
      if (enableTileCoverage) {
        query.set('warmTiles', '1')
        query.set('warmSettleMs', String(warmSettleMs))
      }
      routes.push({
        label: `warfare-${map.slug}-${variant.slug}`,
        url: `${baseURL}/?${query.toString()}`
      })
    }
  }

  return routes
}

async function collectRocomRoutes(baseURL) {
  if (!enableTileCoverage) {
    return []
  }

  const query = new URLSearchParams({
    mode: 'rock-kingdom',
    map: 'shijie',
    warmTiles: '1',
    warmSettleMs: String(warmSettleMs)
  })

  return [
    {
      label: 'rocom-shijie-coverage',
      url: `${baseURL}/?${query.toString()}`
    }
  ]
}

async function collectRocomAssetPaths() {
  const payload = JSON.parse(readFileSync(rocomPath, 'utf8'))
  return [...new Set([
    ...buildRocomIconKeys(payload),
    ...buildInitialRocomTileKeys(),
    ...(includeRocomDetailImages ? buildRocomDetailImageKeys(payload) : [])
  ])]
}

async function main() {
  const baseURL = await resolveBaseURL()
  const chromeBin = resolveChromeBinary()
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'dktool-warm-'))

  try {
    const before = await fetchAssetStats(baseURL)
    if (before) {
      console.log(`assets before: ${before.count} items / ${before.totalBytes} bytes`)
    }

    const browserRoutes = []
    const directAssets = []

    if (includesScope('extraction')) {
      browserRoutes.push(...await collectExtractionRoutes(baseURL))
    }
    if (includesScope('warfare')) {
      browserRoutes.push(...await collectWarfareRoutes(baseURL))
    }
    if (includesScope('rocom')) {
      directAssets.push(...await collectRocomAssetPaths())
      browserRoutes.push(...await collectRocomRoutes(baseURL))
    }

    if (!skipDirectAssets && directAssets.length > 0) {
      console.log(`warming ${directAssets.length} direct asset requests`)
      await runPool(directAssets, 8, (assetPath) => warmAsset(baseURL, assetPath))
    }

    if (browserRoutes.length > 0) {
      console.log(`warming ${browserRoutes.length} browser routes via ${chromeBin}`)
      await runPool(browserRoutes, 1, (route) => warmBrowserRoute(chromeBin, route, tempDir))
    }

    const after = await fetchAssetStats(baseURL)
    if (after) {
      console.log(`assets after: ${after.count} items / ${after.totalBytes} bytes`)
      if (before) {
        console.log(`delta: +${after.count - before.count} items / +${after.totalBytes - before.totalBytes} bytes`)
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
