package main

import (
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"dktool/backend/internal/api"
	"dktool/backend/internal/data"
)

func main() {
	cwd, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}

	dbPath, err := resolveDBPath(cwd)
	if err != nil {
		log.Fatal(err)
	}
	webRoot := filepath.Join(cwd, "web", "dist")

	store, err := data.NewStore(dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()

	server := api.New(store, webRoot)
	addr := ":8080"
	log.Printf("dktool backend listening on %s", addr)
	if err := http.ListenAndServe(addr, server.Handler()); err != nil {
		log.Fatal(err)
	}
}

func resolveDBPath(cwd string) (string, error) {
	if custom := os.Getenv("DKTOOL_DB_PATH"); custom != "" {
		return custom, nil
	}

	primary := filepath.Join(cwd, "data", "dktool.db")
	if _, err := os.Stat(primary); err == nil {
		return primary, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}

	seed := filepath.Join(cwd, "data", "dktool.seed.db")
	if _, err := os.Stat(seed); err == nil {
		return seed, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}

	return primary, nil
}
