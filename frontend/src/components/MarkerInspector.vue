<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  point: {
    type: Object,
    default: null
  },
  view: {
    type: Object,
    default: null
  },
  activeEvent: {
    type: Object,
    default: null
  },
  modeSlug: {
    type: String,
    default: ''
  }
})

const isRocomMode = computed(() => props.modeSlug === 'rock-kingdom')
const pointImages = computed(() => props.point?.imageUrls ?? [])
const activeImageIndex = ref(0)
const activeImageUrl = computed(() => pointImages.value[activeImageIndex.value] ?? '')

watch(
  () => props.point?.id,
  () => {
    activeImageIndex.value = 0
  }
)

function setActiveImage(index) {
  if (index < 0 || index >= pointImages.value.length) return
  activeImageIndex.value = index
}

function showPrevImage() {
  if (pointImages.value.length <= 1) return
  activeImageIndex.value = (activeImageIndex.value - 1 + pointImages.value.length) % pointImages.value.length
}

function showNextImage() {
  if (pointImages.value.length <= 1) return
  activeImageIndex.value = (activeImageIndex.value + 1) % pointImages.value.length
}
</script>

<template>
  <aside class="inspector" :class="{ 'inspector--rocom': isRocomMode }">
    <template v-if="point">
      <div class="inspector__header">
        <span class="inspector__tag" :style="{ '--tag-color': point.layerColor }">{{ point.layerName }}</span>
        <strong>{{ point.name }}</strong>
        <small>{{ point.regionName }}</small>
      </div>
      <p class="inspector__body">{{ point.detail }}</p>
      <div class="inspector__meta">
        <span>稀有度 {{ point.rarity }}</span>
        <span>收益评分 {{ point.lootScore }}</span>
        <span v-if="point.floor">楼层 {{ point.floor.toUpperCase() }}</span>
      </div>
      <div v-if="pointImages.length" class="inspector__media">
        <div class="inspector__media-stage">
          <a
            class="inspector__media-link"
            :href="activeImageUrl"
            target="_blank"
            rel="noreferrer"
          >
            <img
              :src="activeImageUrl"
              :alt="`${point.name} 参考图 ${activeImageIndex + 1}`"
              loading="eager"
              decoding="async"
            />
          </a>
          <button
            v-if="pointImages.length > 1"
            class="inspector__media-nav inspector__media-nav--prev"
            type="button"
            @click="showPrevImage"
          >
            ‹
          </button>
          <button
            v-if="pointImages.length > 1"
            class="inspector__media-nav inspector__media-nav--next"
            type="button"
            @click="showNextImage"
          >
            ›
          </button>
          <span class="inspector__media-count">{{ activeImageIndex + 1 }} / {{ pointImages.length }}</span>
        </div>

        <div v-if="pointImages.length > 1" class="inspector__thumbs">
          <button
            v-for="(imageUrl, index) in pointImages"
            :key="`${point.id}-${index}-${imageUrl}`"
            class="inspector__thumb"
            :class="{ 'is-active': index === activeImageIndex }"
            type="button"
            @click="setActiveImage(index)"
          >
            <img :src="imageUrl" :alt="`${point.name} 缩略图 ${index + 1}`" loading="lazy" decoding="async" />
          </button>
        </div>
      </div>
      <div class="inspector__condition">
        <span>拾取条件</span>
        <strong>{{ point.condition }}</strong>
      </div>
      <p class="inspector__summary">{{ point.summary }}</p>
    </template>

    <template v-else>
      <div class="inspector__header">
        <span class="inspector__tag" style="--tag-color:#13f2a0">视图概览</span>
        <strong>{{ view?.currentMap.name ?? 'DK 地图工具' }}</strong>
        <small>{{ view?.currentMode.description ?? '' }}</small>
      </div>
      <p class="inspector__body">
        {{ activeEvent?.summary || view?.currentMap.description || '选择任意标记查看详细点位说明。' }}
      </p>
      <div class="inspector__meta">
        <span>可见点位 {{ view?.stats.visiblePoints ?? 0 }}</span>
        <span>总点位 {{ view?.stats.totalPoints ?? 0 }}</span>
        <span>模式 {{ view?.currentVariant ?? '-' }}</span>
      </div>
      <div class="inspector__condition" v-if="activeEvent">
        <span>事件提示</span>
        <strong>{{ activeEvent.hint }}</strong>
      </div>
    </template>
  </aside>
</template>
