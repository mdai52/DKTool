import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'

const pointLabelOnlyPattern = /^(位置|触发方式|触发条件|获取方式|流程|提示|相关任务)[:：]\s*$/u
const pointLabelPrefixPattern = /^(位置|触发方式|触发条件|获取方式|流程|提示|相关任务)[:：]\s*(?:\/\s*)?/u

function cleanPointSummary(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''

  const cleaned = text.replace(pointLabelPrefixPattern, '').trim()
  return pointLabelOnlyPattern.test(cleaned) ? '' : cleaned
}

function cleanPointDetail(value) {
  const lines = String(value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (!lines.length) return ''
  if (pointLabelOnlyPattern.test(lines[0])) lines.shift()

  return lines.join('\n').replace(/^\/\s*/, '').trim()
}

function cleanPointCondition(value) {
  const text = String(value ?? '').trim()
  if (!text || pointLabelOnlyPattern.test(text)) return ''
  return text
}

function normalizePoint(point) {
  const summary = cleanPointSummary(point.summary)
  const detail = cleanPointDetail(point.detail)
  const condition = cleanPointCondition(point.condition)
  const fallbackText = summary || detail || `${point.name} 点位`

  return {
    ...point,
    summary: summary || fallbackText,
    detail: detail || fallbackText,
    condition
  }
}

function parseInitialParams() {
  const params = new URLSearchParams(window.location.search)
  const layers = params.get('layers')?.split(',').filter(Boolean) ?? []

  return {
    mode: params.get('mode') ?? '',
    map: params.get('map') ?? '',
    variant: params.get('variant') ?? '',
    floor: params.get('floor') ?? '',
    event: params.get('event') ?? '',
    layerMode: params.get('layerMode') ?? '',
    search: params.get('search') ?? '',
    layers
  }
}

export function useMapData() {
  const initial = parseInitialParams()

  const view = ref(null)
  const loading = ref(false)
  const error = ref('')
  const search = ref(initial.search)
  const selectedPointId = ref(null)
  const focusedRegion = ref('')
  const toast = ref('')
  const selection = reactive({
    mode: initial.mode,
    map: initial.map,
    variant: initial.variant,
    floor: initial.floor,
    event: initial.event,
    layerMode: initial.layerMode,
    layers: initial.layers
  })

  let searchTimer = null
  let toastTimer = null

  const selectedPoint = computed(() => {
    if (!view.value || !selectedPointId.value) return null
    return (view.value.points ?? []).find((item) => item.id === selectedPointId.value) ?? null
  })

  const activeEvent = computed(() => {
    if (!view.value || view.value.currentEvent === 'none') return null
    return (view.value.randomEvents ?? []).find((item) => item.slug === view.value.currentEvent) ?? null
  })

  function allLayerSlugs() {
    return view.value?.layerGroups?.flatMap((group) => (group.layers ?? []).map((layer) => layer.slug)) ?? []
  }

  function syncURL() {
    if (!view.value) return

    const params = new URLSearchParams()
    params.set('mode', selection.mode)
    params.set('map', selection.map)
    params.set('variant', selection.variant)
    if (selection.floor && selection.floor !== 'all') params.set('floor', selection.floor)
    if (selection.event && selection.event !== 'none') params.set('event', selection.event)
    if (search.value.trim()) params.set('search', search.value.trim())

    const all = allLayerSlugs()
    const current = view.value.selectedLayers ?? []
    if (current.length === 0) {
      params.set('layerMode', 'none')
    } else if (current.length !== all.length) {
      params.set('layers', current.join(','))
    }

    const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`
    window.history.replaceState({}, '', next)
  }

  async function load(overrides = {}) {
    loading.value = true
    error.value = ''

    const next = {
      mode: overrides.mode ?? selection.mode,
      map: overrides.map ?? selection.map,
      variant: overrides.variant ?? selection.variant,
      floor: overrides.floor ?? selection.floor,
      event: overrides.event ?? selection.event,
      layerMode: overrides.layerMode ?? selection.layerMode,
      layers: overrides.layers ?? selection.layers,
      search: overrides.search ?? search.value
    }

    const params = new URLSearchParams()
    if (next.mode) params.set('mode', next.mode)
    if (next.map) params.set('map', next.map)
    if (next.variant) params.set('variant', next.variant)
    if (next.floor) params.set('floor', next.floor)
    if (next.event) params.set('event', next.event)
    if (next.layerMode === 'none') params.set('layerMode', 'none')
    if (next.search?.trim()) params.set('search', next.search.trim())
    if (next.layerMode !== 'none' && Array.isArray(next.layers) && next.layers.length > 0) {
      params.set('layers', next.layers.join(','))
    }

    try {
      const response = await fetch(`/api/map-view?${params.toString()}`)
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || '加载地图失败')
      }

      payload.modes = Array.isArray(payload.modes) ? payload.modes : []
      payload.maps = Array.isArray(payload.maps) ? payload.maps : []
      payload.variants = Array.isArray(payload.variants) ? payload.variants : []
      payload.floors = Array.isArray(payload.floors) ? payload.floors : []
      payload.layerGroups = Array.isArray(payload.layerGroups)
        ? payload.layerGroups.map((group) => ({
            ...group,
            layers: Array.isArray(group?.layers) ? group.layers : []
          }))
        : []
      payload.selectedLayers = Array.isArray(payload.selectedLayers) ? payload.selectedLayers : []
      payload.points = Array.isArray(payload.points) ? payload.points.map(normalizePoint) : []
      payload.regions = Array.isArray(payload.regions) ? payload.regions : []
      payload.randomEvents = Array.isArray(payload.randomEvents) ? payload.randomEvents : []

      view.value = payload
      selection.mode = payload.currentMode.slug
      selection.map = payload.currentMap.slug
      selection.variant = payload.currentVariant
      selection.floor = payload.currentFloor
      selection.event = payload.currentEvent
      selection.layerMode = payload.selectedLayers.length === 0 ? 'none' : ''
      selection.layers = [...payload.selectedLayers]

      if (!payload.points.some((item) => item.id === selectedPointId.value)) {
        selectedPointId.value = payload.currentMap?.tileSource?.projection === 'geo' ? null : (payload.points[0]?.id ?? null)
      }

      if (!payload.regions.some((item) => item.name === focusedRegion.value)) {
        focusedRegion.value = ''
      }

      syncURL()
    } catch (requestError) {
      error.value = requestError instanceof Error ? requestError.message : '加载地图失败'
    } finally {
      loading.value = false
    }
  }

  function showToast(message) {
    toast.value = message
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => {
      toast.value = ''
    }, 1800)
  }

  function selectPoint(point) {
    selectedPointId.value = point?.id ?? null
  }

  function focusRegion(name) {
    focusedRegion.value = name
  }

  function setMode(slug) {
    focusedRegion.value = ''
    return load({ mode: slug, map: '', variant: '', floor: 'all', event: 'none', layerMode: '', layers: [] })
  }

  function setMap(slug) {
    focusedRegion.value = ''
    return load({ map: slug, variant: '', floor: 'all', event: 'none', layerMode: '', layers: [] })
  }

  function setVariant(slug) {
    return load({ variant: slug })
  }

  function setFloor(slug) {
    return load({ floor: slug || 'all' })
  }

  function setEvent(slug) {
    return load({ event: slug || 'none' })
  }

  function toggleLayer(slug) {
    if (!view.value) return
    const current = new Set(view.value.selectedLayers ?? [])
    if (current.has(slug)) {
      current.delete(slug)
    } else {
      current.add(slug)
    }
    return load({ layers: [...current], layerMode: current.size === 0 ? 'none' : '' })
  }

  function selectAllLayers() {
    return load({ layers: allLayerSlugs(), layerMode: '' })
  }

  function clearAllLayers() {
    return load({ layers: [], layerMode: 'none' })
  }

  function resetFilters() {
    search.value = ''
    focusedRegion.value = ''
    return load({
      floor: 'all',
      event: 'none',
      layerMode: '',
      layers: allLayerSlugs(),
      search: ''
    })
  }

  watch(search, (value, previous) => {
    if (value === previous) return
    window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => {
      load({ search: value })
    }, 220)
  })

  onBeforeUnmount(() => {
    window.clearTimeout(searchTimer)
    window.clearTimeout(toastTimer)
  })

  return {
    view,
    loading,
    error,
    search,
    toast,
    selectedPoint,
    selectedPointId,
    focusedRegion,
    activeEvent,
    loadInitial: () => load(),
    setMode,
    setMap,
    setVariant,
    setFloor,
    setEvent,
    toggleLayer,
    selectAllLayers,
    clearAllLayers,
    resetFilters,
    selectPoint,
    focusRegion,
    showToast
  }
}
