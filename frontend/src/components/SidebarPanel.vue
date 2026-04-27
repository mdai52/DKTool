<script setup>
import { computed, ref, watch } from 'vue'
import { buildLayerIcon } from '../lib/mapVisuals'

const props = defineProps({
  view: {
    type: Object,
    default: null
  },
  search: {
    type: String,
    default: ''
  },
  loading: {
    type: Boolean,
    default: false
  }
})

defineEmits([
  'update-search',
  'change-mode',
  'change-map',
  'change-variant',
  'change-floor',
  'change-event',
  'focus-region',
  'toggle-layer',
  'select-all-layers',
  'clear-all-layers'
])

const activeEventLabel = computed(() => {
  if (!props.view || props.view.currentEvent === 'none') return '暂无特殊事件'
  return (props.view.randomEvents ?? []).find((item) => item.slug === props.view.currentEvent)?.name ?? '暂无特殊事件'
})

const isRocomMode = computed(() => props.view?.currentMode?.slug === 'rock-kingdom')
const hasCompactControls = computed(
  () =>
    (props.view?.maps?.length ?? 0) > 1 ||
    (props.view?.variants?.length ?? 0) > 1 ||
    (props.view?.floors?.length ?? 0) > 1 ||
    (props.view?.regions?.length ?? 0) > 0 ||
    (props.view?.randomEvents?.length ?? 0) > 0
)

const collapsedGroups = ref({})

function applyGroupLayout(view) {
  if (!view) {
    collapsedGroups.value = {}
    return
  }

  const next = {}
  for (const [index, group] of (view.layerGroups ?? []).entries()) {
    next[group.slug] = isRocomMode.value ? false : index > 8
  }
  collapsedGroups.value = next
}

function isCollapsed(slug) {
  return collapsedGroups.value[slug] ?? false
}

function toggleGroup(slug) {
  collapsedGroups.value = {
    ...collapsedGroups.value,
    [slug]: !isCollapsed(slug)
  }
}

function expandAllGroups() {
  const next = {}
  for (const group of props.view?.layerGroups ?? []) {
    next[group.slug] = false
  }
  collapsedGroups.value = next
}

function collapseAllGroups() {
  const next = {}
  for (const group of props.view?.layerGroups ?? []) {
    next[group.slug] = true
  }
  collapsedGroups.value = next
}

watch(
  () => [props.view?.currentMode?.slug, props.view?.currentMap?.slug, props.view?.layerGroups?.length],
  () => applyGroupLayout(props.view),
  { immediate: true }
)
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar--rocom': isRocomMode }">
    <template v-if="isRocomMode">
      <section class="sidebar-section sidebar-section--tight sidebar-section--rocom-top" v-if="(view?.modes?.length ?? 0) > 1">
        <div class="mode-strip">
          <button
            v-for="mode in view?.modes ?? []"
            :key="mode.slug"
            class="mode-tab"
            :class="{ 'is-active': mode.slug === view?.currentMode.slug }"
            @click="$emit('change-mode', mode.slug)"
          >
            {{ mode.name }}
          </button>
        </div>
      </section>

      <div class="rocom-hero">
        <p class="rocom-hero__meta">DK Collection Atlas</p>
        <h1>洛克王国点位图</h1>
        <p class="rocom-hero__subtitle">独立布局 · {{ view?.currentMap.name ?? '世界地图' }}</p>
        <div class="rocom-hero__stats">
          <span class="rocom-stat">{{ view?.currentMap.name ?? '世界地图' }}</span>
          <span class="rocom-stat">{{ view?.stats.totalPoints ?? 0 }} 个点位</span>
        </div>
        <div class="rocom-hero__actions">
          <button class="rocom-action rocom-action--show" @click="$emit('select-all-layers')">显示全部</button>
          <button class="rocom-action rocom-action--hide" @click="$emit('clear-all-layers')">清空点位</button>
        </div>
      </div>

      <section class="sidebar-section sidebar-section--tight">
        <div class="search-input search-input--rocom">
          <span class="search-input__prefix">⌕</span>
          <input
            :value="search"
            type="text"
            placeholder="搜索点位、材料或区域"
            @input="$emit('update-search', $event.target.value)"
          />
          <button type="button" class="search-input__submit" @click="$emit('update-search', search)">筛选</button>
        </div>
      </section>

      <section v-if="hasCompactControls" class="sidebar-section sidebar-section--tight">
        <div class="rocom-compact-grid">
          <label class="control-field control-field--rocom" v-if="(view?.maps?.length ?? 0) > 1">
            <span>地图</span>
            <select :value="view?.currentMap.slug" @change="$emit('change-map', $event.target.value)">
              <option v-for="map in view?.maps ?? []" :key="map.slug" :value="map.slug">
                {{ map.name }}
              </option>
            </select>
          </label>
          <label class="control-field control-field--rocom" v-if="(view?.variants?.length ?? 0) > 1">
            <span>模式</span>
            <select :value="view?.currentVariant" @change="$emit('change-variant', $event.target.value)">
              <option v-for="variant in view?.variants ?? []" :key="variant.slug" :value="variant.slug">
                {{ variant.label }}
              </option>
            </select>
          </label>
          <label class="control-field control-field--rocom" v-if="(view?.floors?.length ?? 0) > 1">
            <span>楼层</span>
            <select :value="view?.currentFloor" @change="$emit('change-floor', $event.target.value)">
              <option v-for="floor in view?.floors ?? []" :key="floor.slug" :value="floor.slug">
                {{ floor.name }}
              </option>
            </select>
          </label>
          <label class="control-field control-field--rocom" v-if="(view?.regions?.length ?? 0) > 0">
            <span>定位</span>
            <select @change="$emit('focus-region', $event.target.value)">
              <option value="">全部区域</option>
              <option v-for="region in view?.regions ?? []" :key="region.name" :value="region.name">
                {{ region.name }}
              </option>
            </select>
          </label>
          <label class="control-field control-field--rocom control-field--rocom-wide" v-if="(view?.randomEvents?.length ?? 0) > 0">
            <span>事件</span>
            <select :value="view?.currentEvent" @change="$emit('change-event', $event.target.value)">
              <option value="none">不开启特殊事件</option>
              <option v-for="event in view?.randomEvents ?? []" :key="event.slug" :value="event.slug">
                {{ event.name }}
              </option>
            </select>
          </label>
        </div>
        <div class="event-pill event-pill--rocom" v-if="(view?.randomEvents?.length ?? 0) > 0">
          <span>当前事件</span>
          <strong>{{ activeEventLabel }}</strong>
        </div>
      </section>

      <section class="sidebar-section sidebar-section--grow sidebar-section--rocom-list">
        <div class="section-title section-title--rocom">
          <span>分类筛选</span>
          <small>{{ view?.stats.totalPoints ?? 0 }} 项</small>
        </div>

        <div class="layer-groups layer-groups--rocom">
          <section
            v-for="group in view?.layerGroups ?? []"
            :key="group.slug"
            class="layer-group"
          >
            <header class="layer-group__header layer-group__header--rocom">
              <strong>{{ group.name }}</strong>
            </header>
            <div class="layer-grid layer-grid--rocom">
              <button
                v-for="layer in group.layers"
                :key="layer.slug"
                class="layer-tile layer-tile--rocom"
                :class="{ 'is-active': layer.enabled }"
                @click="$emit('toggle-layer', layer.slug)"
              >
                <span class="layer-tile__lead">
                  <span class="layer-tile__icon layer-tile__icon--rocom" :style="{ '--layer-color': layer.color }">
                    <img :src="buildLayerIcon(layer.icon, layer.color)" :alt="layer.name" />
                  </span>
                  <span class="layer-tile__name layer-tile__name--rocom">{{ layer.name }}</span>
                </span>
                <span class="layer-tile__count layer-tile__count--inline">{{ layer.count }}</span>
              </button>
            </div>
          </section>
        </div>
      </section>

      <footer class="sidebar-footer sidebar-footer--rocom">
        <span v-if="loading">数据同步中...</span>
        <span v-else>显示结果 {{ view?.stats.visiblePoints ?? 0 }} / {{ view?.stats.totalPoints ?? 0 }}</span>
      </footer>
    </template>

    <template v-else>
      <div class="brand-panel">
        <div class="brand-panel__logo">△</div>
        <div>
          <p class="eyebrow">Delta Tactical Knowledge</p>
          <h1>DK 地图工具</h1>
        </div>
      </div>

      <section class="sidebar-section sidebar-section--tight">
        <div class="mode-grid">
          <button
            v-for="mode in view?.modes ?? []"
            :key="mode.slug"
            class="mode-card"
            :class="{ 'is-active': mode.slug === view?.currentMode.slug }"
            :style="{ '--mode-accent': mode.accent }"
            @click="$emit('change-mode', mode.slug)"
          >
            <span class="mode-card__meta">{{ mode.subtitle }}</span>
            <strong>{{ mode.name }}</strong>
            <small>{{ mode.description }}</small>
          </button>
        </div>
      </section>

      <section class="sidebar-section sidebar-section--tight">
        <div class="section-title">
          <span>{{ view?.currentMap.name ?? '地图' }}</span>
          <small>{{ view?.currentMode.name ?? '' }}</small>
        </div>
        <div class="chip-row">
          <button
            v-for="map in view?.maps ?? []"
            :key="map.slug"
            class="chip"
            :class="{ 'is-active': map.slug === view?.currentMap.slug }"
            @click="$emit('change-map', map.slug)"
          >
            {{ map.name }}
          </button>
        </div>
        <div class="chip-row chip-row--compact" v-if="(view?.variants?.length ?? 0) > 1">
          <button
            v-for="variant in view?.variants ?? []"
            :key="variant.slug"
            class="chip chip--ghost"
            :class="{ 'is-active': variant.slug === view?.currentVariant }"
            @click="$emit('change-variant', variant.slug)"
          >
            {{ variant.label }}
          </button>
        </div>
      </section>

      <section class="sidebar-section sidebar-section--tight">
        <label class="search-input">
          <span>搜索点位</span>
          <input
            :value="search"
            type="text"
            placeholder="搜索点位、区域或条件"
            @input="$emit('update-search', $event.target.value)"
          />
        </label>
      </section>

      <section class="sidebar-section sidebar-section--tight">
        <div class="control-grid">
          <label class="control-field" v-if="(view?.regions?.length ?? 0) > 0">
            <span>地图快速定位</span>
            <select @change="$emit('focus-region', $event.target.value)">
              <option value="">选择区域</option>
              <option v-for="region in view?.regions ?? []" :key="region.name" :value="region.name">
                {{ region.name }}
              </option>
            </select>
          </label>
          <label class="control-field" v-if="(view?.floors?.length ?? 0) > 1">
            <span>查看地图分层</span>
            <select :value="view?.currentFloor" @change="$emit('change-floor', $event.target.value)">
              <option v-for="floor in view?.floors ?? []" :key="floor.slug" :value="floor.slug">
                {{ floor.name }}
              </option>
            </select>
          </label>
          <label class="control-field control-field--wide" v-if="(view?.randomEvents?.length ?? 0) > 0">
            <span>开启地图随机事件</span>
            <select :value="view?.currentEvent" @change="$emit('change-event', $event.target.value)">
              <option value="none">不开启特殊事件</option>
              <option v-for="event in view?.randomEvents ?? []" :key="event.slug" :value="event.slug">
                {{ event.name }}
              </option>
            </select>
          </label>
        </div>
        <div class="event-pill" v-if="(view?.randomEvents?.length ?? 0) > 0">
          <span>当前事件</span>
          <strong>{{ activeEventLabel }}</strong>
        </div>
      </section>

      <section class="sidebar-section sidebar-section--grow">
        <div class="section-title section-title--compact">
          <span>图层筛选</span>
          <div class="section-title__actions">
            <button class="inline-action" @click="$emit('select-all-layers')">全选</button>
            <button class="inline-action" @click="expandAllGroups">展开</button>
            <button class="inline-action" @click="collapseAllGroups">收起</button>
          </div>
        </div>

        <div class="layer-groups">
          <section
            v-for="group in view?.layerGroups ?? []"
            :key="group.slug"
            class="layer-group"
            :class="{ 'is-collapsed': isCollapsed(group.slug) }"
          >
            <header class="layer-group__header">
              <strong>{{ group.name }}</strong>
              <button class="layer-group__toggle" @click="toggleGroup(group.slug)">
                {{ isCollapsed(group.slug) ? '展开' : '收起' }}
              </button>
            </header>
            <div v-if="!isCollapsed(group.slug)" class="layer-grid">
              <button
                v-for="layer in group.layers"
                :key="layer.slug"
                class="layer-tile"
                :class="{ 'is-active': layer.enabled }"
                @click="$emit('toggle-layer', layer.slug)"
              >
                <span class="layer-tile__icon" :style="{ '--layer-color': layer.color }">
                  <img :src="buildLayerIcon(layer.icon, layer.color)" :alt="layer.name" />
                </span>
                <span class="layer-tile__count">{{ layer.count }}</span>
                <span class="layer-tile__name">{{ layer.name }}</span>
              </button>
            </div>
          </section>
        </div>
      </section>

      <footer class="sidebar-footer">
        <span v-if="loading">数据同步中...</span>
        <span v-else>当前可见 {{ view?.stats.visiblePoints ?? 0 }} / {{ view?.stats.totalPoints ?? 0 }}</span>
      </footer>
    </template>
  </aside>
</template>
