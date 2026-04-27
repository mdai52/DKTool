<script setup>
import { computed, onMounted, ref } from 'vue'
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

const currentVariantLabel = computed(() => {
  if (!view.value) return ''
  return (view.value.variants ?? []).find((item) => item.slug === view.value.currentVariant)?.label ?? view.value.currentVariant
})

const isRocomMode = computed(() => view.value?.currentMode?.slug === 'rock-kingdom')

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
  loadInitial()
})
</script>

<template>
  <div
    class="app-shell"
    :class="{
      'app-shell--wide': isRocomMode,
      'theme-rocom': isRocomMode
    }"
  >
    <SidebarPanel
      :view="view"
      :search="search"
      :loading="loading"
      @update-search="updateSearch"
      @change-mode="setMode"
      @change-map="setMap"
      @change-variant="setVariant"
      @change-floor="setFloor"
      @change-event="setEvent"
      @focus-region="focusRegion"
      @toggle-layer="toggleLayer"
      @select-all-layers="selectAllLayers"
      @clear-all-layers="clearAllLayers"
    />

    <main class="workspace" :class="{ 'workspace--rocom': isRocomMode }">
      <header v-if="!isRocomMode" class="workspace-topbar">
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
        :active-event="activeEvent"
        @zoom-in="mapStage?.zoomIn()"
        @zoom-out="mapStage?.zoomOut()"
        @share="shareView"
        @export="exportPoints"
        @reset="resetAll"
      />

      <MarkerInspector
        v-if="!isRocomMode || selectedPoint"
        :point="selectedPoint"
        :view="view"
        :active-event="activeEvent"
        :mode-slug="view?.currentMode?.slug ?? ''"
      />

      <div v-if="error" class="status-banner status-banner--error">{{ error }}</div>
      <div v-if="toast" class="status-banner">{{ toast }}</div>
    </main>
  </div>
</template>
