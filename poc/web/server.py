"""PoC를 브라우저에서 확인하는 작은 서버. 이 PC 안에서만 열린다 (127.0.0.1).

    poc 폴더에서:  .venv/Scripts/python web/server.py
    브라우저에서:  http://localhost:8765

    - 글이나 녹음을 골라 받아 적기 → 정리 → 발주 초안까지 돌려 본다
    - 저장된 결과로 STT·정리 방식 비교표를 본다
LLM 방식은 Ollama가 켜져 있어야 하고, 녹음을 지금 받아 적으려면 ffmpeg와 녹음 파일이 있어야 한다.
"""

from __future__ import annotations

import json
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))

from src import extract_llm  # noqa: E402
from src.keywords import keyword_recall  # noqa: E402
from src.pipeline import STATUS, run_text  # noqa: E402

DATA = ROOT / "data"
PORT = 8765
STT_NAME = "whisper-large-v3-turbo-hint"
LLM_MODEL = "llama3.1:8b"
# 이 도우미를 불러도 되는 웹 앱 주소. 다른 사이트가 이 PC의 도우미를 쓰지 못하게 한다
ALLOWED_ORIGINS = {"https://material-order-checklist.vercel.app", f"http://localhost:{PORT}",
                   *(f"http://localhost:{port}" for port in range(3000, 3010))}
AUDIO_TYPES = {".wav": "audio/wav", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".3gp": "audio/3gpp"}

SCENARIO = json.loads((DATA / "scenario" / "base.json").read_text(encoding="utf-8"))
ITEMS = json.loads((DATA / "items.json").read_text(encoding="utf-8"))
UTTERANCES = json.loads((DATA / "utterances.json").read_text(encoding="utf-8"))["utterances"]

_stt_lock = threading.Lock()
_stt_model = None


def audio_path(uid: str) -> Path | None:
    for path in (DATA / "audio").glob(f"{uid}.*"):
        if path.suffix.lower() in AUDIO_TYPES:
            return path
    return None


def samples() -> list[dict]:
    path = DATA / "transcripts" / f"{STT_NAME}.json"
    heard = {t["id"]: t["text"] for t in json.loads(path.read_text(encoding="utf-8"))["transcripts"]} if path.exists() else {}
    return [{"id": u["id"], "split": u["split"], "condition": u["condition"], "text": u["text"],
             "heard": heard.get(u["id"]), "expected": u["records"], "expectedReview": bool(u.get("needsReview")),
             "note": u.get("note"), "hasAudio": audio_path(u["id"]) is not None} for u in UTTERANCES]


def stt_summary() -> list[dict]:
    rows = []
    for path in sorted((DATA / "transcripts").glob("*.json")):
        run = json.loads(path.read_text(encoding="utf-8"))
        texts = {t["id"]: t for t in run["transcripts"]}
        row = {"name": run["name"]}
        for split in ("test_in", "test_out"):
            part = [u for u in UTTERANCES if u["split"] == split]
            scores = [keyword_recall(u["text"], texts[u["id"]]["text"], ITEMS) for u in part]
            row[split] = {"hit": sum(s[0] for s in scores), "total": sum(s[1] for s in scores)}
        row["seconds"] = sum(texts[u["id"]]["seconds"] for u in UTTERANCES) / len(UTTERANCES)
        rows.append(row)
    return rows


def extraction_summary() -> list[dict]:
    order = ["rules", "plain", "structured", "hybrid", "hybrid2", "cascade"]
    rows = []
    for path in (DATA / "predictions").glob("*.json"):
        run = json.loads(path.read_text(encoding="utf-8"))
        if run["split"] == "all":
            rows.append({"method": run["method"], "source": run["source"],
                         "test_in": run["summary"]["test_in"], "test_out": run["summary"]["test_out"]})
    rows.sort(key=lambda r: (r["source"], order.index(r["method"].split("@")[0]), r["method"]))
    return rows


def transcribe_now(uid: str) -> tuple[str, float]:
    """녹음을 지금 받아 적는다. Whisper 모델은 처음 한 번만 불러온다"""
    from src.stt import build_hint, transcribe

    path = audio_path(uid)
    if path is None:
        raise FileNotFoundError(f"녹음이 없습니다: {uid} (녹음은 저장소에 올리지 않습니다)")
    with _stt_lock:
        return transcribe(_get_stt(), path, build_hint(ITEMS))


def _get_stt():
    global _stt_model
    from src.stt import load_model

    if _stt_model is None:
        _stt_model, _ = load_model("large-v3-turbo", "cpu")
    return _stt_model


def extract_for_webapp(body: dict) -> dict:
    """웹 앱이 보낸 실제 부자재·프로젝트 목록으로 글(또는 녹음)을 정리한다.

    LLM에는 긴 코드 대신 짧은 코드(M1, P1 …)를 주고, 답을 원래 코드로 되돌린다.
    검사는 엄격한 쪽(hybrid2)을 쓴다. 어차피 웹 앱에서 사람이 확인하므로, 의심스러우면 "확인 필요"로 넘긴다."""
    import base64
    import tempfile

    from src.stt import build_hint, transcribe

    web_items, context = body.get("items") or {}, body.get("context") or {}
    materials = [m for m in web_items.get("materials", []) if m.get("aliases")][:300]
    projects = [p for p in web_items.get("projects", []) if p.get("aliases")][:100]
    m_code = {m["id"]: f"M{i}" for i, m in enumerate(materials, start=1)}
    p_code = {p["id"]: f"P{i}" for i, p in enumerate(projects, start=1)}
    starts = context.get("projectStarts") or {}
    items = {
        "materials": [{"id": m_code[m["id"]], "name": m["name"], "aliases": m["aliases"],
                       "baseUnits": m.get("baseUnits") or ["개"], "packs": m.get("packs") or []} for m in materials],
        "projects": [{"id": p_code[p["id"]], "aliases": p["aliases"]} for p in projects],
    }
    scenario = {"today": context["today"],
                "projects": [{"id": p_code[p["id"]], "startDate": starts.get(p["id"], context["today"])} for p in projects]}

    extra = {}
    if body.get("audioBase64"):
        raw = base64.b64decode(body["audioBase64"])
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "upload"
            path.write_bytes(raw)
            with _stt_lock:
                text, seconds = transcribe(_get_stt(), path, build_hint(items))
        extra["sttSeconds"] = round(seconds, 1)
    else:
        text = str(body.get("text", ""))[:2000]

    result = extract_llm.extract(text, items, scenario, LLM_MODEL, "hybrid2", extract_llm.generic_examples(items))
    back_m = {code: real for real, code in m_code.items()}
    back_p = {code: real for real, code in p_code.items()}
    records = []
    for r in result["records"]:
        if r["kind"] == "stock_report":
            records.append({"kind": "stock_report", "materialId": back_m[r["materialId"]], "qty": r["qty"]})
        else:
            record = {"kind": "schedule_change", "projectId": back_p[r["project"]]}
            if "startDate" in r:
                record["startDate"] = r["startDate"]
            if "productionQty" in r:
                record["productionQty"] = r["productionQty"]
            records.append(record)
    # 이유 문구의 짧은 코드(M2, P1)를 사람이 아는 이름으로 바꾼다
    names = {m_code[m["id"]]: m["name"] for m in materials}
    names.update({p_code[p["id"]]: p.get("name") or p["aliases"][0] for p in projects})
    reasons = [re.sub(r"(?<![A-Za-z0-9])([MP][0-9]+)(?![A-Za-z0-9])", lambda m: names.get(m[1], m[1]), reason)
               for reason in result["reasons"]]
    return {**extra, "text": text, "method": f"hybrid2@{LLM_MODEL}", "records": records,
            "needsReview": result["needsReview"], "reasons": reasons}


def run(body: dict) -> dict:
    method = body.get("method", "hybrid")
    if method not in ("rules", "plain", "structured", "hybrid", "hybrid2"):
        raise ValueError("모르는 방식")
    extra = {}
    if body.get("audioId"):
        text, seconds = transcribe_now(str(body["audioId"]))
        extra = {"sttSeconds": round(seconds, 1)}
    else:
        text = str(body.get("text", ""))[:500]
    result = run_text(text, ITEMS, SCENARIO, method, "llama3.1:8b")
    names = {m["id"]: m["name"] for m in ITEMS["materials"]}

    def orders(rows):
        return [{"material": f"{names[o['materialId']]}({o['materialId']})", "orderDate": o["orderDate"],
                 "orderQty": o["orderQty"], "status": STATUS.get(o["status"], o["status"])}
                for o in sorted(rows, key=lambda o: o["orderDate"])]

    return {**extra, "text": result["text"], "method": result["method"], "records": result["records"],
            "needsReview": result["needsReview"], "reasons": result["reasons"], "applied": result["applied"],
            "changes": [{**c, "material": f"{names[c['materialId']]}({c['materialId']})"} for c in result["changes"]],
            "ordersBefore": orders(result["ordersBefore"]), "ordersAfter": orders(result["ordersAfter"])}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _cors(self) -> None:
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _json(self, payload, status: int = 200) -> None:
        self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        try:
            if path == "/":
                self._send(200, (Path(__file__).parent / "index.html").read_bytes(), "text/html; charset=utf-8")
            elif path == "/api/health":
                self._json({"ok": True, "llm": LLM_MODEL})
            elif path == "/api/state":
                self._json({"today": SCENARIO["today"], "items": ITEMS, "scenario": SCENARIO, "samples": samples(),
                            "stt": stt_summary(), "extraction": extraction_summary(), "sttName": STT_NAME})
            elif path.startswith("/audio/"):
                uid = path.removeprefix("/audio/")
                found = audio_path(uid) if uid.isalnum() else None
                if found is None:
                    self._json({"error": "녹음이 없습니다"}, 404)
                else:
                    self._send(200, found.read_bytes(), AUDIO_TYPES[found.suffix.lower()])
            else:
                self._json({"error": "없는 주소"}, 404)
        except Exception as error:  # 화면에 이유를 보여 준다
            self._json({"error": str(error)}, 500)

    def do_POST(self) -> None:  # noqa: N802
        if self.path not in ("/api/run", "/api/extract"):
            self._json({"error": "없는 주소"}, 404)
            return
        origin = self.headers.get("Origin")
        if origin is not None and origin not in ALLOWED_ORIGINS:
            self._json({"error": "허용되지 않은 주소에서 온 요청입니다"}, 403)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length > 30_000_000:
                self._json({"error": "보낸 내용이 너무 큽니다"}, 413)
                return
            body = json.loads(self.rfile.read(length) or b"{}")
            self._json(extract_for_webapp(body) if self.path == "/api/extract" else run(body))
        except Exception as error:
            self._json({"error": str(error)}, 500)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"http://localhost:{PORT} 에서 열립니다. 끄려면 Ctrl+C", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
