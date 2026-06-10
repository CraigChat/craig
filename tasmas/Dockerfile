FROM docker:27-cli

RUN apk add --no-cache inotify-tools python3 tzdata curl

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY tasmas /app/tasmas

CMD ["python3", "/app/tasmas/watch_flac_zips.py"]
