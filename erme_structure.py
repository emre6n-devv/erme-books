# -*- coding: utf-8 -*-
"""
erme_structure.py - Kitabın bölüm ağacı (içindekiler) için ortak yardımcılar.

yapi.json'daki "toc" listesi her başlık için şunu tutar:
    {"idx": paragraf_no, "title": "...", "level": 1|2|3, "kind": "front"|"part"|"chapter"|"section", "virtual": false}
  - idx: başlığın _editor.md içindeki paragraf numarası (metin "\\n\\n" ile bölünür)
  - virtual=False: o paragraf başlığın kendisidir (metinden çıkarılır)
  - virtual=True: başlık metinde yok, idx'teki paragrafın ÖNÜNE eklenir
  - Liste sırası kitaptaki sıradır: kullanıcı bölümleri sürükleyip yer değiştirebilir,
    her bölüm kendi metin aralığını (başlığından bir sonraki başlığa kadar) yanında taşır.
Eski yapi.json'larda (yalnız chapter_paragraph_indices/chapter_titles) toc yoksa
başlıklardan sınıflandırılarak üretilir.
"""

import re

FRONT_RE = re.compile(r"^\s*(ön\s*söz|önsöz|giriş|sunuş|takdim|yazarın notu|çevirmenin notu|editörün notu|yayıncının notu|ithaf|prolog|başlarken|okura|"
                      r"teşekkür|son\s*söz|sonsöz|epilog|kaynakça|açıklamalar|notlar|dizin|sözlük|ek\s*[:\d]?|foreword|preface|introduction|prologue|epilogue)\b", re.I)
PART_RE = re.compile(r"(\bkısım\b|\bkitap\b\s*$|^\s*(birinci|ikinci|üçüncü|dördüncü|beşinci|altıncı|yedinci|sekizinci|dokuzuncu|onuncu)\s+kitap|\bcilt\b|^\s*part\b)", re.I)
SECTION_RE = re.compile(r"^\s*\d+\.\d+")
SCENE_RE = re.compile(r"^\s*(?:(?:\*\s*){3,}|⁂|(?:[-–—]\s*){3,}|(?:•\s*){3,}|(?:·\s*){3,}|#|§)\s*$")
ROMAN_RE = re.compile(r"^\s*[IVXLCDM]+\.?\s*$")
NUM_RE = re.compile(r"^\s*\d{1,3}\.?\s*$")
LEVEL_KIND = {1: "part", 2: "chapter", 3: "section"}


def classify(title: str):
    """Başlık metninden tür ve seviye: (kind, level)."""
    t = (title or "").strip()
    if FRONT_RE.search(t):
        return "front", 2
    if PART_RE.search(t):
        return "part", 1
    if SECTION_RE.search(t):
        return "section", 3
    return "chapter", 2


def is_scene_break(text: str) -> bool:
    return bool(SCENE_RE.match(text or ""))


def toc_from_structure(structure: dict) -> list:
    toc = structure.get("toc")
    if isinstance(toc, list) and toc:
        out = []
        for it in toc:
            if not isinstance(it, dict) or "idx" not in it:
                continue
            lvl = int(it.get("level") or 2)
            kind = it.get("kind") or LEVEL_KIND.get(lvl, "chapter")
            out.append({"idx": int(it["idx"]), "title": str(it.get("title") or "").strip(), "level": max(1, min(3, lvl)), "kind": kind, "virtual": bool(it.get("virtual"))})
        return out
    idxs = structure.get("chapter_paragraph_indices") or []
    titles = structure.get("chapter_titles") or []
    out = []
    for k, idx in enumerate(idxs):
        title = titles[k] if k < len(titles) else f"Bölüm {k + 1}"
        kind, lvl = classify(title)
        out.append({"idx": int(idx), "title": title, "level": lvl, "kind": kind, "virtual": False})
    return out


def sections(toc: list, paragraphs: list) -> tuple:
    """(açılış_paragrafları, [(toc_öğesi, paragraflar), ...]) — liste sırasında.
    Her başlığın metni: başlıktan (gerçek başlıkta bir sonraki paragraftan) metindeki bir sonraki başlığa kadar."""
    n = len(paragraphs)
    marks = sorted({it["idx"] for it in toc})
    nxt = {m: (marks[i + 1] if i + 1 < len(marks) else n) for i, m in enumerate(marks)}
    opening = paragraphs[: marks[0]] if marks else paragraphs
    out = []
    for it in toc:
        start = it["idx"] if it.get("virtual") else it["idx"] + 1
        out.append((it, paragraphs[start: nxt.get(it["idx"], n)]))
    return opening, out


def label_for(it: dict):
    """Başlığın üstündeki küçük etiket (KISIM / BÖLÜM) ve gösterilecek başlık."""
    t = it["title"].strip()
    if it["kind"] == "part" and not re.search(r"kısım|kitap|cilt|part", t, re.I):
        return "Kısım", t
    if it["kind"] == "chapter" and (ROMAN_RE.match(t) or NUM_RE.match(t)):
        return "Bölüm", t.rstrip(".")
    return "", t


def noise_set(paragraphs, title: str = "", author: str = "") -> set:
    """Taramadan kalan sayfa başlığı/altlığı gürültüsü (e-kitapta gösterilmez):
    - kitap adı / yazar adıyla aynı ya da tamamı büyük harf olan, >=3 kez birebir tekrar eden kısa satırlar
    - sık aralıklarla (medyan < 15 paragraf) gelen yalın sayfa numaraları
    Döndürülen küme paragrafların .strip().casefold() halleridir."""
    from collections import Counter
    keys = [p.strip() for p in paragraphs]
    cnt = Counter(k.casefold() for k in keys if k and len(k) <= 60 and "\n" not in k)
    named = {(title or "").strip().casefold(), (author or "").strip().casefold()} - {""}
    noise = set()
    for k in set(keys):
        ck = k.casefold()
        if cnt.get(ck, 0) >= 3 and not is_scene_break(k) and not re.search(r"[.!?…:;,]$", k):
            if ck in named or (re.search(r"[^\W\d_]", k) and k == k.upper()):
                noise.add(ck)
    nums = [i for i, k in enumerate(keys) if re.fullmatch(r"\d{1,4}", k)]
    if len(nums) >= 6:
        gaps = sorted(b - a for a, b in zip(nums, nums[1:]))
        if gaps[len(gaps) // 2] < 15:
            noise |= {keys[i] for i in nums}
    return noise
