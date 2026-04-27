import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const locationPath = path.join(root, 'output/data/rocom-location.json')
const categoriesPath = path.join(root, 'output/playwright/rocom-categories-clean.json')
const outputPath = path.join(root, 'backend/internal/data/static/rocom-world.json')

const groupConfig = {
  收集: { slug: 'collection', color: '#7af3b0' },
  花草: { slug: 'flowers', color: '#9fe870' },
  果树: { slug: 'fruit', color: '#ffb86a' },
  矿石: { slug: 'ore', color: '#78b7ff' },
  精灵: { slug: 'sprite', color: '#d58cff' },
  地点: { slug: 'location', color: '#6adfff' },
  任务: { slug: 'quest', color: '#ffd76f' },
  其他: { slug: 'other', color: '#b9c6d6' }
}

function normalizeUrl(value) {
  if (!value) return ''
  if (value.startsWith('//')) return `https:${value}`
  if (value.startsWith('http://')) return value.replace('http://', 'https://')
  return value
}

function extractIdFromIcon(url) {
  return normalizeUrl(url).match(/(\d+)\.png$/)?.[1] ?? ''
}

const locationPayload = JSON.parse(readFileSync(locationPath, 'utf8'))
const categoryPayload = JSON.parse(readFileSync(categoriesPath, 'utf8'))

const layerGroups = []
const categoriesByID = new Map()

for (const [groupIndex, group] of categoryPayload.entries()) {
  const meta = groupConfig[group.title] ?? { slug: `group-${groupIndex + 1}`, color: '#8ec7ff' }
  const layers = []

  for (const [categoryIndex, category] of group.categories.entries()) {
    const categoryID = extractIdFromIcon(category.icon)
    if (!categoryID) continue

    const layer = {
      slug: `rocom-${categoryID}`,
      name: category.title,
      icon: `/api/assets/icon/rocom/${categoryID}.png`,
      color: meta.color,
      sort: categoryIndex + 1,
      enabled: true
    }

    layers.push(layer)
    categoriesByID.set(categoryID, {
      groupTitle: group.title,
      layer
    })
  }

  layerGroups.push({
    slug: meta.slug,
    name: group.title,
    sort: groupIndex + 1,
    layers
  })
}

const points = locationPayload.data.map((item, index) => {
  const categoryID = String(item.category_id)
  const category = categoriesByID.get(categoryID) ?? {
    groupTitle: '其他',
    layer: {
      slug: `rocom-${categoryID}`,
      name: `未分类 ${categoryID}`,
      icon: `/api/assets/icon/rocom/${categoryID}.png`,
      color: '#b9c6d6'
    }
  }

  const description = (item.description ?? '').trim()
  const author = item.author?.nickName ? `投稿者：${item.author.nickName}` : ''
  const summary = description || `${category.layer.name} 点位`
  const detail = [author, description].filter(Boolean).join('。') || `${item.title}，分类为 ${category.layer.name}。`

  return {
    id: Number(item.id) || 900000000000 + index,
    variantSlug: 'world',
    layerSlug: category.layer.slug,
    regionName: category.groupTitle,
    floor: '',
    eventSlug: '',
    name: item.title || category.layer.name,
    summary,
    detail,
    condition: description ? '查看点位说明' : '地图点位',
    rarity: category.groupTitle,
    x: Number(item.longitude),
    y: Number(item.latitude),
    lootScore: description ? 78 : 58,
    layerName: category.layer.name,
    layerIcon: category.layer.icon,
    layerColor: category.layer.color,
    imageUrls: [item.image, ...(item.images ?? [])].map(normalizeUrl).filter(Boolean)
  }
})

const output = {
  mode: {
    slug: 'rock-kingdom',
    name: '洛克王国世界',
    subtitle: '世界互动地图',
    description: '整合 17173 世界地图点位、分类与传送路线的采集地图。',
    accent: '#6adfff',
    sort: 3
  },
  map: {
    modeSlug: 'rock-kingdom',
    slug: 'shijie',
    name: '世界地图',
    caption: '17173 世界互动地图',
    description: '覆盖收集、精灵、地点、任务等 3981 个世界点位。',
    theme: 'rocom-world',
    defaultVariant: 'world',
    defaultFloor: 'all',
    sort: 1,
    variants: [
      { slug: 'world', label: '世界', description: '17173 世界地图点位视图。', sort: 1 }
    ],
    floors: [
      { slug: 'all', name: '全部', sort: 1 }
    ],
    regions: [],
    events: [],
    layerGroups,
    points,
    tileSource: {
      projection: 'geo',
      keyPrefix: 'tile/rocom/4010_v3_7f2d9c',
      minZoom: 9,
      maxZoom: 13,
      maxNativeZoom: 12,
      initZoom: 11,
      initCenter: { lat: 0.6567, lng: -0.7844 },
      bounds: {
        south: 0.29668733888530596,
        west: -1.2269427663795511,
        north: 1.0175356186287843,
        east: -0.23109420974913064
      }
    }
  }
}

mkdirSync(path.dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)
console.log(`Wrote ${outputPath}`)
