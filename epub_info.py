# -*- coding: utf-8 -*-
"""epub_info.py - Kitaplık rafı için EPUB'lardan başlık, yazar ve kapak okur.

Kullanım (Electron arayüzü çağırır):
    py epub_info.py liste.json
liste.json: EPUB dosya yollarının JSON listesi.
Çıktı: aynı sırada [{title, author, publisher, date, language, isbn, subjects,
description, pages, pages_exact, cover (base64 jpeg), color}] JSON listesi.
Ek kütüphane gerekmez; sadece zipfile + Pillow.
"""
import base64
import html
import io
import json
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from urllib.parse import unquote

from PIL import Image

THUMB = (500, 750)


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def first_text(root, name: str) -> str:
    for el in root.iter():
        if local(el.tag) == name and (el.text or "").strip():
            return el.text.strip()
    return ""


def all_text(root, name: str) -> list:
    return [el.text.strip() for el in root.iter() if local(el.tag) == name and (el.text or "").strip()]


def find_isbn(opf) -> str:
    for el in opf.iter():
        if local(el.tag) != "identifier" or not (el.text or "").strip():
            continue
        txt = el.text.strip()
        scheme = " ".join(v for k, v in el.attrib.items() if local(k) == "scheme").lower()
        digits = re.sub(r"[^0-9Xx]", "", txt.replace("urn:isbn:", ""))
        if "isbn" in scheme or "isbn" in txt.lower() or re.fullmatch(r"97[89]\d{10}|\d{9}[\dXx]", digits):
            if len(digits) in (10, 13):
                return digits
    return ""


def count_pages(z, opf, opf_dir):
    """Varsa EPUB'ın gerçek sayfa listesini, yoksa kelime sayısından tahmini sayfa döner."""
    names = set(z.namelist())
    for n in names:
        if n.lower().endswith((".xhtml", ".html", ".ncx")):
            raw = z.read(n).decode("utf-8", "ignore")
            if 'epub:type="page-list"' in raw or "<pageList" in raw:
                if n.lower().endswith(".ncx"):
                    c = raw.count("<pageTarget")
                else:
                    section = raw.split('epub:type="page-list"', 1)[1].split("</nav>", 1)[0]
                    c = section.count("<a ")
                if c > 5:
                    return c, True
    items = {it.get("id"): it.get("href") for it in opf.iter() if local(it.tag) == "item"}
    words = 0
    for ref in (el for el in opf.iter() if local(el.tag) == "itemref"):
        href = items.get(ref.get("idref"))
        if not href:
            continue
        p = posixpath.normpath(posixpath.join(opf_dir, unquote(href)))
        if p in names:
            text = re.sub(r"<[^>]+>", " ", z.read(p).decode("utf-8", "ignore"))
            words += len(html.unescape(text).split())
    return (max(1, round(words / 280)), False) if words else (0, False)


def find_cover_href(opf):
    items = [el for el in opf.iter() if local(el.tag) == "item"]
    # 1) EPUB3: properties="cover-image"
    for it in items:
        if "cover-image" in (it.get("properties") or ""):
            return it.get("href")
    # 2) EPUB2: <meta name="cover" content="id">
    cover_id = next((m.get("content") for m in opf.iter()
                     if local(m.tag) == "meta" and (m.get("name") or "").lower() == "cover"), None)
    if cover_id:
        for it in items:
            if it.get("id") == cover_id:
                return it.get("href")
    images = [it for it in items if (it.get("media-type") or "").startswith("image/")]
    # 3) adında "cover" / "kapak" geçen görsel
    for it in images:
        key = ((it.get("id") or "") + (it.get("href") or "")).lower()
        if "cover" in key or "kapak" in key:
            return it.get("href")
    # 4) ilk görsel
    return images[0].get("href") if images else None


def info(path: str) -> dict:
    with zipfile.ZipFile(path) as z:
        container = ET.fromstring(z.read("META-INF/container.xml"))
        opf_path = next(el.get("full-path") for el in container.iter() if local(el.tag) == "rootfile")
        opf = ET.fromstring(z.read(opf_path))
        opf_dir = posixpath.dirname(opf_path)
        desc = html.unescape(re.sub(r"<[^>]+>", " ", html.unescape(first_text(opf, "description"))))
        pages, exact = count_pages(z, opf, opf_dir)
        out = {
            "title": first_text(opf, "title"), "author": ", ".join(all_text(opf, "creator")[:2]),
            "publisher": first_text(opf, "publisher"), "date": first_text(opf, "date"),
            "language": first_text(opf, "language"), "isbn": find_isbn(opf),
            "subjects": all_text(opf, "subject")[:3], "description": re.sub(r"\s+([.,;:!?])", r"\1", re.sub(r"\s+", " ", desc)).strip()[:700],
            "pages": pages, "pages_exact": exact, "cover": None, "color": None,
        }

        href = find_cover_href(opf)
        if href:
            img_path = posixpath.normpath(posixpath.join(opf_dir, unquote(href)))
            try:
                img = Image.open(io.BytesIO(z.read(img_path))).convert("RGB")
                img.thumbnail(THUMB)
                buf = io.BytesIO()
                img.save(buf, "JPEG", quality=82)
                out["cover"] = base64.b64encode(buf.getvalue()).decode("ascii")
                r, g, b = img.resize((1, 1), Image.LANCZOS).getpixel((0, 0))
                out["color"] = "#%02x%02x%02x" % (r, g, b)
            except Exception:
                pass
        return out


def main():
    with open(sys.argv[1], encoding="utf-8") as f:
        files = json.load(f)
    result = []
    for p in files:
        try:
            result.append(info(p))
        except Exception as e:
            result.append({"error": str(e)})
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()