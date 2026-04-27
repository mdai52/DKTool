package data

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

type seedMode struct {
	Slug        string
	Name        string
	Subtitle    string
	Description string
	Accent      string
	Sort        int
}

type seedMap struct {
	ModeSlug        string
	Slug            string
	Name            string
	Caption         string
	Description     string
	Theme           string
	DefaultVariant  string
	DefaultFloor    string
	Sort            int
	Variants        []seedVariant
	Floors          []seedFloor
	Regions         []seedRegion
	Events          []seedEvent
	LayerGroups     []seedLayerGroup
	PointGenerators []seedPointGenerator
	Points          []seedPoint
}

type seedVariant struct {
	Slug        string
	Label       string
	Description string
	Sort        int
}

type seedFloor struct {
	Slug string
	Name string
	Sort int
}

type seedRegion struct {
	Name  string
	X     float64
	Y     float64
	Floor string
	Sort  int
}

type seedEvent struct {
	Slug           string
	Name           string
	Summary        string
	Hint           string
	HighlightColor string
	FocusRegion    string
	Sort           int
}

type seedLayerGroup struct {
	Slug   string
	Name   string
	Sort   int
	Layers []seedLayer
}

type seedLayer struct {
	Slug    string
	Name    string
	Icon    string
	Color   string
	Sort    int
	Enabled bool
}

type seedPointGenerator struct {
	Variants  []string
	LayerSlug string
	Region    string
	Floor     string
	EventSlug string
	BaseName  string
	Summary   string
	Condition string
	Rarity    string
	LootScore int
	Offsets   []offset
}

type offset struct {
	X float64
	Y float64
}

type seedPoint struct {
	Variant   string
	LayerSlug string
	Region    string
	Floor     string
	EventSlug string
	Name      string
	Summary   string
	Detail    string
	Condition string
	Rarity    string
	LootScore int
	X         float64
	Y         float64
	ImageURLs []string
}

func SeedIfEmpty(db *sql.DB) error {
	var count int
	if err := db.QueryRow(`SELECT COUNT(1) FROM modes`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	allModes, allMaps, err := seedDataset()
	if err != nil {
		return err
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	modeIDs := map[string]int64{}
	for _, mode := range allModes {
		res, execErr := tx.Exec(`
			INSERT INTO modes (slug, name, subtitle, description, accent, sort_order)
			VALUES (?, ?, ?, ?, ?, ?)`,
			mode.Slug, mode.Name, mode.Subtitle, mode.Description, mode.Accent, mode.Sort,
		)
		if execErr != nil {
			return execErr
		}
		id, _ := res.LastInsertId()
		modeIDs[mode.Slug] = id
	}

	for _, gameMap := range allMaps {
		modeID := modeIDs[gameMap.ModeSlug]
		res, execErr := tx.Exec(`
			INSERT INTO maps (
				mode_id, slug, name, caption, description, theme,
				default_variant_slug, default_floor_slug, sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			modeID, gameMap.Slug, gameMap.Name, gameMap.Caption, gameMap.Description, gameMap.Theme,
			gameMap.DefaultVariant, gameMap.DefaultFloor, gameMap.Sort,
		)
		if execErr != nil {
			return execErr
		}
		mapID, _ := res.LastInsertId()

		for _, variant := range gameMap.Variants {
			if _, execErr = tx.Exec(`
				INSERT INTO map_variants (map_id, slug, label, description, sort_order)
				VALUES (?, ?, ?, ?, ?)`,
				mapID, variant.Slug, variant.Label, variant.Description, variant.Sort,
			); execErr != nil {
				return execErr
			}
		}

		for _, floor := range gameMap.Floors {
			if _, execErr = tx.Exec(`
				INSERT INTO map_floors (map_id, slug, name, sort_order)
				VALUES (?, ?, ?, ?)`,
				mapID, floor.Slug, floor.Name, floor.Sort,
			); execErr != nil {
				return execErr
			}
		}

		regionLookup := map[string]seedRegion{}
		for _, region := range gameMap.Regions {
			regionLookup[region.Name] = region
			if _, execErr = tx.Exec(`
				INSERT INTO map_regions (map_id, name, x, y, floor_slug, sort_order)
				VALUES (?, ?, ?, ?, ?, ?)`,
				mapID, region.Name, region.X, region.Y, region.Floor, region.Sort,
			); execErr != nil {
				return execErr
			}
		}

		for _, event := range gameMap.Events {
			if _, execErr = tx.Exec(`
				INSERT INTO map_events (
					map_id, slug, name, summary, hint, highlight_color, focus_region, sort_order
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				mapID, event.Slug, event.Name, event.Summary, event.Hint, event.HighlightColor, event.FocusRegion, event.Sort,
			); execErr != nil {
				return execErr
			}
		}

		for _, group := range gameMap.LayerGroups {
			res, groupErr := tx.Exec(`
				INSERT INTO layer_groups (map_id, slug, name, sort_order)
				VALUES (?, ?, ?, ?)`,
				mapID, group.Slug, group.Name, group.Sort,
			)
			if groupErr != nil {
				return groupErr
			}
			groupID, _ := res.LastInsertId()

			for _, layer := range group.Layers {
				enabled := 0
				if layer.Enabled {
					enabled = 1
				}
				if _, execErr = tx.Exec(`
					INSERT INTO layers (group_id, slug, name, icon, color, sort_order, default_enabled)
					VALUES (?, ?, ?, ?, ?, ?, ?)`,
					groupID, layer.Slug, layer.Name, layer.Icon, layer.Color, layer.Sort, enabled,
				); execErr != nil {
					return execErr
				}
			}
		}

		points := gameMap.Points
		if len(points) == 0 {
			points = buildPoints(gameMap.PointGenerators, regionLookup)
		}
		for _, point := range points {
			searchText := strings.ToLower(strings.Join([]string{
				point.Name, point.Region, point.Summary, point.Condition, point.Rarity, point.LayerSlug,
			}, " "))
			imageURLsJSON, marshalErr := json.Marshal(point.ImageURLs)
			if marshalErr != nil {
				return marshalErr
			}
			if _, execErr = tx.Exec(`
				INSERT INTO points (
					map_id, variant_slug, layer_slug, region_name, floor_slug, event_slug,
					name, summary, detail_text, condition_text, rarity, x, y, loot_score, search_text, image_urls
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				mapID, point.Variant, point.LayerSlug, point.Region, point.Floor, point.EventSlug,
				point.Name, point.Summary, point.Detail, point.Condition, point.Rarity, point.X, point.Y,
				point.LootScore, searchText, string(imageURLsJSON),
			); execErr != nil {
				return execErr
			}
		}
	}

	return tx.Commit()
}

func seedDataset() ([]seedMode, []seedMap, error) {
	modes := seedModes()
	maps := seedMaps()

	externalModes, externalMaps, err := loadExternalSeeds()
	if err != nil {
		return nil, nil, err
	}

	modes = append(modes, externalModes...)
	maps = append(maps, externalMaps...)
	return modes, maps, nil
}

func seedModes() []seedMode {
	return []seedMode{
		{
			Slug:        "extraction",
			Name:        "烽火地带",
			Subtitle:    "搜打撤点位图",
			Description: "围绕物资点、撤离点、首领与随机事件的战术地图。",
			Accent:      "#13f2a0",
			Sort:        1,
		},
		{
			Slug:        "warfare",
			Name:        "全面战场",
			Subtitle:    "攻防战部署图",
			Description: "分阶段据点、载具补给与火力支援的部署视图。",
			Accent:      "#f0ca5b",
			Sort:        2,
		},
	}
}

func seedMaps() []seedMap {
	extractionLayers := []seedLayerGroup{
		{
			Slug: "loot",
			Name: "物资点",
			Sort: 1,
			Layers: []seedLayer{
				{Slug: "safe-box", Name: "保险箱", Icon: "safe-box", Color: "#18ffad", Sort: 1, Enabled: true},
				{Slug: "small-safe", Name: "小保险箱", Icon: "small-safe", Color: "#8df2ca", Sort: 2, Enabled: true},
				{Slug: "server", Name: "服务器", Icon: "server", Color: "#6bd6ff", Sort: 3, Enabled: true},
				{Slug: "workstation", Name: "电脑", Icon: "workstation", Color: "#9bb6ff", Sort: 4, Enabled: true},
				{Slug: "weapon-case", Name: "武器箱", Icon: "weapon-case", Color: "#f0c86e", Sort: 5, Enabled: true},
				{Slug: "ammo-box", Name: "弹药箱", Icon: "ammo-box", Color: "#ffdd57", Sort: 6, Enabled: true},
				{Slug: "medical-cache", Name: "医疗箱", Icon: "medical-cache", Color: "#ff7c6b", Sort: 7, Enabled: true},
				{Slug: "tool-cabinet", Name: "工具柜", Icon: "tool-cabinet", Color: "#8db88b", Sort: 8, Enabled: true},
				{Slug: "travel-bag", Name: "旅行包", Icon: "travel-bag", Color: "#f4a86c", Sort: 9, Enabled: true},
				{Slug: "intel-cache", Name: "情报箱", Icon: "intel-cache", Color: "#d97cff", Sort: 10, Enabled: true},
			},
		},
		{
			Slug: "spawn",
			Name: "出生点",
			Sort: 2,
			Layers: []seedLayer{
				{Slug: "spawn", Name: "出生点", Icon: "spawn", Color: "#d6fbff", Sort: 1, Enabled: true},
			},
		},
		{
			Slug: "extract",
			Name: "撤离点",
			Sort: 3,
			Layers: []seedLayer{
				{Slug: "paid-extract", Name: "付费撤离", Icon: "paid-extract", Color: "#ffd66b", Sort: 1, Enabled: true},
				{Slug: "standard-extract", Name: "常规撤离", Icon: "standard-extract", Color: "#9be47a", Sort: 2, Enabled: true},
				{Slug: "conditional-extract", Name: "条件撤离", Icon: "conditional-extract", Color: "#7ee6ff", Sort: 3, Enabled: true},
			},
		},
		{
			Slug: "threat",
			Name: "威胁点",
			Sort: 4,
			Layers: []seedLayer{
				{Slug: "boss", Name: "首领", Icon: "boss", Color: "#ff5c6c", Sort: 1, Enabled: true},
				{Slug: "signal", Name: "信号站", Icon: "signal", Color: "#46e0ff", Sort: 2, Enabled: true},
			},
		},
	}

	warfareLayers := []seedLayerGroup{
		{
			Slug: "objective",
			Name: "据点",
			Sort: 1,
			Layers: []seedLayer{
				{Slug: "sector", Name: "据点", Icon: "sector", Color: "#f2d85c", Sort: 1, Enabled: true},
				{Slug: "attack-base", Name: "进攻方基地", Icon: "attack-base", Color: "#fd8d5e", Sort: 2, Enabled: true},
				{Slug: "defense-base", Name: "防守方基地", Icon: "defense-base", Color: "#5ed8ff", Sort: 3, Enabled: true},
			},
		},
		{
			Slug: "support",
			Name: "支援",
			Sort: 2,
			Layers: []seedLayer{
				{Slug: "ammo-resupply", Name: "弹药补给", Icon: "ammo-resupply", Color: "#ffe374", Sort: 1, Enabled: true},
				{Slug: "mounted-gun", Name: "固定火力", Icon: "mounted-gun", Color: "#ff8c7a", Sort: 2, Enabled: true},
				{Slug: "vehicle-pad", Name: "载具调度", Icon: "vehicle-pad", Color: "#c3f286", Sort: 3, Enabled: true},
				{Slug: "uplink", Name: "侦察终端", Icon: "uplink", Color: "#68d9ff", Sort: 4, Enabled: true},
			},
		},
	}

	return []seedMap{
		{
			ModeSlug:       "extraction",
			Slug:           "zero-dam",
			Name:           "零号大坝",
			Caption:        "常规/机密/绝密",
			Description:    "围绕行政辖区与水坝核心展开的高价值搜打撤地图。",
			Theme:          "dam",
			DefaultVariant: "regular",
			DefaultFloor:   "all",
			Sort:           1,
			Variants: []seedVariant{
				{Slug: "regular", Label: "常规", Description: "资源稳定，适合路线记忆。", Sort: 1},
				{Slug: "secure", Label: "机密", Description: "增加高价值房间与情报箱。", Sort: 2},
				{Slug: "classified", Label: "绝密", Description: "高风险高收益，战斗密度最高。", Sort: 3},
			},
			Floors: []seedFloor{
				{Slug: "all", Name: "全部", Sort: 1},
				{Slug: "b1", Name: "B1 地下通道", Sort: 2},
				{Slug: "1f", Name: "1F 行政层", Sort: 3},
				{Slug: "2f", Name: "2F 指挥层", Sort: 4},
			},
			Regions: []seedRegion{
				{Name: "行政辖区", X: 610, Y: 305, Sort: 1},
				{Name: "军营", X: 395, Y: 250, Sort: 2},
				{Name: "水泥厂", X: 355, Y: 460, Sort: 3},
				{Name: "主变电站", X: 720, Y: 625, Sort: 4},
				{Name: "游客中心", X: 890, Y: 860, Sort: 5},
				{Name: "管道区域", X: 275, Y: 175, Sort: 6},
			},
			Events: []seedEvent{
				{Slug: "crash-site", Name: "坠机事件", Summary: "行政辖区与游客中心之间增加高价值残骸点。", Hint: "优先检查高处天桥与坠机尾段。", HighlightColor: "#ff9b5f", FocusRegion: "行政辖区", Sort: 1},
				{Slug: "forest-fire", Name: "森林山火", Summary: "水泥厂与游客中心一带视野受阻，埋点价值提高。", Hint: "热区会压缩推进路线，适合二次搜刮。", HighlightColor: "#ff6c5c", FocusRegion: "游客中心", Sort: 2},
				{Slug: "bridge-cut", Name: "断桥事件", Summary: "主变电站西侧路径断开，撤离线被重塑。", Hint: "注意条件撤离会转向地下通道。", HighlightColor: "#67d2ff", FocusRegion: "主变电站", Sort: 3},
			},
			LayerGroups: extractionLayers,
			PointGenerators: append(
				baseExtractionPoints(),
				seedPointGenerator{Variants: []string{"secure", "classified"}, LayerSlug: "intel-cache", Region: "行政辖区", Floor: "2f", BaseName: "会议室情报箱", Summary: "机要卷宗与电子情报混合刷新。", Condition: "需要钥匙卡", Rarity: "高价值", LootScore: 92, Offsets: []offset{{X: 48, Y: -30}}},
				seedPointGenerator{Variants: []string{"classified"}, LayerSlug: "safe-box", Region: "主变电站", BaseName: "主控保险箱", Summary: "高风险高收益的绝密保险箱。", Condition: "需要断电后 20 秒开启", Rarity: "顶级", LootScore: 98, Offsets: []offset{{X: 35, Y: -24}}},
				seedPointGenerator{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "signal", Region: "管道区域", BaseName: "地下信号站", Summary: "可同步附近撤离点状态。", Condition: "互动 4 秒", Rarity: "功能点", LootScore: 60, Floor: "b1", Offsets: []offset{{X: 24, Y: 62}}},
				seedPointGenerator{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "boss", Region: "行政辖区", BaseName: "哈夫克巡查队", Summary: "刷新概率取决于战局热度。", Condition: "随机刷新", Rarity: "威胁", LootScore: 90, Offsets: []offset{{X: 10, Y: 18}}},
				seedPointGenerator{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "intel-cache", Region: "游客中心", EventSlug: "crash-site", BaseName: "坠机黑匣子", Summary: "仅坠机事件时出现。", Condition: "事件开启后出现", Rarity: "事件", LootScore: 95, Offsets: []offset{{X: -52, Y: -26}}},
				seedPointGenerator{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "conditional-extract", Region: "主变电站", EventSlug: "bridge-cut", BaseName: "临时检修电梯", Summary: "断桥事件时启用的新撤离点。", Condition: "携带维修卡", Rarity: "事件", LootScore: 70, Offsets: []offset{{X: -46, Y: 18}}},
			),
		},
		{
			ModeSlug:       "extraction",
			Slug:           "longbow-valley",
			Name:           "长弓溪谷",
			Caption:        "山谷路线图",
			Description:    "狙击视野长、资源拉扯明显的峡谷地图。",
			Theme:          "valley",
			DefaultVariant: "regular",
			DefaultFloor:   "all",
			Sort:           2,
			Variants: []seedVariant{
				{Slug: "regular", Label: "常规", Description: "以谷底路线为主。", Sort: 1},
				{Slug: "secure", Label: "机密", Description: "山腰据点收益提升。", Sort: 2},
				{Slug: "classified", Label: "绝密", Description: "高台交火频繁。", Sort: 3},
			},
			Floors: []seedFloor{{Slug: "all", Name: "全部", Sort: 1}},
			Regions: []seedRegion{
				{Name: "北谷口", X: 220, Y: 190, Sort: 1},
				{Name: "溪谷车站", X: 430, Y: 355, Sort: 2},
				{Name: "悬崖观测哨", X: 620, Y: 185, Sort: 3},
				{Name: "旧矿洞", X: 325, Y: 670, Sort: 4},
				{Name: "河心补给站", X: 560, Y: 560, Sort: 5},
				{Name: "南侧营地", X: 815, Y: 790, Sort: 6},
			},
			Events: []seedEvent{
				{Slug: "fog-line", Name: "谷雾来袭", Summary: "谷底能见度下降，高台价值提升。", Hint: "沿岩壁推进更安全。", HighlightColor: "#7bc4ff", FocusRegion: "溪谷车站", Sort: 1},
				{Slug: "supply-drop", Name: "空投补给", Summary: "河心补给站附近刷新空投。", Hint: "高价值但极易被架枪。", HighlightColor: "#ffc96b", FocusRegion: "河心补给站", Sort: 2},
			},
			LayerGroups:     extractionLayers,
			PointGenerators: genericExtractionPoints("longbow-valley"),
		},
		{
			ModeSlug:       "extraction",
			Slug:           "space-base",
			Name:           "航天基地",
			Caption:        "立体中轴图",
			Description:    "中轴建筑密集，纵深与楼层切换频繁。",
			Theme:          "base",
			DefaultVariant: "regular",
			DefaultFloor:   "all",
			Sort:           3,
			Variants: []seedVariant{
				{Slug: "regular", Label: "常规", Description: "适合中轴推进。", Sort: 1},
				{Slug: "secure", Label: "机密", Description: "航站楼高价值箱更多。", Sort: 2},
				{Slug: "classified", Label: "绝密", Description: "停机坪与塔台火力更强。", Sort: 3},
			},
			Floors: []seedFloor{{Slug: "all", Name: "全部", Sort: 1}},
			Regions: []seedRegion{
				{Name: "指挥塔台", X: 700, Y: 180, Sort: 1},
				{Name: "燃料广场", X: 560, Y: 360, Sort: 2},
				{Name: "发射井", X: 510, Y: 575, Sort: 3},
				{Name: "装配车间", X: 280, Y: 495, Sort: 4},
				{Name: "停机坪", X: 820, Y: 510, Sort: 5},
				{Name: "南区仓储", X: 360, Y: 805, Sort: 6},
			},
			Events: []seedEvent{
				{Slug: "power-loss", Name: "主电失效", Summary: "部分封锁门失效，近路开启。", Hint: "发射井周边会暴露更多高价值箱。", HighlightColor: "#ffe36a", FocusRegion: "发射井", Sort: 1},
				{Slug: "launch-alert", Name: "发射警报", Summary: "塔台周边刷新额外情报节点。", Hint: "注意高处视野压制。", HighlightColor: "#ff7968", FocusRegion: "指挥塔台", Sort: 2},
			},
			LayerGroups:     extractionLayers,
			PointGenerators: genericExtractionPoints("space-base"),
		},
		{
			ModeSlug:       "extraction",
			Slug:           "baksh",
			Name:           "巴克什",
			Caption:        "城镇交易图",
			Description:    "街区密度高，资源分层清晰，易形成包夹。",
			Theme:          "city",
			DefaultVariant: "regular",
			DefaultFloor:   "all",
			Sort:           4,
			Variants: []seedVariant{
				{Slug: "regular", Label: "常规", Description: "主街易守难攻。", Sort: 1},
				{Slug: "secure", Label: "机密", Description: "商圈情报点增多。", Sort: 2},
				{Slug: "classified", Label: "绝密", Description: "浴场与旅馆收益更高。", Sort: 3},
			},
			Floors: []seedFloor{{Slug: "all", Name: "全部", Sort: 1}},
			Regions: []seedRegion{
				{Name: "巴克什集市", X: 485, Y: 420, Sort: 1},
				{Name: "皇家博物馆", X: 690, Y: 270, Sort: 2},
				{Name: "蓝汀旅馆", X: 300, Y: 500, Sort: 3},
				{Name: "大浴场", X: 580, Y: 690, Sort: 4},
				{Name: "樱桃小镇", X: 210, Y: 280, Sort: 5},
				{Name: "停车场", X: 805, Y: 610, Sort: 6},
			},
			Events: []seedEvent{
				{Slug: "market-riot", Name: "集市骚乱", Summary: "集市中心临时刷新信号点与补给箱。", Hint: "主街视野会被临时路障打断。", HighlightColor: "#ff915f", FocusRegion: "巴克什集市", Sort: 1},
				{Slug: "museum-heist", Name: "博物馆警报", Summary: "博物馆顶层刷新限时保险箱。", Hint: "适合打高层切入。", HighlightColor: "#d687ff", FocusRegion: "皇家博物馆", Sort: 2},
			},
			LayerGroups:     extractionLayers,
			PointGenerators: genericExtractionPoints("baksh"),
		},
		{
			ModeSlug:       "extraction",
			Slug:           "tide-prison",
			Name:           "潮汐监狱",
			Caption:        "环形封锁图",
			Description:    "外圈推进与内环争夺并行，撤离压迫感强。",
			Theme:          "prison",
			DefaultVariant: "regular",
			DefaultFloor:   "all",
			Sort:           5,
			Variants: []seedVariant{
				{Slug: "regular", Label: "常规", Description: "外墙路线清晰。", Sort: 1},
				{Slug: "secure", Label: "机密", Description: "内环稀有资源更多。", Sort: 2},
				{Slug: "classified", Label: "绝密", Description: "撤离点压力最大。", Sort: 3},
			},
			Floors: []seedFloor{{Slug: "all", Name: "全部", Sort: 1}},
			Regions: []seedRegion{
				{Name: "外环码头", X: 170, Y: 705, Sort: 1},
				{Name: "西监区", X: 300, Y: 390, Sort: 2},
				{Name: "中央监管塔", X: 525, Y: 500, Sort: 3},
				{Name: "医务监区", X: 710, Y: 420, Sort: 4},
				{Name: "北侧崖道", X: 610, Y: 170, Sort: 5},
				{Name: "封锁闸门", X: 860, Y: 710, Sort: 6},
			},
			Events: []seedEvent{
				{Slug: "lockdown", Name: "区域封锁", Summary: "部分外墙门关闭，内环资源刷新。", Hint: "优先确认码头路线。", HighlightColor: "#5cd7ff", FocusRegion: "中央监管塔", Sort: 1},
				{Slug: "tide-rise", Name: "潮位上涨", Summary: "码头路线被水淹，南侧撤离改道。", Hint: "低位路线风险更高。", HighlightColor: "#78b8ff", FocusRegion: "外环码头", Sort: 2},
			},
			LayerGroups:     extractionLayers,
			PointGenerators: genericExtractionPoints("tide-prison"),
		},
		{
			ModeSlug:       "warfare",
			Slug:           "trench-line",
			Name:           "焦土战线",
			Caption:        "攻防三阶段",
			Description:    "从前沿堑壕到雷达站的纵深推进图。",
			Theme:          "warfare-trench",
			DefaultVariant: "attack",
			DefaultFloor:   "all",
			Sort:           1,
			Variants: []seedVariant{
				{Slug: "attack", Label: "进攻视角", Description: "强调推进与补给。", Sort: 1},
				{Slug: "occupy", Label: "占领视角", Description: "强调扇区轮转。", Sort: 2},
			},
			Floors: []seedFloor{{Slug: "all", Name: "全部", Sort: 1}},
			Regions: []seedRegion{
				{Name: "前沿堑壕", X: 180, Y: 540, Sort: 1},
				{Name: "废墟车站", X: 360, Y: 500, Sort: 2},
				{Name: "雷达站", X: 760, Y: 410, Sort: 3},
				{Name: "山脊炮阵", X: 620, Y: 220, Sort: 4},
			},
			Events:      []seedEvent{},
			LayerGroups: warfareLayers,
			PointGenerators: []seedPointGenerator{
				{Variants: []string{"attack", "occupy"}, LayerSlug: "sector", Region: "前沿堑壕", BaseName: "A 扇区", Summary: "第一阶段突破口。", Condition: "持续占领", Rarity: "目标", LootScore: 60, Offsets: []offset{{X: 0, Y: 0}}},
				{Variants: []string{"attack", "occupy"}, LayerSlug: "sector", Region: "废墟车站", BaseName: "B 扇区", Summary: "第二阶段中轴目标。", Condition: "持续占领", Rarity: "目标", LootScore: 70, Offsets: []offset{{X: 15, Y: 0}}},
				{Variants: []string{"attack", "occupy"}, LayerSlug: "sector", Region: "雷达站", BaseName: "C 扇区", Summary: "最终阶段核心。", Condition: "持续占领", Rarity: "目标", LootScore: 80, Offsets: []offset{{X: 0, Y: -10}}},
				{Variants: []string{"attack", "occupy"}, LayerSlug: "attack-base", Region: "前沿堑壕", BaseName: "进攻前线基地", Summary: "载具与步兵补给点。", Condition: "默认开放", Rarity: "基地", LootScore: 45, Offsets: []offset{{X: -50, Y: 48}}},
				{Variants: []string{"attack", "occupy"}, LayerSlug: "defense-base", Region: "雷达站", BaseName: "防守后方基地", Summary: "防守方重生与火力支援。", Condition: "默认开放", Rarity: "基地", LootScore: 45, Offsets: []offset{{X: 64, Y: 30}}},
				{Variants: []string{"attack", "occupy"}, LayerSlug: "ammo-resupply", Region: "废墟车站", BaseName: "车站补给箱", Summary: "提供持续弹药与维修。", Condition: "双方可用", Rarity: "支援", LootScore: 50, Offsets: []offset{{X: -40, Y: 32}, {X: 38, Y: -30}}},
				{Variants: []string{"attack", "occupy"}, LayerSlug: "mounted-gun", Region: "山脊炮阵", BaseName: "山脊重机枪", Summary: "俯压整个中线。", Condition: "固定火力", Rarity: "火力", LootScore: 65, Offsets: []offset{{X: 22, Y: -20}}},
				{Variants: []string{"attack", "occupy"}, LayerSlug: "vehicle-pad", Region: "前沿堑壕", BaseName: "步战车调度位", Summary: "阶段推进后可刷新重载具。", Condition: "阶段二开启", Rarity: "支援", LootScore: 75, Offsets: []offset{{X: 58, Y: -20}}},
				{Variants: []string{"attack", "occupy"}, LayerSlug: "uplink", Region: "雷达站", BaseName: "前线侦察终端", Summary: "可短时标记敌方密集区域。", Condition: "冷却 90 秒", Rarity: "支援", LootScore: 68, Offsets: []offset{{X: -52, Y: -35}}},
			},
		},
		{
			ModeSlug:       "warfare",
			Slug:           "canal-city",
			Name:           "运河都市",
			Caption:        "桥梁会战",
			Description:    "跨桥推进与楼顶火力压制并存的城区战图。",
			Theme:          "warfare-city",
			DefaultVariant: "attack",
			DefaultFloor:   "all",
			Sort:           2,
			Variants: []seedVariant{
				{Slug: "attack", Label: "进攻视角", Description: "桥头推进。", Sort: 1},
				{Slug: "occupy", Label: "占领视角", Description: "区域轮转。", Sort: 2},
			},
			Floors: []seedFloor{{Slug: "all", Name: "全部", Sort: 1}},
			Regions: []seedRegion{
				{Name: "北桥头", X: 220, Y: 460, Sort: 1},
				{Name: "中央运河", X: 520, Y: 520, Sort: 2},
				{Name: "商贸中心", X: 760, Y: 360, Sort: 3},
				{Name: "南岸车库", X: 680, Y: 760, Sort: 4},
			},
			Events:      []seedEvent{},
			LayerGroups: warfareLayers,
			PointGenerators: []seedPointGenerator{
				{Variants: []string{"attack", "occupy"}, LayerSlug: "sector", Region: "北桥头", BaseName: "A 扇区", Summary: "桥头第一目标。", Condition: "持续占领", Rarity: "目标", LootScore: 60, Offsets: []offset{{X: 0, Y: 0}}},
				{Variants: []string{"attack", "occupy"}, LayerSlug: "sector", Region: "中央运河", BaseName: "B 扇区", Summary: "水道与桥梁交界。", Condition: "持续占领", Rarity: "目标", LootScore: 70, Offsets: []offset{{X: 0, Y: 0}}},
				{Variants: []string{"attack", "occupy"}, LayerSlug: "sector", Region: "商贸中心", BaseName: "C 扇区", Summary: "高楼密集，适合垂直拉扯。", Condition: "持续占领", Rarity: "目标", LootScore: 80, Offsets: []offset{{X: 0, Y: 0}}},
				{Variants: []string{"attack", "occupy"}, LayerSlug: "attack-base", Region: "北桥头", BaseName: "进攻集结区", Summary: "步兵与轻载具复位点。", Condition: "默认开放", Rarity: "基地", LootScore: 45, Offsets: []offset{{X: -50, Y: 46}}},
				{Variants: []string{"attack", "occupy"}, LayerSlug: "defense-base", Region: "商贸中心", BaseName: "防守高台基地", Summary: "防守方俯视中线。", Condition: "默认开放", Rarity: "基地", LootScore: 45, Offsets: []offset{{X: 62, Y: -30}}},
				{Variants: []string{"attack", "occupy"}, LayerSlug: "ammo-resupply", Region: "中央运河", BaseName: "桥下补给", Summary: "掩体后持续供弹。", Condition: "双方可用", Rarity: "支援", LootScore: 50, Offsets: []offset{{X: -35, Y: 40}, {X: 36, Y: -40}}},
				{Variants: []string{"attack", "occupy"}, LayerSlug: "vehicle-pad", Region: "南岸车库", BaseName: "装甲出动位", Summary: "控制南岸车库后可启用。", Condition: "阶段二开启", Rarity: "支援", LootScore: 75, Offsets: []offset{{X: 0, Y: 0}}},
				{Variants: []string{"attack", "occupy"}, LayerSlug: "mounted-gun", Region: "商贸中心", BaseName: "高层压制机枪", Summary: "可锁桥头与运河。", Condition: "固定火力", Rarity: "火力", LootScore: 62, Offsets: []offset{{X: -42, Y: -52}}},
				{Variants: []string{"attack", "occupy"}, LayerSlug: "uplink", Region: "中央运河", BaseName: "运河侦察终端", Summary: "短时标记敌方密集区域。", Condition: "冷却 90 秒", Rarity: "支援", LootScore: 68, Offsets: []offset{{X: 48, Y: 28}}},
			},
		},
	}
}

func baseExtractionPoints() []seedPointGenerator {
	return []seedPointGenerator{
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "safe-box", Region: "行政辖区", Floor: "1f", BaseName: "行政保险箱", Summary: "主楼一层的标准高价值保险箱。", Condition: "需撬锁 6 秒", Rarity: "高价值", LootScore: 88, Offsets: []offset{{X: 32, Y: -18}, {X: -28, Y: 24}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "small-safe", Region: "军营", BaseName: "营房侧箱", Summary: "靠近兵舍补给线。", Condition: "直接开启", Rarity: "中价值", LootScore: 72, Offsets: []offset{{X: -24, Y: 14}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "server", Region: "行政辖区", Floor: "2f", BaseName: "指挥服务器", Summary: "电子元件与高价值硬盘刷新。", Condition: "直接搜刮", Rarity: "高价值", LootScore: 84, Offsets: []offset{{X: 58, Y: -56}, {X: 18, Y: -12}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "workstation", Region: "游客中心", BaseName: "前台电脑", Summary: "电子配件与小情报点。", Condition: "直接搜刮", Rarity: "中价值", LootScore: 64, Offsets: []offset{{X: -22, Y: -14}, {X: 32, Y: 16}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "weapon-case", Region: "军营", BaseName: "武器库", Summary: "随机主武器与配件。", Condition: "打开后 8 秒刷新声响", Rarity: "中高价值", LootScore: 78, Offsets: []offset{{X: 18, Y: -42}, {X: 46, Y: 8}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "ammo-box", Region: "水泥厂", BaseName: "施工弹药箱", Summary: "常驻弹药与战术道具。", Condition: "直接开启", Rarity: "基础", LootScore: 55, Offsets: []offset{{X: 28, Y: -18}, {X: -26, Y: 26}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "medical-cache", Region: "主变电站", BaseName: "应急医疗箱", Summary: "止血类和高级医疗用品。", Condition: "直接开启", Rarity: "中价值", LootScore: 62, Offsets: []offset{{X: -32, Y: 26}, {X: 24, Y: -36}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "tool-cabinet", Region: "水泥厂", BaseName: "维修工具柜", Summary: "工业材料和电器零件。", Condition: "直接开启", Rarity: "基础", LootScore: 52, Offsets: []offset{{X: -36, Y: -26}, {X: 34, Y: 40}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "travel-bag", Region: "游客中心", BaseName: "旅客行李", Summary: "中价值杂项与生活物资。", Condition: "直接搜刮", Rarity: "基础", LootScore: 48, Offsets: []offset{{X: -44, Y: 18}, {X: 52, Y: -34}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "intel-cache", Region: "主变电站", BaseName: "配电情报箱", Summary: "电站图纸与小型情报件。", Condition: "直接开启", Rarity: "中高价值", LootScore: 74, Offsets: []offset{{X: 22, Y: -18}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "spawn", Region: "管道区域", BaseName: "北侧出生点", Summary: "靠近地下通道入口。", Condition: "开局可用", Rarity: "出生", LootScore: 30, Offsets: []offset{{X: -18, Y: 26}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "spawn", Region: "游客中心", BaseName: "南侧出生点", Summary: "靠近游客中心外缘。", Condition: "开局可用", Rarity: "出生", LootScore: 30, Offsets: []offset{{X: 38, Y: 28}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "standard-extract", Region: "军营", BaseName: "军营卡口撤离", Summary: "稳定撤离，开局即开放。", Condition: "所有玩家可用", Rarity: "撤离", LootScore: 40, Offsets: []offset{{X: -54, Y: -12}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "paid-extract", Region: "游客中心", BaseName: "观景台付费撤离", Summary: "掏钱即可离场。", Condition: "消耗 1 枚信标", Rarity: "撤离", LootScore: 45, Offsets: []offset{{X: 68, Y: -18}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "conditional-extract", Region: "管道区域", Floor: "b1", BaseName: "管道闸门撤离", Summary: "隐蔽但要求携带通行卡。", Condition: "持有地下通行卡", Rarity: "撤离", LootScore: 58, Offsets: []offset{{X: 56, Y: 48}}},
	}
}

func genericExtractionPoints(mapSlug string) []seedPointGenerator {
	regionOrder := map[string][]string{
		"longbow-valley": {"北谷口", "溪谷车站", "悬崖观测哨", "旧矿洞", "河心补给站", "南侧营地"},
		"space-base":     {"指挥塔台", "燃料广场", "发射井", "装配车间", "停机坪", "南区仓储"},
		"baksh":          {"巴克什集市", "皇家博物馆", "蓝汀旅馆", "大浴场", "樱桃小镇", "停车场"},
		"tide-prison":    {"外环码头", "西监区", "中央监管塔", "医务监区", "北侧崖道", "封锁闸门"},
	}
	r := regionOrder[mapSlug]
	return []seedPointGenerator{
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "safe-box", Region: r[0], BaseName: "主区保险箱", Summary: "主线高价值保险箱。", Condition: "需要撬锁 6 秒", Rarity: "高价值", LootScore: 84, Offsets: []offset{{X: 34, Y: -22}, {X: -30, Y: 18}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "small-safe", Region: r[1], BaseName: "侧屋保险箱", Summary: "副路线补充资源。", Condition: "直接开启", Rarity: "中价值", LootScore: 68, Offsets: []offset{{X: -26, Y: 16}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "server", Region: r[1], BaseName: "控制终端", Summary: "电子元件与高价值硬盘刷新。", Condition: "直接搜刮", Rarity: "高价值", LootScore: 82, Offsets: []offset{{X: 28, Y: -34}, {X: 56, Y: 14}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "workstation", Region: r[2], BaseName: "办公终端", Summary: "电子配件与小情报点。", Condition: "直接搜刮", Rarity: "中价值", LootScore: 60, Offsets: []offset{{X: -20, Y: 18}, {X: 34, Y: -14}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "weapon-case", Region: r[3], BaseName: "武器存放箱", Summary: "随机主武器与配件。", Condition: "打开后会暴露位置", Rarity: "中高价值", LootScore: 78, Offsets: []offset{{X: 18, Y: -28}, {X: -42, Y: 24}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "ammo-box", Region: r[4], BaseName: "前线弹药箱", Summary: "常驻弹药与战术道具。", Condition: "直接开启", Rarity: "基础", LootScore: 54, Offsets: []offset{{X: 26, Y: -18}, {X: -32, Y: 26}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "medical-cache", Region: r[3], BaseName: "应急医疗箱", Summary: "高等级医疗物资。", Condition: "直接开启", Rarity: "中价值", LootScore: 64, Offsets: []offset{{X: 38, Y: 36}, {X: -18, Y: -34}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "tool-cabinet", Region: r[5], BaseName: "维修工具柜", Summary: "工业材料和电器零件。", Condition: "直接开启", Rarity: "基础", LootScore: 50, Offsets: []offset{{X: -36, Y: -24}, {X: 34, Y: 22}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "travel-bag", Region: r[0], BaseName: "散落背包", Summary: "生活物资与杂项。", Condition: "直接搜刮", Rarity: "基础", LootScore: 42, Offsets: []offset{{X: -44, Y: 22}, {X: 52, Y: -18}}},
		{Variants: []string{"secure", "classified"}, LayerSlug: "intel-cache", Region: r[2], BaseName: "机要情报箱", Summary: "高阶情报与稀有配件。", Condition: "需要门禁卡", Rarity: "高价值", LootScore: 90, Offsets: []offset{{X: 26, Y: -46}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "spawn", Region: r[0], BaseName: "北侧出生点", Summary: "靠近外圈进入点。", Condition: "开局可用", Rarity: "出生", LootScore: 30, Offsets: []offset{{X: -58, Y: 48}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "spawn", Region: r[5], BaseName: "南侧出生点", Summary: "靠近边缘撤离线。", Condition: "开局可用", Rarity: "出生", LootScore: 30, Offsets: []offset{{X: 44, Y: 54}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "standard-extract", Region: r[1], BaseName: "主路常规撤离", Summary: "稳定撤离点。", Condition: "所有玩家可用", Rarity: "撤离", LootScore: 42, Offsets: []offset{{X: -62, Y: -12}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "paid-extract", Region: r[4], BaseName: "高台付费撤离", Summary: "成本较高但路线最短。", Condition: "消耗 1 枚信标", Rarity: "撤离", LootScore: 50, Offsets: []offset{{X: 60, Y: -30}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "conditional-extract", Region: r[5], BaseName: "隐蔽撤离门", Summary: "要求满足场景条件。", Condition: "完成区域互动", Rarity: "撤离", LootScore: 58, Offsets: []offset{{X: -56, Y: -42}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "boss", Region: r[2], BaseName: "区域首领", Summary: "高压警戒巡逻小队。", Condition: "随机刷新", Rarity: "威胁", LootScore: 92, Offsets: []offset{{X: 0, Y: 0}}},
		{Variants: []string{"regular", "secure", "classified"}, LayerSlug: "signal", Region: r[3], BaseName: "信号中继站", Summary: "可同步附近高价值房间状态。", Condition: "互动 4 秒", Rarity: "功能点", LootScore: 60, Offsets: []offset{{X: 54, Y: 10}}},
	}
}

func buildPoints(generators []seedPointGenerator, regionLookup map[string]seedRegion) []seedPoint {
	var points []seedPoint
	for _, generator := range generators {
		anchor, ok := regionLookup[generator.Region]
		if !ok {
			continue
		}
		for _, variant := range generator.Variants {
			for idx, delta := range generator.Offsets {
				name := generator.BaseName
				if len(generator.Offsets) > 1 {
					name = fmt.Sprintf("%s %d", generator.BaseName, idx+1)
				}
				points = append(points, seedPoint{
					Variant:   variant,
					LayerSlug: generator.LayerSlug,
					Region:    generator.Region,
					Floor:     generator.Floor,
					EventSlug: generator.EventSlug,
					Name:      name,
					Summary:   generator.Summary,
					Detail:    buildDetail(name, generator.Region, generator.Summary),
					Condition: generator.Condition,
					Rarity:    generator.Rarity,
					LootScore: generator.LootScore,
					X:         clamp(anchor.X+delta.X, 60, 940),
					Y:         clamp(anchor.Y+delta.Y, 60, 940),
				})
			}
		}
	}
	return points
}

func buildDetail(name, region, summary string) string {
	return fmt.Sprintf("%s 位于 %s，适合沿附近掩体完成二次搜刮。%s", name, region, summary)
}

func clamp(value, minValue, maxValue float64) float64 {
	return math.Max(minValue, math.Min(maxValue, value))
}
