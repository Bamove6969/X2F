#!/usr/bin/env python3
"""Jetpost wake listener (agy copy; port 8788).

Listens on 127.0.0.1:8788 (Tailscale Funnel forwards HTTPS here). Accepts only
POST /jetpost with a valid Standard Webhooks signature (secret in
secret.txt, "whsec_..."). Until a secret exists it accepts any POST to /jetpost,
so the first test can arrive. On a good request it appends the body to
wakes.jsonl and EXITS: the exit wakes the agent session that started it.
"""
import base64, hashlib, hmac, http.server, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
SECRET_FILE = os.path.join(HERE, "secret.txt")
LOG = os.path.join(HERE, "wakes.jsonl")
MAX_BODY = 64 * 1024


def secret():
    try:
        s = open(SECRET_FILE).read().strip()
    except OSError:
        return None
    if s.startswith("whsec_"):
        s = s[6:]
    return base64.b64decode(s)


def valid(headers, body):
    key = secret()
    if key is None:
        return True  # bootstrap: no secret yet
    mid = headers.get("webhook-id", "")
    ts = headers.get("webhook-timestamp", "")
    sigs = headers.get("webhook-signature", "")
    try:
        if abs(time.time() - int(ts)) > 300:
            return False
    except ValueError:
        return False
    want = base64.b64encode(
        hmac.new(key, f"{mid}.{ts}.".encode() + body, hashlib.sha256).digest()
    ).decode()
    for part in sigs.split():
        _, _, sig = part.partition(",")
        if hmac.compare_digest(sig, want):
            return True
    return False


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok\n")

    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        if self.path.rstrip("/") != "/jetpost" or n > MAX_BODY:
            self.send_response(404)
            self.end_headers()
            return
        body = self.rfile.read(n)
        if not valid(self.headers, body):
            self.send_response(401)
            self.end_headers()
            return
        with open(LOG, "a") as f:
            f.write(json.dumps({"at": time.time(), "body": body.decode("utf-8", "replace")}) + "\n")
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok\n")
        self.wfile.flush()
        print("WAKE", body.decode("utf-8", "replace")[:500], flush=True)
        os._exit(0)


http.server.HTTPServer(("127.0.0.1", 8788), H).serve_forever()
