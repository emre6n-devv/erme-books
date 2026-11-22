# -*- coding: utf-8 -*-
"""
degerlendir.py - OCR hattının her adımını kitabın EPUB'ına karşı ölçer.

NEDEN: Bir kural bir kitapta işe yarayıp başka yerde metni bozabiliyor. Her
değişikliği sayıyla görmek için çıktıları "doğru metin" (aynı kitabın EPUB'ı)
ile kelime kelime karşılaştırır.

NE YAPAR:
  1. EPUB'ın metnini çıkarır, test PDF'inin hangi bölümüne denk geldiğini
     kendisi bulur (test_50 dosyaları kitabın ortasından olabilir).
  2. Her aşamanın çıktısını (tek model, ikinci model, ensemble, editör) EPUB'a
     hizalar: kelime hata oranı (WER) ve karakter hata oranı (CER).
  3. Ardışık aşamaları karşılaştırır: o adım kaç kelimeyi DÜZELTTİ, kaç
     kelimeyi BOZDU, örnekleriyle.

KULLANIM:
    py degerlendir.py --book Kafamda_test_50
    py degerlendir.py --book Kafamda_test_50 --epub "epubs/Kafamda Bir Tuhaflik - Orhan Pamuk.epub"
    py degerlendir.py --book X --files output/X/X_tek_model.md output/X/X_editor.md

Rapor: output/<kitap>/<kitap>_degerlendirme.txt
"""

import argparse
import difflib
import html
import json
import re
import sys
import unicodedata
import zipfile
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TR_LETTERS = "A-Za-zÇĞİıÖŞÜçğıöşüÂâÎîÛû"
WORD_RE = re.compile(rf"[{TR_LETTERS}0-9]+(?:'[{TR_LETTERS}]+)*")
ANCHOR_N = 6          # bölüm bulmak için kullanılan kelime dizisi uzunluğu
MAX_EXAMPLES = 60     # rapordaki örnek sayısı (her liste için)


# ---------------------------------------------------------------- metin --

def trlow(s: str) -> str:
    return s.replace("I", "ı").replace("İ", "i").lower()


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFC", text)
    text = text.replace("’", "'").replace("‘", "'").replace("`", "'").replace("­", "")
    text = re.sub(r"^=== SAYFA \d+ ===$", "", text, flags=re.M)   # model_dene.py ayırıcıları
    text = re.sub(r"^#+\s*", "", text, flags=re.M)        # markdown başlıkları
    text = text.replace("*", "").replace("_", " ")
    return text


def words(text: str):
    return WORD_RE.findall(normalize(text))


class _TextExtractor(HTMLParser):
    BLOCK = {"p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr"}

    def __init__(self):
        super().__init__()
        self.parts, self._skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "head"):
            self._skip += 1
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "head") and self._skip:
            self._skip -= 1
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def epub_text(path: Path) -> str:
    """EPUB'ın metnini okuma sırasıyla (content.opf spine) çıkarır."""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        opf_name = next((n for n in names if n.endswith(".opf")), None)
        order = []
        if opf_name:
            opf = z.read(opf_name).decode("utf-8", "ignore")
            base = opf_name.rsplit("/", 1)[0] + "/" if "/" in opf_name else ""
            items = dict(re.findall(r'<item[^>]*?id="([^"]+)"[^>]*?href="([^"]+)"', opf))
            items.update({k: v for v, k in re.findall(r'<item[^>]*?href="([^"]+)"[^>]*?id="([^"]+)"', opf)})
            for idref in re.findall(r'<itemref[^>]*?idref="([^"]+)"', opf):
                if idref in items:
                    order.append(base + html.unescape(items[idref]))
        if not order:
            order = sorted(n for n in names if n.endswith((".html", ".xhtml", ".htm")))
        out = []
        for n in order:
            if n not in names:
                continue
            p = _TextExtractor()
            p.feed(z.read(n).decode("utf-8", "ignore"))
            out.append("".join(p.parts))
    return "\n".join(out)


def load_hypothesis(path: Path) -> str:
    """.md ya da ocr.py/ensemble.py'nin sayfa json'ı (sayfalar sıralı birleştirilir)."""
    if path.suffix.lower() == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        pages = data.get("pages", data)
        return "\n\n".join(pages[k] for k in sorted(pages, key=int))
    return path.read_text(encoding="utf-8")


# ------------------------------------------------------------ hizalama --

def locate_span(ref_words, hyp_words):
    """Hipotezin EPUB'da başladığı ve bittiği kelime indekslerini bulur."""
    ref_l = [trlow(w) for w in ref_words]
    hyp_l = [trlow(w) for w in hyp_words]
    index = {}
    for i in range(len(ref_l) - ANCHOR_N + 1):
        index.setdefault(tuple(ref_l[i:i + ANCHOR_N]), []).append(i)

    def find(positions):
        votes = {}
        for k in positions:
            hits = index.get(tuple(hyp_l[k:k + ANCHOR_N]), [])
            if len(hits) == 1:
                votes.setdefault(hits[0] - k, 0)
                votes[hits[0] - k] += 1
        return max(votes, key=votes.get) if votes else None

    n = len(hyp_l)
    start = find(range(0, min(400, n - ANCHOR_N)))
    end_off = find(range(max(0, n - 400 - ANCHOR_N), n - ANCHOR_N))
    if start is None or end_off is None:
        return None
    return max(0, start), min(len(ref_words), end_off + n)


def levenshtein(a: str, b: str) -> int:
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def align(ref, hyp, casefold=False):
    """Hizalama sonucu: hata sayıları + her referans kelimesinin doğru okunup okunmadığı."""
    r = [trlow(w) for w in ref] if casefold else ref
    h = [trlow(w) for w in hyp] if casefold else hyp
    ops = difflib.SequenceMatcher(None, r, h, autojunk=False).get_opcodes()
    # baştaki/sondaki fazlalıklar (bölüm sınırı farkı) hata sayılmaz
    while ops and ops[0][0] in ("delete", "insert"):
        ops.pop(0)
    while ops and ops[-1][0] in ("delete", "insert"):
        ops.pop()
    correct = {}
    sub = ins = dele = 0
    char_err = 0
    pairs = []          # (ref_idx, ref_kelime, hyp_kelime) - yanlış okunanlar
    r_lo = ops[0][1] if ops else 0
    r_hi = ops[-1][2] if ops else 0
    for tag, i1, i2, j1, j2 in ops:
        if tag == "equal":
            for i in range(i1, i2):
                correct[i] = True
            continue
        a, b = " ".join(ref[i1:i2]), " ".join(hyp[j1:j2])
        char_err += levenshtein(a, b) if len(a) * len(b) < 4_000_000 else max(len(a), len(b))
        for i in range(i1, i2):
            correct[i] = False
        if tag == "replace":
            s = min(i2 - i1, j2 - j1)
            sub += s
            dele += max(0, (i2 - i1) - (j2 - j1))
            ins += max(0, (j2 - j1) - (i2 - i1))
            pairs.append((i1, a, b))
        elif tag == "delete":
            dele += i2 - i1
            pairs.append((i1, a, ""))
        else:
            ins += j2 - j1
            pairs.append((i1, "", b))
    n_ref = max(1, r_hi - r_lo)
    n_chars = max(1, len(" ".join(ref[r_lo:r_hi])))
    return {
        "wer": (sub + ins + dele) / n_ref, "cer": char_err / n_chars,
        "sub": sub, "ins": ins, "del": dele, "n": n_ref,
        "correct": correct, "pairs": pairs, "range": (r_lo, r_hi),
    }


def ctx(ref, i, w=5):
    return " ".join(ref[max(0, i - w):i]) + " ⟦" + ref[i] + "⟧ " + " ".join(ref[i + 1:i + 1 + w])


# ---------------------------------------------------------------- ana --

def _ad(s: str) -> str:
    """Ad karşılaştırması için: küçük harf, Türkçe harfler ve şapkalar sadeleşir
    ("Gurur ve Önyargı" == "Gurur_ve_Onyargi")."""
    s = unicodedata.normalize("NFKD", trlow(s).replace("ı", "i"))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[\s_\-]+", " ", s).strip()


def find_epub(stem: str):
    """Kitabın doğru metni olacak EPUB'ı adına göre bulur: önce epubs/ornekler/
    (karşılaştırma için konan örnek EPUB'lar), sonra epubs/ (eski düzen).
    build_epub.py'nin bu kitap için ÜRETTİĞİ EPUB (epubs/<kitap>.epub) hariç tutulur:
    yoksa araç bizim kendi çıktımızı "doğru metin" sanıp %0 hata gösterirdi."""
    key = _ad(re.split(r"_test|_\d+$", stem)[0])
    for d in (ROOT / "epubs" / "ornekler", ROOT / "epubs"):
        for p in sorted(d.glob("*.epub")):
            if _ad(p.stem) == _ad(stem):
                continue
            if _ad(p.stem).startswith(key) or key in _ad(p.stem):
                return p
    return None


def default_stages(book_dir: Path, stem: str):
    cand = [
        ("tek model (OCR)", f"{stem}_tek_model.md"),
        ("ikinci model", None),                       # _sayfalar_<model>.json
        ("ensemble", f"{stem}.md"),
        ("editör (son hal)", f"{stem}_editor.md"),
    ]
    out = []
    for label, name in cand:
        if name is None:
            for p in sorted(book_dir.glob(f"{stem}_sayfalar_*.json")):
                out.append((f"ikinci model ({p.stem.split('_sayfalar_')[1]})", p))
            continue
        p = book_dir / name
        if p.exists():
            out.append((label, p))
    # tek model yedeği yoksa (ensemble hiç çalışmadıysa) .md tek modeldir
    if not any(l.startswith("tek model (") for l, _ in out) and (book_dir / f"{stem}.md").exists():
        out = [(l if l != "ensemble" else "tek model (OCR)", p) for l, p in out]
    return out


def main():
    ap = argparse.ArgumentParser(description="OCR çıktısını EPUB'a karşı ölçer")
    ap.add_argument("--book", required=True, help="output/ altındaki kitap klasörü adı (ör. Kafamda_test_50)")
    ap.add_argument("--epub", help="Doğru metin EPUB'ı (verilmezse epubs/ içinde adına göre aranır)")
    ap.add_argument("--files", nargs="*", help="Sırayla karşılaştırılacak dosyalar (verilmezse aşamalar otomatik bulunur)")
    ap.add_argument("--find-only", action="store_true", help="Sadece doğru metin EPUB'ını bul ve JSON yazdır (uygulama için)")
    args = ap.parse_args()

    stem = args.book
    if args.find_only:
        p = Path(args.epub) if args.epub else find_epub(stem)
        print(json.dumps({"epub": str(p) if p and p.exists() else None}, ensure_ascii=False))
        return
    book_dir = ROOT / "output" / stem
    epub = Path(args.epub) if args.epub else find_epub(stem)
    if not epub or not epub.exists():
        print(f"HATA: {stem} için EPUB bulunamadı. --epub ile yolunu ver.")
        sys.exit(1)

    stages = [(Path(f).name, Path(f)) for f in args.files] if args.files else default_stages(book_dir, stem)
    if not stages:
        print(f"HATA: {book_dir} içinde ölçülecek çıktı yok.")
        sys.exit(1)

    print(f"EPUB okunuyor: {epub.name}")
    ref_all = words(epub_text(epub))

    first_hyp = words(load_hypothesis(stages[0][1]))
    span = locate_span(ref_all, first_hyp)
    if not span:
        print("HATA: OCR metninin EPUB'daki yeri bulunamadı (farklı baskı/çeviri olabilir).")
        sys.exit(1)
    margin = 40
    ref = ref_all[max(0, span[0] - margin): span[1] + margin]
    print(f"Bölüm bulundu: EPUB'ın {span[0]}-{span[1]}. kelimeleri ({span[1] - span[0]} kelime)\n")

    results = []
    for label, path in stages:
        hyp = words(load_hypothesis(path))
        print(f"  ölçülüyor: {label} ...", flush=True)
        res = align(ref, hyp)
        res_ci = align(ref, hyp, casefold=True)
        results.append((label, path, res, res_ci))

    lines = [f"DEĞERLENDİRME: {stem}", f"Doğru metin: {epub.name} (kelime {span[0]}-{span[1]})", "=" * 72, ""]
    lines.append(f"{'aşama':28} {'WER':>7} {'CER':>7} {'yanlış':>7} {'eksik':>6} {'fazla':>6}  {'WER(harf büyüklüğü hariç)':>10}")
    for label, path, r, rc in results:
        lines.append(f"{label:28} {r['wer']*100:6.2f}% {r['cer']*100:6.2f}% {r['sub']:7d} {r['del']:6d} {r['ins']:6d}  {rc['wer']*100:6.2f}%")
    lines += ["", "WER: kelime hata oranı, CER: karakter hata oranı (ikisi de düşük = iyi).", ""]

    # Aşama -> aşama: ne düzeldi, ne bozuldu
    def wrong_reading(res, i):
        for i1, a, b in res["pairs"]:
            if i1 <= i < i1 + max(1, len(a.split())):
                return b or "(yok)"
        return "?"

    chain = [x for x in results if not x[0].startswith("ikinci model")]
    for (la, _, ra, _), (lb, _, rb, _) in zip(chain, chain[1:]):
        lo = max(ra["range"][0], rb["range"][0])
        hi = min(ra["range"][1], rb["range"][1])
        fixed = [i for i in range(lo, hi) if ra["correct"].get(i) is False and rb["correct"].get(i)]
        broke = [i for i in range(lo, hi) if ra["correct"].get(i) and rb["correct"].get(i) is False]
        lines += ["=" * 72, f"{la}  ->  {lb}:  {len(fixed)} kelime DÜZELDİ, {len(broke)} kelime BOZULDU "
                  f"(net {len(fixed) - len(broke):+d})", "=" * 72]
        lines.append(f"\nBOZULANLAR (doğruydu, bu adımda yanlış oldu) - ilk {MAX_EXAMPLES}:")
        for i in broke[:MAX_EXAMPLES]:
            lines.append(f"  {ctx(ref, i)}   ->  {wrong_reading(rb, i)}")
        lines.append(f"\nDÜZELENLER - ilk {MAX_EXAMPLES}:")
        for i in fixed[:MAX_EXAMPLES]:
            lines.append(f"  {wrong_reading(ra, i)}  ->  {ref[i]}      ({ctx(ref, i, 3)})")
        lines.append("")

    # Son aşamada kalan hatalar
    label, _, r, _ = results[-1]
    lines += ["=" * 72, f"SON AŞAMADA ({label}) KALAN HATALAR - ilk {MAX_EXAMPLES * 2}", "=" * 72]
    for i1, a, b in r["pairs"][:MAX_EXAMPLES * 2]:
        lines.append(f"  doğrusu: {a or '(yok)':30}  okunan: {b or '(yok)'}")

    out = book_dir / f"{stem}_degerlendirme.txt"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print()
    print("\n".join(lines[:4 + len(results) + 1]))
    print(f"\nAyrıntılı rapor: {out}")


if __name__ == "__main__":
    main()
