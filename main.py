"""Start Math Notebook: builds the web UI if needed, runs the server, and opens the browser.

    python main.py                 # notebooks live in ~/MathJournal
    MATHJOURNAL_DIR=... python main.py
"""

import os
import shutil
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

import uvicorn

HOST = "127.0.0.1"
PORT = int(os.environ.get("MATHJOURNAL_PORT", "8642"))
FRONTEND = Path(__file__).resolve().parent / "frontend"


def ensure_frontend_built() -> None:
    if (FRONTEND / "dist" / "index.html").exists():
        return
    npm = shutil.which("npm")
    if not npm:
        sys.exit("The web UI is not built and npm was not found. Install Node.js, then run this again.")
    print("Building the web UI (first run only)...")
    if not (FRONTEND / "node_modules").exists():
        subprocess.run([npm, "install"], cwd=FRONTEND, check=True)
    subprocess.run([npm, "run", "build"], cwd=FRONTEND, check=True)


if __name__ == "__main__":
    ensure_frontend_built()
    url = f"http://{HOST}:{PORT}/"
    threading.Timer(1.0, webbrowser.open, args=[url]).start()
    print(f"Math Notebook running at {url}  (Ctrl+C to stop)")
    uvicorn.run("server.app:app", host=HOST, port=PORT)
