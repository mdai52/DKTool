<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MapStage from './components/MapStage.vue'
import MarkerInspector from './components/MarkerInspector.vue'
import SidebarPanel from './components/SidebarPanel.vue'
import ToolbarRail from './components/ToolbarRail.vue'
import { useMapData } from './composables/useMapData'

const mapStage = ref(null)

const {
  view,
  loading,
  error,
  search,
  toast,
  selectedPoint,
  selectedPointId,
  focusedRegion,
  activeEvent,
  loadInitial,
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
} = useMapData()

const drawerOpen = ref(false)
const inspectorVisible = ref(false)
const isMobileViewport = ref(false)
let mediaQueryList
let detachViewportListener = null

const currentVariantLabel = computed(() => {
  if (!view.value) return ''
  return (view.value.variants ?? []).find((item) => item.slug === view.value.currentVariant)?.label ?? view.value.currentVariant
})

const isAtlasMode = computed(() => {
  const modeSlug = view.value?.currentMode?.slug
  return view.value?.currentMap?.tileSource?.projection === 'geo' || modeSlug === 'rock-kingdom' || modeSlug === 'kings-world'
})
const isKingsWorldTheme = computed(() => view.value?.currentMode?.slug === 'kings-world')

const mobileTopbarTitle = computed(() => view.value?.currentMode?.name ?? 'DK 地图工具')
const mobileTopbarSubtitle = computed(() => {
  if (!view.value) return ''
  const pieces = [view.value.currentMap?.name ?? '', currentVariantLabel.value]
  return pieces.filter(Boolean).join(' · ')
})
const shouldRenderInspector = computed(() => {
  if (isMobileViewport.value) return !!selectedPoint.value
  return !isAtlasMode.value || !!selectedPoint.value
})

function toggleDrawer() {
  drawerOpen.value = !drawerOpen.value
}

function closeDrawer() {
  drawerOpen.value = false
}

watch(selectedPointId, (id) => {
  inspectorVisible.value = !!id
})

function clearSelectedPoint() {
  inspectorVisible.value = false
  selectPoint(null)
}

function syncViewportMode() {
  if (typeof window === 'undefined') return
  isMobileViewport.value = window.matchMedia('(max-width: 760px)').matches
  if (!isMobileViewport.value) {
    drawerOpen.value = false
  }
}

function updateSearch(value) {
  search.value = value
}

async function shareView() {
  try {
    await navigator.clipboard.writeText(window.location.href)
    showToast('当前视图链接已复制')
  } catch {
    showToast('复制失败，请检查浏览器权限')
  }
}

function exportPoints() {
  if (!view.value) return
  const blob = new Blob([JSON.stringify(view.value.points, null, 2)], {
    type: 'application/json;charset=utf-8'
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${view.value.currentMap.slug}-${view.value.currentVariant}-points.json`
  anchor.click()
  URL.revokeObjectURL(url)
  showToast('可见点位已导出')
}

async function resetAll() {
  await resetFilters()
  mapStage.value?.resetView()
  showToast('筛选与视图已重置')
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    mediaQueryList = window.matchMedia('(max-width: 760px)')
    syncViewportMode()
    const handler = () => syncViewportMode()
    if (typeof mediaQueryList.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', handler)
      detachViewportListener = () => mediaQueryList?.removeEventListener('change', handler)
    } else if (typeof mediaQueryList.addListener === 'function') {
      mediaQueryList.addListener(handler)
      detachViewportListener = () => mediaQueryList?.removeListener(handler)
    }
  }
  loadInitial()
})

onBeforeUnmount(() => {
  detachViewportListener?.()
})
</script>

<template>
  <div
    class="app-shell"
    :class="{
      'app-shell--wide': isAtlasMode,
      'theme-rocom': isAtlasMode,
      'theme-kings': isKingsWorldTheme
    }"
  >
    <!-- 移动端遮罩 -->
    <div
      v-if="isMobileViewport"
      class="mobile-overlay"
      :class="{ 'is-visible': drawerOpen }"
      @click="closeDrawer"
    />

    <SidebarPanel
      :view="view"
      :search="search"
      :loading="loading"
      :class="{ 'is-drawer-open': isMobileViewport && drawerOpen }"
      @update-search="(v) => { updateSearch(v); closeDrawer() }"
      @change-mode="(m) => { setMode(m); closeDrawer() }"
      @change-map="(m) => { setMap(m); closeDrawer() }"
      @change-variant="(v) => { setVariant(v); closeDrawer() }"
      @change-floor="(f) => { setFloor(f); closeDrawer() }"
      @change-event="(e) => { setEvent(e); closeDrawer() }"
      @focus-region="(r) => { focusRegion(r); closeDrawer() }"
      @toggle-layer="toggleLayer"
      @select-all-layers="(l) => { selectAllLayers(l); closeDrawer() }"
      @clear-all-layers="(l) => { clearAllLayers(l); closeDrawer() }"
    />

    <main
      class="workspace"
      :class="{
        'workspace--rocom': isAtlasMode,
        'workspace--mobile-has-inspector': isMobileViewport && inspectorVisible
      }"
    >
      <div v-if="isMobileViewport" class="mobile-topbar" :class="{ 'mobile-topbar--atlas': isAtlasMode }">
        <div class="mobile-topbar__left">
          <button class="mobile-topbar__button" type="button" @click="toggleDrawer">
            {{ drawerOpen ? '✕' : '☰' }}
          </button>
          <div class="mobile-topbar__title">
            {{ mobileTopbarTitle }}
            <small>{{ mobileTopbarSubtitle }}</small>
          </div>
        </div>
        <button class="mobile-topbar__button" type="button" @click="toggleDrawer">⌕</button>
      </div>

      <header v-if="!isAtlasMode" class="workspace-topbar">
        <div>
          <p class="eyebrow">Visual Tactical Replica</p>
          <h2>{{ view?.currentMap.name ?? '加载地图中' }}</h2>
          <p class="workspace-topbar__copy">
            {{ view?.currentMode.name ?? '' }}
            <span v-if="view"> / {{ currentVariantLabel }}</span>
            <span v-if="view"> / {{ view.stats.visiblePoints }} 个可见点位</span>
          </p>
        </div>
        <div class="workspace-topbar__status">
          <span class="status-dot" :class="{ 'is-busy': loading }" />
          <strong>{{ loading ? '正在同步' : '已连接 SQLite 数据源' }}</strong>
        </div>
      </header>

      <MapStage
        ref="mapStage"
        :view="view"
        :selected-point-id="selectedPointId"
        :focused-region="focusedRegion"
        :active-event="activeEvent"
        @select-point="selectPoint"
        @clear-point="selectPoint(null)"
      />

      <ToolbarRail
        :mode-slug="view?.currentMode?.slug ?? ''"
        :atlas-mode="isAtlasMode"
        :active-event="activeEvent"
        @zoom-in="mapStage?.zoomIn()"
        @zoom-out="mapStage?.zoomOut()"
        @share="shareView"
        @export="exportPoints"
        @reset="resetAll"
      />

      <MarkerInspector
        v-if="shouldRenderInspector"
        :point="selectedPoint"
        :view="view"
        :active-event="activeEvent"
        :atlas-mode="isAtlasMode"
        :mobile="isMobileViewport"
        :class="{ 'is-visible': !isMobileViewport || inspectorVisible }"
        @close="clearSelectedPoint"
      />

      <div v-if="error" class="status-banner status-banner--error">{{ error }}</div>
      <div v-if="toast" class="status-banner">{{ toast }}</div>
    </main>
  </div>
</template>
