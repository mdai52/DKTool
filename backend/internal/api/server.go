package api

import (
	"context"
	"encoding/json"
	"io"
	"log"
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
	if !s.assetBootstrapEnabled {
		return
	}
	if response.CurrentMode.Slug != "rock-kingdom" || response.CurrentMap.Slug != "shijie" {
		return
	}

	s.rocomWarmOnce.Do(func() {
		go s.prewarmRocomInitialAssets(response)
	})
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
