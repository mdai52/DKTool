import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'backend/internal/data/static')

const apiBase = 'https://mapapi.gamersky.com'
const mode = {
  slug: 'kings-world',
  name: '王者荣耀世界',
  subtitle: '大世界互动地图',
  description: '数据来源于 Gamersky 互动地图，覆盖地上世界与地下世界的点位收集与任务指引。',
  accent: '#d9a64d',
  sort: 4
}

const mapConfigs = [
  { id: 190, slug: 'hkw-ground', region: 'dishang', name: '地上世界', sort: 1, fileName: 'hkw-ground.json' },
  { id: 191, slug: 'hkw-underground', region: 'dixia', name: '地下世界', sort: 2, fileName: 'hkw-underground.json' }
]

const groupColors = {
  地点: '#72d6ff',
  收集品: '#f4c56a',
  溯闻: '#ff9a6e',
  其他: '#c3ccd8'
}

const scoreByCatalog = {
  渡石: 48,
  赋神令: 82,
  河道游灵: 74,
  河道匿灵: 76,
  河道苗灵: 76,
  溯闻手记: 92,
  溯闻: 88,
  任务道具: 85,
  留言提醒: 36,
  官方留言: 20,
  杂项: 28
}

async function request(endpoint, body) {
  const response = await fetch(`${apiBase}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    throw new Error(`${endpoint} -> ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  if (payload.error) {
    throw new Error(`${endpoint} -> ${payload.errorDescription || payload.error}`)
  }
  return payload
}

function normalizeUrl(value) {
  if (!value) return ''
  if (value.startsWith('//')) return `https:${value}`
  if (value.startsWith('http://')) return value.replace('http://', 'https://')
  return value
}

function proxyGamerskyImageURL(sourceURL) {
  const normalized = normalizeUrl(sourceURL)
  if (!normalized) return ''
  return `/api/assets/image/gamersky/${Buffer.from(normalized).toString('base64url')}`
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function htmlToText(html = '') {
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|li|ul|ol|h\d)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<a [^>]*>(.*?)<\/a>/gi, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r/g, '')
  )
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

function summarizeText(text, fallback) {
  const lines = text.split('\n').filter(Boolean)
  if (!lines.length) return fallback
  return lines.slice(0, 2).join(' / ')
}

function buildCondition(text, fallback) {
  const first = text.split('\n').find(Boolean)?.trim() ?? ''
  if (/^(位置|触发方式|触发条件|获取方式|流程|提示|相关任务)[:：]\s*$/u.test(first)) {
    return fallback
  }
  if (/^(位置|触发方式|触发条件|获取方式|流程|提示|相关任务)/.test(first)) {
    return first
  }
  return fallback
}

function pickRegionName(point, areas, fallback) {
  if (!areas.length) return fallback

  let current = areas[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const area of areas) {
    const dx = point.x - area.x
    const dy = point.y - area.y
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      bestDistance = distance
      current = area
    }
  }
  return current.name || fallback
}

function buildBounds(mapMeta, points) {
  const xs = []
  const ys = []

  for (const point of points) {
    xs.push(Number(point.x))
    ys.push(Number(point.y))
  }
  for (const area of mapMeta.gameMapAreas ?? []) {
    xs.push(Number(area.x))
    ys.push(Number(area.y))
  }
  xs.push(Number(mapMeta.mapDefaultPositionX))
  ys.push(Number(mapMeta.mapDefaultPositionY))

  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const padX = Math.max((maxX - minX) * 0.18, 0.12)
  const padY = Math.max((maxY - minY) * 0.18, 0.12)

  return {
    south: minY - padY,
    west: minX - padX,
    north: maxY + padY,
    east: maxX + padX
  }
}

function buildLayerGroups(mapMeta) {
  const groups = []
  const catalogLookup = new Map()

  for (const [groupIndex, group] of (mapMeta.landmarkCatalogGroups ?? []).entries()) {
    const color = groupColors[group.groupName] ?? '#b9c4d3'
    const layers = []

    for (const [layerIndex, catalog] of (group.landmarkCatalogs ?? []).entries()) {
      const layer = {
        slug: `hkw-${catalog.id}`,
        name: catalog.name,
        icon: proxyGamerskyImageURL(catalog.iconUrl),
        color,
        sort: layerIndex + 1,
        enabled: (catalog.landmarksCount ?? 0) > 0
      }

      layers.push(layer)
      catalogLookup.set(catalog.id, { layer, groupName: group.groupName })
    }

    groups.push({
      slug: `hkw-group-${groupIndex + 1}`,
      name: group.groupName,
      sort: group.orderIndex ?? groupIndex + 1,
      layers
    })
  }

  return { groups, catalogLookup }
}

function buildPoints(landmarks, areas, catalogLookup, fallbackRegion) {
  return landmarks.map((landmark) => {
    const plainText = htmlToText(landmark.description || '')
    const catalogMeta = catalogLookup.get(landmark.landmarkCatalogId)
    const regionName = pickRegionName(landmark, areas, fallbackRegion)
    const summaryFallback = `${landmark.landmarkCatalogName} 点位`

    return {
      variantSlug: 'world',
      layerSlug: catalogMeta?.layer.slug ?? `hkw-${landmark.landmarkCatalogId}`,
      regionName,
      floor: '',
      eventSlug: '',
      name: landmark.name || landmark.landmarkCatalogName,
      summary: summarizeText(plainText, summaryFallback),
      detail: plainText || `${landmark.landmarkCatalogName} 点位`,
      condition: buildCondition(plainText, landmark.landmarkCatalogGroupName || '地图点位'),
      rarity: landmark.landmarkCatalogName || landmark.landmarkCatalogGroupName || '点位',
      x: Number(landmark.x),
      y: Number(landmark.y),
      lootScore: scoreByCatalog[landmark.landmarkCatalogName] ?? 60,
      imageUrls: []
    }
  })
}

function buildDataset(config, mapMeta, landmarks) {
  const { groups, catalogLookup } = buildLayerGroups(mapMeta)
  const regions = (mapMeta.gameMapAreas ?? []).map((area, index) => ({
    name: area.name,
    x: Number(area.x),
    y: Number(area.y),
    floor: '',
    sort: area.orderIndex ?? index + 1
  }))
  const points = buildPoints(landmarks, regions, catalogLookup, mapMeta.regionName || config.name)
  const bounds = buildBounds(mapMeta, points)

  return {
    mode,
    map: {
      modeSlug: mode.slug,
      slug: config.slug,
      name: config.name,
      caption: 'Gamersky 互动地图',
      description: mapMeta.description || mapMeta.shareDescription || `${config.name} 收集点位地图。`,
      theme: 'hkw-world',
      tileSource: {
        projection: 'geo',
        urlTemplate: `/api/assets/tile/hkw/${config.region}/{z}/{x}_{y}.webp`,
        minZoom: Number(mapMeta.mapTileZoomMin || 8),
        maxZoom: Number(mapMeta.mapTileZoomMax || 13),
        maxNativeZoom: Number(mapMeta.mapTileZoomMax || 13),
        tileSize: 256,
        noWrap: true,
        initZoom: Number(mapMeta.mapDefaultZoom || 10),
        initLat: Number(mapMeta.mapDefaultPositionY || 0),
        initLng: Number(mapMeta.mapDefaultPositionX || 0),
        bounds
      },
      defaultVariant: 'world',
      defaultFloor: 'all',
      sort: config.sort,
      variants: [
        { slug: 'world', label: '世界', description: `${config.name} 点位视图。`, sort: 1 }
      ],
      floors: [
        { slug: 'all', name: '全部', sort: 1 }
      ],
      regions,
      events: [],
      layerGroups: groups,
      points
    }
  }
}

async function main() {
  mkdirSync(outputDir, { recursive: true })

  for (const config of mapConfigs) {
    const [mapPayload, listPayload] = await Promise.all([
      request('/map/getMap', { gameMapId: config.id }),
      request('/landmark/getLandmarkList', {
        gameMapId: config.id,
        keyword: null,
        catalogIdsSelected: []
      })
    ])

    const dataset = buildDataset(config, mapPayload.map, listPayload.landmarks ?? [])
    const outputPath = path.join(outputDir, config.fileName)
    writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`)
    console.log(`Wrote ${outputPath}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
