#!/usr/bin/env python3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os


ROOT = Path(__file__).resolve().parent.parent / "dist"
PORT = int(os.environ.get("PORT", "4173"))


class SpaHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _rewrite_path_for_spa(self):
        requested = self.translate_path(self.path)
        if self.path.startswith("/assets/") or Path(requested).exists():
            return

        self.path = "/index.html"

    def do_GET(self):
        self._rewrite_path_for_spa()
        return super().do_GET()

    def do_HEAD(self):
        self._rewrite_path_for_spa()
        return super().do_HEAD()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), SpaHandler)
    print(f"Serving {ROOT} on http://0.0.0.0:{PORT}", flush=True)
    server.serve_forever()
