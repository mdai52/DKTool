import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const externalDatasets = loadExternalDatasets()
const externalModes = summarizeExternalModes(externalDatasets)

const modes = [
  {
    slug: 'extraction',
    name: '烽火地带',
    subtitle: '搜打撤点位图',
    description: '围绕物资点、撤离点、首领与随机事件的战术地图。',
    accent: '#13f2a0'
  },
  {
    slug: 'warfare',
    name: '全面战场',
    subtitle: '攻防战部署图',
    description: '分阶段据点、载具补给与火力支援的部署视图。',
    accent: '#f0ca5b'
  },
  ...externalModes
]

const extractionLayerGroups = [
  {
    slug: 'loot',
    name: '物资点',
    layers: [
      ['safe-box', '保险箱', 'safe-box', '#18ffad'],
      ['small-safe', '小保险箱', 'small-safe', '#8df2ca'],
      ['server', '服务器', 'server', '#6bd6ff'],
      ['workstation', '电脑', 'workstation', '#9bb6ff'],
      ['weapon-case', '武器箱', 'weapon-case', '#f0c86e'],
      ['ammo-box', '弹药箱', 'ammo-box', '#ffdd57'],
      ['medical-cache', '医疗箱', 'medical-cache', '#ff7c6b'],
      ['tool-cabinet', '工具柜', 'tool-cabinet', '#8db88b'],
      ['travel-bag', '旅行包', 'travel-bag', '#f4a86c'],
      ['intel-cache', '情报箱', 'intel-cache', '#d97cff']
    ]
  },
  {
    slug: 'spawn',
    name: '出生点',
    layers: [['spawn', '出生点', 'spawn', '#d6fbff']]
  },
  {
    slug: 'extract',
    name: '撤离点',
    layers: [
      ['paid-extract', '付费撤离', 'paid-extract', '#ffd66b'],
      ['standard-extract', '常规撤离', 'standard-extract', '#9be47a'],
      ['conditional-extract', '条件撤离', 'conditional-extract', '#7ee6ff']
    ]
  },
  {
    slug: 'threat',
    name: '威胁点',
    layers: [
      ['boss', '首领', 'boss', '#ff5c6c'],
      ['signal', '信号站', 'signal', '#46e0ff']
    ]
  }
]

const warfareLayerGroups = [
  {
    slug: 'objective',
    name: '据点',
    layers: [
      ['sector', '据点', 'sector', '#f2d85c'],
      ['attack-base', '进攻方基地', 'attack-base', '#fd8d5e'],
      ['defense-base', '防守方基地', 'defense-base', '#5ed8ff']
    ]
  },
  {
    slug: 'support',
    name: '支援',
    layers: [
      ['ammo-resupply', '弹药补给', 'ammo-resupply', '#ffe374'],
      ['mounted-gun', '固定火力', 'mounted-gun', '#ff8c7a'],
      ['vehicle-pad', '载具调度', 'vehicle-pad', '#c3f286'],
      ['uplink', '侦察终端', 'uplink', '#68d9ff']
    ]
  }
]

const extractionMaps = [
  createExtractionMap({
    slug: 'zero-dam',
    name: '零号大坝',
    caption: '常规/机密/绝密',
    description: '围绕行政辖区与水坝核心展开的高价值搜打撤地图。',
    theme: 'dam',
    floors: [
      ['all', '全部'],
      ['b1', 'B1 地下通道'],
      ['1f', '1F 行政层'],
      ['2f', '2F 指挥层']
    ],
    regions: [
      ['行政辖区', 610, 305],
      ['军营', 395, 250],
      ['水泥厂', 355, 460],
      ['主变电站', 720, 625],
      ['游客中心', 890, 860],
      ['管道区域', 275, 175]
    ],
    events: [
      ['crash-site', '坠机事件', '行政辖区与游客中心之间增加高价值残骸点。', '优先检查高处天桥与坠机尾段。', '#ff9b5f', '行政辖区'],
      ['forest-fire', '森林山火', '水泥厂与游客中心一带视野受阻，埋点价值提高。', '热区会压缩推进路线，适合二次搜刮。', '#ff6c5c', '游客中心'],
      ['bridge-cut', '断桥事件', '主变电站西侧路径断开，撤离线被重塑。', '注意条件撤离会转向地下通道。', '#67d2ff', '主变电站']
    ]
  }),
  createExtractionMap({
    slug: 'longbow-valley',
    name: '长弓溪谷',
    caption: '山谷路线图',
    description: '狙击视野长、资源拉扯明显的峡谷地图。',
    theme: 'valley',
    regions: [
      ['北谷口', 220, 190],
      ['溪谷车站', 430, 355],
      ['悬崖观测哨', 620, 185],
      ['旧矿洞', 325, 670],
      ['河心补给站', 560, 560],
      ['南侧营地', 815, 790]
    ],
    events: [
      ['fog-line', '谷雾来袭', '谷底能见度下降，高台价值提升。', '沿岩壁推进更安全。', '#7bc4ff', '溪谷车站'],
      ['supply-drop', '空投补给', '河心补给站附近刷新空投。', '高价值但极易被架枪。', '#ffc96b', '河心补给站']
    ]
  }),
  createExtractionMap({
    slug: 'space-base',
    name: '航天基地',
    caption: '立体中轴图',
    description: '中轴建筑密集，纵深与楼层切换频繁。',
    theme: 'base',
    regions: [
      ['指挥塔台', 700, 180],
      ['燃料广场', 560, 360],
      ['发射井', 510, 575],
      ['装配车间', 280, 495],
      ['停机坪', 820, 510],
      ['南区仓储', 360, 805]
    ],
    events: [
      ['power-loss', '主电失效', '部分封锁门失效，近路开启。', '发射井周边会暴露更多高价值箱。', '#ffe36a', '发射井'],
      ['launch-alert', '发射警报', '塔台周边刷新额外情报节点。', '注意高处视野压制。', '#ff7968', '指挥塔台']
    ]
  }),
  createExtractionMap({
    slug: 'baksh',
    name: '巴克什',
    caption: '城镇交易图',
    description: '街区密度高，资源分层清晰，易形成包夹。',
    theme: 'city',
    regions: [
      ['巴克什集市', 485, 420],
      ['皇家博物馆', 690, 270],
      ['蓝汀旅馆', 300, 500],
      ['大浴场', 580, 690],
      ['樱桃小镇', 210, 280],
      ['停车场', 805, 610]
    ],
    events: [
      ['market-riot', '集市骚乱', '集市中心临时刷新信号点与补给箱。', '主街视野会被临时路障打断。', '#ff915f', '巴克什集市'],
      ['museum-heist', '博物馆警报', '博物馆顶层刷新限时保险箱。', '适合打高层切入。', '#d687ff', '皇家博物馆']
    ]
  }),
  createExtractionMap({
    slug: 'tide-prison',
    name: '潮汐监狱',
    caption: '环形封锁图',
    description: '外圈推进与内环争夺并行，撤离压迫感强。',
    theme: 'prison',
    regions: [
      ['外环码头', 170, 705],
      ['西监区', 300, 390],
      ['中央监管塔', 525, 500],
      ['医务监区', 710, 420],
      ['北侧崖道', 610, 170],
      ['封锁闸门', 860, 710]
    ],
    events: [
      ['lockdown', '区域封锁', '部分外墙门关闭，内环资源刷新。', '优先确认码头路线。', '#5cd7ff', '中央监管塔'],
      ['tide-rise', '潮位上涨', '码头路线被水淹，南侧撤离改道。', '低位路线风险更高。', '#78b8ff', '外环码头']
    ]
  })
]

const warfareMaps = [
  createWarfareMap({
    slug: 'pc',
    name: '攀升',
    caption: '官方战场瓦图',
    description: '垂直高差与建筑推进并行的全面战场地图。',
    theme: 'warfare-city',
    regions: [
      ['前沿阵地', 180, 540],
      ['中段据点', 360, 500],
      ['核心阵地', 760, 410],
      ['高地火力点', 620, 220]
    ]
  }),
  createWarfareMap({
    slug: 'ljd',
    name: '临界点',
    caption: '官方战场瓦图',
    description: '桥区、运河与城区火力交错的全面战场地图。',
    theme: 'warfare-city',
    regions: [
      ['西侧桥头', 200, 470],
      ['中轴运河', 420, 500],
      ['城区核心', 760, 360],
      ['南岸火力点', 640, 720]
    ]
  }),
  createWarfareMap({
    slug: 'gc',
    name: '贯穿',
    caption: '官方战场瓦图',
    description: '纵深推进与多路穿插并存的全面战场地图。',
    theme: 'warfare-trench',
    regions: [
      ['西线入口', 170, 520],
      ['中段据点', 380, 500],
      ['终段阵地', 740, 420],
      ['高台火力点', 610, 210]
    ]
  }),
  createWarfareMap({
    slug: 'jq',
    name: '烬区',
    caption: '官方战场瓦图',
    description: '工业废墟和燃烧带压迫感很强的全面战场地图。',
    theme: 'warfare-trench',
    regions: [
      ['前沿废墟', 190, 530],
      ['燃烧中段', 380, 500],
      ['核心厂区', 730, 390],
      ['架高火力点', 610, 220]
    ]
  }),
  createWarfareMap({
    slug: 'qhz',
    name: '堑壕战',
    caption: '官方战场瓦图',
    description: '低地堑壕与前沿推进线并行的全面战场地图。',
    theme: 'warfare-trench',
    regions: [
      ['前沿堑壕', 180, 540],
      ['废墟车站', 360, 500],
      ['雷达站', 760, 410],
      ['山脊炮阵', 620, 220]
    ]
  }),
  createWarfareMap({
    slug: 'df',
    name: '刀锋',
    caption: '官方战场瓦图',
    description: '谷地与立交纵横切割的全面战场地图。',
    theme: 'warfare-trench',
    regions: [
      ['前线谷口', 180, 560],
      ['中段交汇', 420, 520],
      ['终点阵线', 740, 420],
      ['俯瞰火力点', 610, 240]
    ]
  }),
  createWarfareMap({
    slug: 'dg',
    name: '断轨',
    caption: '官方战场瓦图',
    description: '铁路枢纽与多方向机动并存的全面战场地图。',
    theme: 'warfare-city',
    regions: [
      ['西线集结', 180, 560],
      ['轨道中段', 410, 520],
      ['枢纽核心', 700, 420],
      ['高坡火力点', 570, 250]
    ]
  }),
  createWarfareMap({
    slug: 'hdz',
    name: '风暴眼',
    caption: '官方战场瓦图',
    description: '海岛中心争夺与环线推进并存的全面战场地图。',
    theme: 'warfare-city',
    regions: [
      ['外环阵地', 220, 500],
      ['中段据点', 430, 480],
      ['岛心核心', 700, 360],
      ['岸防火力点', 560, 230]
    ]
  }),
  createWarfareMap({
    slug: 'jzt',
    name: '金字塔',
    caption: '官方战场瓦图',
    description: '高台视野明显的沙漠遗迹全面战场地图。',
    theme: 'warfare-trench',
    regions: [
      ['外围阵地', 200, 500],
      ['遗迹中段', 410, 470],
      ['核心高台', 720, 360],
      ['侧翼火力点', 560, 220]
    ]
  }),
  createWarfareMap({
    slug: 'dc',
    name: '断层',
    caption: '官方战场瓦图',
    description: '裂谷通道与断崖高差交织的全面战场地图。',
    theme: 'warfare-trench',
    regions: [
      ['前沿断面', 200, 510],
      ['裂谷中段', 420, 500],
      ['终点阵地', 730, 380],
      ['高点火力位', 570, 220]
    ]
  }),
  createWarfareMap({
    slug: 'yz',
    name: '余震',
    caption: '官方战场瓦图',
    description: '震后城区与大纵深通道并行的全面战场地图。',
    theme: 'warfare-city',
    regions: [
      ['前沿城区', 220, 530],
      ['主干中段', 430, 500],
      ['核心阵地', 700, 370],
      ['高坡火力点', 560, 240]
    ]
  })
]

const externalMapsByMode = buildExternalMapsByMode(externalDatasets)

const mapsByMode = {
  extraction: extractionMaps,
  warfare: warfareMaps,
  ...externalMapsByMode
}

function createExtractionMap(config) {
  const variants = [
    ['regular', '常规', '资源稳定，适合路线记忆。'],
    ['secure', '机密', '增加高价值房间与情报箱。'],
    ['classified', '绝密', '高风险高收益，战斗密度最高。']
  ]
  const floors = config.floors ?? [['all', '全部']]
  const map = {
    modeSlug: 'extraction',
    slug: config.slug,
    name: config.name,
    caption: config.caption,
    description: config.description,
    theme: config.theme,
    defaultVariant: 'regular',
    defaultFloor: floors[0][0],
    variants: variants.map(([slug, label, description]) => ({ slug, label, description })),
    floors: floors.map(([slug, name]) => ({ slug, name })),
    regions: config.regions.map(([name, x, y]) => ({ name, x, y, floor: '' })),
    events: (config.events ?? []).map(([slug, name, summary, hint, highlightColor, focusRegion]) => ({
      slug,
      name,
      summary,
      hint,
      highlightColor,
      focusRegion
    })),
    layerGroups: extractionLayerGroups.map((group) => ({
      slug: group.slug,
      name: group.name,
      layers: group.layers.map(([slug, name, icon, color]) => ({ slug, name, icon, color }))
    }))
  }
  map.points = buildExtractionPoints(map)
  return map
}

function createWarfareMap(config) {
  const map = {
    modeSlug: 'warfare',
    slug: config.slug,
    name: config.name,
    caption: config.caption,
    description: config.description,
    theme: config.theme,
    defaultVariant: 'attack',
    defaultFloor: 'all',
    variants: [
      { slug: 'attack', label: '进攻视角', description: '强调推进与补给。' },
      { slug: 'occupy', label: '占领视角', description: '强调扇区轮转。' }
    ],
    floors: [{ slug: 'all', name: '全部' }],
    regions: config.regions.map(([name, x, y]) => ({ name, x, y, floor: '' })),
    events: [],
    layerGroups: warfareLayerGroups.map((group) => ({
      slug: group.slug,
      name: group.name,
      layers: group.layers.map(([slug, name, icon, color]) => ({ slug, name, icon, color }))
    }))
  }
  map.points = buildWarfarePoints(map)
  return map
}

function buildExtractionPoints(map) {
  const regions = map.regions
  const templates = [
    basePoint(['regular', 'secure', 'classified'], 'safe-box', 0, '1f', '', '主控保险箱', '主楼一层的标准高价值保险箱。', '需撬锁 6 秒', '高价值', 88, [[32, -18], [-28, 24]]),
    basePoint(['regular', 'secure', 'classified'], 'small-safe', 1, '', '', '营房侧箱', '靠近兵舍补给线。', '直接开启', '中价值', 72, [[-24, 14]]),
    basePoint(['regular', 'secure', 'classified'], 'server', 0, map.slug === 'zero-dam' ? '2f' : '', '', '控制终端', '电子元件与高价值硬盘刷新。', '直接搜刮', '高价值', 84, [[58, -56], [18, -12]]),
    basePoint(['regular', 'secure', 'classified'], 'workstation', 4, '', '', '前台电脑', '电子配件与小情报点。', '直接搜刮', '中价值', 64, [[-22, -14], [32, 16]]),
    basePoint(['regular', 'secure', 'classified'], 'weapon-case', 1, '', '', '武器库', '随机主武器与配件。', '打开后 8 秒刷新声响', '中高价值', 78, [[18, -42], [46, 8]]),
    basePoint(['regular', 'secure', 'classified'], 'ammo-box', 2, '', '', '施工弹药箱', '常驻弹药与战术道具。', '直接开启', '基础', 55, [[28, -18], [-26, 26]]),
    basePoint(['regular', 'secure', 'classified'], 'medical-cache', 3, '', '', '应急医疗箱', '止血类和高级医疗用品。', '直接开启', '中价值', 62, [[-32, 26], [24, -36]]),
    basePoint(['regular', 'secure', 'classified'], 'tool-cabinet', 2, '', '', '维修工具柜', '工业材料和电器零件。', '直接开启', '基础', 52, [[-36, -26], [34, 40]]),
    basePoint(['regular', 'secure', 'classified'], 'travel-bag', 4, '', '', '旅客行李', '中价值杂项与生活物资。', '直接搜刮', '基础', 48, [[-44, 18], [52, -34]]),
    basePoint(['secure', 'classified'], 'intel-cache', 3, map.slug === 'zero-dam' ? '2f' : '', '', '机要情报箱', '高阶情报与稀有配件。', '需要门禁卡', '高价值', 90, [[22, -18]]),
    basePoint(['regular', 'secure', 'classified'], 'spawn', 5, map.slug === 'zero-dam' ? 'b1' : '', '', '北侧出生点', '靠近隐蔽切入线。', '开局可用', '出生', 30, [[-18, 26]]),
    basePoint(['regular', 'secure', 'classified'], 'spawn', 4, '', '', '南侧出生点', '靠近边缘撤离线。', '开局可用', '出生', 30, [[38, 28]]),
    basePoint(['regular', 'secure', 'classified'], 'standard-extract', 1, '', '', '主路常规撤离', '稳定撤离点。', '所有玩家可用', '撤离', 40, [[-54, -12]]),
    basePoint(['regular', 'secure', 'classified'], 'paid-extract', 4, '', '', '高台付费撤离', '成本较高但路线最短。', '消耗 1 枚信标', '撤离', 45, [[68, -18]]),
    basePoint(['regular', 'secure', 'classified'], 'conditional-extract', 5, map.slug === 'zero-dam' ? 'b1' : '', '', '隐蔽撤离门', '要求满足场景条件。', '完成区域互动', '撤离', 58, [[56, 48]]),
    basePoint(['regular', 'secure', 'classified'], 'boss', 0, '', '', '区域首领', '高压警戒巡逻小队。', '随机刷新', '威胁', 92, [[10, 18]]),
    basePoint(['regular', 'secure', 'classified'], 'signal', 5, map.slug === 'zero-dam' ? 'b1' : '', '', '地下信号站', '可同步附近高价值房间状态。', '互动 4 秒', '功能点', 60, [[24, 62]])
  ]

  if (map.events[0]) {
    templates.push(basePoint(['regular', 'secure', 'classified'], 'intel-cache', 4, '', map.events[0].slug, `${map.events[0].name}情报点`, '仅事件开启时出现的高价值目标。', '事件开启后出现', '事件', 95, [[-52, -26]]))
  }
  if (map.events[1]) {
    templates.push(basePoint(['regular', 'secure', 'classified'], 'medical-cache', 2, '', map.events[1].slug, `${map.events[1].name}补给点`, '事件期间刷新额外补给。', '事件开启后出现', '事件', 74, [[40, 18]]))
  }

  const points = []
  let id = 1
  for (const template of templates) {
    for (const variant of template.variants) {
      for (let index = 0; index < template.offsets.length; index += 1) {
        const [dx, dy] = template.offsets[index]
        const region = regions[template.regionIndex]
        const name = template.offsets.length > 1 ? `${template.name} ${index + 1}` : template.name
        points.push({
          id: id++,
          name,
          variantSlug: variant,
          layerSlug: template.layerSlug,
          regionName: region.name,
          floor: template.floor,
          eventSlug: template.eventSlug,
          summary: template.summary,
          detail: `${name} 位于 ${region.name}，适合沿附近掩体完成二次搜刮。${template.summary}`,
          condition: template.condition,
          rarity: template.rarity,
          x: clamp(region.x + dx),
          y: clamp(region.y + dy),
          lootScore: template.lootScore
        })
      }
    }
  }

  return decoratePoints(points, map.layerGroups)
}

function buildWarfarePoints(map) {
  const regions = map.regions
  const templates = [
    basePoint(['attack', 'occupy'], 'sector', 0, '', '', 'A 扇区', '第一阶段突破口。', '持续占领', '目标', 60, [[0, 0]]),
    basePoint(['attack', 'occupy'], 'sector', 1, '', '', 'B 扇区', '第二阶段中轴目标。', '持续占领', '目标', 70, [[15, 0]]),
    basePoint(['attack', 'occupy'], 'sector', 2, '', '', 'C 扇区', '最终阶段核心。', '持续占领', '目标', 80, [[0, -10]]),
    basePoint(['attack', 'occupy'], 'attack-base', 0, '', '', '进攻前线基地', '载具与步兵补给点。', '默认开放', '基地', 45, [[-50, 48]]),
    basePoint(['attack', 'occupy'], 'defense-base', 2, '', '', '防守后方基地', '防守方重生与火力支援。', '默认开放', '基地', 45, [[64, 30]]),
    basePoint(['attack', 'occupy'], 'ammo-resupply', 1, '', '', '车站补给箱', '提供持续弹药与维修。', '双方可用', '支援', 50, [[-40, 32], [38, -30]]),
    basePoint(['attack', 'occupy'], 'mounted-gun', 3, '', '', '固定火力点', '可俯压整个中线。', '固定火力', '火力', 65, [[22, -20]]),
    basePoint(['attack', 'occupy'], 'vehicle-pad', 0, '', '', '载具调度位', '阶段推进后可刷新重载具。', '阶段二开启', '支援', 75, [[58, -20]]),
    basePoint(['attack', 'occupy'], 'uplink', 2, '', '', '侦察终端', '可短时标记敌方密集区域。', '冷却 90 秒', '支援', 68, [[-52, -35]])
  ]

  const points = []
  let id = 10001
  for (const template of templates) {
    for (const variant of template.variants) {
      for (let index = 0; index < template.offsets.length; index += 1) {
        const [dx, dy] = template.offsets[index]
        const region = regions[template.regionIndex]
        const name = template.offsets.length > 1 ? `${template.name} ${index + 1}` : template.name
        points.push({
          id: id++,
          name,
          variantSlug: variant,
          layerSlug: template.layerSlug,
          regionName: region.name,
          floor: '',
          eventSlug: '',
          summary: template.summary,
          detail: `${name} 位于 ${region.name}，是该扇区的重要控制点。${template.summary}`,
          condition: template.condition,
          rarity: template.rarity,
          x: clamp(region.x + dx),
          y: clamp(region.y + dy),
          lootScore: template.lootScore
        })
      }
    }
  }

  return decoratePoints(points, map.layerGroups)
}

function decoratePoints(points, layerGroups) {
  const layerLookup = Object.fromEntries(
    layerGroups.flatMap((group) =>
      group.layers.map((layer) => [layer.slug, { layerName: layer.name, layerIcon: layer.icon, layerColor: layer.color }])
    )
  )

  return points.map((point) => ({
    ...point,
    ...layerLookup[point.layerSlug]
  }))
}

function basePoint(variants, layerSlug, regionIndex, floor, eventSlug, name, summary, condition, rarity, lootScore, offsets) {
  return { variants, layerSlug, regionIndex, floor, eventSlug, name, summary, condition, rarity, lootScore, offsets }
}

function clamp(value) {
  return Math.max(60, Math.min(940, value))
}

function summarizeMaps(list) {
  return list.map((map) => ({
    slug: map.slug,
    name: map.name,
    caption: map.caption,
    description: map.description,
    theme: map.theme,
    tileSource: map.tileSource,
    defaultVariant: map.defaultVariant,
    defaultFloor: map.defaultFloor
  }))
}

function loadExternalDatasets() {
  const staticDir = path.resolve(__dirname, '../backend/internal/data/static')
  return readdirSync(staticDir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(path.join(staticDir, name), 'utf8')))
}

function summarizeExternalModes(datasets) {
  const lookup = new Map()
  for (const dataset of datasets) {
    if (!dataset?.mode?.slug) continue
    lookup.set(dataset.mode.slug, {
      slug: dataset.mode.slug,
      name: dataset.mode.name,
      subtitle: dataset.mode.subtitle,
      description: dataset.mode.description,
      accent: dataset.mode.accent,
      sort: dataset.mode.sort ?? 999
    })
  }
  return [...lookup.values()]
    .sort((left, right) => (left.sort - right.sort) || left.slug.localeCompare(right.slug))
    .map(({ sort, ...mode }) => mode)
}

function buildExternalMapsByMode(datasets) {
  const grouped = {}
  for (const dataset of datasets) {
    const map = buildExternalMap(dataset.map)
    grouped[map.modeSlug] ??= []
    grouped[map.modeSlug].push(map)
  }

  Object.values(grouped).forEach((maps) => {
    maps.sort((left, right) => (left.sort ?? 0) - (right.sort ?? 0) || left.slug.localeCompare(right.slug))
  })

  return grouped
}

function proxyRemoteImageURL(sourceURL) {
  const normalized = sourceURL?.trim()
  if (!normalized) return ''
  if (normalized.startsWith('/api/assets/')) return normalized
  if (/17173cdn\.com/i.test(normalized)) {
    return `/api/assets/image/rocom/${Buffer.from(normalized).toString('base64url')}`
  }
  if (/gamersky\.com/i.test(normalized)) {
    return `/api/assets/image/gamersky/${Buffer.from(normalized).toString('base64url')}`
  }
  return ''
}

function localizeRemoteImageURLs(imageUrls = []) {
  const seen = new Set()
  return imageUrls
    .map((item) => proxyRemoteImageURL(item))
    .filter((item) => {
      if (!item || seen.has(item)) return false
      seen.add(item)
      return true
    })
}

function normalizeExternalTileSource(tileSource) {
  if (!tileSource || typeof tileSource !== 'object') return null

  const normalized = structuredClone(tileSource)
  if (!normalized.urlTemplate && normalized.keyPrefix) {
    if (String(normalized.keyPrefix).startsWith('tile/rocom/')) {
      normalized.urlTemplate = `/api/assets/${normalized.keyPrefix}/{z}/{y}_{x}.png`
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
  return normalized
}

function buildExternalMap(rawMap) {
  return {
    modeSlug: rawMap.modeSlug,
    slug: rawMap.slug,
    name: rawMap.name,
    caption: rawMap.caption,
    description: rawMap.description,
    theme: rawMap.theme,
    sort: rawMap.sort ?? 0,
    tileSource: normalizeExternalTileSource(rawMap.tileSource),
    defaultVariant: rawMap.defaultVariant,
    defaultFloor: rawMap.defaultFloor,
    variants: rawMap.variants.map((item) => ({
      slug: item.slug,
      label: item.label,
      description: item.description
    })),
    floors: rawMap.floors.map((item) => ({
      slug: item.slug,
      name: item.name
    })),
    regions: rawMap.regions.map((item) => ({
      name: item.name,
      x: item.x,
      y: item.y,
      floor: item.floor
    })),
    events: rawMap.events.map((item) => ({
      slug: item.slug,
      name: item.name,
      summary: item.summary,
      hint: item.hint,
      highlightColor: item.highlightColor,
      focusRegion: item.focusRegion
    })),
    layerGroups: rawMap.layerGroups.map((group) => ({
      slug: group.slug,
      name: group.name,
      layers: group.layers.map((layer) => ({
        slug: layer.slug,
        name: layer.name,
        icon: layer.icon,
        color: layer.color
      }))
    })),
    points: rawMap.points.map((point) => ({
      ...point,
      imageUrls: localizeRemoteImageURLs(point.imageUrls)
    }))
  }
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

export function createMapView(searchParams) {
  const modeSlug = mapsByMode[searchParams.get('mode')] ? searchParams.get('mode') : 'extraction'
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

export { mapsByMode, modes }
