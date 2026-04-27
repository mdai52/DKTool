import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const rocomPath = path.join(root, 'backend/internal/data/static/rocom-world.json')
const requestedBaseURL = process.env.DKTOOL_BASE_URL?.replace(/\/$/, '') || ''
const concurrency = Number(process.env.DKTOOL_WARM_CONCURRENCY || 8)
const includeDetailImages = /^(1|true|yes|on)$/i.test(process.env.DKTOOL_WARM_DETAIL_IMAGES || '')

function buildInitialTileKeys() {
  const keys = []

  // Leaflet + detectRetina will usually request z12 on high-DPI displays.
  for (let y = 2035; y <= 2044; y += 1) {
    for (let x = 2036; x <= 2045; x += 1) {
      keys.push(`/api/assets/tile/rocom/4010_v3_7f2d9c/12/${y}_${x}.png`)
    }
  }

  // Non-retina fallback for the same initial view.
  for (let y = 1017; y <= 1022; y += 1) {
    for (let x = 1017; x <= 1022; x += 1) {
      keys.push(`/api/assets/tile/rocom/4010_v3_7f2d9c/11/${y}_${x}.png`)
    }
  }

  return keys
}

function buildIconKeys(payload) {
  const iconKeys = new Set()

  for (const group of payload.map?.layerGroups ?? []) {
    for (const layer of group.layers ?? []) {
      if (layer.icon?.startsWith('/api/assets/')) {
        iconKeys.add(layer.icon)
      }
    }
  }

  for (const point of payload.map?.points ?? []) {
    if (point.layerIcon?.startsWith('/api/assets/')) {
      iconKeys.add(point.layerIcon)
    }
  }

  return [...iconKeys]
}

function buildDetailImageKeys(payload) {
  const imageKeys = new Set()

  for (const point of payload.map?.points ?? []) {
    for (const imageURL of point.imageUrls ?? []) {
      const normalized = proxyRocomImageURL(imageURL)
      if (normalized) {
        imageKeys.add(normalized)
      }
    }
  }

  return [...imageKeys]
}

function proxyRocomImageURL(sourceURL) {
  if (!sourceURL?.trim()) return ''
  return `/api/assets/image/rocom/${Buffer.from(sourceURL.trim()).toString('base64url')}`
}

async function warmAsset(baseURL, assetPath) {
  const response = await fetch(`${baseURL}${assetPath}`)
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }
  await response.arrayBuffer()
}

async function resolveBaseURL() {
  if (requestedBaseURL) {
    return requestedBaseURL
  }

  for (const candidate of ['http://127.0.0.1:8080', 'http://127.0.0.1:4273', 'http://127.0.0.1:4173']) {
    try {
      const response = await fetch(`${candidate}/api/healthz`)
      if (!response.ok) continue
      const payload = await response.json()
      if (payload.mode === 'preview-shim' && payload.assetPersistence !== 'sqlite') {
        console.warn(`warning: ${candidate} is preview-shim and will not persist warmed assets into SQLite`)
      }
      return candidate
    } catch {
      // Try the next candidate.
    }
  }

  return 'http://127.0.0.1:8080'
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
        if (completed % 25 === 0 || completed === items.length) {
          console.log(`warmed ${completed}/${items.length}`)
        }
      } catch (error) {
        errors.push({ item, error })
        console.error(`failed: ${item} -> ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, workerCount) }, () => consume()))

  if (errors.length > 0) {
    process.exitCode = 1
  }
}

async function main() {
  const payload = JSON.parse(readFileSync(rocomPath, 'utf8'))
  const baseURL = await resolveBaseURL()
  const assetPaths = [...new Set([
    ...buildIconKeys(payload),
    ...buildInitialTileKeys(),
    ...(includeDetailImages ? buildDetailImageKeys(payload) : [])
  ])]

  console.log(`warming ${assetPaths.length} rocom assets via ${baseURL}`)
  await runPool(assetPaths, concurrency, (assetPath) => warmAsset(baseURL, assetPath))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
