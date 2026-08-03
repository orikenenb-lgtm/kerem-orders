#!/usr/bin/env python3
"""
J.A.R.V.I.S local bridge.

Serves the dashboard and wires the three halves of the voice loop:

    browser mic (Web Speech API)
        -> POST /ask
        -> `claude -p`            (the real brain: your skills + connectors)
        -> Fish Audio TTS         (the British butler voice)
        -> MP3 back to the page   (the sphere pulses while it speaks)

Standard library only — nothing to pip install.

    python3 server.py
    open http://localhost:8765

Bound to 127.0.0.1 on purpose: /ask runs a subprocess with your
Claude session and connectors attached. Do not expose it to a network.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
AUDIO_DIR = HERE / ".audio_cache"

# ----------------------------------------------------------------------
# Config (all overridable by environment — see .env.example)
# ----------------------------------------------------------------------
FISH_KEY = os.environ.get("FISH_AUDIO_API_KEY", "").strip()
FISH_REF = os.environ.get("FISH_AUDIO_REFERENCE_ID", "").strip()
FISH_MODEL = os.environ.get("FISH_AUDIO_MODEL", "s2.1-pro-free").strip()
FISH_URL = "https://api.fish.audio/v1/tts"

CLAUDE_BIN = os.environ.get("JARVIS_CLAUDE_BIN", "claude")
CLAUDE_CWD = os.environ.get("JARVIS_CLAUDE_CWD", str(HERE))
CLAUDE_TIMEOUT = int(os.environ.get("JARVIS_CLAUDE_TIMEOUT", "120"))
CLAUDE_EXTRA = [a for a in os.environ.get("JARVIS_CLAUDE_ARGS", "").split() if a]

MAX_QUESTION = 2000          # characters accepted from the browser
MAX_SPOKEN = 1200            # characters we bother sending to TTS
AUDIO_TTL = 30 * 60          # seconds before a cached clip is swept

# Keeps answers short enough to be listened to rather than read.
PREAMBLE = os.environ.get(
    "JARVIS_PREAMBLE",
    "You are J.A.R.V.I.S, a concise British butler-assistant. Answer out loud in at "
    "most three sentences, plain prose, no markdown, no bullet points, no code blocks. "
    "If you genuinely do not know, say so in one sentence.\n\nRequest: ",
)


def log(msg: str) -> None:
    print(f"[jarvis {time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ----------------------------------------------------------------------
# The brain
# ----------------------------------------------------------------------
def ask_claude(question: str) -> str:
    """Run the question through Claude Code headlessly and return the reply."""
    cmd = [CLAUDE_BIN, "-p", PREAMBLE + question, *CLAUDE_EXTRA]
    log(f"claude -p {question[:70]!r}")
    try:
        proc = subprocess.run(
            cmd,
            cwd=CLAUDE_CWD,
            capture_output=True,
            text=True,
            timeout=CLAUDE_TIMEOUT,
        )
    except FileNotFoundError:
        raise RuntimeError(
            f"'{CLAUDE_BIN}' not found. Install it with "
            "`npm install -g @anthropic-ai/claude-code`, or set JARVIS_CLAUDE_BIN."
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"Claude took longer than {CLAUDE_TIMEOUT}s and was stopped.")

    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()[:400] or "no output"
        raise RuntimeError(f"claude exited {proc.returncode}: {detail}")

    reply = (proc.stdout or "").strip()
    return reply or "I have nothing to report."


# ----------------------------------------------------------------------
# The voice
# ----------------------------------------------------------------------
def strip_for_speech(text: str) -> str:
    """Drop markdown scaffolding that a TTS engine would read aloud."""
    text = re.sub(r"```.*?```", " ", text, flags=re.S)      # code fences
    text = re.sub(r"`([^`]*)`", r"\1", text)                # inline code
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.M)  # headings
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.M)    # bullets
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)          # bold
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)    # links
    text = re.sub(r"\s+", " ", text)
    return text.strip()[:MAX_SPOKEN]


def synthesize(text: str) -> str | None:
    """POST to Fish Audio, cache the MP3, return its URL path (or None)."""
    if not FISH_KEY:
        return None

    spoken = strip_for_speech(text)
    if not spoken:
        return None

    body: dict = {
        "text": spoken,
        "format": "mp3",
        "mp3_bitrate": 128,
        "normalize": True,
        "latency": "normal",
    }
    if FISH_REF:
        body["reference_id"] = FISH_REF

    req = urllib.request.Request(
        FISH_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {FISH_KEY}",
            "Content-Type": "application/json",
            # Fish Audio selects the TTS model with this header.
            "model": FISH_MODEL,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            audio = resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        log(f"Fish Audio HTTP {e.code}: {detail}")
        return None
    except Exception as e:                                   # noqa: BLE001
        log(f"Fish Audio failed: {e}")
        return None

    if not audio:
        log("Fish Audio returned an empty body")
        return None

    AUDIO_DIR.mkdir(exist_ok=True)
    name = f"{uuid.uuid4().hex}.mp3"
    (AUDIO_DIR / name).write_bytes(audio)
    log(f"spoke {len(spoken)} chars -> {name} ({len(audio)//1024} KB)")
    return f"/audio/{name}"


def sweep_audio() -> None:
    """Delete cached clips older than AUDIO_TTL. Runs hourly-ish."""
    while True:
        time.sleep(300)
        if not AUDIO_DIR.exists():
            continue
        cutoff = time.time() - AUDIO_TTL
        for f in AUDIO_DIR.glob("*.mp3"):
            try:
                if f.stat().st_mtime < cutoff:
                    f.unlink()
            except OSError:
                pass


# ----------------------------------------------------------------------
# HTTP
# ----------------------------------------------------------------------
class Handler(SimpleHTTPRequestHandler):
    server_version = "JarvisBridge/1.0"

    def log_message(self, fmt, *args):        # quieter than the default
        if "/audio/" not in (self.path or ""):
            log(f"{self.command} {self.path}")

    # ---------------- helpers ----------------
    def _json(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return {}
        if length <= 0 or length > 64 * 1024:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    # ---------------- routes ----------------
    # Only these are ever served off disk. Everything else in this folder —
    # .env with your API key, server.py, scripts/ — stays unreachable.
    # A page in any other tab can fetch http://localhost:8765/<anything>,
    # so a directory server here would hand out the Fish Audio key.
    STATIC_ALLOW = {
        "/dashboard.html": "text/html; charset=utf-8",
        "/jarvis_data.js": "text/javascript; charset=utf-8",
        "/jarvis_brief.mp3": "audio/mpeg",
    }

    def do_GET(self) -> None:                                  # noqa: N802
        path = (self.path or "/").split("?", 1)[0].split("#", 1)[0]

        if path == "/health":
            return self._json(200, {
                "ok": True,
                "claude": CLAUDE_BIN,
                "tts": bool(FISH_KEY),
                "voice": FISH_REF or None,
                "model": FISH_MODEL,
            })

        if path.startswith("/audio/"):
            return self._serve_audio(path)

        if path in ("/", ""):
            path = "/dashboard.html"

        ctype = self.STATIC_ALLOW.get(path)
        if ctype is None:
            return self._json(404, {"error": "not found"})

        target = HERE / path.lstrip("/")
        if not target.is_file():
            # jarvis_brief.mp3 is generated, not committed — a 404 here is
            # expected until you run scripts/generate_brief.py.
            return self._json(404, {"error": "not found"})

        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def _serve_audio(self, path: str) -> None:
        name = os.path.basename(path[len("/audio/"):])
        # uuid4().hex + ".mp3" only — no traversal, no surprises.
        if not re.fullmatch(r"[0-9a-f]{32}\.mp3", name):
            return self._json(404, {"error": "not found"})
        path = AUDIO_DIR / name
        if not path.is_file():
            return self._json(404, {"error": "expired"})
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:                                 # noqa: N802
        if self.path not in ("/ask", "/speak"):
            return self._json(404, {"error": "no such endpoint"})

        payload = self._read_json()

        if self.path == "/speak":
            text = (payload.get("text") or "").strip()
            if not text:
                return self._json(400, {"error": "text is required"})
            return self._json(200, {"audio_url": synthesize(text)})

        question = (payload.get("question") or "").strip()
        if not question:
            return self._json(400, {"error": "question is required"})
        if len(question) > MAX_QUESTION:
            return self._json(413, {"error": "question too long"})

        try:
            reply = ask_claude(question)
        except RuntimeError as e:
            log(f"ask failed: {e}")
            return self._json(502, {"error": str(e)})

        return self._json(200, {"reply": reply, "audio_url": synthesize(reply)})


def main() -> int:
    ap = argparse.ArgumentParser(description="J.A.R.V.I.S local bridge")
    ap.add_argument("--port", type=int, default=int(os.environ.get("JARVIS_PORT", "8765")))
    ap.add_argument("--host", default=os.environ.get("JARVIS_HOST", "127.0.0.1"))
    args = ap.parse_args()

    if args.host not in ("127.0.0.1", "localhost", "::1"):
        log(f"⚠️  binding to {args.host} — /ask runs Claude with your connectors "
            "attached. Only do this on a network you control.")

    threading.Thread(target=sweep_audio, daemon=True).start()

    handler = partial(Handler, directory=str(HERE))
    httpd = ThreadingHTTPServer((args.host, args.port), handler)

    mimetypes.add_type("text/javascript", ".js")

    log(f"dashboard  →  http://{args.host}:{args.port}")
    log(f"brain      →  {CLAUDE_BIN} -p   (cwd {CLAUDE_CWD})")
    if FISH_KEY:
        log(f"voice      →  Fish Audio {FISH_MODEL}" + (f", ref {FISH_REF}" if FISH_REF else " (default voice)"))
    else:
        log("voice      →  off (set FISH_AUDIO_API_KEY to enable speech)")
    log("Ctrl-C to stop.")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log("stopped.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
