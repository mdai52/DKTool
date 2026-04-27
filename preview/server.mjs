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
      sendJson(res, await createMapViewFromDB(url.searchParams))
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : 'map-view failed' }, 500)
    }
    return
  }

  if (url.pathname.startsWith('/api/assets/')) {
    const assetKey = url.pathname.replace(/^\/api\/assets\//, '')

    try {
      const cached = await getCachedAsset(assetKey)
      if (cached) {
        sendAsset(res, cached.contentType, cached.body)
        return
      }
    } catch (error) {
      console.error(`sqlite cache read failed for ${assetKey}:`, error)
    }

    const asset = resolvePreviewAsset(assetKey)
    if (!asset) {
      sendJson(res, { error: 'asset not found' }, 404)
      return
    }

    try {
      const response = await fetch(asset.url, {
        headers: {
          'user-agent': 'DKTool Preview/0.1',
          accept: 'image/*,*/*'
        }
      })
      if (!response.ok) {
        sendJson(res, { error: `upstream asset failed: ${response.status}` }, 502)
        return
      }

      const body = Buffer.from(await response.arrayBuffer())
      const contentType = response.headers.get('content-type') || asset.contentType

      try {
        await saveCachedAsset(assetKey, asset.url, contentType, body)
      } catch (error) {
        console.error(`sqlite cache write failed for ${assetKey}:`, error)
      }

      sendAsset(res, contentType, body)
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
