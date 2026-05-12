# Architecture

Craig AI is a monorepo of four Node.js services plus a Python transcription sidecar, all orchestrated via Docker Compose.

## Services

| Service | Purpose |
|---------|---------|
| `bot` | Discord bot — joins voice channels, records multi-track audio as per-speaker FLAC stems |
| `dashboard` | Web UI for account management and cloud storage exports (Google Drive, OneDrive, Dropbox) |
| `download` | Recording download server, clustered for throughput |
| `tasks` | Background jobs — cloud uploads, recording expiry, format conversion |
| `tasmas` | Python sidecar — transcription and AI summarization after each recording |

## Data flow

```
Discord voice → bot records → .flac.zip written to disk
                                       ↓
                              tasmas detects file
                                       ↓
                          Whisper transcription (local)
                                       ↓
                       AI summarization (provider chain)
                                       ↓
                        Discord webhook (optional)
```

## Infrastructure

- **PostgreSQL** — persistent data (users, recordings metadata)
- **Redis** — session cache and bot state
- All services run inside Docker; the `craig` container manages the four Node services under PM2

## Ports

| Port | Service |
|------|---------|
| 3000 | Dashboard |
| 5029 | Download server |
