# Craig TASMAS sidecar

This folder contains the local transcription and summarization sidecar for Craig recordings. Craig's job is still only recording Discord audio; this sidecar watches the recording directory, extracts `RECORDING_ID.flac.zip`, runs TASMAS on the per-speaker FLAC stems, and optionally summarizes the transcript using a configurable AI provider chain.

The sidecar runs as a Docker Compose service. The `tasmas` folder is bind-mounted into the container, so changes to the Python code only need a container restart, not an image rebuild.

## Requirements

```sh
sudo apt install docker.io docker-compose-plugin
```

The sidecar image includes Python, Docker CLI, and `inotifywait`.

Configuration lives in Craig's root `.env`. The scripts load that file automatically and then apply any environment variables supplied for a single command.

## Start the sidecar

```sh
docker compose up -d tasmas
```

## Install Whisper model

TASMAS uses `whisper_timestamped` and defaults to Whisper `small`, which is a good fit for an RTX 2060 SUPER with 8 GB VRAM. The model is downloaded by the TASMAS container the first time transcription runs.

To pre-download it into the persistent cache:

```sh
mkdir -p "$TASMAS_MODEL_CACHE_DIR"
docker run --rm --gpus all \
  --entrypoint python \
  -v "$TASMAS_MODEL_CACHE_DIR:/root/.cache" \
  kaddaok/tasmas:latest \
  -c "import whisper_timestamped as whisper; whisper.load_model('small', device='cuda')"
```

If NVIDIA Docker support is not installed yet, the same command will fail at `--gpus all`; install the NVIDIA Container Toolkit first.

## Process one recording

```sh
docker compose run --rm tasmas python3 /app/tasmas/process_flac_zip.py "$CRAIG_RECORDINGS_DIR/xMOdSpsi9mLY.flac.zip"
```

## Summaries

For NVIDIA summaries, set `NVIDIA_API_KEY` in `.env`. The default model is:

```txt
mistralai/mistral-large-3-675b-instruct-2512
```

After transcription, the sidecar writes:

```txt
summary_nvidia_mistralai_mistral-large-3-675b-instruct-2512.md
```


## Configuration

Set these in `.env`:

- `CRAIG_RECORDINGS_DIR`: Craig recording folder. **Required** — set this in `.env`.
- `TASMAS_OUTPUT_DIR`: staged audio, transcripts, and summaries. Default: `$CRAIG_RECORDINGS_DIR/tasmas`.
- `TASMAS_IMAGE`: TASMAS Docker image. Default: `kaddaok/tasmas:latest`.
- `TASMAS_GPU_ARGS`: Docker GPU args. Default: `--gpus all`. Set to an empty value for CPU-only.
- `TASMAS_MODEL_CACHE_DIR`: persistent Whisper/Torch model cache. Default: `$CRAIG_RECORDINGS_DIR/tasmas-model-cache`.
- `TASMAS_EXTRA_ARGS`: extra TASMAS args before `semiauto`, such as `--showTimestamps`.
- `NVIDIA_API_KEY`: enables NVIDIA-hosted summary generation when set.
- `NVIDIA_API_URL`: NVIDIA chat completions endpoint.
- `NVIDIA_SUMMARY_MODEL`: summary model. Default: `mistralai/mistral-large-3-675b-instruct-2512`.
- `NVIDIA_SUMMARY_MAX_TOKENS`: summary output limit. Default: `2048`.
- `NVIDIA_SUMMARY_TEMPERATURE`: summary temperature. Default: `0.15`.
- `TASMAS_WATCH_INTERVAL`: polling interval in seconds. Default: `10`.
- `TASMAS_SETTLE_SECONDS`: seconds a file must remain unchanged before processing. Default: `5`.
- `TASMAS_RECORDINGS_LOCK_FILE`: central recording state file. Default: `recordings.lock.json`.

Output is written to `TASMAS_OUTPUT_DIR/RECORDING_ID/`. The `.done` marker makes processing idempotent.

The sidecar also writes `TASMAS_OUTPUT_DIR/recordings.lock.json`, which tracks each recording ID as `processing`, `completed`, or `failed`. Completed recording IDs are skipped before staging so a watcher restart does not process the same meeting twice. Failed recordings are left retryable.

## Development

The Compose service bind-mounts this folder as `/app/tasmas:ro`. After editing Python files, restart the sidecar:

```sh
docker compose restart tasmas
```

Only rebuild if you change [Dockerfile](Dockerfile):

```sh
docker compose build tasmas
```
