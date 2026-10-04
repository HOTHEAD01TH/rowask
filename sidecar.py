#!/usr/bin/env python3
"""rowask Laya sidecar.

Calls laya.Router.predict in-process. LAYA_SERVE_BACKEND is forced to "laya".
Any other value is refused: this process will not talk to a fake backend.
Weights are not downloaded until the first POST /predict. If Laya is not
installed or the checkpoint cannot be loaded, the body is exactly
{"ok": false, "error": "Laya not running"} and no answer object is returned.
action.act_probability is never read and is stripped if a checkpoint adds it.
min_confidence is always forwarded (default 0.6) so abstention is on.
"""
from __future__ import annotations

import json
import os
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP = "rowask"
PORT = 4011
NOT_RUNNING = "Laya not running"
DEFAULT_MIN_CONFIDENCE = 0.6
MAX_BODY = 512_000

_lock = threading.Lock()
_router = None
_loaded = False


def _backend_ok() -> bool:
    raw = os.environ.get("LAYA_SERVE_BACKEND", "").strip().lower()
    if raw and raw != "laya":
        return False
    os.environ["LAYA_SERVE_BACKEND"] = "laya"
    return True


def _strip_action(result: dict) -> dict:
    answers = result.get("answers")
    if isinstance(answers, dict):
        for answer in answers.values():
            if isinstance(answer, dict):
                answer.pop("action", None)
    return result


def _predict(state, questions, min_confidence: float) -> dict:
    global _router, _loaded
    if not _backend_ok():
        raise RuntimeError(NOT_RUNNING)
    with _lock:
        if _router is None:
            from laya import Router  # lazy so /health does not import torch

            _router = Router(max_loaded=1)
        result = _router.predict(state, questions, min_confidence=min_confidence)
        if not isinstance(result, dict) or "answers" not in result:
            raise RuntimeError(NOT_RUNNING)
        _loaded = True
        return _strip_action(result)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        print("[%s sidecar] " % APP + (fmt % args), flush=True)

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/health":
            self._send(404, {"ok": False, "error": "not found"})
            return
        if not _backend_ok() or not _loaded:
            self._send(503, {"ok": False, "loaded": False, "error": NOT_RUNNING})
            return
        self._send(200, {"ok": True, "loaded": True, "error": None})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/predict":
            self._send(404, {"ok": False, "error": "not found"})
            return
        if not _backend_ok():
            self._send(503, {"ok": False, "error": NOT_RUNNING})
            return
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            self._send(400, {"ok": False, "error": "body length rejected"})
            return
        if length <= 0 or length > MAX_BODY:
            self._send(400, {"ok": False, "error": "body length rejected"})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            self._send(400, {"ok": False, "error": "invalid json"})
            return
        if not isinstance(body, dict) or "questions" not in body or "state" not in body:
            self._send(400, {"ok": False, "error": "state and questions are required"})
            return
        try:
            min_confidence = body.get("min_confidence", DEFAULT_MIN_CONFIDENCE)
            if min_confidence is None:
                min_confidence = DEFAULT_MIN_CONFIDENCE
            min_confidence = float(min_confidence)
            if not 0.0 <= min_confidence <= 1.0:
                raise ValueError("min_confidence must be between 0 and 1")
        except (TypeError, ValueError) as exc:
            self._send(422, {"ok": False, "error": str(exc)})
            return
        try:
            result = _predict(body["state"], body["questions"], min_confidence)
        except ValueError as exc:
            if _loaded:
                self._send(422, {"ok": False, "error": str(exc)})
            else:
                print(traceback.format_exc(), flush=True)
                self._send(503, {"ok": False, "error": NOT_RUNNING})
            return
        except Exception:
            print(traceback.format_exc(), flush=True)
            self._send(503, {"ok": False, "error": NOT_RUNNING})
            return
        usage = result.get("usage") if isinstance(result.get("usage"), dict) else None
        self._send(
            200,
            {
                "ok": True,
                "model": result.get("model"),
                "answers": result.get("answers"),
                "usage": usage,
                "routing": result.get("routing"),
            },
        )


def main() -> None:
    if not _backend_ok():
        print(NOT_RUNNING + ": LAYA_SERVE_BACKEND is not laya", flush=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("%s sidecar on http://127.0.0.1:%s (model loads on first /predict)" % (APP, PORT), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
