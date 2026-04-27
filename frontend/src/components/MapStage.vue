<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L from 'leaflet'
import { buildLayerIcon, buildMapArt, resolveRemoteTileSource } from '../lib/mapVisuals'

const props = defineProps({
  view: {
    type: Object,
    default: null
  },
  selectedPointId: {
    type: Number,
    default: null
  },
  focusedRegion: {
    type: String,
    default: ''
  },
  activeEvent: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['select-point', 'clear-point'])

const container = ref(null)
const currentZoom = ref(0)
const worldSize = ref({ width: 1000, height: 1000 })
const renderedPointCount = ref(0)

let map
let baseLayer
let pointLayer
let regionLayer
let eventLayer
let currentBounds = null
let currentBaseSource = null
let resizeObserver
let isAdjustingView = false
let warmSweepToken = 0
let lastWarmSignature = ''

const visiblePointCount = computed(() => renderedPointCount.value)
const projectionMode = computed(() => resolveRemoteTileSource(props.view)?.projection ?? 'simple')

function selected(point) {
  return point.id === props.selectedPointId
}

function worldBounds() {
  return [
    [0, 0],
    [worldSize.value.height, worldSize.value.width]
  ]
}

function activeBounds() {
  return currentBounds ?? L.latLngBounds(worldBounds())
}

function currentCRS() {
  return projectionMode.value === 'geo' ? L.CRS.EPSG3857 : L.CRS.Simple
}

function projectPoint(x, y) {
  const bounds = activeBounds()
  const north = bounds.getNorth()
  const south = bounds.getSouth()
  const west = bounds.getWest()
  const east = bounds.getEast()

  return [
    north + (y / 1000) * (south - north),
    west + (x / 1000) * (east - west)
  ]
}

function pointLatLng(point) {
  if (currentBaseSource?.projection === 'geo') {
    return [point.y, point.x]
  }
  return projectPoint(point.x, point.y)
}

function regionLatLng(region) {
  if (currentBaseSource?.projection === 'geo') {
    return [region.y, region.x]
  }
  return projectPoint(region.x, region.y)
}

function regionMarker(region) {
  return L.marker(regionLatLng(region), {
    interactive: false,
    icon: L.divIcon({
      className: 'region-label-host',
      html: `<span class="region-label">${region.name}</span>`,
      iconSize: [10, 10],
      iconAnchor: [5, 5]
    })
  })
}

function pointMarker(point) {
  return L.marker(pointLatLng(point), {
    icon: L.divIcon({
      className: 'point-icon-host',
      html: `
        <button class="map-pin ${selected(point) ? 'is-active' : ''}" style="--pin-color:${point.layerColor}">
          <img class="map-pin__img" src="${buildLayerIcon(point.layerIcon, point.layerColor)}" alt="${point.layerName}" />
        </button>
      `,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    })
  }).on('click', () => emit('select-point', point))
}

function shouldCullPoints() {
  return (props.view?.points?.length ?? 0) > 400 || currentBaseSource?.projection === 'geo'
}

function declutterGridSize() {
  if (!map || currentBaseSource?.projection !== 'geo') return 0

  const zoom = map.getZoom()
  if (zoom >= 13) return 0
  if (zoom >= 12) return 30
  return 42
}

function pointBoundsWithBuffer() {
  if (!map) return null
  const bounds = map.getBounds()
  if (!bounds || !shouldCullPoints()) return null
  return bounds.pad(currentBaseSource?.projection === 'geo' ? 0.08 : 0.12)
}

function refreshEventRing() {
  if (!eventLayer) return
  eventLayer.clearLayers()
  if (!props.activeEvent || !props.view || currentBaseSource?.projection === 'geo') return

  const region = (props.view.regions ?? []).find((item) => item.name === props.activeEvent.focusRegion)
  if (!region) return

  const bounds = activeBounds()
  const ringSpan = Math.max(
    Math.abs(bounds.getEast() - bounds.getWest()),
    Math.abs(bounds.getSouth() - bounds.getNorth())
  )

  eventLayer.addLayer(
    L.circle(regionLatLng(region), {
      radius: (84 / 1000) * ringSpan,
      color: props.activeEvent.highlightColor,
      weight: 2,
      fillColor: props.activeEvent.highlightColor,
      fillOpacity: 0.14,
      dashArray: '10 8'
    })
  )
}

function clearBaseLayer() {
  if (baseLayer && map?.hasLayer(baseLayer)) {
    map.removeLayer(baseLayer)
  }
  baseLayer = null
}

function applyBounds(minZoom, maxZoom, bounds) {
  currentBounds = bounds
  map.setMinZoom(minZoom)
  map.setMaxZoom(maxZoom)
  map.setMaxBounds(bounds)
  map.options.minZoom = minZoom
  map.options.maxZoom = maxZoom
}

function buildSimpleRemoteBounds(source) {
  const southWest = L.latLng(source.latLngX, source.latLngY)
  const northEast = L.latLng(
    (source.boundsH - 70) * source.pixelToLatLngRatio,
    source.boundsW * source.pixelToLatLngRatio
  )
  return L.latLngBounds(southWest, northEast)
}

function buildGeoBounds(source) {
  return L.latLngBounds(
    [source.bounds.south, source.bounds.west],
    [source.bounds.north, source.bounds.east]
  )
}

function applyFallbackOverlay() {
  clearBaseLayer()
  currentBaseSource = null
  applyBounds(-0.5, 2.2, L.latLngBounds(worldBounds()))

  const source = buildMapArt(props.view.currentMap, props.view.regions, props.activeEvent)
  baseLayer = L.imageOverlay(source, activeBounds()).addTo(map)
}

function applyRemoteTiles(source) {
  clearBaseLayer()
  currentBaseSource = source

  if (source.projection === 'geo') {
    applyBounds(source.minZoom, source.maxZoom, buildGeoBounds(source))
    baseLayer = L.tileLayer(source.urlTemplate, {
      minZoom: source.minZoom,
      maxZoom: source.maxZoom,
      maxNativeZoom: source.maxNativeZoom,
      detectRetina: true,
      noWrap: source.noWrap ?? true,
      bounds: activeBounds(),
      tileSize: source.tileSize ?? 256
    }).addTo(map)
    return
  }

  applyBounds(source.minZoom, source.maxZoom, buildSimpleRemoteBounds(source))
  baseLayer = L.tileLayer(source.urlTemplate, {
    minZoom: source.minZoom,
    maxZoom: source.maxZoom,
    maxNativeZoom: source.maxNativeZoom,
    noWrap: false,
    bounds: activeBounds(),
    tileSize: source.tileSize,
    zoomOffset: source.zoomOffset
  }).addTo(map)
}

function refreshBaseLayer() {
  if (!map || !props.view) return

  const source = resolveRemoteTileSource(props.view)
  if (!source) {
    applyFallbackOverlay()
    refreshEventRing()
    return
  }

  applyRemoteTiles(source)
  refreshEventRing()
}

function refreshRegions() {
  if (!map || !props.view) return
  regionLayer.clearLayers()
  ;(props.view.regions ?? []).forEach((region) => regionLayer.addLayer(regionMarker(region)))
}

function refreshPoints() {
  if (!map || !props.view) return
  pointLayer.clearLayers()

  const visibleBounds = pointBoundsWithBuffer()
  const declutterSize = declutterGridSize()
  const occupiedCells = declutterSize > 0 ? new Set() : null
  let rendered = 0

  ;(props.view.points ?? []).forEach((point) => {
    const latLng = pointLatLng(point)
    const isSelected = selected(point)
    if (visibleBounds && !visibleBounds.contains(L.latLng(latLng)) && !isSelected) {
      return
    }
    if (occupiedCells && !isSelected) {
      const pixelPoint = map.latLngToContainerPoint(latLng)
      const cellKey = `${Math.floor(pixelPoint.x / declutterSize)}:${Math.floor(pixelPoint.y / declutterSize)}`
      if (occupiedCells.has(cellKey)) {
        return
      }
      occupiedCells.add(cellKey)
    }
    pointLayer.addLayer(pointMarker(point))
    rendered += 1
  })

  renderedPointCount.value = rendered
}

function syncViewportState(refreshVisiblePoints = true) {
  if (!map) return

  currentZoom.value = Number(map.getZoom().toFixed(2))
  if (refreshVisiblePoints) {
    refreshPoints()
  }
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function warmTilesEnabled() {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  const value = params.get('warmTiles') ?? ''
  return ['1', 'true', 'yes', 'on', 'full', 'coverage'].includes(value.toLowerCase())
}

function warmTileSettleMs() {
  if (typeof window === 'undefined') return 180
  const params = new URLSearchParams(window.location.search)
  const value = Number(params.get('warmSettleMs') || 180)
  return Number.isFinite(value) ? Math.max(60, Math.min(1000, value)) : 180
}

function coverageZoomLevels() {
  if (!currentBaseSource) return []

  if (currentBaseSource.projection === 'geo') {
    const zooms = []
    for (let zoom = Math.ceil(currentBaseSource.minZoom); zoom <= currentBaseSource.maxNativeZoom; zoom += 1) {
      zooms.push(zoom)
    }
    return zooms
  }

  const zooms = new Set([currentBaseSource.minZoom, currentBaseSource.initZoom])
  const zoomOffset = currentBaseSource.zoomOffset ?? 0
  const maxDisplayZoom = Math.min(
    currentBaseSource.maxZoom ?? currentBaseSource.maxNativeZoom,
    currentBaseSource.maxNativeZoom - zoomOffset + (zoomOffset < 0 ? 1 : 0)
  )

  for (let zoom = Math.ceil(currentBaseSource.minZoom); zoom <= Math.ceil(maxDisplayZoom); zoom += 1) {
    zooms.add(zoom)
  }

  return [...zooms].sort((left, right) => left - right)
}

function axisCenters(min, max, visibleSpan) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || visibleSpan <= 0) {
    return [(min + max) / 2]
  }

  if (max <= min) {
    return [min]
  }

  if (visibleSpan >= max - min) {
    return [(min + max) / 2]
  }

  const half = visibleSpan / 2
  const start = min + half
  const end = max - half
  const step = Math.max(visibleSpan * 0.72, (max - min) / 8)
  const centers = []

  for (let value = start; value <= end; value += step) {
    centers.push(value)
  }

  if (!centers.length || Math.abs(centers[centers.length - 1] - end) > 1e-6) {
    centers.push(end)
  }

  return centers
}

function coverageCentersForZoom() {
  const bounds = activeBounds()
  const viewBounds = map.getBounds()
  const latSpan = Math.abs(viewBounds.getNorth() - viewBounds.getSouth())
  const lngSpan = Math.abs(viewBounds.getEast() - viewBounds.getWest())
  const latCenters = axisCenters(bounds.getSouth(), bounds.getNorth(), latSpan)
  const lngCenters = axisCenters(bounds.getWest(), bounds.getEast(), lngSpan)
  const centers = []

  latCenters.forEach((lat, rowIndex) => {
    const row = lngCenters.map((lng) => [lat, lng])
    centers.push(...(rowIndex % 2 === 0 ? row : row.reverse()))
  })

  return centers
}

async function runWarmCoverageSweep() {
  if (!map || !props.view || !currentBaseSource || !warmTilesEnabled()) return

  const token = ++warmSweepToken
  const settleMs = warmTileSettleMs()
  const zooms = coverageZoomLevels()
  if (!zooms.length) return

  for (const zoom of zooms) {
    if (token !== warmSweepToken || !map) return

    if (currentBaseSource.projection === 'geo') {
      map.setView([currentBaseSource.initLat, currentBaseSource.initLng], zoom, { animate: false })
    } else {
      map.setView([currentBaseSource.initX, currentBaseSource.initY], zoom, { animate: false })
    }
    await wait(settleMs)

    const centers = coverageCentersForZoom()
    for (const center of centers) {
      if (token !== warmSweepToken || !map) return
      map.setView(center, zoom, { animate: false })
      await wait(settleMs)
    }
  }

  if (token === warmSweepToken) {
    resetView()
  }
}

function queueWarmCoverageSweep() {
  if (!warmTilesEnabled() || !map || !props.view || !currentBaseSource) return

  const signature = [
    props.view.currentMode?.slug,
    props.view.currentMap?.slug,
    props.view.currentVariant,
    props.view.currentFloor,
    currentBaseSource.urlTemplate
  ].join('|')

  if (signature === lastWarmSignature) return
  lastWarmSignature = signature

  window.setTimeout(() => {
    runWarmCoverageSweep()
  }, 0)
}

function resetView() {
  if (!map) return

  if (currentBaseSource) {
    syncAdaptiveMinZoom()
    if (currentBaseSource.fitMode === 'bounds') {
      map.fitBounds(activeBounds(), { padding: [24, 24], animate: false })
      syncViewportState()
      return
    }
    if (currentBaseSource.projection === 'geo') {
      map.setView([currentBaseSource.initLat, currentBaseSource.initLng], currentBaseSource.initZoom, {
        animate: false
      })
      syncViewportState()
      return
    }
    map.setView([currentBaseSource.initX, currentBaseSource.initY], currentBaseSource.initZoom, {
      animate: false
    })
    syncViewportState()
  } else {
    map.fitBounds(activeBounds(), { padding: [40, 40], animate: false })
    syncViewportState()
  }
}

function syncAdaptiveMinZoom() {
  if (!map || !currentBaseSource || currentBaseSource.fitMode !== 'bounds') return

  const adaptiveMinZoom = Math.max(
    currentBaseSource.minZoom ?? map.getMinZoom(),
    map.getBoundsZoom(activeBounds(), false, L.point(24, 24))
  )

  map.setMinZoom(adaptiveMinZoom)
  map.options.minZoom = adaptiveMinZoom
}

function refreshLayout() {
  if (!map || isAdjustingView) return

  map.invalidateSize(false)

  if (!currentBaseSource) return

  syncAdaptiveMinZoom()

  if (currentBaseSource.fitMode === 'bounds') {
    const viewBounds = map.getBounds()
    if (!activeBounds().contains(viewBounds)) {
      isAdjustingView = true
      map.fitBounds(activeBounds(), { padding: [24, 24], animate: false })
      isAdjustingView = false
      return
    }
  }

  isAdjustingView = true
  map.panInsideBounds(activeBounds(), { animate: false })
  isAdjustingView = false
}

function zoomIn() {
  map?.zoomIn(projectionMode.value === 'geo' ? 1 : 0.5)
}

function zoomOut() {
  map?.zoomOut(projectionMode.value === 'geo' ? 1 : 0.5)
}

function focusSelectedRegion(name) {
  if (!map || !name || !props.view) return
  const region = (props.view.regions ?? []).find((item) => item.name === name)
  if (!region) return
  map.flyTo(regionLatLng(region), Math.max(map.getZoom(), currentBaseSource?.projection === 'geo' ? 10.5 : 0.25), {
    duration: 0.6
  })
}

function focusSelectedPoint() {
  if (!map || !props.selectedPointId || !props.view) return
  const point = (props.view.points ?? []).find((item) => item.id === props.selectedPointId)
  if (!point) return
  map.panTo(pointLatLng(point), { animate: true, duration: 0.45 })
}

function attachMap() {
  const geoMode = projectionMode.value === 'geo'
  map = L.map(container.value, {
    crs: currentCRS(),
    attributionControl: false,
    zoomControl: false,
    minZoom: geoMode ? 10 : -4,
    maxZoom: projectionMode.value === 'geo' ? 13 : 10,
    zoomSnap: geoMode ? 1 : 0.25,
    zoomDelta: geoMode ? 1 : 0.25,
    inertia: true,
    maxBoundsViscosity: 1
  })

  pointLayer = L.layerGroup().addTo(map)
  regionLayer = L.layerGroup().addTo(map)
  eventLayer = L.layerGroup().addTo(map)

  map.on('zoomend', () => {
    currentZoom.value = Number(map.getZoom().toFixed(2))
    if (shouldCullPoints()) {
      refreshPoints()
    }
  })
  map.on('moveend', () => {
    if (currentBaseSource?.fitMode === 'bounds') {
      refreshLayout()
    }
    if (shouldCullPoints()) {
      refreshPoints()
    }
  })
  map.on('click', () => emit('clear-point'))
}

async function rebuildMap() {
  if (!container.value) return
  warmSweepToken += 1
  map?.remove()
  map = null
  baseLayer = null
  pointLayer = null
  regionLayer = null
  eventLayer = null
  currentBounds = null
  currentBaseSource = null
  renderedPointCount.value = 0

  await nextTick()
  attachMap()
  map.invalidateSize(false)
  if (props.view) {
    refreshBaseLayer()
    refreshRegions()
    resetView()
    refreshPoints()
    queueWarmCoverageSweep()
  }
}

async function syncMapForView() {
  if (!map || !props.view) return

  await nextTick()
  map.invalidateSize(false)
  refreshBaseLayer()
  refreshRegions()
  resetView()
  refreshPoints()
  queueWarmCoverageSweep()
}

onMounted(async () => {
  attachMap()

  await nextTick()
  map.invalidateSize(false)
  if (props.view) {
    refreshBaseLayer()
    refreshRegions()
    resetView()
    refreshPoints()
    queueWarmCoverageSweep()
  }

  if (typeof ResizeObserver !== 'undefined' && container.value) {
    resizeObserver = new ResizeObserver(() => {
      refreshLayout()
    })
    resizeObserver.observe(container.value)
  }
})

watch(
  () => [props.view?.currentMode?.slug, props.view?.currentMap?.slug, props.view?.currentFloor],
  () => {
    if (!props.view) return
    syncMapForView()
  },
  { flush: 'post' }
)

watch(
  () => projectionMode.value,
  async (value, previous) => {
    if (!container.value || value === previous) return
    await rebuildMap()
  }
)

watch(
  () => props.view?.points,
  () => {
    refreshPoints()
  },
  { deep: true }
)

watch(
  () => props.view?.regions,
  () => {
    refreshRegions()
    refreshEventRing()
  },
  { deep: true }
)

watch(
  () => props.selectedPointId,
  () => {
    refreshPoints()
    focusSelectedPoint()
  }
)

watch(
  () => props.focusedRegion,
  (value) => focusSelectedRegion(value)
)

watch(
  () => props.activeEvent?.slug,
  () => {
    if (!props.view) return
    if (resolveRemoteTileSource(props.view)) {
      refreshEventRing()
      return
    }
    refreshBaseLayer()
    refreshRegions()
    refreshPoints()
  }
)

onBeforeUnmount(() => {
  warmSweepToken += 1
  resizeObserver?.disconnect()
  map?.remove()
  renderedPointCount.value = 0
})

defineExpose({
  resetView,
  zoomIn,
  zoomOut
})
</script>

<template>
  <section class="map-stage">
    <div ref="container" class="map-stage__canvas" />

    <div class="map-stage__hud">
      <div class="map-stage__badge">
        <span>地图</span>
        <strong>{{ view?.currentMap.name }}</strong>
      </div>
      <div class="map-stage__badge">
        <span>模式</span>
        <strong>{{ view?.currentVariant }}</strong>
      </div>
      <div class="map-stage__badge">
        <span>缩放</span>
        <strong>{{ currentZoom.toFixed(2) }}</strong>
      </div>
      <div class="map-stage__badge">
        <span>可见点位</span>
        <strong>{{ visiblePointCount }}</strong>
      </div>
    </div>
  </section>
</template>
