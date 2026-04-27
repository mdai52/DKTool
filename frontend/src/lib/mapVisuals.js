function encodeSvg(markup) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
}

function hashSeed(input) {
  return [...input].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 2147483647, 7)
}

function createRng(seed) {
  let value = seed % 2147483647
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

function topoLines(rng) {
  const lines = []
  for (let index = 0; index < 18; index += 1) {
    const y = 48 + index * 52
    const amplitude = 12 + rng() * 24
    const phase = rng() * 160
    lines.push(
      `<path d="M-40 ${y} C 160 ${y - amplitude}, 320 ${y + amplitude}, 520 ${y - amplitude * 0.35} S 840 ${y + amplitude}, 1040 ${y - amplitude * 0.2}" />`
    )
  }
  return `<g class="topo">${lines.join('')}</g>`
}

function roadPath(points) {
  if (!points.length) return ''
  const [first, ...rest] = points
  return `M ${first.x} ${first.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(' ')}`
}

function themeGeometry(theme, regions, rng) {
  const points = regions.map((region) => ({ x: region.x, y: region.y }))
  const compounds = regions
    .map((region, index) => {
      const width = 82 + rng() * 90
      const height = 42 + rng() * 68
      return `<rect x="${region.x - width / 2}" y="${region.y - height / 2}" width="${width}" height="${height}" rx="${8 + (index % 3) * 3}" />`
    })
    .join('')

  const roads = `<path class="roads" d="${roadPath(points)}" />`

  const palettes = {
    dam: `<path class="water" d="M 470 -40 C 560 170, 420 330, 525 560 S 645 910, 540 1040 L 430 1040 C 325 915, 455 715, 365 520 S 370 170, 270 -40 Z" />
      <rect class="slab" x="564" y="120" width="320" height="98" rx="6" />
      <rect class="slab" x="598" y="612" width="220" height="136" rx="8" />
      <rect class="slab" x="280" y="260" width="164" height="126" rx="8" />`,
    valley: `<path class="water" d="M 60 120 C 250 210, 340 260, 460 420 S 760 620, 940 830" />
      <path class="terrain" d="M 0 220 C 160 150, 260 170, 360 320 S 540 520, 760 460 S 920 360, 1040 430 L 1040 1040 L 0 1040 Z" />
      <path class="terrain terrain--alt" d="M 0 120 C 160 40, 280 40, 420 180 S 720 340, 1040 220 L 1040 0 L 0 0 Z" />`,
    base: `<rect class="runway" x="120" y="430" width="760" height="140" rx="12" />
      <rect class="slab" x="640" y="120" width="154" height="144" rx="10" />
      <rect class="slab" x="200" y="660" width="250" height="160" rx="10" />
      <circle class="terrain" cx="520" cy="590" r="110" />`,
    city: `<path class="canal" d="M 90 640 C 260 520, 420 460, 560 520 S 820 650, 980 720" />
      <rect class="district" x="160" y="180" width="220" height="180" rx="16" />
      <rect class="district" x="420" y="260" width="200" height="200" rx="16" />
      <rect class="district" x="640" y="140" width="190" height="240" rx="16" />
      <rect class="district" x="480" y="580" width="300" height="220" rx="16" />`,
    prison: `<circle class="ring" cx="520" cy="500" r="220" />
      <circle class="ring ring--inner" cx="520" cy="500" r="124" />
      <path class="water" d="M -40 790 C 120 730, 250 760, 360 880 S 620 1020, 1040 930 L 1040 1040 L -40 1040 Z" />
      <rect class="slab" x="260" y="300" width="146" height="116" rx="10" />
      <rect class="slab" x="650" y="320" width="140" height="102" rx="10" />`,
    'warfare-trench': `<path class="trench" d="M 70 620 C 220 550, 340 560, 470 480 S 760 350, 970 420" />
      <path class="trench trench--alt" d="M 90 730 C 260 650, 380 670, 520 600 S 780 500, 930 530" />
      <circle class="crater" cx="620" cy="232" r="74" />
      <circle class="crater" cx="300" cy="488" r="56" />`,
    'warfare-city': `<path class="canal" d="M 90 520 C 340 420, 520 460, 720 420 S 890 260, 980 210" />
      <rect class="district" x="170" y="320" width="180" height="160" rx="12" />
      <rect class="district" x="430" y="420" width="180" height="160" rx="12" />
      <rect class="district" x="680" y="260" width="210" height="190" rx="12" />
      <rect class="district" x="600" y="650" width="210" height="150" rx="12" />`
  }

  return `${palettes[theme] ?? ''}<g class="compounds">${compounds}</g>${roads}`
}

function buildEventHalo(regions, activeEvent) {
  if (!activeEvent) return ''
  const region = regions.find((item) => item.name === activeEvent.focusRegion)
  if (!region) return ''
  return `<g class="event">
    <circle cx="${region.x}" cy="${region.y}" r="88" fill="${activeEvent.highlightColor}" fill-opacity="0.16" />
    <circle cx="${region.x}" cy="${region.y}" r="122" stroke="${activeEvent.highlightColor}" stroke-width="2.5" stroke-dasharray="12 10" fill="none" />
  </g>`
}

export function buildMapArt(map, regions, activeEvent) {
  if (!map) return ''
  const rng = createRng(hashSeed(map.slug))
  const markup = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" fill="none">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0b1516" />
          <stop offset="100%" stop-color="#172123" />
        </linearGradient>
        <filter id="blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="24" />
        </filter>
        <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
          <path d="M 60 0 L 0 0 0 60" stroke="rgba(124,156,160,0.18)" stroke-width="1" />
        </pattern>
      </defs>
      <style>
        .topo path { stroke: rgba(153, 176, 180, 0.12); stroke-width: 1.15; }
        .roads { stroke: rgba(248,248,248,0.24); stroke-width: 18; stroke-linecap: round; stroke-linejoin: round; fill: none; }
        .compounds rect { fill: rgba(240, 244, 245, 0.14); stroke: rgba(255,255,255,0.12); stroke-width: 1.3; }
        .water { fill: rgba(54, 96, 110, 0.55); stroke: rgba(157, 227, 255, 0.16); stroke-width: 3; }
        .slab { fill: rgba(235,235,235,0.15); }
        .terrain { fill: rgba(56, 77, 69, 0.24); }
        .terrain--alt { fill: rgba(76, 64, 52, 0.18); }
        .district { fill: rgba(229, 229, 229, 0.12); stroke: rgba(255,255,255,0.08); }
        .canal { stroke: rgba(107, 157, 173, 0.55); stroke-width: 46; fill: none; stroke-linecap: round; }
        .ring { stroke: rgba(230,230,230,0.22); stroke-width: 44; fill: none; }
        .ring--inner { stroke-width: 14; stroke: rgba(255,255,255,0.16); }
        .runway { fill: rgba(209,214,215,0.12); stroke: rgba(255,255,255,0.08); }
        .trench { stroke: rgba(163, 140, 110, 0.32); stroke-width: 18; fill: none; stroke-linecap: round; stroke-dasharray: 34 22; }
        .trench--alt { stroke-width: 12; opacity: 0.68; }
        .crater { fill: rgba(49, 43, 35, 0.28); stroke: rgba(244, 191, 121, 0.16); stroke-width: 2; }
      </style>
      <rect width="1000" height="1000" fill="url(#bg)" />
      <rect width="1000" height="1000" fill="url(#grid)" opacity="0.42" />
      <ellipse cx="540" cy="250" rx="260" ry="120" fill="rgba(255,255,255,0.05)" filter="url(#blur)" />
      ${topoLines(rng)}
      ${themeGeometry(map.theme, regions, rng)}
      ${buildEventHalo(regions, activeEvent)}
    </svg>
  `
  return encodeSvg(markup)
}

const iconPaths = {
  'safe-box': '<rect x="18" y="18" width="76" height="60" rx="10"/><circle cx="66" cy="48" r="6"/><path d="M30 38h24M30 58h24"/>',
  'small-safe': '<rect x="24" y="24" width="64" height="52" rx="10"/><circle cx="66" cy="50" r="6"/><path d="M34 42h18M34 58h18"/>',
  server: '<rect x="22" y="14" width="68" height="72" rx="10"/><path d="M34 34h44M34 52h44M34 70h28"/><circle cx="74" cy="70" r="4"/>',
  workstation: '<rect x="18" y="20" width="76" height="48" rx="8"/><path d="M42 78h28M54 68v10"/>',
  'weapon-case': '<rect x="14" y="36" width="84" height="28" rx="8"/><path d="M26 50h48M78 50h8"/>',
  'ammo-box': '<rect x="18" y="26" width="76" height="48" rx="10"/><path d="M32 40l8-12M52 40l8-12M72 40l8-12"/>',
  'medical-cache': '<rect x="20" y="24" width="72" height="54" rx="12"/><path d="M56 34v34M39 51h34"/>',
  'tool-cabinet': '<rect x="24" y="16" width="64" height="72" rx="8"/><path d="M34 32h44M34 52h44M34 72h44"/>',
  'travel-bag': '<path d="M28 42h56l8 32H20z"/><path d="M40 42v-8a8 8 0 0 1 8-8h16a8 8 0 0 1 8 8v8"/>',
  'intel-cache': '<path d="M20 30h28l10 10h30v34H20z"/><path d="M48 30v10h10"/>',
  spawn: '<path d="M56 12l20 20-20 20-20-20z"/><circle cx="56" cy="56" r="20"/><path d="M56 42v28M42 56h28"/>',
  'paid-extract': '<path d="M20 50h48"/><path d="M54 34l18 16-18 16"/><circle cx="82" cy="24" r="12"/>',
  'standard-extract': '<path d="M18 50h52"/><path d="M54 34l18 16-18 16"/><path d="M24 24h18"/>',
  'conditional-extract': '<path d="M18 50h48"/><path d="M50 34l18 16-18 16"/><circle cx="82" cy="22" r="8"/><path d="M82 18v8"/>',
  boss: '<path d="M56 14l26 14v24c0 14-10 26-26 34-16-8-26-20-26-34V28z"/><path d="M44 50h24M48 60h16"/>',
  signal: '<path d="M56 18v50"/><path d="M36 68h40"/><path d="M46 30c6-6 14-6 20 0M38 22c10-10 26-10 36 0"/>',
  sector: '<path d="M56 14l28 20v30c0 10-8 18-18 18H46c-10 0-18-8-18-18V34z"/><path d="M40 56h32"/>',
  'attack-base': '<path d="M20 72h72"/><path d="M28 64V30l28-16 28 16v34"/><path d="M56 20v24"/>',
  'defense-base': '<path d="M22 72h68"/><path d="M28 68V30h56v38"/><path d="M42 44h28"/>',
  'ammo-resupply': '<rect x="18" y="30" width="76" height="42" rx="8"/><path d="M30 42l8-12M52 42l8-12M74 42l8-12"/>',
  'mounted-gun': '<path d="M26 66h60"/><path d="M44 66l12-36 16 10"/><circle cx="70" cy="42" r="8"/>',
  'vehicle-pad': '<rect x="22" y="34" width="58" height="28" rx="6"/><path d="M80 44h10v18H80"/><circle cx="36" cy="68" r="8"/><circle cx="74" cy="68" r="8"/>',
  uplink: '<circle cx="56" cy="28" r="10"/><path d="M56 38v28"/><path d="M36 70h40"/><path d="M34 28c12-12 32-12 44 0"/><path d="M28 22c16-18 40-18 56 0"/>'
}

export function buildLayerIcon(iconSlug, color = '#13f2a0') {
  if (!iconSlug) {
    return ''
  }
  if (
    iconSlug.startsWith('/api/') ||
    iconSlug.startsWith('data:') ||
    iconSlug.startsWith('http://') ||
    iconSlug.startsWith('https://') ||
    iconSlug.startsWith('//')
  ) {
    return iconSlug
  }

  const path = iconPaths[iconSlug] ?? iconPaths['safe-box']
  const markup = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 112" fill="none">
      <rect x="6" y="6" width="100" height="100" rx="24" fill="rgba(8,18,20,0.84)" stroke="${color}" stroke-opacity="0.45" />
      <g stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${path}</g>
    </svg>
  `
  return encodeSvg(markup)
}

const localAssetBaseUrl = '/api/assets'
const remoteTileBaseUrl = `${localAssetBaseUrl}/tile/delta-force`

const extractionRemoteMaps = {
  'zero-dam': {
    base: {
      folder: 'map_db',
      boundsW: -250,
      boundsH: 250,
      minZoom: 3,
      initZoom: 3,
      initX: -85,
      initY: 110
    },
    floors: {
      b1: {
        folder: 'daba_0f',
        boundsW: -120,
        boundsH: 140,
        minZoom: 4.8,
        initZoom: 4.8,
        initX: -33,
        initY: 8,
        latLngX: -22,
        latLngY: 30,
        pixelToLatLngRatio: -0.85
      },
      '1f': {
        folder: 'daba_1f',
        boundsW: -100,
        boundsH: 120,
        minZoom: 6,
        initZoom: 6,
        initX: -33,
        initY: 68,
        latLngX: -25,
        latLngY: 55,
        pixelToLatLngRatio: -0.85
      },
      '2f': {
        folder: 'daba_2f',
        boundsW: -100,
        boundsH: 120,
        minZoom: 6,
        initZoom: 6,
        initX: -33,
        initY: 68,
        latLngX: -25,
        latLngY: 55,
        pixelToLatLngRatio: -0.85
      }
    }
  },
  'longbow-valley': {
    base: {
      folder: 'map_yc',
      boundsW: -250,
      boundsH: 320,
      minZoom: 3,
      initZoom: 3,
      initX: -135,
      initY: 110
    },
    floors: {
      '1f': {
        folder: 'cgxg_1f',
        boundsW: -250,
        boundsH: 320,
        minZoom: 6,
        initZoom: 6.5,
        initX: -77,
        initY: 58,
        latLngX: -68,
        latLngY: 43,
        pixelToLatLngRatio: -0.35
      },
      '2f': {
        folder: 'cgxg_2f',
        boundsW: -250,
        boundsH: 320,
        minZoom: 6,
        initZoom: 6.5,
        initX: -77,
        initY: 58,
        latLngX: -68,
        latLngY: 43,
        pixelToLatLngRatio: -0.35
      }
    }
  },
  'space-base': {
    base: {
      folder: 'map_htjd',
      boundsW: -250,
      boundsH: 320,
      minZoom: 3,
      initZoom: 3,
      initX: -115,
      initY: 110
    }
  },
  baksh: {
    base: {
      folder: 'map_bks2',
      boundsW: -250,
      boundsH: 300,
      minZoom: 3,
      initZoom: 3,
      initX: -110,
      initY: 110
    },
    floors: {
      b1: {
        folder: 'bks_1f',
        boundsW: -85,
        boundsH: 140,
        minZoom: 5.5,
        initZoom: 5.5,
        initX: -58,
        initY: 62,
        latLngX: -47,
        latLngY: 38,
        pixelToLatLngRatio: -1
      },
      '1f': {
        folder: 'bks_2f',
        boundsW: -85,
        boundsH: 140,
        minZoom: 5.5,
        initZoom: 5.5,
        initX: -58,
        initY: 62,
        latLngX: -47,
        latLngY: 38,
        pixelToLatLngRatio: -1
      },
      '2f': {
        folder: 'bks_3f',
        boundsW: -85,
        boundsH: 140,
        minZoom: 5.5,
        initZoom: 5.5,
        initX: -58,
        initY: 62,
        latLngX: -47,
        latLngY: 38,
        pixelToLatLngRatio: -1
      }
    }
  },
  'tide-prison': {
    base: {
      folder: 'map_cxjy',
      boundsW: -250,
      boundsH: 300,
      minZoom: 2.5,
      initZoom: 2.5,
      initX: -135,
      initY: 150
    },
    floors: {
      '1f': {
        folder: 'cxjy_1f',
        boundsW: -400,
        boundsH: 350,
        minZoom: 3.5,
        initZoom: 3.5,
        initX: -135,
        initY: 150,
        latLngX: -20,
        latLngY: -20,
        pixelToLatLngRatio: -0.35,
        maxNativeZoom: 5
      },
      '2f': {
        folder: 'cxjy_2f',
        boundsW: -400,
        boundsH: 350,
        minZoom: 3.5,
        initZoom: 3.5,
        initX: -135,
        initY: 150,
        latLngX: -20,
        latLngY: -20,
        pixelToLatLngRatio: -0.35,
        maxNativeZoom: 5
      },
      '3f': {
        folder: 'cxjy_3f',
        boundsW: -400,
        boundsH: 350,
        minZoom: 3.5,
        initZoom: 3.5,
        initX: -135,
        initY: 150,
        latLngX: -20,
        latLngY: -20,
        pixelToLatLngRatio: -0.35,
        maxNativeZoom: 5
      },
      '4f': {
        folder: 'cxjy_4f',
        boundsW: -400,
        boundsH: 350,
        minZoom: 3.5,
        initZoom: 3.5,
        initX: -135,
        initY: 150,
        latLngX: -20,
        latLngY: -20,
        pixelToLatLngRatio: -0.35,
        maxNativeZoom: 5
      }
    }
  }
}

function withTileDefaults(layer, floor = false) {
  return {
    projection: 'simple',
    urlTemplate: `${remoteTileBaseUrl}/${layer.folder}/{z}/{x}_{y}.jpg`,
    maxZoom: 8,
    maxNativeZoom: layer.maxNativeZoom ?? (floor ? 6 : 4),
    tileSize: floor ? 512 : 256,
    zoomOffset: floor ? -1 : 0,
    latLngX: layer.latLngX ?? 0,
    latLngY: layer.latLngY ?? 0,
    pixelToLatLngRatio: layer.pixelToLatLngRatio ?? -1,
    ...layer
  }
}

function normalizeExternalTileSource(source) {
  if (!source || typeof source !== 'object') return null

  const normalized = { ...source }
  if (!normalized.urlTemplate && normalized.keyPrefix) {
    if (String(normalized.keyPrefix).startsWith('tile/rocom/')) {
      normalized.urlTemplate = `${localAssetBaseUrl}/${normalized.keyPrefix}/{z}/{y}_{x}.png`
      normalized.tileSize ??= 256
      normalized.noWrap ??= true
    }
  }
  if (!Number.isFinite(normalized.initLat) && normalized.initCenter?.lat != null) {
    normalized.initLat = normalized.initCenter.lat
  }
  if (!Number.isFinite(normalized.initLng) && normalized.initCenter?.lng != null) {
    normalized.initLng = normalized.initCenter.lng
  }

  return normalized.urlTemplate ? normalized : null
}

const rockKingdomRemoteMaps = {
  shijie: {
    projection: 'geo',
    // 17173 rocom tiles are addressed as {y}_{x}, not {x}_{y}.
    urlTemplate: `${localAssetBaseUrl}/tile/rocom/4010_v3_7f2d9c/{z}/{y}_{x}.png`,
    minZoom: 9,
    maxZoom: 13,
    maxNativeZoom: 13,
    tileSize: 256,
    noWrap: true,
    initZoom: 11,
    initLat: 0.5,
    initLng: -0.6,
    bounds: {
      south: 0,
      west: -1.4,
      north: 1.4,
      east: 0
    }
  }
}

const warfareRemoteMaps = {
  pc: {
    attack: {
      folder: 'map_pc',
      boundsW: -300,
      boundsH: 300,
      minZoom: 2.5,
      initZoom: 2.5,
      initX: -120,
      initY: 90
    },
    occupy: {
      folder: 'map_pc_zl',
      boundsW: -250,
      boundsH: 300,
      minZoom: 2.8,
      initZoom: 2.8,
      initX: -130,
      initY: 90
    }
  },
  ljd: {
    attack: {
      folder: 'map_ljd_pc',
      boundsW: -250,
      boundsH: 300,
      minZoom: 3,
      initZoom: 3,
      initX: -120,
      initY: 105
    },
    occupy: {
      folder: 'map_ljd_zl',
      boundsW: -250,
      boundsH: 300,
      minZoom: 3,
      initZoom: 3,
      initX: -120,
      initY: 105
    }
  },
  gc: {
    attack: {
      folder: 'map_gc',
      boundsW: -300,
      boundsH: 300,
      minZoom: 2.8,
      initZoom: 2.8,
      initX: -110,
      initY: 125
    },
    occupy: {
      folder: 'map_gc_zl',
      boundsW: -300,
      boundsH: 300,
      minZoom: 2.8,
      initZoom: 2.8,
      initX: -110,
      initY: 170
    }
  },
  jq: {
    attack: {
      folder: 'map_jq',
      boundsW: -300,
      boundsH: 300,
      minZoom: 3,
      initZoom: 3,
      initX: -130,
      initY: 100
    },
    occupy: {
      folder: 'map_jq_zl',
      boundsW: -300,
      boundsH: 300,
      minZoom: 2.5,
      initZoom: 2.5,
      initX: -130,
      initY: 100
    }
  },
  qhz: {
    attack: {
      folder: 'map_qhz',
      boundsW: -300,
      boundsH: 300,
      minZoom: 2.5,
      initZoom: 2.5,
      initX: -130,
      initY: 110
    },
    occupy: {
      folder: 'map_qhz_zl',
      boundsW: -300,
      boundsH: 310,
      minZoom: 2,
      initZoom: 2.2,
      initX: -150,
      initY: 110
    }
  },
  df: {
    attack: {
      folder: 'map_df',
      boundsW: -300,
      boundsH: 300,
      minZoom: 2.8,
      initZoom: 2.8,
      initX: -130,
      initY: 150
    },
    occupy: {
      folder: 'map_df_zl',
      boundsW: -300,
      boundsH: 300,
      minZoom: 2.8,
      initZoom: 2.8,
      initX: -130,
      initY: 140
    }
  },
  dg: {
    attack: {
      folder: 'map_dg',
      boundsW: -300,
      boundsH: 350,
      minZoom: 2,
      initZoom: 2.5,
      initX: -130,
      initY: 130
    },
    occupy: {
      folder: 'map_dg',
      boundsW: -300,
      boundsH: 300,
      minZoom: 2,
      initZoom: 2.5,
      initX: -130,
      initY: 170
    }
  },
  hdz: {
    attack: {
      folder: 'map_hdz',
      boundsW: -300,
      boundsH: 300,
      minZoom: 2.6,
      initZoom: 2.6,
      initX: -105,
      initY: 105
    },
    occupy: {
      folder: 'map_hdz',
      boundsW: -200,
      boundsH: 300,
      minZoom: 2.6,
      initZoom: 2.6,
      initX: -105,
      initY: 125
    }
  },
  jzt: {
    attack: {
      folder: 'map_jzt',
      boundsW: -300,
      boundsH: 300,
      minZoom: 2.5,
      initZoom: 2.5,
      initX: -125,
      initY: 105
    },
    occupy: {
      folder: 'map_jzt',
      boundsW: -200,
      boundsH: 300,
      minZoom: 2.5,
      initZoom: 2.5,
      initX: -125,
      initY: 125
    }
  },
  dc: {
    attack: {
      folder: 'map_dc',
      boundsW: -300,
      boundsH: 300,
      minZoom: 2.5,
      initZoom: 2.5,
      initX: -125,
      initY: 105
    },
    occupy: {
      folder: 'map_dc',
      boundsW: -240,
      boundsH: 300,
      minZoom: 2.5,
      initZoom: 2.5,
      initX: -115,
      initY: 125
    }
  },
  yz: {
    attack: {
      folder: 'map_yz',
      boundsW: -300,
      boundsH: 300,
      minZoom: 2.5,
      initZoom: 2.5,
      initX: -115,
      initY: 110
    },
    occupy: {
      folder: 'map_yz',
      boundsW: -250,
      boundsH: 500,
      minZoom: 2.5,
      initZoom: 2.5,
      initX: -130,
      initY: 100
    }
  },
  'canal-city': {
    attack: {
      folder: 'map_ljd_pc',
      boundsW: -250,
      boundsH: 300,
      minZoom: 3,
      initZoom: 3,
      initX: -120,
      initY: 105
    },
    occupy: {
      folder: 'map_ljd_zl',
      boundsW: -250,
      boundsH: 300,
      minZoom: 3,
      initZoom: 3,
      initX: -120,
      initY: 105
    }
  },
  'trench-line': {
    attack: {
      folder: 'map_qhz',
      boundsW: -300,
      boundsH: 300,
      minZoom: 2.5,
      initZoom: 2.5,
      initX: -130,
      initY: 110
    },
    occupy: {
      folder: 'map_qhz_zl',
      boundsW: -300,
      boundsH: 310,
      minZoom: 2,
      initZoom: 2.2,
      initX: -150,
      initY: 110
    }
  }
}

export function resolveRemoteTileSource(view) {
  if (!view?.currentMap) return null

  const externalTileSource = normalizeExternalTileSource(view.currentMap.tileSource)
  if (externalTileSource) {
    return externalTileSource
  }

  if (view.currentMode?.slug === 'rock-kingdom') {
    return rockKingdomRemoteMaps[view.currentMap.slug] ?? null
  }

  if (view.currentMode?.slug === 'warfare') {
    const mapConfig = warfareRemoteMaps[view.currentMap.slug]
    if (!mapConfig) return null
    return withTileDefaults(view.currentVariant === 'occupy' ? mapConfig.occupy : mapConfig.attack)
  }

  if (view.currentMode?.slug !== 'extraction') return null

  const mapConfig = extractionRemoteMaps[view.currentMap.slug]
  if (!mapConfig) return null

  const currentFloor = view.currentFloor && view.currentFloor !== 'all' ? view.currentFloor : ''
  if (currentFloor) {
    const floorConfig = mapConfig.floors?.[currentFloor]
    if (floorConfig) {
      return withTileDefaults(floorConfig, true)
    }
  }

  if (!mapConfig.base) return null
  return withTileDefaults(mapConfig.base)
}
