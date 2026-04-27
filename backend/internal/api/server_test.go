package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"dktool/backend/internal/data"
	"dktool/backend/internal/domain"
)

func TestMapViewEndpoint(t *testing.T) {
	store := newTestStore(t)
	t.Cleanup(func() {
		_ = store.Close()
	})

	server := New(store, t.TempDir())

	request := httptest.NewRequest(http.MethodGet, "/api/map-view?mode=extraction&map=zero-dam&variant=classified&event=crash-site", nil)
	recorder := httptest.NewRecorder()

	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}

	var payload domain.MapViewResponse
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if payload.CurrentMap.Slug != "zero-dam" {
		t.Fatalf("expected zero-dam map, got %s", payload.CurrentMap.Slug)
	}

	if payload.CurrentEvent != "crash-site" {
		t.Fatalf("expected crash-site event, got %s", payload.CurrentEvent)
	}

	if len(payload.Points) == 0 {
		t.Fatal("expected points in payload")
	}
}

func TestHealthEndpoint(t *testing.T) {
	store := newTestStore(t)
	t.Cleanup(func() {
		_ = store.Close()
	})

	server := New(store, t.TempDir())
	request := httptest.NewRequest(http.MethodGet, "/api/healthz", nil)
	recorder := httptest.NewRecorder()

	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
}

func TestAssetStatsEndpoint(t *testing.T) {
	store := newTestStore(t)
	t.Cleanup(func() {
		_ = store.Close()
	})

	if err := store.SaveAsset("tile/test/1.png", "https://example.com/1.png", "image/png", []byte("abc")); err != nil {
		t.Fatalf("save asset: %v", err)
	}

	server := New(store, t.TempDir())
	request := httptest.NewRequest(http.MethodGet, "/api/asset-stats", nil)
	recorder := httptest.NewRecorder()

	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}

	var payload struct {
		Count            int  `json:"count"`
		TotalBytes       int  `json:"totalBytes"`
		BootstrapEnabled bool `json:"bootstrapEnabled"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if payload.Count != 1 {
		t.Fatalf("expected 1 asset, got %d", payload.Count)
	}

	if payload.TotalBytes != 3 {
		t.Fatalf("expected 3 total bytes, got %d", payload.TotalBytes)
	}
}

func newTestStore(t *testing.T) *data.Store {
	t.Helper()

	store, err := data.NewStore(filepath.Join(t.TempDir(), "test.sqlite"))
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	return store
}
