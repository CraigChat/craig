# AI Summarization

After transcription, `tasmas/summarizer.py` generates a structured meeting summary using a configurable provider chain. Every provider is an OpenAI-compatible chat completions endpoint.

## Provider chain

```
1. Primary    configured via NVIDIA_API_KEY / NVIDIA_API_URL / AI_SUMMARY_MODEL
              (defaults to NVIDIA NIM, but any OpenAI-compatible URL works)

2. Fallbacks  SUMMARY_FALLBACK_CHAIN — semicolon-separated url|API_KEY_ENV|model entries,
              tried in order after the primary fails
```

Providers are skipped if their API key env var is empty. If a provider fails at runtime, the chain waits `SUMMARY_RETRY_DELAY_SECONDS` before trying the next one. If all fail, an error is raised — summaries are optional and the recording is still marked complete.

## Configuration

All settings live in `install.config`. Key variables:

- `NVIDIA_API_KEY` — API key for the primary provider
- `NVIDIA_API_URL` — primary endpoint URL (defaults to NVIDIA NIM)
- `AI_SUMMARY_MODEL` — model to use on the primary provider
- `SUMMARY_FALLBACK_CHAIN` — additional fallback providers
- `SUMMARY_RETRY_DELAY_SECONDS` — wait between provider attempts (default: 120s)
- `DISCORD_SUMMARY_WEBHOOK_URL` — posts the summary to a Discord channel after each recording

See `install.config.example` for generation parameters (temperature, max tokens, etc.).

## Output

The summarizer writes a Markdown file per successful provider under `TASMAS_OUTPUT_DIR/RECORDING_ID/`. The summary is structured in four sections: résumé, decisions, actions, and open questions. Speaker names from Craig's recording metadata are preserved as-is.

## Re-triggering a summary

To regenerate the summary for an already-transcribed recording:

```sh
./tasmas/test/test-summary.sh RECORDING_ID
```
