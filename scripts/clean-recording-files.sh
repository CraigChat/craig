#!/bin/sh
# Removes processed recording files and tasmas work directories.
# Cleans: *.ogg.*, *.flac.zip, tasmas subdirs, and resets recordings.lock.json.

RECORDINGS_DIR="${1:-${CRAIG_RECORDINGS_DIR:-}}"
if [ -z "$RECORDINGS_DIR" ]; then
  echo "Error: pass the recordings directory as \$1 or set CRAIG_RECORDINGS_DIR" >&2
  exit 1
fi
TASMAS_DIR="$RECORDINGS_DIR/tasmas"
LOCK_FILE="$TASMAS_DIR/recordings.lock.json"

if [ ! -d "$RECORDINGS_DIR" ]; then
  echo "Directory not found: $RECORDINGS_DIR" >&2
  exit 1
fi

# Delete *.ogg.* files
ogg_count=$(find "$RECORDINGS_DIR" -maxdepth 1 -name '*.ogg.*' | wc -l)
echo "Deleting $ogg_count .ogg.* files..."
find "$RECORDINGS_DIR" -maxdepth 1 -name '*.ogg.*' -delete

# Delete *.flac.zip files
zip_count=$(find "$RECORDINGS_DIR" -maxdepth 1 -name '*.flac.zip' | wc -l)
echo "Deleting $zip_count .flac.zip files..."
find "$RECORDINGS_DIR" -maxdepth 1 -name '*.flac.zip' -delete

# Delete tasmas subdirectories (keep recordings.lock.json)
if [ -d "$TASMAS_DIR" ]; then
  dir_count=$(find "$TASMAS_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l)
  echo "Deleting $dir_count tasmas subdirectories..."
  find "$TASMAS_DIR" -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} +
fi

# Reset recordings.lock.json
if [ -f "$LOCK_FILE" ]; then
  echo "Resetting $LOCK_FILE..."
  printf '{"recordings": {}, "version": 1}\n' > "$LOCK_FILE"
fi

echo "Done."
