package data

import (
	"database/sql"
	"embed"
	"encoding/json"
	"path"
	"sort"
	"strings"

	"dktool/backend/internal/assets"
)

//go:embed static/*.json
var staticSeedFiles embed.FS

type externalSeedDataset struct {
	Mode externalSeedMode `json:"mode"`
	Map  externalSeedMap  `json:"map"`
}

type externalSeedMode struct {
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	Subtitle    string `json:"subtitle"`
	Description string `json:"description"`
	Accent      string `json:"accent"`
	Sort        int    `json:"sort"`
}

type externalSeedMap struct {
	ModeSlug       string                   `json:"modeSlug"`
	Slug           string                   `json:"slug"`
	Name           string                   `json:"name"`
	Caption        string                   `json:"caption"`
	Description    string                   `json:"description"`
	Theme          string                   `json:"theme"`
	TileSource     json.RawMessage          `json:"tileSource,omitempty"`
	DefaultVariant string                   `json:"defaultVariant"`
	DefaultFloor   string                   `json:"defaultFloor"`
	Sort           int                      `json:"sort"`
	Variants       []externalSeedVariant    `json:"variants"`
	Floors         []externalSeedFloor      `json:"floors"`
	Regions        []externalSeedRegion     `json:"regions"`
	Events         []externalSeedEvent      `json:"events"`
	LayerGroups    []externalSeedLayerGroup `json:"layerGroups"`
	Points         []externalSeedPoint      `json:"points"`
}

type externalSeedVariant struct {
	Slug        string `json:"slug"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Sort        int    `json:"sort"`
}

type externalSeedFloor struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
	Sort int    `json:"sort"`
}

type externalSeedRegion struct {
	Name  string  `json:"name"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Floor string  `json:"floor"`
	Sort  int     `json:"sort"`
}

type externalSeedEvent struct {
	Slug           string `json:"slug"`
	Name           string `json:"name"`
	Summary        string `json:"summary"`
	Hint           string `json:"hint"`
	HighlightColor string `json:"highlightColor"`
	FocusRegion    string `json:"focusRegion"`
	Sort           int    `json:"sort"`
}

type externalSeedLayerGroup struct {
	Slug   string              `json:"slug"`
	Name   string              `json:"name"`
	Sort   int                 `json:"sort"`
	Layers []externalSeedLayer `json:"layers"`
}

type externalSeedLayer struct {
	Slug    string `json:"slug"`
	Name    string `json:"name"`
	Icon    string `json:"icon"`
	Color   string `json:"color"`
	Sort    int    `json:"sort"`
	Enabled bool   `json:"enabled"`
}

type externalSeedPoint struct {
	VariantSlug string   `json:"variantSlug"`
	LayerSlug   string   `json:"layerSlug"`
	RegionName  string   `json:"regionName"`
	Floor       string   `json:"floor"`
	EventSlug   string   `json:"eventSlug"`
	Name        string   `json:"name"`
	Summary     string   `json:"summary"`
	Detail      string   `json:"detail"`
	Condition   string   `json:"condition"`
	Rarity      string   `json:"rarity"`
	X           float64  `json:"x"`
	Y           float64  `json:"y"`
	LootScore   int      `json:"lootScore"`
	ImageURLs   []string `json:"imageUrls"`
}

func loadExternalSeeds() ([]seedMode, []seedMap, error) {
	entries, err := staticSeedFiles.ReadDir("static")
	if err != nil {
		return nil, nil, err
	}

	fileNames := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".json") {
			continue
		}
		fileNames = append(fileNames, entry.Name())
	}
	sort.Strings(fileNames)

	modeLookup := map[string]seedMode{}
	maps := make([]seedMap, 0, len(fileNames))

	for _, fileName := range fileNames {
		body, readErr := staticSeedFiles.ReadFile(path.Join("static", fileName))
		if readErr != nil {
			return nil, nil, readErr
		}

		var dataset externalSeedDataset
		if err := json.Unmarshal(body, &dataset); err != nil {
			return nil, nil, err
		}

		modeLookup[dataset.Mode.Slug] = seedMode{
			Slug:        dataset.Mode.Slug,
			Name:        dataset.Mode.Name,
			Subtitle:    dataset.Mode.Subtitle,
			Description: dataset.Mode.Description,
			Accent:      dataset.Mode.Accent,
			Sort:        dataset.Mode.Sort,
		}

		gameMap := seedMap{
			ModeSlug:       dataset.Map.ModeSlug,
			Slug:           dataset.Map.Slug,
			Name:           dataset.Map.Name,
			Caption:        dataset.Map.Caption,
			Description:    dataset.Map.Description,
			Theme:          dataset.Map.Theme,
			TileSource:     normalizeExternalTileSource(dataset.Map.TileSource),
			DefaultVariant: dataset.Map.DefaultVariant,
			DefaultFloor:   dataset.Map.DefaultFloor,
			Sort:           dataset.Map.Sort,
		}

		for _, variant := range dataset.Map.Variants {
			gameMap.Variants = append(gameMap.Variants, seedVariant{
				Slug:        variant.Slug,
				Label:       variant.Label,
				Description: variant.Description,
				Sort:        variant.Sort,
			})
		}
		for _, floor := range dataset.Map.Floors {
			gameMap.Floors = append(gameMap.Floors, seedFloor{
				Slug: floor.Slug,
				Name: floor.Name,
				Sort: floor.Sort,
			})
		}
		for _, region := range dataset.Map.Regions {
			gameMap.Regions = append(gameMap.Regions, seedRegion{
				Name:  region.Name,
				X:     region.X,
				Y:     region.Y,
				Floor: region.Floor,
				Sort:  region.Sort,
			})
		}
		for _, event := range dataset.Map.Events {
			gameMap.Events = append(gameMap.Events, seedEvent{
				Slug:           event.Slug,
				Name:           event.Name,
				Summary:        event.Summary,
				Hint:           event.Hint,
				HighlightColor: event.HighlightColor,
				FocusRegion:    event.FocusRegion,
				Sort:           event.Sort,
			})
		}
		for _, group := range dataset.Map.LayerGroups {
			item := seedLayerGroup{
				Slug: group.Slug,
				Name: group.Name,
				Sort: group.Sort,
			}
			for _, layer := range group.Layers {
				item.Layers = append(item.Layers, seedLayer{
					Slug:    layer.Slug,
					Name:    layer.Name,
					Icon:    layer.Icon,
					Color:   layer.Color,
					Sort:    layer.Sort,
					Enabled: layer.Enabled,
				})
			}
			gameMap.LayerGroups = append(gameMap.LayerGroups, item)
		}
		for _, point := range dataset.Map.Points {
			gameMap.Points = append(gameMap.Points, seedPoint{
				Variant:   point.VariantSlug,
				LayerSlug: point.LayerSlug,
				Region:    point.RegionName,
				Floor:     point.Floor,
				EventSlug: point.EventSlug,
				Name:      point.Name,
				Summary:   point.Summary,
				Detail:    point.Detail,
				Condition: point.Condition,
				Rarity:    point.Rarity,
				LootScore: point.LootScore,
				X:         point.X,
				Y:         point.Y,
				ImageURLs: localizeRemoteImageURLs(point.ImageURLs),
			})
		}

		maps = append(maps, gameMap)
	}

	modes := make([]seedMode, 0, len(modeLookup))
	for _, mode := range modeLookup {
		modes = append(modes, mode)
	}

	sort.Slice(modes, func(left, right int) bool {
		if modes[left].Sort == modes[right].Sort {
			return modes[left].Slug < modes[right].Slug
		}
		return modes[left].Sort < modes[right].Sort
	})
	sort.Slice(maps, func(left, right int) bool {
		if maps[left].Sort == maps[right].Sort {
			return maps[left].Slug < maps[right].Slug
		}
		return maps[left].Sort < maps[right].Sort
	})

	return modes, maps, nil
}

func SyncExternalSeeds(db *sql.DB) error {
	externalModes, externalMaps, err := loadExternalSeeds()
	if err != nil {
		return err
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, mode := range externalModes {
		if _, execErr := tx.Exec(`
			INSERT INTO modes (slug, name, subtitle, description, accent, sort_order)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(slug) DO UPDATE SET
				name = excluded.name,
				subtitle = excluded.subtitle,
				description = excluded.description,
				accent = excluded.accent,
				sort_order = excluded.sort_order`,
			mode.Slug, mode.Name, mode.Subtitle, mode.Description, mode.Accent, mode.Sort,
		); execErr != nil {
			return execErr
		}
	}

	for _, gameMap := range externalMaps {
		tileSourceJSON := tileSourceJSONString(gameMap.TileSource)

		var mapID int64
		scanErr := tx.QueryRow(`SELECT id FROM maps WHERE slug = ?`, gameMap.Slug).Scan(&mapID)
		switch scanErr {
		case nil:
			if _, execErr := tx.Exec(`
				UPDATE maps
				SET mode_id = (SELECT id FROM modes WHERE slug = ?),
					name = ?, caption = ?, description = ?, theme = ?, tile_source_json = ?,
					default_variant_slug = ?, default_floor_slug = ?, sort_order = ?
				WHERE id = ?`,
				gameMap.ModeSlug, gameMap.Name, gameMap.Caption, gameMap.Description, gameMap.Theme, tileSourceJSON,
				gameMap.DefaultVariant, gameMap.DefaultFloor, gameMap.Sort, mapID,
			); execErr != nil {
				return execErr
			}
		case sql.ErrNoRows:
			res, execErr := tx.Exec(`
				INSERT INTO maps (
					mode_id, slug, name, caption, description, theme, tile_source_json,
					default_variant_slug, default_floor_slug, sort_order
				) VALUES ((SELECT id FROM modes WHERE slug = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				gameMap.ModeSlug, gameMap.Slug, gameMap.Name, gameMap.Caption, gameMap.Description,
				gameMap.Theme, tileSourceJSON, gameMap.DefaultVariant, gameMap.DefaultFloor, gameMap.Sort,
			)
			if execErr != nil {
				return execErr
			}
			mapID, _ = res.LastInsertId()
		default:
			return scanErr
		}

		if _, execErr := tx.Exec(`DELETE FROM points WHERE map_id = ?`, mapID); execErr != nil {
			return execErr
		}
		if _, execErr := tx.Exec(`DELETE FROM layers WHERE group_id IN (SELECT id FROM layer_groups WHERE map_id = ?)`, mapID); execErr != nil {
			return execErr
		}
		if _, execErr := tx.Exec(`DELETE FROM layer_groups WHERE map_id = ?`, mapID); execErr != nil {
			return execErr
		}
		if _, execErr := tx.Exec(`DELETE FROM map_events WHERE map_id = ?`, mapID); execErr != nil {
			return execErr
		}
		if _, execErr := tx.Exec(`DELETE FROM map_regions WHERE map_id = ?`, mapID); execErr != nil {
			return execErr
		}
		if _, execErr := tx.Exec(`DELETE FROM map_floors WHERE map_id = ?`, mapID); execErr != nil {
			return execErr
		}
		if _, execErr := tx.Exec(`DELETE FROM map_variants WHERE map_id = ?`, mapID); execErr != nil {
			return execErr
		}

		for _, variant := range gameMap.Variants {
			if _, execErr := tx.Exec(`
				INSERT INTO map_variants (map_id, slug, label, description, sort_order)
				VALUES (?, ?, ?, ?, ?)`,
				mapID, variant.Slug, variant.Label, variant.Description, variant.Sort,
			); execErr != nil {
				return execErr
			}
		}
		for _, floor := range gameMap.Floors {
			if _, execErr := tx.Exec(`
				INSERT INTO map_floors (map_id, slug, name, sort_order)
				VALUES (?, ?, ?, ?)`,
				mapID, floor.Slug, floor.Name, floor.Sort,
			); execErr != nil {
				return execErr
			}
		}
		for _, region := range gameMap.Regions {
			if _, execErr := tx.Exec(`
				INSERT INTO map_regions (map_id, name, x, y, floor_slug, sort_order)
				VALUES (?, ?, ?, ?, ?, ?)`,
				mapID, region.Name, region.X, region.Y, region.Floor, region.Sort,
			); execErr != nil {
				return execErr
			}
		}
		for _, event := range gameMap.Events {
			if _, execErr := tx.Exec(`
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
				if _, execErr := tx.Exec(`
					INSERT INTO layers (group_id, slug, name, icon, color, sort_order, default_enabled)
					VALUES (?, ?, ?, ?, ?, ?, ?)`,
					groupID, layer.Slug, layer.Name, layer.Icon, layer.Color, layer.Sort, enabled,
				); execErr != nil {
					return execErr
				}
			}
		}
		for _, point := range gameMap.Points {
			searchText := strings.ToLower(strings.Join([]string{
				point.Name, point.Region, point.Summary, point.Condition, point.Rarity, point.LayerSlug,
			}, " "))
			imageURLsJSON, marshalErr := json.Marshal(point.ImageURLs)
			if marshalErr != nil {
				return marshalErr
			}
			if _, execErr := tx.Exec(`
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

func SyncExternalPointMedia(db *sql.DB) error {
	return SyncExternalSeeds(db)
}

func localizeRemoteImageURLs(raw []string) []string {
	if len(raw) == 0 {
		return []string{}
	}

	seen := map[string]struct{}{}
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		localURL := strings.TrimSpace(assets.ProxyRemoteImageURL(item))
		if localURL == "" {
			continue
		}
		if _, exists := seen[localURL]; exists {
			continue
		}
		seen[localURL] = struct{}{}
		out = append(out, localURL)
	}
	return out
}

func normalizeExternalTileSource(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return nil
	}

	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return raw
	}

	keyPrefix, _ := payload["keyPrefix"].(string)
	if _, hasURLTemplate := payload["urlTemplate"]; !hasURLTemplate && keyPrefix != "" {
		if strings.HasPrefix(keyPrefix, "tile/rocom/") {
			payload["urlTemplate"] = "/api/assets/" + keyPrefix + "/{z}/{y}_{x}.png"
			if _, ok := payload["tileSize"]; !ok {
				payload["tileSize"] = 256
			}
			if _, ok := payload["noWrap"]; !ok {
				payload["noWrap"] = true
			}
		}
	}

	if initCenter, ok := payload["initCenter"].(map[string]any); ok {
		if _, hasLat := payload["initLat"]; !hasLat {
			payload["initLat"] = initCenter["lat"]
		}
		if _, hasLng := payload["initLng"]; !hasLng {
			payload["initLng"] = initCenter["lng"]
		}
	}

	normalized, err := json.Marshal(payload)
	if err != nil {
		return raw
	}
	return normalized
}
