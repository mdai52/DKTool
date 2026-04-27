package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"dktool/backend/internal/assets"
	"dktool/backend/internal/data"
	"dktool/backend/internal/domain"
)

type Server struct {
	store                 *data.Store
	webRoot               string
	httpClient            *http.Client
	assetBootstrapEnabled bool
	rocomWarmOnce         sync.Once
	geoWarmOnce           sync.Map
}

const fullMapWarmTileBudget = 1800

var transparentTileBody = decodeTransparentTileBody()

type geoTileBounds struct {
	South float64 `json:"south"`
	West  float64 `json:"west"`
	North float64 `json:"north"`
	East  float64 `json:"east"`
}

type geoTileSource struct {
	Projection    string        `json:"projection"`
	URLTemplate   string        `json:"urlTemplate"`
	MinZoom       int           `json:"minZoom"`
	MaxNativeZoom int           `json:"maxNativeZoom"`
	InitZoom      int           `json:"initZoom"`
	InitLat       float64       `json:"initLat"`
	InitLng       float64       `json:"initLng"`
	Bounds        geoTileBounds `json:"bounds"`
}

type tileRange struct {
	MinX int
	MaxX int
	MinY int
	MaxY int
}

func New(store *data.Store, webRoot string) *Server {
	enabled := true
	switch strings.ToLower(strings.TrimSpace(os.Getenv("ASSET_BOOTSTRAP_ENABLED"))) {
	case "0", "false", "off":
		enabled = false
	}

	server := &Server{
		store:   store,
		webRoot: webRoot,
		httpClient: &http.Client{
			Timeout: 18 * time.Second,
		},
		assetBootstrapEnabled: enabled,
	}

	if server.assetBootstrapEnabled {
		go server.prewarmRocomStartupAssets()
	}

	return server
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/healthz", s.handleHealth)
	mux.HandleFunc("/api/asset-stats", s.handleAssetStats)
	mux.HandleFunc("/api/map-view", s.handleMapView)
	mux.HandleFunc("/api/assets/", s.handleAsset)
	mux.Handle("/", s.handleFrontend())
	return s.withCORS(loggingMiddleware(mux))
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleAssetStats(w http.ResponseWriter, _ *http.Request) {
	stats, err := s.store.AssetStats()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"count":            stats.Count,
		"totalBytes":       stats.TotalBytes,
		"bootstrapEnabled": s.assetBootstrapEnabled,
	})
}

func (s *Server) handleMapView(w http.ResponseWriter, r *http.Request) {
	query := domain.MapViewQuery{
		ModeSlug:   r.URL.Query().Get("mode"),
		MapSlug:    r.URL.Query().Get("map"),
		Variant:    r.URL.Query().Get("variant"),
		Floor:      r.URL.Query().Get("floor"),
		EventSlug:  r.URL.Query().Get("event"),
		LayerMode:  r.URL.Query().Get("layerMode"),
		Search:     r.URL.Query().Get("search"),
		LayerSlugs: splitCSV(r.URL.Query().Get("layers")),
	}

	response, err := s.store.MapView(query)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.maybeWarmAssets(response)
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleAsset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	rawKey := strings.TrimPrefix(r.URL.Path, "/api/assets/")
	assetKey := strings.TrimPrefix(path.Clean("/"+rawKey), "/")
	if assetKey == "" || assetKey == "." {
		http.NotFound(w, r)
		return
	}

	contentType, body, found, err := s.store.GetAsset(assetKey)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	if !found && s.assetBootstrapEnabled {
		contentType, body, found, err = s.bootstrapAsset(r.Context(), assetKey)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
	}

	if !found {
		http.NotFound(w, r)
		return
	}

	s.maybeWarmNeighborTiles(assetKey)
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}

	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(body); err != nil {
		log.Printf("write asset %s: %v", assetKey, err)
	}
}

func (s *Server) handleFrontend() http.HandlerFunc {
	fileServer := http.FileServer(http.Dir(s.webRoot))

	return func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}

		indexPath := filepath.Join(s.webRoot, "index.html")
		if info, err := os.Stat(indexPath); err != nil || info.IsDir() {
			writeJSON(w, http.StatusOK, map[string]string{
				"message": "frontend build not found, run `npm install` and `npm run build` inside frontend",
			})
			return
		}

		cleanPath := strings.TrimPrefix(filepath.Clean(r.URL.Path), "/")
		requestPath := filepath.Join(s.webRoot, cleanPath)
		if stat, err := os.Stat(requestPath); err == nil && !stat.IsDir() {
			fileServer.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, indexPath)
	}
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func splitCSV(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	raw := strings.Split(value, ",")
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		item = strings.TrimSpace(item)
		if item != "" {
			out = append(out, item)
		}
	}
	return out
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("encode response: %v", err)
	}
}

func (s *Server) bootstrapAsset(ctx context.Context, assetKey string) (contentType string, body []byte, found bool, err error) {
	remoteAsset, ok := assets.Resolve(assetKey)
	if !ok {
		return "", nil, false, nil
	}

	request, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, remoteAsset.SourceURL, nil)
	if reqErr != nil {
		return "", nil, false, reqErr
	}
	request.Header.Set("User-Agent", "DKTool/0.1")
	request.Header.Set("Accept", "image/*,*/*")

	response, requestErr := s.httpClient.Do(request)
	if requestErr != nil {
		return "", nil, false, requestErr
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		if response.StatusCode == http.StatusNotFound && strings.HasPrefix(assetKey, "tile/") {
			contentType = "image/gif"
			body = transparentTileBody
			if saveErr := s.store.SaveAsset(assetKey, remoteAsset.SourceURL, contentType, body); saveErr != nil {
				return "", nil, false, saveErr
			}
			return contentType, body, true, nil
		}
		return "", nil, false, nil
	}

	body, err = io.ReadAll(io.LimitReader(response.Body, 32<<20))
	if err != nil {
		return "", nil, false, err
	}

	contentType = strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0])
	if contentType == "" {
		contentType = remoteAsset.ContentType
	}
	if err := s.store.SaveAsset(assetKey, remoteAsset.SourceURL, contentType, body); err != nil {
		return "", nil, false, err
	}

	return contentType, body, true, nil
}

func (s *Server) maybeWarmAssets(response *domain.MapViewResponse) {
	if !s.assetBootstrapEnabled || response == nil {
		return
	}

	if response.CurrentMode.Slug == "rock-kingdom" && response.CurrentMap.Slug == "shijie" {
		s.rocomWarmOnce.Do(func() {
			go s.prewarmRocomInitialAssets(response)
		})
	}
}

func (s *Server) prewarmRocomInitialAssets(response *domain.MapViewResponse) {
	s.prewarmAssetKeys(collectRocomInitialAssetKeys(response), s.prewarmConcurrency())
}

func formatTileKey(y, x int) string {
	return strconv.Itoa(y) + "_" + strconv.Itoa(x) + ".png"
}

func (s *Server) prewarmRocomStartupAssets() {
	response, err := s.store.MapView(domain.MapViewQuery{
		ModeSlug: "rock-kingdom",
		MapSlug:  "shijie",
	})
	if err != nil {
		log.Printf("prewarm rocom startup map-view: %v", err)
		return
	}

	s.prewarmRocomInitialAssets(response)
}

func (s *Server) prewarmAssetKeys(assetKeys []string, workers int) {
	if len(assetKeys) == 0 {
		return
	}

	jobs := make(chan string)
	var group sync.WaitGroup

	for workerIndex := 0; workerIndex < workers; workerIndex++ {
		group.Add(1)
		go func() {
			defer group.Done()
			for assetKey := range jobs {
				if err := s.prewarmAssetKey(assetKey); err != nil {
					log.Printf("prewarm %s: %v", assetKey, err)
				}
			}
		}()
	}

	for _, assetKey := range assetKeys {
		jobs <- assetKey
	}
	close(jobs)
	group.Wait()
}

func (s *Server) prewarmAssetKey(assetKey string) error {
	if _, _, found, err := s.store.GetAsset(assetKey); err == nil && found {
		return nil
	} else if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 18*time.Second)
	defer cancel()

	_, _, _, err := s.bootstrapAsset(ctx, assetKey)
	return err
}

func (s *Server) prewarmConcurrency() int {
	if raw := strings.TrimSpace(os.Getenv("ASSET_PREWARM_CONCURRENCY")); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil && value > 0 {
			return value
		}
	}
	return 8
}

func (s *Server) maybeWarmNeighborTiles(assetKey string) {
	adjacentAssetKeys := collectAdjacentTileAssetKeys(assetKey)
	if len(adjacentAssetKeys) == 0 {
		return
	}

	onceValue, _ := s.geoWarmOnce.LoadOrStore("tile:"+assetKey, &sync.Once{})
	once := onceValue.(*sync.Once)
	once.Do(func() {
		go s.prewarmAssetKeys(adjacentAssetKeys, 2)
	})
}

func collectAdjacentTileAssetKeys(assetKey string) []string {
	parts := strings.Split(assetKey, "/")
	if len(parts) != 5 || parts[0] != "tile" {
		return nil
	}

	zoom, err := strconv.Atoi(parts[3])
	if err != nil {
		return nil
	}

	extension := path.Ext(parts[4])
	stem := strings.TrimSuffix(parts[4], extension)
	coords := strings.Split(stem, "_")
	if len(coords) != 2 {
		return nil
	}

	first, err := strconv.Atoi(coords[0])
	if err != nil {
		return nil
	}
	second, err := strconv.Atoi(coords[1])
	if err != nil {
		return nil
	}

	deltas := [][2]int{
		{1, 0},
		{-1, 0},
		{0, 1},
		{0, -1},
	}

	adjacentAssetKeys := make([]string, 0, len(deltas))
	for _, delta := range deltas {
		fileName := ""
		switch parts[1] {
		case "rocom":
			fileName = strconv.Itoa(first+delta[1]) + "_" + strconv.Itoa(second+delta[0]) + extension
		case "hkw", "delta-force":
			fileName = strconv.Itoa(first+delta[0]) + "_" + strconv.Itoa(second+delta[1]) + extension
		default:
			return nil
		}
		adjacentAssetKeys = append(adjacentAssetKeys, path.Join(parts[0], parts[1], parts[2], strconv.Itoa(zoom), fileName))
	}

	return adjacentAssetKeys
}

func collectGeoWarmPlan(response *domain.MapViewResponse) (signature string, initialAssetKeys, backgroundAssetKeys []string, ok bool) {
	source, ok := parseGeoTileSource(response.CurrentMap.TileSource)
	if !ok {
		return "", nil, nil, false
	}

	initialAssetKeys = collectInitialGeoAssetKeys(source)
	initialSet := make(map[string]struct{}, len(initialAssetKeys))
	for _, assetKey := range initialAssetKeys {
		initialSet[assetKey] = struct{}{}
	}

	for _, assetKey := range collectBackgroundGeoAssetKeys(source) {
		if _, exists := initialSet[assetKey]; exists {
			continue
		}
		backgroundAssetKeys = append(backgroundAssetKeys, assetKey)
	}

	signature = response.CurrentMode.Slug + ":" + response.CurrentMap.Slug + ":" + source.URLTemplate
	return signature, initialAssetKeys, backgroundAssetKeys, true
}

func parseGeoTileSource(raw json.RawMessage) (geoTileSource, bool) {
	if len(raw) == 0 {
		return geoTileSource{}, false
	}

	var source geoTileSource
	if err := json.Unmarshal(raw, &source); err != nil {
		return geoTileSource{}, false
	}
	if source.Projection != "geo" || !strings.HasPrefix(source.URLTemplate, "/api/assets/") {
		return geoTileSource{}, false
	}
	if source.MaxNativeZoom < source.MinZoom {
		source.MaxNativeZoom = source.MinZoom
	}
	if source.InitZoom < source.MinZoom {
		source.InitZoom = source.MinZoom
	}
	if source.InitZoom > source.MaxNativeZoom {
		source.InitZoom = source.MaxNativeZoom
	}
	if math.Abs(source.InitLat) < 1e-9 && math.Abs(source.InitLng) < 1e-9 {
		source.InitLat = (source.Bounds.North + source.Bounds.South) / 2
		source.InitLng = (source.Bounds.West + source.Bounds.East) / 2
	}

	return source, true
}

func collectInitialGeoAssetKeys(source geoTileSource) []string {
	zoom := clampInt(source.InitZoom, source.MinZoom, source.MaxNativeZoom)
	initialAssetKeys := map[string]struct{}{}

	boundsRange := tileRangeFromBounds(source.Bounds, zoom, 0)
	if rangeAtZoom, ok := intersectTileRanges(boundsRange, tileRangeAroundCenter(source, zoom, 2)); ok {
		addTileRangeAssetKeys(initialAssetKeys, source, zoom, rangeAtZoom)
	}

	if zoom > source.MinZoom {
		lowerZoom := zoom - 1
		if rangeAtZoom, ok := intersectTileRanges(tileRangeFromBounds(source.Bounds, lowerZoom, 0), tileRangeAroundCenter(source, lowerZoom, 1)); ok {
			addTileRangeAssetKeys(initialAssetKeys, source, lowerZoom, rangeAtZoom)
		}
	}

	return sortedAssetKeys(initialAssetKeys)
}

func collectBackgroundGeoAssetKeys(source geoTileSource) []string {
	fullAssetKeys, totalTiles := collectFullGeoAssetKeys(source)
	if totalTiles <= fullMapWarmTileBudget {
		return fullAssetKeys
	}

	focusAssetKeys := map[string]struct{}{}
	maxCoverageZoom := clampInt(source.InitZoom, source.MinZoom, source.MaxNativeZoom)
	for zoom := source.MinZoom; zoom <= maxCoverageZoom; zoom++ {
		addTileRangeAssetKeys(focusAssetKeys, source, zoom, tileRangeFromBounds(source.Bounds, zoom, 0))
	}

	if rangeAtZoom, ok := intersectTileRanges(
		tileRangeFromBounds(source.Bounds, maxCoverageZoom, 0),
		tileRangeAroundCenter(source, maxCoverageZoom, 3),
	); ok {
		addTileRangeAssetKeys(focusAssetKeys, source, maxCoverageZoom, rangeAtZoom)
	}

	return sortedAssetKeys(focusAssetKeys)
}

func collectFullGeoAssetKeys(source geoTileSource) ([]string, int) {
	assetKeys := map[string]struct{}{}
	totalTiles := 0

	for zoom := source.MinZoom; zoom <= source.MaxNativeZoom; zoom++ {
		totalTiles += addTileRangeAssetKeys(assetKeys, source, zoom, tileRangeFromBounds(source.Bounds, zoom, 0))
	}

	return sortedAssetKeys(assetKeys), totalTiles
}

func addTileRangeAssetKeys(assetKeys map[string]struct{}, source geoTileSource, zoom int, bounds tileRange) int {
	count := 0
	for x := bounds.MinX; x <= bounds.MaxX; x++ {
		for y := bounds.MinY; y <= bounds.MaxY; y++ {
			assetKey := strings.TrimPrefix(replaceTileTemplate(source.URLTemplate, zoom, x, y), "/api/assets/")
			if _, exists := assetKeys[assetKey]; exists {
				continue
			}
			assetKeys[assetKey] = struct{}{}
			count++
		}
	}
	return count
}

func tileRangeFromBounds(bounds geoTileBounds, zoom, padTiles int) tileRange {
	northWestX, northWestY := latLngToTile(bounds.North, bounds.West, zoom)
	southEastX, southEastY := latLngToTile(bounds.South, bounds.East, zoom)
	limit := (1 << zoom) - 1

	return tileRange{
		MinX: clampInt(minInt(northWestX, southEastX)-padTiles, 0, limit),
		MaxX: clampInt(maxInt(northWestX, southEastX)+padTiles, 0, limit),
		MinY: clampInt(minInt(northWestY, southEastY)-padTiles, 0, limit),
		MaxY: clampInt(maxInt(northWestY, southEastY)+padTiles, 0, limit),
	}
}

func tileRangeAroundCenter(source geoTileSource, zoom, padTiles int) tileRange {
	centerX, centerY := latLngToTile(source.InitLat, source.InitLng, zoom)
	limit := (1 << zoom) - 1

	return tileRange{
		MinX: clampInt(centerX-padTiles, 0, limit),
		MaxX: clampInt(centerX+padTiles, 0, limit),
		MinY: clampInt(centerY-padTiles, 0, limit),
		MaxY: clampInt(centerY+padTiles, 0, limit),
	}
}

func intersectTileRanges(left, right tileRange) (tileRange, bool) {
	result := tileRange{
		MinX: maxInt(left.MinX, right.MinX),
		MaxX: minInt(left.MaxX, right.MaxX),
		MinY: maxInt(left.MinY, right.MinY),
		MaxY: minInt(left.MaxY, right.MaxY),
	}
	if result.MinX > result.MaxX || result.MinY > result.MaxY {
		return tileRange{}, false
	}
	return result, true
}

func latLngToTile(lat, lng float64, zoom int) (int, int) {
	clampedLat := math.Max(-85.05112878, math.Min(85.05112878, lat))
	n := math.Exp2(float64(zoom))
	x := int(math.Floor(((lng + 180) / 360) * n))
	latRad := clampedLat * math.Pi / 180
	y := int(math.Floor((1 - math.Log(math.Tan(latRad)+1/math.Cos(latRad))/math.Pi) / 2 * n))
	limit := int(n) - 1
	return clampInt(x, 0, limit), clampInt(y, 0, limit)
}

func replaceTileTemplate(urlTemplate string, zoom, x, y int) string {
	value := strings.ReplaceAll(urlTemplate, "{z}", strconv.Itoa(zoom))
	value = strings.ReplaceAll(value, "{x}", strconv.Itoa(x))
	return strings.ReplaceAll(value, "{y}", strconv.Itoa(y))
}

func sortedAssetKeys(assetKeys map[string]struct{}) []string {
	list := make([]string, 0, len(assetKeys))
	for assetKey := range assetKeys {
		list = append(list, assetKey)
	}
	sort.Strings(list)
	return list
}

func clampInt(value, minValue, maxValue int) int {
	return minInt(maxInt(value, minValue), maxValue)
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func decodeTransparentTileBody() []byte {
	body, err := base64.StdEncoding.DecodeString("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==")
	if err != nil {
		panic(err)
	}
	return body
}

func collectRocomInitialAssetKeys(response *domain.MapViewResponse) []string {
	if response == nil {
		return nil
	}

	assetKeys := map[string]struct{}{}

	for _, group := range response.LayerGroups {
		for _, layer := range group.Layers {
			addLocalAssetKey(assetKeys, layer.Icon)
		}
	}

	detailWarmBudget := 36
	for _, point := range response.Points {
		for _, imageURL := range point.ImageURLs {
			if addLocalAssetKey(assetKeys, imageURL) {
				detailWarmBudget--
				if detailWarmBudget == 0 {
					break
				}
			}
		}
		if detailWarmBudget == 0 {
			break
		}
	}

	for y := 2035; y <= 2044; y++ {
		for x := 2036; x <= 2045; x++ {
			assetKeys[path.Join("tile", "rocom", "4010_v3_7f2d9c", "12", formatTileKey(y, x))] = struct{}{}
		}
	}

	for y := 1017; y <= 1022; y++ {
		for x := 1017; x <= 1022; x++ {
			assetKeys[path.Join("tile", "rocom", "4010_v3_7f2d9c", "11", formatTileKey(y, x))] = struct{}{}
		}
	}

	list := make([]string, 0, len(assetKeys))
	for assetKey := range assetKeys {
		list = append(list, assetKey)
	}
	sort.Strings(list)
	return list
}

func addLocalAssetKey(assetKeys map[string]struct{}, localURL string) bool {
	key := strings.TrimPrefix(strings.TrimSpace(localURL), "/api/assets/")
	if key == "" || strings.HasPrefix(key, "/") {
		return false
	}
	if _, exists := assetKeys[key]; exists {
		return false
	}
	assetKeys[key] = struct{}{}
	return true
}
