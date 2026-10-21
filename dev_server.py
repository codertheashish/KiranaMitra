"""
KiranaMitra - dev_server.py - run the WHOLE app locally without the Vercel CLI.

    python dev_server.py            -> http://localhost:3000

Serves public/ and routes /api/reorder to the same code Vercel runs.
Local testing only; on Vercel this file is simply ignored.
"""
import functools
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

import json  # noqa: E402
from api.reorder import MAX_BODY_BYTES, process_request  # noqa: E402

PORT = int(os.environ.get("PORT", "3000"))


class DevHandler(SimpleHTTPRequestHandler):
    # Some Windows PCs map .js to text/plain; force the right types.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # always show latest edits
        super().end_headers()

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] == "/api/reorder":
            return self._json(200, {"status": "ok"})
        return super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] != "/api/reorder":
            return self._json(404, {"error": "Not found"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._json(400, {"error": "Bad Content-Length."})
        if length > MAX_BODY_BYTES:
            return self._json(413, {"error": "Request too large."})
        status, payload = process_request(self.rfile.read(length))
        self._json(status, payload)


if __name__ == "__main__":
    handler_cls = functools.partial(DevHandler, directory=os.path.join(ROOT, "public"))
    server = ThreadingHTTPServer(("127.0.0.1", PORT), handler_cls)
    print("KiranaMitra running at http://localhost:%d  (Ctrl+C to stop)" % PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
