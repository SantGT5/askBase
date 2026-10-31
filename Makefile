.PHONY: install start stop test url test-unit e2e e2e-ui e2e-headed e2e-report

PY := backend/.venv/bin/python

ifneq (,$(wildcard .env))
	include .env
	export
endif

BACKEND := http://127.0.0.1:$(or $(BACKEND_PORT),5001)

# First-time setup: .env from the template (if missing), plus a local venv so the editor can resolve imports
install:
	test -f .env || cp .env.example .env
	uv venv --allow-existing backend/.venv
	uv pip install --python $(PY) -r backend/requirements.txt

# Runs everything in the foreground (Ctrl+C stops it, data is kept)
start:
	docker compose up --build

# Stops all containers, data is kept (only `docker compose down -v` deletes it)
stop:
	docker compose down

test:
	docker compose run --rm --no-deps --build backend python test_rag.py

# Frontend unit tests (Vitest), no running app needed. Watch mode: cd frontend && npm run test:watch
test-unit:
	cd frontend && npm test

# Browser tests (Playwright) against the running app, so `make start` first. Filter: make e2e ARGS="-g login"
e2e:
	cd frontend && npx playwright install chromium && npx playwright test $(ARGS)

# Same tests in Playwright's interactive UI (watch, step through, time-travel)
e2e-ui:
	cd frontend && npx playwright test --ui

# Watch a real browser click through the tests, one at a time and slowed down. Faster: make e2e-headed SLOWMO=200
e2e-headed:
	cd frontend && SLOWMO=$(or $(SLOWMO),500) npx playwright test --headed --workers=1 $(ARGS)

# Opens the HTML report of the last run
e2e-report:
	cd frontend && npx playwright show-report

url:
	@echo "Frontend      http://127.0.0.1:$(or $(FRONTEND_PORT),5173)"
	@echo "Swagger UI    $(BACKEND)/docs"
	@echo "OpenAPI spec  $(BACKEND)/openapi.json"
	@echo "Backend API   $(BACKEND)"
	@echo "LangSmith     $(if $(findstring eu.,$(LANGSMITH_ENDPOINT)),https://eu.smith.langchain.com,https://smith.langchain.com)  (project: $(or $(LANGSMITH_PROJECT),askbase), tracing: $(or $(LANGSMITH_TRACING),false))"
	@echo "Postgres      postgresql://$(POSTGRES_USER):<password>@localhost:$(or $(POSTGRES_PORT),5432)/$(POSTGRES_DB)"

format:
	@echo "\nFormatting frontend code..."
	@cd frontend && npm run format && npm run lint:fix
.PHONY: format
