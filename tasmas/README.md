# Craig TASMAS sidecar

This folder contains the local transcription and summarization sidecar for Craig recordings. Craig's job is still only recording Discord audio; this sidecar watches the recording directory, extracts `RECORDING_ID.flac.zip`, runs TASMAS on the per-speaker FLAC stems, and optionally sends the transcript to a local Ollama model.

The sidecar runs as a Docker Compose service. The `tasmas` folder is bind-mounted into the container, so changes to the Python code only need a container restart, not an image rebuild.

## Requirements

```sh
sudo apt install docker.io docker-compose-plugin
```

The sidecar image includes Python, Docker CLI, and `inotifywait`.

Configuration lives in Craig's root `install.config`. The scripts load that file automatically and then apply any environment variables supplied for a single command.

## Start the sidecar

```sh
docker compose up -d tasmas
```

## Install Whisper model

TASMAS uses `whisper_timestamped` and defaults to Whisper `small`, which is a good fit for an RTX 2060 SUPER with 8 GB VRAM. The model is downloaded by the TASMAS container the first time transcription runs.

To pre-download it into the persistent cache:

```sh
mkdir -p /mnt/media8tb/craig-recordings/tasmas-model-cache
docker run --rm --gpus all \
  --entrypoint python \
  -v /mnt/media8tb/craig-recordings/tasmas-model-cache:/root/.cache \
  kaddaok/tasmas:latest \
  -c "import whisper_timestamped as whisper; whisper.load_model('small', device='cuda')"
```

If NVIDIA Docker support is not installed yet, the same command will fail at `--gpus all`; install the NVIDIA Container Toolkit first.

## Process one recording

```sh
docker compose run --rm tasmas python3 /app/tasmas/process_flac_zip.py /mnt/media8tb/craig-recordings/xMOdSpsi9mLY.flac.zip
```

## Local summaries with Ollama

Set `OLLAMA_MODEL` in `install.config`, then restart the sidecar:

```sh
docker compose restart tasmas
```

## Configuration

Set these in `install.config`:

- `CRAIG_RECORDINGS_DIR`: Craig recording folder. Default: `/mnt/media8tb/craig-recordings`.
- `TASMAS_OUTPUT_DIR`: staged audio, transcripts, and summaries. Default: `$CRAIG_RECORDINGS_DIR/tasmas`.
- `TASMAS_IMAGE`: TASMAS Docker image. Default: `kaddaok/tasmas:latest`.
- `TASMAS_GPU_ARGS`: Docker GPU args. Default: `--gpus all`. Set to an empty value for CPU-only.
- `TASMAS_MODEL_CACHE_DIR`: persistent Whisper/Torch model cache. Default in this setup: `/mnt/media8tb/craig-recordings/tasmas-model-cache`.
- `TASMAS_EXTRA_ARGS`: extra TASMAS args before `semiauto`, such as `--showTimestamps`.
- `OLLAMA_MODEL`: enables local summarization when set.
- `OLLAMA_URL`: Ollama generate endpoint. Default for Docker: `http://host.docker.internal:11434/api/generate`.
- `TASMAS_WATCH_INTERVAL`: polling interval in seconds. Default: `10`.
- `TASMAS_SETTLE_SECONDS`: seconds a file must remain unchanged before processing. Default: `5`.

Output is written to `TASMAS_OUTPUT_DIR/RECORDING_ID/`. The `.done` marker makes processing idempotent.

## Development

The Compose service bind-mounts this folder as `/app/tasmas:ro`. After editing Python files, restart the sidecar:

```sh
docker compose restart tasmas
```

Only rebuild if you change [Dockerfile](Dockerfile):

```sh
docker compose build tasmas
```
