.PHONY: up down logs load seed test repro psql clean

# Bring the whole slice up (Postgres + Redis + app + mock payment provider).
up:
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f app

# Arch-aware offline image loader. Picks the tarball that matches your CPU,
# falls back to building from source if no tarball is present.
load:
	@ARCH=$$(uname -m); \
	if [ "$$ARCH" = "arm64" ] || [ "$$ARCH" = "aarch64" ]; then \
		TARBALL=images-arm64.tar.gz; \
	else \
		TARBALL=images-amd64.tar.gz; \
	fi; \
	if [ -f "$$TARBALL" ]; then \
		echo "Loading offline images from $$TARBALL"; \
		docker load -i "$$TARBALL"; \
	else \
		echo "No offline tarball ($$TARBALL) found; images will be built/pulled by 'make up'."; \
	fi

seed:
	docker compose exec app npx ts-node db/seed.ts

test:
	npm test

# Seeds, delivers one settlement webhook, queries payments, and times a guarded route.
repro:
	./reproduce_bugs.sh

psql:
	docker compose exec postgres psql -U northwind -d northwind

clean:
	docker compose down -v
