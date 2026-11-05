"""Local dev server with caching disabled: python3 tests/serve.py [port]"""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    # The default listen backlog (5) resets connections when a browser loads many ES modules at
    # once, which made parallel browser tests flaky.
    request_queue_size = 128


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
Server(("127.0.0.1", port), NoCacheHandler).serve_forever()
