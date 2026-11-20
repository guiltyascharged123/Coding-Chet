FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv git curl ca-certificates jq sqlite3 ripgrep \
    && rm -rf /var/lib/apt/lists/*
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /project
