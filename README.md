# Stashd

A document organizer that automatically classifies uploaded files (PDFs, images) into categories using a local or hosted Ollama model.

## Project Structure

This is an npm workspaces monorepo with three packages:

- `packages/client` — React + Vite frontend
- `packages/server` — Express backend with file storage and AI classification
- `packages/shared` — TypeScript types shared between client and server

## Prerequisites

- Node.js 18+
- An [Ollama](https://ollama.com) instance (local or hosted) with a multimodal model pulled

## Setup

Install dependencies from the repo root:

```bash
npm install
```

### Environment Variables

Create `packages/server/.env`:

```env
# Base URL of your Ollama instance
# Default: http://localhost:11434
OLLAMA_URL=http://localhost:11434

# Model to use for classification (must support JSON output; multimodal for image support)
# Default: gemma4
OLLAMA_MODEL=gemma4

# API key for Ollama, if your instance requires authentication (optional)
OLLAMA_API_KEY=

# Port for the server to listen on (optional)
# Default: 3001
PORT=3001

# AI provider to use (optional)
# Default: ollama
PROVIDER=ollama
```

| Variable         | Required | Default                  | Description                                        |
| ---------------- | -------- | ------------------------ | -------------------------------------------------- |
| `OLLAMA_URL`     | No       | `http://localhost:11434` | Ollama base URL                                    |
| `OLLAMA_MODEL`   | No       | `gemma4`                 | Model name to use for classification               |
| `OLLAMA_API_KEY` | No       | —                        | Bearer token if your Ollama instance requires auth |
| `PORT`           | No       | `3001`                   | Port the server listens on                         |
| `PROVIDER`       | No       | `ollama`                 | AI provider to use for classification              |

## Running

Start the server and client in separate terminals:

```bash
# Terminal 1 — backend (http://localhost:3001)
npm run dev:server

# Terminal 2 — frontend (http://localhost:5173)
npm run dev:client
```

## API

### Documents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/documents` | List documents (optional `?search=` and `?category=` filters) |
| `GET` | `/api/documents/:id` | Get a single document |
| `PATCH` | `/api/documents/:id` | Update a document's category, tags, or notes |
| `DELETE` | `/api/documents/:id` | Delete a document |
| `POST` | `/api/documents/upload` | Upload a file — returns `{ jobId }` |
| `GET` | `/api/documents/process/:jobId` | SSE stream for classification progress (`extracting` → `classifying` → `complete`/`error`) |
| `POST` | `/api/documents/file/:jobId` | Confirm and file a classified document |

### Categories

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/categories` | List all categories with per-category document counts |

### Upload flow

1. `POST /api/documents/upload` with a `multipart/form-data` `file` field → returns `{ jobId }`
2. Open an `EventSource` on `GET /api/documents/process/:jobId` to stream classification progress
3. On `complete`, call `POST /api/documents/file/:jobId` with the classification data to persist the document
