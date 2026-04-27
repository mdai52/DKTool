import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMapViewFromDB, ensurePreviewDataReady } from './sqlite-map-store.mjs'
import { getCachedAsset, readAssetStats, saveCachedAsset } from './sqlite-asset-cache.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../backend/web/dist')
const port = Number(process.env.PORT || 4173)

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
}

const LOCAL_ASSET_PREFIX = '/api/assets/'
const FULL_MAP_WARM_TILE_BUDGET = 1800
const assetFetches = new Map()
const mapWarmStates = new Map()
const neighborWarmSeeds = new Set()
const transparentTileBody = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')

function sendJson(res, payload, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  })
  res.end(JSON.stringify(payload))
}

function sendAsset(res, contentType, body) {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': '*'
  })
  res.end(body)
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizeGeoTileSource(tileSource) {
  if (!tileSource || typeof tileSource !== 'object') return null
  if (tileSource.projection !== 'geo') return null
  if (typeof tileSource.urlTemplate !== 'string' || !tileSource.urlTemplate.startsWith(LOCAL_ASSET_PREFIX)) {
    return null
  }
  if (!tileSource.bounds) return null

  const source = structuredClone(tileSource)
  source.minZoom = Number.isFinite(source.minZoom) ? Math.round(source.minZoom) : 0
  source.maxNativeZoom = Number.isFinite(source.maxNativeZoom) ? Math.round(source.maxNativeZoom) : source.minZoom
  source.initZoom = Number.isFinite(source.initZoom) ? Math.round(source.initZoom) : source.minZoom
  source.initLat = Number.isFinite(source.initLat)
    ? source.initLat
    : (Number(source.bounds.north) + Number(source.bounds.south)) / 2
  source.initLng = Number.isFinite(source.initLng)
    ? source.initLng
    : (Number(source.bounds.west) + Number(source.bounds.east)) / 2

  return source
}

function clampLat(lat) {
  return clamp(lat, -85.05112878, 85.05112878)
}

function latLngToTile(lat, lng, zoom) {
  const normalizedLat = clampLat(lat)
  const n = 2 ** zoom
  const x = clamp(Math.floor(((lng + 180) / 360) * n), 0, n - 1)
  const latRad = (normalizedLat * Math.PI) / 180
  const y = clamp(
    Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n),
    0,
    n - 1
  )
  return { x, y }
}

function tileRangeFromBounds(bounds, zoom, padTiles = 0) {
  const northWest = latLngToTile(bounds.north, bounds.west, zoom)
  const southEast = latLngToTile(bounds.south, bounds.east, zoom)
  const limit = (2 ** zoom) - 1

  return {
    minX: clamp(Math.min(northWest.x, southEast.x) - padTiles, 0, limit),
    maxX: clamp(Math.max(northWest.x, southEast.x) + padTiles, 0, limit),
    minY: clamp(Math.min(northWest.y, southEast.y) - padTiles, 0, limit),
    maxY: clamp(Math.max(northWest.y, southEast.y) + padTiles, 0, limit)
  }
}

function tileRangeAroundCenter(source, zoom, padTiles) {
  const center = latLngToTile(source.initLat, source.initLng, zoom)
  const limit = (2 ** zoom) - 1

  return {
    minX: clamp(center.x - padTiles, 0, limit),
    maxX: clamp(center.x + padTiles, 0, limit),
    minY: clamp(center.y - padTiles, 0, limit),
    maxY: clamp(center.y + padTiles, 0, limit)
  }
}

function intersectTileRanges(left, right) {
  const range = {
    minX: Math.max(left.minX, right.minX),
    maxX: Math.min(left.maxX, right.maxX),
    minY: Math.max(left.minY, right.minY),
    maxY: Math.min(left.maxY, right.maxY)
  }

  if (range.minX > range.maxX || range.minY > range.maxY) {
    return null
  }
  return range
}

function replaceTileTemplate(urlTemplate, zoom, x, y) {
  return urlTemplate
    .replaceAll('{z}', String(zoom))
    .replaceAll('{x}', String(x))
    .replaceAll('{y}', String(y))
}

function addTileRangeAssetKeys(assetKeys, source, zoom, range) {
  if (!range) return 0

  let count = 0
  for (let x = range.minX; x <= range.maxX; x += 1) {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      const assetKey = replaceTileTemplate(source.urlTemplate, zoom, x, y).replace(LOCAL_ASSET_PREFIX, '')
      if (!assetKeys.has(assetKey)) {
        assetKeys.add(assetKey)
        count += 1
      }
    }
  }
  return count
}

function collectInitialGeoAssetKeys(source) {
  const zoom = clamp(source.initZoom, source.minZoom, source.maxNativeZoom)
  const boundsRange = tileRangeFromBounds(source.bounds, zoom)
  const initialKeys = new Set()

  addTileRangeAssetKeys(initialKeys, source, zoom, intersectTileRanges(boundsRange, tileRangeAroundCenter(source, zoom, 2)))

  if (zoom > source.minZoom) {
    const lowerZoom = zoom - 1
    addTileRangeAssetKeys(
      initialKeys,
      source,
      lowerZoom,
      intersectTileRanges(tileRangeFromBounds(source.bounds, lowerZoom), tileRangeAroundCenter(source, lowerZoom, 1))
    )
  }

  return [...initialKeys]
}

function collectFullGeoAssetKeys(source) {
  const assetKeys = new Set()
  let total = 0

  for (let zoom = source.minZoom; zoom <= source.maxNativeZoom; zoom += 1) {
    const range = tileRangeFromBounds(source.bounds, zoom)
    total += addTileRangeAssetKeys(assetKeys, source, zoom, range)
  }

  return {
    assetKeys: [...assetKeys],
    total
  }
}

function collectBackgroundGeoAssetKeys(source) {
  const fullCoverage = collectFullGeoAssetKeys(source)
  if (fullCoverage.total <= FULL_MAP_WARM_TILE_BUDGET) {
    return fullCoverage.assetKeys
  }

  const focusKeys = new Set()
  const maxCoverageZoom = clamp(source.initZoom, source.minZoom, source.maxNativeZoom)
  for (let zoom = source.minZoom; zoom <= maxCoverageZoom; zoom += 1) {
    addTileRangeAssetKeys(focusKeys, source, zoom, tileRangeFromBounds(source.bounds, zoom))
  }
  addTileRangeAssetKeys(
    focusKeys,
    source,
    maxCoverageZoom,
    intersectTileRanges(
      tileRangeFromBounds(source.bounds, maxCoverageZoom),
      tileRangeAroundCenter(source, maxCoverageZoom, 3)
    )
  )

  return [...focusKeys]
}

function resolvePreviewAsset(assetKey) {
  const parts = assetKey.split('/').filter(Boolean)
  if (parts[0] === 'tile' && parts[1] === 'delta-force' && parts.length === 5) {
    const [, , folder, zoom, file] = parts
    return {
      url: `https://game.gtimg.cn/images/dfm/cp/a20240729directory/img/${folder}/${zoom}_${file}`,
      contentType: 'image/jpeg'
    }
  }
  if (parts[0] === 'tile' && parts[1] === 'rocom' && parts.length === 5) {
    const [, , source, zoom, file] = parts
    return {
      url: `https://ue.17173cdn.com/a/terra/tiles/rocom/${source}/${zoom}/${file}?v1`,
      contentType: 'image/png'
    }
  }
  if (parts[0] === 'tile' && parts[1] === 'hkw' && parts.length === 5) {
    const [, , region, zoom, file] = parts
    return {
      url: `https://image.gamersky.com/webimg13/db/game_map/wangzherongyaoshijie/${region}/${zoom}/${file}`,
      contentType: 'image/webp'
    }
  }
  if (parts[0] === 'icon' && parts[1] === 'rocom' && parts.length === 3) {
    return {
      url: `https://ue.17173cdn.com/a/terra/icon/rocom/${parts[2]}`,
      contentType: 'image/png'
    }
  }
  if (parts[0] === 'image' && parts[1] === 'rocom' && parts.length === 3) {
    const sourceURL = decodeRocomImageSource(parts[2])
    if (!sourceURL) {
      return null
    }
    return {
      url: sourceURL,
      contentType: sourceURL.endsWith('.jpg') || sourceURL.endsWith('.jpeg') ? 'image/jpeg' : 'image/png'
    }
  }
  if (parts[0] === 'image' && parts[1] === 'gamersky' && parts.length === 3) {
    const sourceURL = decodeGamerskyImageSource(parts[2])
    if (!sourceURL) {
      return null
    }
    return {
      url: sourceURL,
      contentType: sourceURL.endsWith('.jpg') || sourceURL.endsWith('.jpeg') ? 'image/jpeg' : (sourceURL.endsWith('.webp') ? 'image/webp' : 'image/png')
    }
  }
  return null
}

function decodeRocomImageSource(encoded) {
  try {
    const sourceURL = Buffer.from(encoded, 'base64url').toString('utf8').trim()
    const parsed = new URL(sourceURL)
    if (parsed.protocol !== 'https:') return ''
    if (parsed.hostname !== '17173cdn.com' && !parsed.hostname.endsWith('.17173cdn.com')) return ''
    return sourceURL
  } catch {
    return ''
  }
}

function decodeGamerskyImageSource(encoded) {
  try {
    const sourceURL = Buffer.from(encoded, 'base64url').toString('utf8').trim()
    const parsed = new URL(sourceURL)
    if (parsed.protocol !== 'https:') return ''
    if (parsed.hostname !== 'gamersky.com' && !parsed.hostname.endsWith('.gamersky.com')) return ''
    return sourceURL
  } catch {
    return ''
  }
}

async function bootstrapPreviewAsset(assetKey) {
  try {
    const cached = await getCachedAsset(assetKey)
    if (cached) {
      return cached
    }
  } catch (error) {
    console.error(`sqlite cache read failed for ${assetKey}:`, error)
  }

  if (assetFetches.has(assetKey)) {
    return assetFetches.get(assetKey)
  }

  const promise = (async () => {
    const asset = resolvePreviewAsset(assetKey)
    if (!asset) {
      return null
    }

    const response = await fetch(asset.url, {
      headers: {
        'user-agent': 'DKTool Preview/0.1',
        accept: 'image/*,*/*'
      }
    })
    if (response.status === 404 && assetKey.startsWith('tile/')) {
      const contentType = 'image/gif'
      try {
        await saveCachedAsset(assetKey, asset.url, contentType, transparentTileBody)
      } catch (error) {
        console.error(`sqlite cache write failed for ${assetKey}:`, error)
      }
      return { contentType, body: transparentTileBody }
    }
    if (!response.ok) {
      throw new Error(`upstream asset failed: ${response.status}`)
    }

    const body = Buffer.from(await response.arrayBuffer())
    const contentType = response.headers.get('content-type') || asset.contentType

    try {
      await saveCachedAsset(assetKey, asset.url, contentType, body)
    } catch (error) {
      console.error(`sqlite cache write failed for ${assetKey}:`, error)
    }

    return { contentType, body }
  })()

  assetFetches.set(assetKey, promise)

  try {
    return await promise
  } finally {
    assetFetches.delete(assetKey)
  }
}

async function prewarmAssetKeys(assetKeys, concurrency = 6) {
  const queue = [...new Set(assetKeys)]
  let index = 0

  async function worker() {
    while (index < queue.length) {
      const nextIndex = index
      index += 1
      const assetKey = queue[nextIndex]

      try {
        await bootstrapPreviewAsset(assetKey)
      } catch (error) {
        console.error(`prewarm failed for ${assetKey}:`, error)
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, () => worker())
  )
}

function collectAdjacentTileAssetKeys(assetKey) {
  const parts = assetKey.split('/').filter(Boolean)
  if (parts[0] !== 'tile' || parts.length !== 5) {
    return []
  }

  const zoom = Number(parts[3])
  const extension = path.extname(parts[4])
  const stem = parts[4].slice(0, Math.max(0, parts[4].length - extension.length))
  const coords = stem.split('_').map((value) => Number(value))
  if (coords.length !== 2 || coords.some((value) => !Number.isFinite(value)) || !Number.isFinite(zoom)) {
    return []
  }

  const deltas = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ]

  return deltas.map(([dx, dy]) => {
    let fileName = ''
    if (parts[1] === 'rocom') {
      const [y, x] = coords
      fileName = `${y + dy}_${x + dx}${extension}`
    } else {
      const [x, y] = coords
      fileName = `${x + dx}_${y + dy}${extension}`
    }
    return ['tile', parts[1], parts[2], String(zoom), fileName].join('/')
  })
}

function queueAdjacentTileWarm(assetKey) {
  if (neighborWarmSeeds.has(assetKey)) {
    return
  }
  neighborWarmSeeds.add(assetKey)

  const adjacentKeys = collectAdjacentTileAssetKeys(assetKey)
  if (!adjacentKeys.length) {
    return
  }

  setTimeout(() => {
    prewarmAssetKeys(adjacentKeys, 2).catch((error) => {
      console.error(`adjacent warm failed for ${assetKey}:`, error)
    })
  }, 0)
}

async function maybePrimeMapAssets(view) {
  const source = normalizeGeoTileSource(view?.currentMap?.tileSource)
  if (!source) {
    return
  }

  const signature = `${view.currentMode?.slug || 'mode'}:${view.currentMap?.slug || 'map'}:${source.urlTemplate}`
  let state = mapWarmStates.get(signature)
  if (!state) {
    state = {
      initialPromise: null,
      backgroundPromise: null
    }
    mapWarmStates.set(signature, state)
  }

  if (!state.initialPromise) {
    const initialAssetKeys = collectInitialGeoAssetKeys(source)
    const initialSet = new Set(initialAssetKeys)
    const backgroundAssetKeys = collectBackgroundGeoAssetKeys(source).filter((assetKey) => !initialSet.has(assetKey))

    state.initialPromise = prewarmAssetKeys(initialAssetKeys, 4)
      .catch((error) => {
        console.error(`initial warm failed for ${signature}:`, error)
      })
      .finally(() => {
        if (!state.backgroundPromise && backgroundAssetKeys.length) {
          state.backgroundPromise = prewarmAssetKeys(backgroundAssetKeys, 6).catch((error) => {
            console.error(`background warm failed for ${signature}:`, error)
          })
        }
      })
  }

  await state.initialPromise
}

async function serveFile(res, target) {
  const extension = path.extname(target)
  const body = await readFile(target)
  res.writeHead(200, {
    'Content-Type': mimeTypes[extension] ?? 'application/octet-stream'
  })
  res.end(body)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  if (url.pathname === '/api/healthz') {
    sendJson(res, { status: 'ok', mode: 'preview-shim', assetPersistence: 'sqlite', dataPersistence: 'sqlite' })
    return
  }

  if (url.pathname === '/api/asset-stats') {
    try {
      const stats = await readAssetStats()
      sendJson(res, {
        count: stats.count,
        totalBytes: stats.totalBytes,
        bootstrapEnabled: true,
        mode: 'preview-shim',
        assetPersistence: 'sqlite'
      })
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : 'asset stats failed' }, 500)
    }
    return
  }

  if (url.pathname === '/api/map-view') {
    try {
      const view = await createMapViewFromDB(url.searchParams)
      sendJson(res, view)
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : 'map-view failed' }, 500)
    }
    return
  }

  if (url.pathname.startsWith('/api/assets/')) {
    const assetKey = url.pathname.replace(/^\/api\/assets\//, '')

    try {
      const cached = await bootstrapPreviewAsset(assetKey)
      if (!cached) {
        sendJson(res, { error: 'asset not found' }, 404)
        return
      }

      sendAsset(res, cached.contentType, cached.body)
      queueAdjacentTileWarm(assetKey)
      return
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : 'asset fetch failed' }, 502)
      return
    }
  }

  let target = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname)
  try {
    const info = await stat(target)
    if (info.isDirectory()) {
      target = path.join(target, 'index.html')
    }
    await serveFile(res, target)
  } catch {
    await serveFile(res, path.join(root, 'index.html'))
  }
})

ensurePreviewDataReady()
  .then(() => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`preview server listening at http://127.0.0.1:${port}`)
    })
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
