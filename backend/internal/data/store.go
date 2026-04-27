package data

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"dktool/backend/internal/domain"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

type AssetStats struct {
	Count      int   `json:"count"`
	TotalBytes int64 `json:"totalBytes"`
}

func NewStore(dbPath string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}

	store := &Store{db: db}
	if err := store.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	if err := SeedIfEmpty(db); err != nil {
		db.Close()
		return nil, err
	}
	if err := SyncExternalSeeds(db); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) GetAsset(assetKey string) (contentType string, body []byte, found bool, err error) {
	err = s.db.QueryRow(`
		SELECT content_type, body
		FROM assets
		WHERE asset_key = ?`,
		assetKey,
	).Scan(&contentType, &body)
	if err == sql.ErrNoRows {
		return "", nil, false, nil
	}
	if err != nil {
		return "", nil, false, err
	}
	return contentType, body, true, nil
}

func (s *Store) SaveAsset(assetKey, sourceURL, contentType string, body []byte) error {
	_, err := s.db.Exec(`
		INSERT INTO assets (asset_key, source_url, content_type, body, updated_at)
		VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(asset_key) DO UPDATE SET
			source_url = excluded.source_url,
			content_type = excluded.content_type,
			body = excluded.body,
			updated_at = CURRENT_TIMESTAMP`,
		assetKey, sourceURL, contentType, body,
	)
	return err
}

func (s *Store) AssetStats() (AssetStats, error) {
	var stats AssetStats
	err := s.db.QueryRow(`
		SELECT COUNT(*), COALESCE(SUM(LENGTH(body)), 0)
		FROM assets`,
	).Scan(&stats.Count, &stats.TotalBytes)
	return stats, err
}

func (s *Store) migrate() error {
	schema := []string{
		`CREATE TABLE IF NOT EXISTS modes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			slug TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			subtitle TEXT NOT NULL,
			description TEXT NOT NULL,
			accent TEXT NOT NULL,
			sort_order INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS maps (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			mode_id INTEGER NOT NULL,
			slug TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			caption TEXT NOT NULL,
			description TEXT NOT NULL,
			theme TEXT NOT NULL,
			tile_source_json TEXT NOT NULL DEFAULT '',
			default_variant_slug TEXT NOT NULL,
			default_floor_slug TEXT NOT NULL,
			sort_order INTEGER NOT NULL,
			FOREIGN KEY(mode_id) REFERENCES modes(id)
		)`,
		`CREATE TABLE IF NOT EXISTS map_variants (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			map_id INTEGER NOT NULL,
			slug TEXT NOT NULL,
			label TEXT NOT NULL,
			description TEXT NOT NULL,
			sort_order INTEGER NOT NULL,
			UNIQUE(map_id, slug),
			FOREIGN KEY(map_id) REFERENCES maps(id)
		)`,
		`CREATE TABLE IF NOT EXISTS map_floors (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			map_id INTEGER NOT NULL,
			slug TEXT NOT NULL,
			name TEXT NOT NULL,
			sort_order INTEGER NOT NULL,
			UNIQUE(map_id, slug),
			FOREIGN KEY(map_id) REFERENCES maps(id)
		)`,
		`CREATE TABLE IF NOT EXISTS map_regions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			map_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			x REAL NOT NULL,
			y REAL NOT NULL,
			floor_slug TEXT NOT NULL DEFAULT '',
			sort_order INTEGER NOT NULL,
			FOREIGN KEY(map_id) REFERENCES maps(id)
		)`,
		`CREATE TABLE IF NOT EXISTS map_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			map_id INTEGER NOT NULL,
			slug TEXT NOT NULL,
			name TEXT NOT NULL,
			summary TEXT NOT NULL,
			hint TEXT NOT NULL,
			highlight_color TEXT NOT NULL,
			focus_region TEXT NOT NULL,
			sort_order INTEGER NOT NULL,
			UNIQUE(map_id, slug),
			FOREIGN KEY(map_id) REFERENCES maps(id)
		)`,
		`CREATE TABLE IF NOT EXISTS layer_groups (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			map_id INTEGER NOT NULL,
			slug TEXT NOT NULL,
			name TEXT NOT NULL,
			sort_order INTEGER NOT NULL,
			UNIQUE(map_id, slug),
			FOREIGN KEY(map_id) REFERENCES maps(id)
		)`,
		`CREATE TABLE IF NOT EXISTS layers (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			group_id INTEGER NOT NULL,
			slug TEXT NOT NULL,
			name TEXT NOT NULL,
			icon TEXT NOT NULL,
			color TEXT NOT NULL,
			sort_order INTEGER NOT NULL,
			default_enabled INTEGER NOT NULL DEFAULT 1,
			UNIQUE(group_id, slug),
			FOREIGN KEY(group_id) REFERENCES layer_groups(id)
		)`,
		`CREATE TABLE IF NOT EXISTS points (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			map_id INTEGER NOT NULL,
			variant_slug TEXT NOT NULL,
			layer_slug TEXT NOT NULL,
			region_name TEXT NOT NULL,
			floor_slug TEXT NOT NULL DEFAULT '',
			event_slug TEXT NOT NULL DEFAULT '',
			name TEXT NOT NULL,
			summary TEXT NOT NULL,
			detail_text TEXT NOT NULL,
			condition_text TEXT NOT NULL,
			rarity TEXT NOT NULL,
			x REAL NOT NULL,
			y REAL NOT NULL,
			loot_score INTEGER NOT NULL DEFAULT 0,
			search_text TEXT NOT NULL,
			image_urls TEXT NOT NULL DEFAULT '[]',
			FOREIGN KEY(map_id) REFERENCES maps(id)
		)`,
		`CREATE TABLE IF NOT EXISTS assets (
			asset_key TEXT PRIMARY KEY,
			source_url TEXT NOT NULL,
			content_type TEXT NOT NULL,
			body BLOB NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
	}

	for _, statement := range schema {
		if _, err := s.db.Exec(statement); err != nil {
			return err
		}
	}

	if err := s.ensurePointMediaColumns(); err != nil {
		return err
	}
	if err := s.ensureMapTileSourceColumn(); err != nil {
		return err
	}

	return nil
}

func (s *Store) MapView(query domain.MapViewQuery) (*domain.MapViewResponse, error) {
	modes, err := s.fetchModes()
	if err != nil {
		return nil, err
	}
	if len(modes) == 0 {
		return nil, errors.New("no modes available")
	}

	currentMode := modes[0]
	if query.ModeSlug != "" {
		for _, mode := range modes {
			if mode.Slug == query.ModeSlug {
				currentMode = mode
				break
			}
		}
	}

	maps, err := s.fetchMaps(currentMode.Slug)
	if err != nil {
		return nil, err
	}
	if len(maps) == 0 {
		return nil, fmt.Errorf("no maps available for mode %s", currentMode.Slug)
	}

	currentMap := maps[0]
	if query.MapSlug != "" {
		for _, candidate := range maps {
			if candidate.Slug == query.MapSlug {
				currentMap = candidate
				break
			}
		}
	}

	mapID, err := s.lookupMapID(currentMap.Slug)
	if err != nil {
		return nil, err
	}

	variants, err := s.fetchVariants(mapID)
	if err != nil {
		return nil, err
	}
	currentVariant := currentMap.DefaultVariant
	if currentVariant == "" && len(variants) > 0 {
		currentVariant = variants[0].Slug
	}
	if query.Variant != "" {
		for _, variant := range variants {
			if variant.Slug == query.Variant {
				currentVariant = variant.Slug
				break
			}
		}
	}

	floors, err := s.fetchFloors(mapID)
	if err != nil {
		return nil, err
	}
	currentFloor := normalizeFloor(query.Floor, currentMap.DefaultFloor)
	if currentFloor == "" {
		currentFloor = "all"
	}
	if !floorExists(currentFloor, floors) {
		currentFloor = currentMap.DefaultFloor
		if currentFloor == "" {
			currentFloor = "all"
		}
	}

	regions, err := s.fetchRegions(mapID)
	if err != nil {
		return nil, err
	}
	events, err := s.fetchEvents(mapID)
	if err != nil {
		return nil, err
	}
	currentEvent := normalizeEvent(query.EventSlug)
	if currentEvent != "none" && !eventExists(currentEvent, events) {
		currentEvent = "none"
	}

	layerGroups, allLayerSlugs, err := s.fetchLayerGroups(mapID)
	if err != nil {
		return nil, err
	}
	selectedLayers := normalizeLayerSelection(query.LayerSlugs, allLayerSlugs, query.LayerMode)

	layerCounts, err := s.fetchLayerCounts(mapID, currentVariant, currentFloor, currentEvent)
	if err != nil {
		return nil, err
	}
	for groupIdx := range layerGroups {
		for layerIdx := range layerGroups[groupIdx].Layers {
			layer := &layerGroups[groupIdx].Layers[layerIdx]
			layer.Count = layerCounts[layer.Slug]
			layer.Enabled = contains(selectedLayers, layer.Slug)
		}
	}

	points, totalPoints, err := s.fetchPoints(mapID, currentVariant, currentFloor, currentEvent, selectedLayers, query.Search)
	if err != nil {
		return nil, err
	}

	return &domain.MapViewResponse{
		Modes:          modes,
		CurrentMode:    currentMode,
		Maps:           maps,
		CurrentMap:     currentMap,
		Variants:       variants,
		CurrentVariant: currentVariant,
		Floors:         floors,
		CurrentFloor:   currentFloor,
		RandomEvents:   events,
		CurrentEvent:   currentEvent,
		Regions:        regions,
		LayerGroups:    layerGroups,
		SelectedLayers: selectedLayers,
		Points:         points,
		Stats: domain.ViewStats{
			TotalPoints:   totalPoints,
			VisiblePoints: len(points),
		},
	}, nil
}

func (s *Store) fetchModes() ([]domain.ModeSummary, error) {
	modes := make([]domain.ModeSummary, 0)
	rows, err := s.db.Query(`
		SELECT slug, name, subtitle, description, accent
		FROM modes
		ORDER BY sort_order`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var mode domain.ModeSummary
		if err := rows.Scan(&mode.Slug, &mode.Name, &mode.Subtitle, &mode.Description, &mode.Accent); err != nil {
			return nil, err
		}
		modes = append(modes, mode)
	}
	return modes, rows.Err()
}

func (s *Store) fetchMaps(modeSlug string) ([]domain.MapSummary, error) {
	maps := make([]domain.MapSummary, 0)
	rows, err := s.db.Query(`
		SELECT maps.slug, maps.name, maps.caption, maps.description, maps.theme, maps.tile_source_json, maps.default_variant_slug, maps.default_floor_slug
		FROM maps
		JOIN modes ON maps.mode_id = modes.id
		WHERE modes.slug = ?
		ORDER BY maps.sort_order`, modeSlug)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var summary domain.MapSummary
		var rawTileSource string
		if err := rows.Scan(
			&summary.Slug, &summary.Name, &summary.Caption, &summary.Description,
			&summary.Theme, &rawTileSource, &summary.DefaultVariant, &summary.DefaultFloor,
		); err != nil {
			return nil, err
		}
		if strings.TrimSpace(rawTileSource) != "" && json.Valid([]byte(rawTileSource)) {
			summary.TileSource = json.RawMessage(rawTileSource)
		}
		maps = append(maps, summary)
	}
	return maps, rows.Err()
}

func (s *Store) lookupMapID(mapSlug string) (int64, error) {
	var mapID int64
	if err := s.db.QueryRow(`SELECT id FROM maps WHERE slug = ?`, mapSlug).Scan(&mapID); err != nil {
		return 0, err
	}
	return mapID, nil
}

func (s *Store) fetchVariants(mapID int64) ([]domain.Variant, error) {
	variants := make([]domain.Variant, 0)
	rows, err := s.db.Query(`
		SELECT slug, label, description
		FROM map_variants
		WHERE map_id = ?
		ORDER BY sort_order`, mapID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var variant domain.Variant
		if err := rows.Scan(&variant.Slug, &variant.Label, &variant.Description); err != nil {
			return nil, err
		}
		variants = append(variants, variant)
	}
	return variants, rows.Err()
}

func (s *Store) fetchFloors(mapID int64) ([]domain.Floor, error) {
	floors := make([]domain.Floor, 0)
	rows, err := s.db.Query(`
		SELECT slug, name
		FROM map_floors
		WHERE map_id = ?
		ORDER BY sort_order`, mapID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var floor domain.Floor
		if err := rows.Scan(&floor.Slug, &floor.Name); err != nil {
			return nil, err
		}
		floors = append(floors, floor)
	}
	return floors, rows.Err()
}

func (s *Store) fetchRegions(mapID int64) ([]domain.Region, error) {
	regions := make([]domain.Region, 0)
	rows, err := s.db.Query(`
		SELECT name, x, y, floor_slug
		FROM map_regions
		WHERE map_id = ?
		ORDER BY sort_order`, mapID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var region domain.Region
		if err := rows.Scan(&region.Name, &region.X, &region.Y, &region.Floor); err != nil {
			return nil, err
		}
		regions = append(regions, region)
	}
	return regions, rows.Err()
}

func (s *Store) fetchEvents(mapID int64) ([]domain.RandomEvent, error) {
	events := make([]domain.RandomEvent, 0)
	rows, err := s.db.Query(`
		SELECT slug, name, summary, hint, highlight_color, focus_region
		FROM map_events
		WHERE map_id = ?
		ORDER BY sort_order`, mapID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var event domain.RandomEvent
		if err := rows.Scan(
			&event.Slug, &event.Name, &event.Summary, &event.Hint,
			&event.HighlightColor, &event.FocusRegion,
		); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *Store) fetchLayerGroups(mapID int64) ([]domain.LayerGroup, []string, error) {
	rows, err := s.db.Query(`
		SELECT layer_groups.slug, layer_groups.name, layers.slug, layers.name, layers.icon, layers.color, layers.default_enabled
		FROM layer_groups
		JOIN layers ON layers.group_id = layer_groups.id
		WHERE layer_groups.map_id = ?
		ORDER BY layer_groups.sort_order, layers.sort_order`, mapID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	groupIndex := map[string]int{}
	groups := make([]domain.LayerGroup, 0)
	layerSlugs := make([]string, 0)
	for rows.Next() {
		var groupSlug, groupName string
		var layer domain.Layer
		var defaultEnabled int
		if err := rows.Scan(&groupSlug, &groupName, &layer.Slug, &layer.Name, &layer.Icon, &layer.Color, &defaultEnabled); err != nil {
			return nil, nil, err
		}
		layer.Enabled = defaultEnabled == 1
		layerSlugs = append(layerSlugs, layer.Slug)

		idx, ok := groupIndex[groupSlug]
		if !ok {
			groupIndex[groupSlug] = len(groups)
			groups = append(groups, domain.LayerGroup{Slug: groupSlug, Name: groupName})
			idx = len(groups) - 1
		}
		groups[idx].Layers = append(groups[idx].Layers, layer)
	}
	return groups, layerSlugs, rows.Err()
}

func (s *Store) fetchLayerCounts(mapID int64, variant, floor, eventSlug string) (map[string]int, error) {
	query := `
		SELECT layer_slug, COUNT(1)
		FROM points
		WHERE map_id = ? AND variant_slug = ?
	`
	args := []any{mapID, variant}

	if floor != "" && floor != "all" {
		query += ` AND (floor_slug = '' OR floor_slug = ?)`
		args = append(args, floor)
	}
	if eventSlug == "none" {
		query += ` AND event_slug = ''`
	} else {
		query += ` AND (event_slug = '' OR event_slug = ?)`
		args = append(args, eventSlug)
	}

	query += ` GROUP BY layer_slug`
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := map[string]int{}
	for rows.Next() {
		var slug string
		var count int
		if err := rows.Scan(&slug, &count); err != nil {
			return nil, err
		}
		counts[slug] = count
	}
	return counts, rows.Err()
}

func (s *Store) fetchPoints(mapID int64, variant, floor, eventSlug string, layers []string, search string) ([]domain.Point, int, error) {
	base := `
		SELECT
			points.id,
			points.name,
			points.layer_slug,
			points.region_name,
			points.floor_slug,
			points.event_slug,
			points.summary,
			points.detail_text,
			points.condition_text,
			points.rarity,
			points.x,
			points.y,
			points.loot_score,
			points.image_urls,
			layers.name,
			layers.icon,
			layers.color
		FROM points
		JOIN maps ON maps.id = points.map_id
		JOIN layer_groups ON layer_groups.map_id = maps.id
		JOIN layers ON layers.group_id = layer_groups.id AND layers.slug = points.layer_slug
		WHERE points.map_id = ? AND points.variant_slug = ?
	`
	args := []any{mapID, variant}

	if floor != "" && floor != "all" {
		base += ` AND (points.floor_slug = '' OR points.floor_slug = ?)`
		args = append(args, floor)
	}
	if eventSlug == "none" {
		base += ` AND points.event_slug = ''`
	} else {
		base += ` AND (points.event_slug = '' OR points.event_slug = ?)`
		args = append(args, eventSlug)
	}
	if len(layers) > 0 {
		placeholders := make([]string, 0, len(layers))
		for _, slug := range layers {
			placeholders = append(placeholders, "?")
			args = append(args, slug)
		}
		base += ` AND points.layer_slug IN (` + strings.Join(placeholders, ",") + `)`
	}
	if trimmed := strings.TrimSpace(strings.ToLower(search)); trimmed != "" {
		base += ` AND points.search_text LIKE ?`
		args = append(args, "%"+trimmed+"%")
	}

	base += ` ORDER BY points.loot_score DESC, points.name`

	rows, err := s.db.Query(base, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	points := make([]domain.Point, 0)
	for rows.Next() {
		var point domain.Point
		var rawImageURLs string
		if err := rows.Scan(
			&point.ID, &point.Name, &point.LayerSlug, &point.RegionName, &point.Floor, &point.EventSlug,
			&point.Summary, &point.Detail, &point.Condition, &point.Rarity,
			&point.X, &point.Y, &point.LootScore, &rawImageURLs,
			&point.LayerName, &point.LayerIcon, &point.LayerColor,
		); err != nil {
			return nil, 0, err
		}
		if err := json.Unmarshal([]byte(rawImageURLs), &point.ImageURLs); err != nil {
			return nil, 0, err
		}
		if point.ImageURLs == nil {
			point.ImageURLs = []string{}
		}
		points = append(points, point)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	totalCount, err := s.countTotalPoints(mapID, variant, floor, eventSlug)
	if err != nil {
		return nil, 0, err
	}
	return points, totalCount, nil
}

func (s *Store) countTotalPoints(mapID int64, variant, floor, eventSlug string) (int, error) {
	query := `SELECT COUNT(1) FROM points WHERE map_id = ? AND variant_slug = ?`
	args := []any{mapID, variant}

	if floor != "" && floor != "all" {
		query += ` AND (floor_slug = '' OR floor_slug = ?)`
		args = append(args, floor)
	}
	if eventSlug == "none" {
		query += ` AND event_slug = ''`
	} else {
		query += ` AND (event_slug = '' OR event_slug = ?)`
		args = append(args, eventSlug)
	}

	var count int
	if err := s.db.QueryRow(query, args...).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func floorExists(target string, floors []domain.Floor) bool {
	if target == "" {
		return false
	}
	for _, floor := range floors {
		if floor.Slug == target {
			return true
		}
	}
	return false
}

func eventExists(target string, events []domain.RandomEvent) bool {
	for _, event := range events {
		if event.Slug == target {
			return true
		}
	}
	return false
}

func normalizeFloor(requested, fallback string) string {
	if requested == "" {
		return fallback
	}
	return requested
}

func normalizeEvent(requested string) string {
	if requested == "" {
		return "none"
	}
	return requested
}

func normalizeLayerSelection(requested, all []string, mode string) []string {
	if mode == "none" {
		return []string{}
	}
	if len(requested) == 0 {
		return append([]string(nil), all...)
	}

	lookup := map[string]struct{}{}
	for _, slug := range all {
		lookup[slug] = struct{}{}
	}

	selected := make([]string, 0, len(requested))
	for _, slug := range requested {
		if _, ok := lookup[slug]; ok {
			selected = append(selected, slug)
		}
	}
	if len(selected) == 0 {
		return append([]string(nil), all...)
	}
	sort.Strings(selected)
	return selected
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

func (s *Store) ensurePointMediaColumns() error {
	hasImageURLs, err := s.hasColumn("points", "image_urls")
	if err != nil {
		return err
	}
	if hasImageURLs {
		return nil
	}

	_, err = s.db.Exec(`ALTER TABLE points ADD COLUMN image_urls TEXT NOT NULL DEFAULT '[]'`)
	return err
}

func (s *Store) ensureMapTileSourceColumn() error {
	hasTileSource, err := s.hasColumn("maps", "tile_source_json")
	if err != nil {
		return err
	}
	if hasTileSource {
		return nil
	}

	_, err = s.db.Exec(`ALTER TABLE maps ADD COLUMN tile_source_json TEXT NOT NULL DEFAULT ''`)
	return err
}

func (s *Store) hasColumn(tableName, columnName string) (bool, error) {
	rows, err := s.db.Query(`PRAGMA table_info(` + tableName + `)`)
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var dataType string
		var notNull int
		var defaultValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &pk); err != nil {
			return false, err
		}
		if name == columnName {
			return true, nil
		}
	}
	return false, rows.Err()
}
