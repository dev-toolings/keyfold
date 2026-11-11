.DEFAULT_GOAL := help
SHELL := /bin/sh

LISTEN ?= 127.0.0.1:8717
DATA   ?= ./data

PROD_DIR := deploy/prod

C_SECTION := \033[1;33m
C_TARGET  := \033[36m
C_OK      := \033[32m
C_WARN    := \033[33m
C_ERR     := \033[31m
C_RESET   := \033[0m

.PHONY: help install dev server web-dev site-dev build web-build site-build fmt vet test typecheck lint ts-test check deploy-dry-run deploy-prod clean

# ─── Install / Setup ──────────────────────────────────────────────────────────

install: ## Download Go modules and web packages
	@go mod download
	@bun install
	@printf "$(C_OK)[make] dependencies installed$(C_RESET)\n"

# ─── Run ──────────────────────────────────────────────────────────────────────

dev: ## Start the vault server and the web UI dev server together (Ctrl-C stops both)
	@go build -o bin/keyfold-server ./apps/keyfold-server
	@printf "$(C_OK)[make] vault server on http://$(LISTEN), web UI on the URL printed below$(C_RESET)\n"
	@KEYFOLD_ENV=development ./bin/keyfold-server -listen $(LISTEN) -data $(DATA) & pid=$$!; \
		trap 'kill $$pid 2>/dev/null' EXIT INT TERM; \
		cd apps/web && bun run dev

server: ## Start the vault server (LISTEN, DATA), serving apps/web/dist if built
	@go run ./apps/keyfold-server -listen $(LISTEN) -data $(DATA) -web apps/web/dist

web-dev: ## Start the web UI dev server (proxies /api to the vault server)
	@cd apps/web && bun run dev

site-dev: ## Start the public product site dev server (apps/site, Next.js)
	@cd apps/site && bun run dev

# ─── Build ────────────────────────────────────────────────────────────────────

build: ## Build the kf and keyfold-server binaries into bin/
	@go build -o bin/kf ./apps/kf
	@go build -o bin/keyfold-server ./apps/keyfold-server
	@printf "$(C_OK)[make] built bin/kf and bin/keyfold-server$(C_RESET)\n"

web-build: ## Build the web UI into apps/web/dist
	@cd apps/web && bun run build
	@printf "$(C_OK)[make] web UI built in apps/web/dist$(C_RESET)\n"

site-build: ## Build the public product site (apps/site, static export) into apps/site/out
	@cd apps/site && bun run build
	@printf "$(C_OK)[make] product site built in apps/site/out$(C_RESET)\n"

# ─── Check ────────────────────────────────────────────────────────────────────

fmt: ## Fail if a Go file is not gofmt formatted
	@out=$$(gofmt -l .); if [ -n "$$out" ]; then \
		printf "$(C_ERR)[make] not formatted:$(C_RESET)\n%s\n" "$$out"; exit 1; \
	fi
	@printf "$(C_OK)[make] gofmt ok$(C_RESET)\n"

vet: ## Run go vet
	@go vet ./...
	@printf "$(C_OK)[make] go vet ok$(C_RESET)\n"

test: ## Run the Go tests
	@go test -count=1 ./...
	@printf "$(C_OK)[make] go tests ok$(C_RESET)\n"

typecheck: ## Typecheck the web UI, the product site and the shared TypeScript package
	@cd apps/web && bunx tsc --noEmit
	@cd apps/site && bun run typecheck
	@cd packages/vault-core && bunx tsc --noEmit
	@printf "$(C_OK)[make] typecheck ok$(C_RESET)\n"

lint: ## Lint the TypeScript code with Biome
	@bunx biome check apps packages
	@printf "$(C_OK)[make] lint ok$(C_RESET)\n"

ts-test: ## Run the TypeScript tests: vault statistics, and Go/TypeScript vault interop
	@cd packages/vault-core && bun test
	@printf "$(C_OK)[make] TypeScript tests ok$(C_RESET)\n"

check: fmt vet test typecheck lint ts-test ## Run every check
	@printf "$(C_OK)[make] all checks passed$(C_RESET)\n"

# ─── Deploy ───────────────────────────────────────────────────────────────────

deploy-dry-run: ## Preview the production deployment of the public site (changes nothing)
	@cd $(PROD_DIR) && shuttle deploy --config config.json --dry-run

deploy-prod: ## Deploy the public site (keyfold.pulseview.app) to production with Shuttle
	@git diff --quiet && git diff --cached --quiet || { \
		printf "$(C_ERR)[make] uncommitted changes: commit before deploying$(C_RESET)\n"; exit 1; }
	@[ -z "$$(git log @{u}.. --oneline 2>/dev/null)" ] || { \
		printf "$(C_ERR)[make] local commits not pushed: push before deploying$(C_RESET)\n"; exit 1; }
	@cd $(PROD_DIR) && shuttle deploy --config config.json
	@printf "$(C_OK)[make] public site deployed to https://keyfold.pulseview.app$(C_RESET)\n"

# ─── Clean ────────────────────────────────────────────────────────────────────

clean: ## Remove built binaries, apps/web/dist and the apps/site build (never the vault data)
	@if [ -e bin ] || [ -e apps/web/dist ] || [ -e apps/site/.next ] || [ -e apps/site/out ]; then \
		rm -rf bin apps/web/dist apps/site/.next apps/site/out; \
		printf "$(C_OK)[make] build outputs removed$(C_RESET)\n"; \
	else \
		printf "$(C_WARN)[make] nothing to clean$(C_RESET)\n"; \
	fi

# ─── Help ─────────────────────────────────────────────────────────────────────

help: ## Show this help
	@awk -v s="$(C_SECTION)" -v t="$(C_TARGET)" -v r="$(C_RESET)" ' \
		/^# ─── / { name = $$0; sub(/^# ─── /, "", name); sub(/ ─.*$$/, "", name); \
			printf "\n%s%s%s\n", s, name, r; next } \
		/^[a-zA-Z0-9_-]+:.*## / { target = $$1; sub(/:.*/, "", target); \
			desc = $$0; sub(/^.*## /, "", desc); \
			printf "  %s%-14s%s %s\n", t, target, r, desc } \
	' $(MAKEFILE_LIST)
