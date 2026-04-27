package data

import (
	"database/sql"
	"embed"
	"encoding/json"
	"strings"

	"dktool/backend/internal/assets"
)

//go:embed static/rocom-world.json
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
	body, err := staticSeedFiles.ReadFile("static/rocom-world.json")
	if err != nil {
		return nil, nil, err
	}

	var dataset externalSeedDataset
	if err := json.Unmarshal(body, &dataset); err != nil {
		return nil, nil, err
	}

	mode := seedMode{
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
			ImageURLs: localizeRocomImageURLs(point.ImageURLs),
		})
	}

	return []seedMode{mode}, []seedMap{gameMap}, nil
}

func SyncExternalPointMedia(db *sql.DB) error {
	_, externalMaps, err := loadExternalSeeds()
	if err != nil {
		return err
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, gameMap := range externalMaps {
		var mapID int64
		if scanErr := tx.QueryRow(`SELECT id FROM maps WHERE slug = ?`, gameMap.Slug).Scan(&mapID); scanErr != nil {
			if scanErr == sql.ErrNoRows {
				continue
			}
			return scanErr
		}

		for _, point := range gameMap.Points {
			imageURLsJSON, marshalErr := json.Marshal(point.ImageURLs)
			if marshalErr != nil {
				return marshalErr
			}

			if _, execErr := tx.Exec(`
				UPDATE points
				SET image_urls = ?
				WHERE map_id = ?
					AND variant_slug = ?
					AND layer_slug = ?
					AND region_name = ?
					AND floor_slug = ?
					AND event_slug = ?
					AND name = ?
					AND ABS(x - ?) < 1e-9
					AND ABS(y - ?) < 1e-9`,
				string(imageURLsJSON), mapID, point.Variant, point.LayerSlug, point.Region, point.Floor,
				point.EventSlug, point.Name, point.X, point.Y,
			); execErr != nil {
				return execErr
			}
		}
	}

	return tx.Commit()
}

func localizeRocomImageURLs(raw []string) []string {
	if len(raw) == 0 {
		return []string{}
	}

	seen := map[string]struct{}{}
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		localURL := strings.TrimSpace(assets.ProxyRocomImageURL(item))
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
