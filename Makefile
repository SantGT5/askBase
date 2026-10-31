.PHONY: install start stop test url

PY := backend/.venv/bin/python

ifneq (,$(wildcard .env))
	include .env
	export
	ENV_FILE_PARAM := --env-file .env
endif

BACKEND := http://127.0.0.1:$(or $(BACKEND_PORT),5001)

# First-time setup: .env from the template (if missing), plus a local venv so the editor can resolve imports
install:
	test -f .env || cp .env.example .env
	uv venv --allow-existing backend/.venv
	uv pip install --python $(PY) -r backend/requirements.txt

# DB in the background, backend logs in this terminal (Ctrl+C stops the backend, data is kept)
start:
	docker compose up --build

# Stops all containers, data is kept (only `docker compose down -v` deletes it)
stop:
	docker compose down

test:
	docker compose run --rm --no-deps --build backend python test_rag.py

url:
	@echo "Frontend      http://127.0.0.1:$(or $(FRONTEND_PORT),5173)"
	@echo "Swagger UI    $(BACKEND)/docs"
	@echo "OpenAPI spec  $(BACKEND)/openapi.json"
	@echo "Backend API   $(BACKEND)"
	@echo "Postgres      postgresql://$(POSTGRES_USER):<password>@localhost:$(or $(POSTGRES_PORT),5432)/$(POSTGRES_DB)"
