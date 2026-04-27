<script setup>
const props = defineProps({
  activeEvent: {
    type: Object,
    default: null
  },
  modeSlug: {
    type: String,
    default: ''
  }
})

defineEmits(['zoom-in', 'zoom-out', 'share', 'export', 'reset'])

const items = [
  { key: 'share', label: '分享', sub: '复制链接' },
  { key: 'export', label: '导出', sub: '导出点位' },
  { key: 'reset', label: '校准', sub: '重置筛选' },
  { key: 'zoom-in', label: '放大', sub: '地图缩放 +' },
  { key: 'zoom-out', label: '缩小', sub: '地图缩放 -' }
]
</script>

<template>
  <aside class="toolbar-rail" :class="{ 'toolbar-rail--rocom': modeSlug === 'rock-kingdom' }">
    <div class="toolbar-rail__event" v-if="activeEvent">
      <span>事件热区</span>
      <strong>{{ activeEvent.name }}</strong>
    </div>

    <button
      v-for="item in items"
      :key="item.key"
      class="toolbar-button"
      @click="$emit(item.key)"
    >
      <strong>{{ item.label }}</strong>
      <small>{{ item.sub }}</small>
    </button>
  </aside>
</template>
