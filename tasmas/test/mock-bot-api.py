#!/usr/bin/env python3
"""
Mock of the craig bot's internal /deliver-summary endpoint.

Run this in one terminal, then point TASMAS at it:

    python mock-bot-api.py                   # port 3001, no auth, returns 200
    python mock-bot-api.py --mode 204        # simulate: no channel configured
    python mock-bot-api.py --mode 500        # simulate: internal error
    python mock-bot-api.py --secret s3cr3t   # require Authorization header
    python mock-bot-api.py --port 3002 --mode 204 --secret s3cr3t

Response contract (mirrors InternalApiModule):
    200  Summary "delivered" (just logged here instead of posted to Discord)
    204  No summary channel configured for this guild → TASMAS falls back to webhook
    500  Internal error → TASMAS falls back to webhook

Auth: if --secret is given, every request must include
      Authorization: Bearer <secret>  or the server returns 401.
"""
from __future__ import annotations

import argparse
import http.server
import json
import sys

_MODE_LABEL = {
    200: "delivered — TASMAS returns True",
    204: "no channel found (guild has no system channel) — summary not delivered",
    500: "server error — summary not delivered",
}


def make_handler(secret: str, mode: int):
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):  # quieten the default access log
            pass

        def do_POST(self):
            if self.path != "/deliver-summary":
                self._reply(404)
                return

            if secret:
                auth = self.headers.get("Authorization", "")
                if auth != f"Bearer {secret}":
                    print(f"  → 401  bad auth (got {auth!r})", flush=True)
                    self._reply(401)
                    return

            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
                rid = data.get("recordingId", "<missing>")
            except (json.JSONDecodeError, ValueError):
                self._reply(400)
                return

            print(f"  POST /deliver-summary  recordingId={rid!r}", flush=True)
            print(f"  → {mode}  {_MODE_LABEL.get(mode, '')}", flush=True)
            self._reply(mode)

        def _reply(self, status: int):
            self.send_response(status)
            self.end_headers()

    return Handler


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--port", type=int, default=3001, help="Port to listen on (default: 3001)")
    parser.add_argument("--secret", default="", help="Required Bearer token; empty = no auth check")
    parser.add_argument(
        "--mode",
        type=int,
        default=200,
        choices=[200, 204, 500],
        help="HTTP status returned after auth passes (default: 200)",
    )
    args = parser.parse_args()

    server = http.server.HTTPServer(("127.0.0.1", args.port), make_handler(args.secret, args.mode))
    auth_info = f"secret='{args.secret}'" if args.secret else "no auth required"
    print(
        f"mock-bot-api  http://127.0.0.1:{args.port}  mode={args.mode}  {auth_info}",
        flush=True,
    )
    print(f"  {_MODE_LABEL.get(args.mode, '')}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)
        sys.exit(0)


if __name__ == "__main__":
    main()
