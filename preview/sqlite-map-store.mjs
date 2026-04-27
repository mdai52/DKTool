import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapsByMode as sourceMapsByMode, modes as sourceModes } from './mock-data.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function resolveDBPath() {
  const requested = process.env.DKTOOL_DB_PATH?.trim()
  if (requested) {
    return path.resolve(requested)
  }

  const primary = path.resolve(__dirname, '../backend/data/dktool.db')
  if (existsSync(primary)) {
    return primary
  }

  return path.resolve(__dirname, '../backend/data/dktool.seed.db')
}

const dbPath = resolveDBPath()

let initializePromise = null
let datasetPromise = null

function resolveSqliteBinary() {
  const candidates = [
    process.env.DKTOOL_SQLITE3_BIN,
    '/usr/bin/sqlite3',
    '/opt/homebrew/bin/sqlite3',
    '/usr/local/bin/sqlite3'
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error('sqlite3 binary not found; set DKTOOL_SQLITE3_BIN')
}

const sqliteBin = resolveSqliteBinary()

function runSQLite(sql, { json = false } = {}) {
  return new Promise((resolve, reject) => {
    mkdirSync(path.dirname(dbPath), { recursive: true })

    const child = spawn(sqliteBin, json ? ['-json', dbPath] : [dbPath])
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `sqlite3 exited with code ${code}`))
        return
      }
      if (!json) {
        resolve(stdout)
        return
      }

      const body = stdout.trim()
      if (!body) {
        resolve([])
        return
      }

      try {
        resolve(JSON.parse(body))
      } catch (error) {
        reject(error)
      }
    })

    child.stdin.end(sql)
  })
}

function escapeSQL(value) {
  return String(value ?? '').replace(/'/g, "''")
}

function sqlText(value) {
  return `'${escapeSQL(value)}'`
}

function flattenMapEntries() {
  const seen = new Set()
  const entries = []

  for (const mode of sourceModes) {
    ;(sourceMapsByMode[mode.slug] ?? []).forEach((map, mapIndex) => {
      if (seen.has(map.slug)) return
      seen.add(map.slug)
      entries.push({ map, mapIndex })
    })
  }

  return entries
}

function buildSearchText(point) {
  return [
    point.name,
    point.regionName,
    point.summary,
    point.condition,
    point.rarity,
    point.layerSlug
  ]
    .join(' ')
    .toLowerCase()
}

function buildSchemaSQL() {
  return `
    CREATE TABLE IF NOT EXISTS modes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      description TEXT NOT NULL,
      accent TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode_id INTEGER NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      caption TEXT NOT NULL,
      description TEXT NOT NULL,
      theme TEXT NOT NULL,
      default_variant_slug TEXT NOT NULL,
      default_floor_slug TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY(mode_id) REFERENCES modes(id)
    );
    CREATE TABLE IF NOT EXISTS map_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      map_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      UNIQUE(map_id, slug),
      FOREIGN KEY(map_id) REFERENCES maps(id)
    );
    CREATE TABLE IF NOT EXISTS map_floors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      map_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      UNIQUE(map_id, slug),
      FOREIGN KEY(map_id) REFERENCES maps(id)
    );
    CREATE TABLE IF NOT EXISTS map_regions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      map_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      floor_slug TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL,
      FOREIGN KEY(map_id) REFERENCES maps(id)
    );
    CREATE TABLE IF NOT EXISTS map_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      map_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL,
      hint TEXT NOT NULL,
      highlight_color TEXT NOT NULL,
      focus_region TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      UNIQUE(map_id, slug),
      FOREIGN KEY(map_id) REFERENCES maps(id)
    );
    CREATE TABLE IF NOT EXISTS layer_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      map_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      UNIQUE(map_id, slug),
      FOREIGN KEY(map_id) REFERENCES maps(id)
    );
    CREATE TABLE IF NOT EXISTS layers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      color TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      default_enabled INTEGER NOT NULL DEFAULT 1,
      UNIQUE(group_id, slug),
      FOREIGN KEY(group_id) REFERENCES layer_groups(id)
    );
    CREATE TABLE IF NOT EXISTS points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      map_id INTEGER NOT NULL,
      variant_slug TEXT NOT NULL,
      layer_slug TEXT NOT NULL,
      region_name TEXT NOT NULL,
      floor_slug TEXT NOT NULL DEFAULT '',
      event_slug TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail_text TEXT NOT NULL,
      condition_text TEXT NOT NULL,
      rarity TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      loot_score INTEGER NOT NULL DEFAULT 0,
      search_text TEXT NOT NULL,
      image_urls TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY(map_id) REFERENCES maps(id)
    );
  `
}

function buildSeedSQL() {
  const statements = [
    'BEGIN;',
    'DELETE FROM points;',
    'DELETE FROM layers;',
    'DELETE FROM layer_groups;',
    'DELETE FROM map_events;',
    'DELETE FROM map_regions;',
    'DELETE FROM map_floors;',
    'DELETE FROM map_variants;',
    'DELETE FROM maps;',
    'DELETE FROM modes;'
  ]

  sourceModes.forEach((mode, modeIndex) => {
    statements.push(`
      INSERT INTO modes (slug, name, subtitle, description, accent, sort_order)
      VALUES (${sqlText(mode.slug)}, ${sqlText(mode.name)}, ${sqlText(mode.subtitle)}, ${sqlText(mode.description)}, ${sqlText(mode.accent)}, ${mode.sort ?? modeIndex});
    `)
  })

  for (const { map, mapIndex } of flattenMapEntries()) {
    statements.push(`
      INSERT INTO maps (
        mode_id, slug, name, caption, description, theme, default_variant_slug, default_floor_slug, sort_order
      ) VALUES (
        (SELECT id FROM modes WHERE slug = ${sqlText(map.modeSlug)}),
        ${sqlText(map.slug)},
        ${sqlText(map.name)},
        ${sqlText(map.caption)},
        ${sqlText(map.description)},
        ${sqlText(map.theme)},
        ${sqlText(map.defaultVariant)},
        ${sqlText(map.defaultFloor)},
        ${map.sort ?? mapIndex}
      );
    `)

    map.variants.forEach((variant, index) => {
      statements.push(`
        INSERT INTO map_variants (map_id, slug, label, description, sort_order)
        VALUES (
          (SELECT id FROM maps WHERE slug = ${sqlText(map.slug)}),
          ${sqlText(variant.slug)},
          ${sqlText(variant.label)},
          ${sqlText(variant.description)},
          ${variant.sort ?? index}
        );
      `)
    })

    map.floors.forEach((floor, index) => {
      statements.push(`
        INSERT INTO map_floors (map_id, slug, name, sort_order)
        VALUES (
          (SELECT id FROM maps WHERE slug = ${sqlText(map.slug)}),
          ${sqlText(floor.slug)},
          ${sqlText(floor.name)},
          ${floor.sort ?? index}
        );
      `)
    })

    map.regions.forEach((region, index) => {
      statements.push(`
        INSERT INTO map_regions (map_id, name, x, y, floor_slug, sort_order)
        VALUES (
          (SELECT id FROM maps WHERE slug = ${sqlText(map.slug)}),
          ${sqlText(region.name)},
          ${Number(region.x)},
          ${Number(region.y)},
          ${sqlText(region.floor ?? '')},
          ${region.sort ?? index}
        );
      `)
    })

    map.events.forEach((event, index) => {
      statements.push(`
        INSERT INTO map_events (map_id, slug, name, summary, hint, highlight_color, focus_region, sort_order)
        VALUES (
          (SELECT id FROM maps WHERE slug = ${sqlText(map.slug)}),
          ${sqlText(event.slug)},
          ${sqlText(event.name)},
          ${sqlText(event.summary)},
          ${sqlText(event.hint)},
          ${sqlText(event.highlightColor)},
          ${sqlText(event.focusRegion)},
          ${event.sort ?? index}
        );
      `)
    })

    map.layerGroups.forEach((group, groupIndex) => {
      statements.push(`
        INSERT INTO layer_groups (map_id, slug, name, sort_order)
        VALUES (
          (SELECT id FROM maps WHERE slug = ${sqlText(map.slug)}),
          ${sqlText(group.slug)},
          ${sqlText(group.name)},
          ${group.sort ?? groupIndex}
        );
      `)

      group.layers.forEach((layer, layerIndex) => {
        statements.push(`
          INSERT INTO layers (group_id, slug, name, icon, color, sort_order, default_enabled)
          VALUES (
            (
              SELECT layer_groups.id
              FROM layer_groups
              JOIN maps ON maps.id = layer_groups.map_id
              WHERE maps.slug = ${sqlText(map.slug)} AND layer_groups.slug = ${sqlText(group.slug)}
            ),
            ${sqlText(layer.slug)},
            ${sqlText(layer.name)},
            ${sqlText(layer.icon)},
            ${sqlText(layer.color)},
            ${layer.sort ?? layerIndex},
            ${layer.enabled === false ? 0 : 1}
          );
        `)
      })
    })

    map.points.forEach((point) => {
      statements.push(`
        INSERT INTO points (
          map_id, variant_slug, layer_slug, region_name, floor_slug, event_slug,
          name, summary, detail_text, condition_text, rarity, x, y, loot_score, search_text, image_urls
        ) VALUES (
          (SELECT id FROM maps WHERE slug = ${sqlText(map.slug)}),
          ${sqlText(point.variantSlug)},
          ${sqlText(point.layerSlug)},
          ${sqlText(point.regionName)},
          ${sqlText(point.floor ?? '')},
          ${sqlText(point.eventSlug ?? '')},
          ${sqlText(point.name)},
          ${sqlText(point.summary)},
          ${sqlText(point.detail)},
          ${sqlText(point.condition)},
          ${sqlText(point.rarity)},
          ${Number(point.x)},
          ${Number(point.y)},
          ${Number(point.lootScore ?? 0)},
          ${sqlText(buildSearchText(point))},
          ${sqlText(JSON.stringify(point.imageUrls ?? []))}
        );
      `)
    })
  }

  statements.push('COMMIT;')
  return statements.join('\n')
}

async function ensureSeeded() {
  if (!initializePromise) {
    initializePromise = (async () => {
      await runSQLite(buildSchemaSQL())
      const rows = await runSQLite(`SELECT COUNT(*) AS count FROM modes;`, { json: true })
      const count = Number(rows[0]?.count || 0)
      if (count === 0) {
        await runSQLite(buildSeedSQL())
      }
    })()
  }

  return initializePromise
}

async function loadDatasetFromDB() {
  const [modeRows, mapRows, variantRows, floorRows, regionRows, eventRows, layerRows, pointRows] = await Promise.all([
    runSQLite(`SELECT slug, name, subtitle, description, accent FROM modes ORDER BY sort_order;`, { json: true }),
    runSQLite(`
      SELECT modes.slug AS modeSlug, maps.slug, maps.name, maps.caption, maps.description, maps.theme, maps.default_variant_slug AS defaultVariant, maps.default_floor_slug AS defaultFloor
      FROM maps
      JOIN modes ON maps.mode_id = modes.id
      ORDER BY modes.sort_order, maps.sort_order;
    `, { json: true }),
    runSQLite(`
      SELECT maps.slug AS mapSlug, map_variants.slug, map_variants.label, map_variants.description
      FROM map_variants
      JOIN maps ON maps.id = map_variants.map_id
      ORDER BY maps.sort_order, map_variants.sort_order;
    `, { json: true }),
    runSQLite(`
      SELECT maps.slug AS mapSlug, map_floors.slug, map_floors.name
      FROM map_floors
      JOIN maps ON maps.id = map_floors.map_id
      ORDER BY maps.sort_order, map_floors.sort_order;
    `, { json: true }),
    runSQLite(`
      SELECT maps.slug AS mapSlug, map_regions.name, map_regions.x, map_regions.y, map_regions.floor_slug AS floor
      FROM map_regions
      JOIN maps ON maps.id = map_regions.map_id
      ORDER BY maps.sort_order, map_regions.sort_order;
    `, { json: true }),
    runSQLite(`
      SELECT maps.slug AS mapSlug, map_events.slug, map_events.name, map_events.summary, map_events.hint, map_events.highlight_color AS highlightColor, map_events.focus_region AS focusRegion
      FROM map_events
      JOIN maps ON maps.id = map_events.map_id
      ORDER BY maps.sort_order, map_events.sort_order;
    `, { json: true }),
    runSQLite(`
      SELECT maps.slug AS mapSlug, layer_groups.slug AS groupSlug, layer_groups.name AS groupName, layers.slug, layers.name, layers.icon, layers.color
      FROM layer_groups
      JOIN maps ON maps.id = layer_groups.map_id
      JOIN layers ON layers.group_id = layer_groups.id
      ORDER BY maps.sort_order, layer_groups.sort_order, layers.sort_order;
    `, { json: true }),
    runSQLite(`
      SELECT
        maps.slug AS mapSlug,
        points.id,
        points.name,
        points.variant_slug AS variantSlug,
        points.layer_slug AS layerSlug,
        points.region_name AS regionName,
        points.floor_slug AS floor,
        points.event_slug AS eventSlug,
        points.summary,
        points.detail_text AS detail,
        points.condition_text AS condition,
        points.rarity,
        points.x,
        points.y,
        points.loot_score AS lootScore,
        points.image_urls AS imageUrls,
        layers.name AS layerName,
        layers.icon AS layerIcon,
        layers.color AS layerColor
      FROM points
      JOIN maps ON maps.id = points.map_id
      JOIN layer_groups ON layer_groups.map_id = maps.id
      JOIN layers ON layers.group_id = layer_groups.id AND layers.slug = points.layer_slug
      ORDER BY maps.sort_order, points.id;
    `, { json: true })
  ])

  const datasetModes = modeRows.map((mode) => ({
    slug: mode.slug,
    name: mode.name,
    subtitle: mode.subtitle,
    description: mode.description,
    accent: mode.accent
  }))

  const mapsByMode = Object.fromEntries(datasetModes.map((mode) => [mode.slug, []]))
  const mapLookup = new Map()

  mapRows.forEach((mapRow) => {
    const map = {
      modeSlug: mapRow.modeSlug,
      slug: mapRow.slug,
      name: mapRow.name,
      caption: mapRow.caption,
      description: mapRow.description,
      theme: mapRow.theme,
      defaultVariant: mapRow.defaultVariant,
      defaultFloor: mapRow.defaultFloor,
      variants: [],
      floors: [],
      regions: [],
      events: [],
      layerGroups: [],
      points: []
    }
    mapsByMode[map.modeSlug] ??= []
    mapsByMode[map.modeSlug].push(map)
    mapLookup.set(map.slug, map)
  })

  variantRows.forEach((row) => {
    mapLookup.get(row.mapSlug)?.variants.push({
      slug: row.slug,
      label: row.label,
      description: row.description
    })
  })
  floorRows.forEach((row) => {
    mapLookup.get(row.mapSlug)?.floors.push({
      slug: row.slug,
      name: row.name
    })
  })
  regionRows.forEach((row) => {
    mapLookup.get(row.mapSlug)?.regions.push({
      name: row.name,
      x: Number(row.x),
      y: Number(row.y),
      floor: row.floor
    })
  })
  eventRows.forEach((row) => {
    mapLookup.get(row.mapSlug)?.events.push({
      slug: row.slug,
      name: row.name,
      summary: row.summary,
      hint: row.hint,
      highlightColor: row.highlightColor,
      focusRegion: row.focusRegion
    })
  })

  const groupLookup = new Map()
  layerRows.forEach((row) => {
    const map = mapLookup.get(row.mapSlug)
    if (!map) return
    const key = `${row.mapSlug}:${row.groupSlug}`
    let group = groupLookup.get(key)
    if (!group) {
      group = {
        slug: row.groupSlug,
        name: row.groupName,
        layers: []
      }
      groupLookup.set(key, group)
      map.layerGroups.push(group)
    }
    group.layers.push({
      slug: row.slug,
      name: row.name,
      icon: row.icon,
      color: row.color
    })
  })

  pointRows.forEach((row) => {
    const map = mapLookup.get(row.mapSlug)
    if (!map) return
    let imageUrls = []
    try {
      imageUrls = JSON.parse(row.imageUrls || '[]')
    } catch {
      imageUrls = []
    }
    map.points.push({
      id: Number(row.id),
      name: row.name,
      variantSlug: row.variantSlug,
      layerSlug: row.layerSlug,
      regionName: row.regionName,
      floor: row.floor,
      eventSlug: row.eventSlug,
      summary: row.summary,
      detail: row.detail,
      condition: row.condition,
      rarity: row.rarity,
      x: Number(row.x),
      y: Number(row.y),
      lootScore: Number(row.lootScore || 0),
      imageUrls,
      layerName: row.layerName,
      layerIcon: row.layerIcon,
      layerColor: row.layerColor
    })
  })

  return {
    modes: datasetModes,
    mapsByMode
  }
}

async function getDataset() {
  await ensureSeeded()

  if (!datasetPromise) {
    datasetPromise = loadDatasetFromDB()
  }

  return datasetPromise
}

function floorAllowed(point, currentFloor) {
  return currentFloor === 'all' || point.floor === '' || point.floor === currentFloor
}

function eventAllowed(point, currentEvent) {
  return currentEvent === 'none' ? point.eventSlug === '' : point.eventSlug === '' || point.eventSlug === currentEvent
}

function normalizeLayerSelection(layerGroups, raw, layerMode = '') {
  const all = layerGroups.flatMap((group) => group.layers.map((layer) => layer.slug))
  if (layerMode === 'none') return []
  if (!raw.length) return all
  const selected = raw.filter((slug) => all.includes(slug))
  return selected.length ? selected : all
}

function summarizeMaps(list) {
  return list.map((map) => ({
    slug: map.slug,
    name: map.name,
    caption: map.caption,
    description: map.description,
    theme: map.theme,
    defaultVariant: map.defaultVariant,
    defaultFloor: map.defaultFloor
  }))
}

export async function ensurePreviewDataReady() {
  await getDataset()
}

export async function createMapViewFromDB(searchParams) {
  const { modes, mapsByMode } = await getDataset()
  const requestedMode = searchParams.get('mode')
  const modeSlug = mapsByMode[requestedMode] ? requestedMode : 'extraction'
  const maps = mapsByMode[modeSlug]
  const currentMap = maps.find((item) => item.slug === searchParams.get('map')) ?? maps[0]
  const currentVariant = currentMap.variants.find((item) => item.slug === searchParams.get('variant'))?.slug ?? currentMap.defaultVariant
  const currentFloor = currentMap.floors.find((item) => item.slug === searchParams.get('floor'))?.slug ?? currentMap.defaultFloor
  const currentEvent = currentMap.events.find((item) => item.slug === searchParams.get('event'))?.slug ?? 'none'
  const layerMode = searchParams.get('layerMode') ?? ''
  const layerRequest = (searchParams.get('layers') ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  const selectedLayers = normalizeLayerSelection(currentMap.layerGroups, layerRequest, layerMode)
  const query = (searchParams.get('search') ?? '').trim().toLowerCase()
  const layerCounts = {}
  const variantPoints = currentMap.points.filter((point) => point.variantSlug === currentVariant)

  const allForView = variantPoints.filter((point) => floorAllowed(point, currentFloor) && eventAllowed(point, currentEvent))

  for (const point of allForView) {
    layerCounts[point.layerSlug] = (layerCounts[point.layerSlug] ?? 0) + 1
  }

  const points = allForView.filter((point) => {
    if (!selectedLayers.includes(point.layerSlug)) return false
    if (!query) return true
    const haystack = `${point.name} ${point.regionName} ${point.summary} ${point.condition} ${point.rarity} ${point.layerName}`.toLowerCase()
    return haystack.includes(query)
  })

  return {
    modes,
    currentMode: modes.find((item) => item.slug === modeSlug),
    maps: summarizeMaps(maps),
    currentMap: summarizeMaps([currentMap])[0],
    variants: currentMap.variants,
    currentVariant,
    floors: currentMap.floors,
    currentFloor,
    randomEvents: currentMap.events,
    currentEvent,
    regions: currentMap.regions,
    layerGroups: currentMap.layerGroups.map((group) => ({
      ...group,
      layers: group.layers.map((layer) => ({
        ...layer,
        count: layerCounts[layer.slug] ?? 0,
        enabled: selectedLayers.includes(layer.slug)
      }))
    })),
    selectedLayers,
    points,
    stats: {
      totalPoints: allForView.length,
      visiblePoints: points.length
    }
  }
}
