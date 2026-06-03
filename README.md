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
```

| Variable         | Required | Default                  | Description                                        |
| ---------------- | -------- | ------------------------ | -------------------------------------------------- |
| `OLLAMA_URL`     | No       | `http://localhost:11434` | Ollama base URL                                    |
| `OLLAMA_MODEL`   | No       | `gemma4`                 | Model name to use for classification               |
| `OLLAMA_API_KEY` | No       | —                        | Bearer token if your Ollama instance requires auth |
| `PORT`           | No       | `3001`                   | Port the server listens on                         |

## Running

Start the server and client in separate terminals:

```bash
# Terminal 1 — backend (http://localhost:3001)
npm run dev:server

# Terminal 2 — frontend (http://localhost:5173)
npm run dev:client
```

## API

The server exposes two REST endpoints:

- `GET/POST /api/documents` — list and upload documents
- `GET /api/categories` — list categories with document counts

Uploads are processed via SSE (`POST /api/documents/upload`) which streams classification progress back to the client.
