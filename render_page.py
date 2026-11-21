# -*- coding: utf-8 -*-
"""render_page.py - Electron arayüzündeki PDF önizlemesi için tek bir sayfayı
PNG'ye çevirip JSON olarak stdout'a basar. OCR'a dokunmaz, sadece görüntüleme."""
import argparse
import base64
import json

import pymupdf


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--pdf", required=True)
    p.add_argument("--page", type=int, default=0, help="0-indeksli sayfa")
    p.add_argument("--dpi", type=int, default=110)
    a = p.parse_args()

    doc = pymupdf.open(a.pdf)
    count = len(doc)
    idx = min(max(a.page, 0), count - 1)
    pix = doc[idx].get_pixmap(dpi=a.dpi)
    png = base64.b64encode(pix.tobytes("png")).decode("ascii")
    print(json.dumps({"count": count, "page": idx, "png": png}))


if __name__ == "__main__":
    main()