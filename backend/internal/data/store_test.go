package data

import (
	"path/filepath"
	"testing"

	"dktool/backend/internal/domain"
)

func TestMapViewDefaults(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "store.sqlite"))
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	defer store.Close()

	payload, err := store.MapView(domain.MapViewQuery{})
	if err != nil {
		t.Fatalf("map view: %v", err)
	}

	if payload.CurrentMode.Slug != "extraction" {
		t.Fatalf("expected extraction default mode, got %s", payload.CurrentMode.Slug)
	}

	if payload.CurrentMap.Slug != "zero-dam" {
		t.Fatalf("expected zero-dam default map, got %s", payload.CurrentMap.Slug)
	}

	if len(payload.LayerGroups) == 0 {
		t.Fatal("expected layer groups in default payload")
	}
}

func TestMapViewLayerFiltering(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "store.sqlite"))
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	defer store.Close()

	payload, err := store.MapView(domain.MapViewQuery{
		ModeSlug:   "extraction",
		MapSlug:    "zero-dam",
		Variant:    "regular",
		LayerSlugs: []string{"boss"},
	})
	if err != nil {
		t.Fatalf("map view: %v", err)
	}

	if len(payload.Points) == 0 {
		t.Fatal("expected filtered points")
	}

	for _, point := range payload.Points {
		if point.LayerSlug != "boss" {
			t.Fatalf("expected boss layer only, got %s", point.LayerSlug)
		}
	}
}

func TestAssetStats(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "store.sqlite"))
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	defer store.Close()

	if err := store.SaveAsset("tile/test/1.png", "https://example.com/1.png", "image/png", []byte("abc")); err != nil {
		t.Fatalf("save asset: %v", err)
	}
	if err := store.SaveAsset("tile/test/2.png", "https://example.com/2.png", "image/png", []byte("abcdef")); err != nil {
		t.Fatalf("save asset: %v", err)
	}

	stats, err := store.AssetStats()
	if err != nil {
		t.Fatalf("asset stats: %v", err)
	}

	if stats.Count != 2 {
		t.Fatalf("expected 2 assets, got %d", stats.Count)
	}

	if stats.TotalBytes != 9 {
		t.Fatalf("expected 9 bytes, got %d", stats.TotalBytes)
	}
}
