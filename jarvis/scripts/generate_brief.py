#!/usr/bin/env python3
"""
Generate jarvis_brief.mp3 — the audio the BRIEF ME button plays.

Three ways to run it:

    # 1. Let Claude write the brief from jarvis_data.js, then speak it
    python3 scripts/generate_brief.py

    # 2. Speak text you wrote yourself
    python3 scripts/generate_brief.py --text "Good morning. Two things need you."

    # 3. Speak a file
    python3 scripts/generate_brief.py --file brief.txt

Add --print to see the script without spending TTS characters.
Emotion tags work on the S2.1 models: "[calm] Your three o'clock is
confirmed. [amused] Shall I cancel the four as well?"
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))

from server import (  # noqa: E402
    AUDIO_DIR,
    CLAUDE_BIN,
    CLAUDE_CWD,
    CLAUDE_TIMEOUT,
    FISH_KEY,
    FISH_MODEL,
    FISH_REF,
    synthesize,
)

WRITE_PROMPT = """Read jarvis_data.js in this folder.

Write what I should hear when I press BRIEF ME: a spoken morning brief,
25 to 45 seconds when read aloud (roughly 70 to 120 words).

Rules:
- You are J.A.R.V.I.S: British, dry, unhurried, never chirpy.
- Open with the greeting, then the headline, then the priorities in order
  of urgency, then the closer.
- Name any overdue money explicitly.
- Plain prose only. No markdown, no bullets, no headings, no stage directions.
- Output ONLY the words to be spoken. Nothing else.
"""


def write_brief() -> str:
    print(f"Asking Claude to write the brief (cwd {CLAUDE_CWD})…", file=sys.stderr)
    try:
        proc = subprocess.run(
            [CLAUDE_BIN, "-p", WRITE_PROMPT],
            cwd=CLAUDE_CWD,
            capture_output=True,
            text=True,
            timeout=CLAUDE_TIMEOUT,
        )
    except FileNotFoundError:
        sys.exit(f"'{CLAUDE_BIN}' not found. npm install -g @anthropic-ai/claude-code")
    except subprocess.TimeoutExpired:
        sys.exit(f"Claude took longer than {CLAUDE_TIMEOUT}s.")

    if proc.returncode != 0:
        sys.exit(f"claude exited {proc.returncode}: {(proc.stderr or '').strip()[:400]}")

    text = (proc.stdout or "").strip()
    if not text:
        sys.exit("Claude returned an empty brief.")
    return text


def main() -> int:
    ap = argparse.ArgumentParser(description="Build jarvis_brief.mp3")
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--text", help="speak this text verbatim")
    src.add_argument("--file", type=Path, help="speak the contents of this file")
    ap.add_argument("--out", type=Path, default=ROOT / "jarvis_brief.mp3",
                    help="output path (default: jarvis_brief.mp3)")
    ap.add_argument("--print", dest="show", action="store_true",
                    help="print the brief and exit without calling Fish Audio")
    args = ap.parse_args()

    if args.text:
        brief = args.text.strip()
    elif args.file:
        if not args.file.is_file():
            sys.exit(f"No such file: {args.file}")
        brief = args.file.read_text(encoding="utf-8").strip()
    else:
        brief = write_brief()

    print("\n--- brief ---\n" + brief + "\n-------------\n", file=sys.stderr)

    if args.show:
        return 0

    if not FISH_KEY:
        sys.exit(
            "FISH_AUDIO_API_KEY is not set, so there is nothing to speak with.\n"
            "Get a key at https://fish.audio and put it in jarvis/.env, then:\n"
            "  set -a && . ./.env && set +a\n"
            "Re-run with --print in the meantime to check the words."
        )

    print(f"Synthesising with Fish Audio ({FISH_MODEL}"
          + (f", voice {FISH_REF}" if FISH_REF else ", default voice") + ")…", file=sys.stderr)

    url = synthesize(brief)
    if not url:
        sys.exit("Fish Audio did not return audio — see the error above.")

    cached = AUDIO_DIR / Path(url).name
    args.out.write_bytes(cached.read_bytes())
    cached.unlink(missing_ok=True)

    size_kb = args.out.stat().st_size // 1024
    print(f"\n✅ Wrote {args.out} ({size_kb} KB). Press BRIEF ME.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
