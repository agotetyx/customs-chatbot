import json, re, zipfile
from pathlib import Path
from datetime import datetime

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.lib.utils import simpleSplit

# ---- CONFIG ----
INPUT_JSON = r"C:\Customs search\customs-chat-ui\src\assets\demoData.json"
OUT_DIR = Path(r"C:\Customs search\customs-chat-ui\out_pdfs")
ZIP_NAME = Path(r"C:\Customs search\customs-chat-ui\out_pdfs.zip")

COLLECTIONS = ["persons", "vehicles", "first_info_reports", "cases", "trips"]
ID_KEYS = ["person_id", "vehicle_id", "first_info_id", "case_id", "trip_id", "id"]
# ---------------

def safe_filename(s: str) -> str:
    s = str(s)
    s = re.sub(r"[^\w\-\.]+", "_", s.strip())
    return s[:120] if len(s) > 120 else s

def draw_wrapped(c: canvas.Canvas, text: str, x: float, y: float, width: float, leading: float = 12):
    lines = simpleSplit(text, "Helvetica", 10, width)
    for line in lines:
        if y < 0.75 * inch:
            c.showPage()
            y = 10.5 * inch
            c.setFont("Helvetica", 10)
        c.drawString(x, y, line)
        y -= leading
    return y

def find_id(obj: dict) -> str:
    for k in ID_KEYS:
        if k in obj and obj[k] is not None:
            return str(obj[k])
    # fallback: stable-ish hash of JSON
    return "obj_" + str(abs(hash(json.dumps(obj, sort_keys=True))) % 10**10)

def flatten_pairs(obj: dict):
    pairs = []
    for k, v in obj.items():
        if isinstance(v, (dict, list)):
            pairs.append((k, json.dumps(v, ensure_ascii=False)))
        else:
            pairs.append((k, "" if v is None else str(v)))
    return pairs

def make_pdf(collection: str, obj: dict, out_path: Path):
    c = canvas.Canvas(str(out_path), pagesize=LETTER)
    w, h = LETTER

    obj_id = find_id(obj)
    title = f"{collection} • {obj_id}"

    # Header
    c.setFont("Helvetica-Bold", 16)
    c.drawString(0.75 * inch, h - 0.9 * inch, title)

    c.setFont("Helvetica", 10)
    c.drawString(0.75 * inch, h - 1.15 * inch, f"Generated: {datetime.now().isoformat(timespec='seconds')}")

    y = h - 1.6 * inch
    x = 0.75 * inch
    col_w = w - 1.5 * inch

    c.setFont("Helvetica-Bold", 12)
    c.drawString(x, y, "Fields")
    y -= 0.25 * inch
    c.setFont("Helvetica", 10)

    for k, v in flatten_pairs(obj):
        y = draw_wrapped(c, f"{k}: {v}", x, y, col_w, leading=12)

    y -= 0.2 * inch
    if y < 1.2 * inch:
        c.showPage()
        y = h - 0.9 * inch

    c.setFont("Helvetica-Bold", 12)
    c.drawString(x, y, "Raw JSON")
    y -= 0.25 * inch
    c.setFont("Helvetica", 9)

    raw = json.dumps(obj, indent=2, ensure_ascii=False)
    y = draw_wrapped(c, raw, x, y, col_w, leading=11)

    c.save()

def main():
    with open(INPUT_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    count = 0
    for collection in COLLECTIONS:
        items = data.get(collection, [])
        if not isinstance(items, list):
            continue

        for obj in items:
            if not isinstance(obj, dict):
                continue
            obj_id = safe_filename(find_id(obj))
            filename = f"{collection}_{obj_id}.pdf"
            make_pdf(collection, obj, OUT_DIR / filename)
            count += 1

    if ZIP_NAME.exists():
        ZIP_NAME.unlink()

    with zipfile.ZipFile(ZIP_NAME, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for p in sorted(OUT_DIR.glob("*.pdf")):
            z.write(p, arcname=p.name)

    print(f"Done. PDFs created: {count}")
    print(f"Folder: {OUT_DIR}")
    print(f"Zip: {ZIP_NAME}")

if __name__ == "__main__":
    main()
