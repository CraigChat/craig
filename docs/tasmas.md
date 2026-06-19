# TASMAS Transcription Sidecar

The `tasmas/` folder is a Python sidecar that watches Craig's recordings directory, transcribes each recording with OpenAI Whisper, and optionally summarizes it with an AI provider. Craig works without it — the sidecar is entirely optional.

## How it works

1. Watches `CRAIG_RECORDINGS_DIR` for new `.flac.zip` files
2. Extracts the archive and builds a speaker map from Craig's `info.txt`
3. Runs the [TASMAS](https://github.com/CraigChat/tasmas) Docker image (`whisper_timestamped`) to produce a transcript
4. Passes the transcript to the AI provider chain — see [ai-summarization.md](ai-summarization.md)
5. Optionally posts the summary to Discord via webhook
6. Marks the recording as complete so watcher restarts skip it

The sidecar is bind-mounted into its container, so Python edits only need a `docker compose restart tasmas` — no rebuild.

## Start

```sh
docker compose up -d tasmas
```

## Process one recording manually

```sh
docker compose run --rm tasmas python3 /app/tasmas/process_flac_zip.py /path/to/RECORDING_ID.flac.zip
```

## Whisper model

TASMAS defaults to the `small` Whisper model. It downloads automatically on first run. To pre-cache it, run the image with `--entrypoint python` and call `whisper.load_model('small')` — see [self-hosting.md](self-hosting.md#tasmas--transcription--ai-summaries) for the full command.

Set `TASMAS_GPU_ARGS=--gpus all` in `.env` to use a GPU; leave it empty for CPU-only.

## Configuration

All settings live in `.env`. Key variables: `CRAIG_RECORDINGS_DIR`, `TASMAS_OUTPUT_DIR`, `CRAIG_TASMAS_IMAGE`, `TASMAS_GPU_ARGS`, `TASMAS_MODEL_CACHE_DIR`. See `.env.example` for the full list.

## Output

Written to `TASMAS_OUTPUT_DIR/RECORDING_ID/`: `transcript.txt`, summary Markdown files, and a `.done` marker. A `recordings.lock.json` tracks state (`processing` / `completed` / `failed`) across the whole recordings directory.
