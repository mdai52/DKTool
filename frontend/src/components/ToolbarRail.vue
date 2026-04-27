<script setup>
const props = defineProps({
  activeEvent: {
    type: Object,
    default: null
  },
  atlasMode: {
    type: Boolean,
    default: false
  },
  modeSlug: {
    type: String,
    default: ''
  }
})

defineEmits(['zoom-in', 'zoom-out', 'share', 'export', 'reset'])

const items = [
  { key: 'share', label: '分享', sub: '复制链接', icon: '\u{1F4CB}' },
  { key: 'export', label: '导出', sub: '导出点位', icon: '\u{1F4E5}' },
  { key: 'reset', label: '校准', sub: '重置筛选', icon: '\u{1F504}' },
  { key: 'zoom-in', label: '放大', sub: '地图缩放 +', icon: '\u{1F50D}' },
  { key: 'zoom-out', label: '缩小', sub: '地图缩放 -', icon: '\u{1F505}' }
]
</script>

<template>
  <aside class="toolbar-rail" :class="{ 'toolbar-rail--rocom': atlasMode }">
    <div class="toolbar-rail__event" v-if="activeEvent">
      <span>事件热区</span>
      <strong>{{ activeEvent.name }}</strong>
    </div>

    <button
      v-for="item in items"
      :key="item.key"
      class="toolbar-button"
      :title="item.label"
      @click="$emit(item.key)"
    >
      <span class="toolbar-button__icon">{{ item.icon }}</span>
      <strong class="toolbar-button__label">{{ item.label }}</strong>
      <small class="toolbar-button__sub">{{ item.sub }}</small>
    </button>
  </aside>
</template>
