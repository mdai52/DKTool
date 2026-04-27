FRONTEND_DIR=frontend
BACKEND_DIR=backend

.PHONY: install frontend backend build warm-assets warm-rocom-assets warm-coverage docker-up

install:
	cd $(FRONTEND_DIR) && npm install
	cd $(BACKEND_DIR) && go get modernc.org/sqlite@v1.29.10

frontend:
	cd $(FRONTEND_DIR) && npm run dev

backend:
	cd $(BACKEND_DIR) && go run ./cmd/server

build:
	cd $(FRONTEND_DIR) && npm run build

warm-assets:
	node scripts/warm_backend_assets.mjs

warm-rocom-assets:
	node scripts/warm_rocom_initial_assets.mjs

warm-coverage:
	DKTOOL_WARM_TILE_COVERAGE=1 DKTOOL_WARM_SKIP_DIRECT_ASSETS=1 DKTOOL_WARM_TILE_SETTLE_MS=120 DKTOOL_WARM_VIRTUAL_TIME_BUDGET=14000 node scripts/warm_backend_assets.mjs rocom,warfare,extraction

docker-up:
	docker compose up --build
