# -*- coding: utf-8 -*-
"""
detect_structure.py - _editor.md dosyasındaki bölüm/kısım başlıklarını ve
kitap başlığı/yazar bilgisini tespit eder.

BAŞLIK/YAZAR TESPİTİ (v3):
  Kitabın kendi metninden (ilk ~4000 karakter) hem AI ile hem de basit bir
  kod-tabanlı ipucuyla (metnin en baştaki izole/büyük-harfli satırı, genelde
  başlık ya da ilk bölüm adı olur) aday çıkarılır. AI'nın cevabı METİNDE
  GERÇEKTEN GEÇMİYORSA (halüsinasyon) reddedilir - Hamnet testinde "Kara
  Kitap/Orhan Pamuk" gibi tamamen uydurma bir cevap üretmişti, bu artık
  mümkün değil.
  SONRA: tespit edilen aday terminalde gösterilir, TEK SATIRLIK bir onay
  istenir (Enter = kabul et, bir şey yaz = üzerine yaz). Bu, çok-öyküllü
  derlemelerde (örn. bu betiğin "Saygınlık Çağı" başlığını kitabın TAMAMI
  sanıp yanlış anlaması gibi durumlarda) tamamen otomasyona güvenmek yerine
  ucuz bir son kontrol sağlıyor - --title/--author CLI'dan verilirse ya da
  --no-confirm ile bu adım tamamen atlanabilir (script'i otomatikleştirmek
  istersen).

Kullanım:
    python detect_structure.py --input output/kadin/kadin_editor.md --book kadin
    python detect_structure.py --input ... --book ... --title "..." --author "..."   (AI'yı atla)
    python detect_structure.py --input ... --book ... --no-confirm                    (onay isteme, AI'ya güven)
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

import requests

from erme_structure import FRONT_RE, NUM_RE, PART_RE, ROMAN_RE, SECTION_RE, classify, is_scene_break

OLLAMA_URL = "http://localhost:11434/api/chat"
TEXT_MODEL = os.environ.get("KITAP_TEXT_MODEL", "qwen2.5:14b-instruct")   # boş = kural tabanlı tespit (dil modeli yok)
NUM_CTX = 8192
REQUEST_TIMEOUT = 300
THINK = False
NUM_PREDICT = 800

BATCH_SIZE = 25
SAMPLE_CHARS = 4000

QUOTE_CHARS = '"\u201c\u201d\u2018\u2019\''

HEADING_PROMPT = """Aşağıda bir kitaptan alınmış, BAŞLIK OLMA İHTİMALİ olan satırların numaralı bir listesi var. Her satırın öncesinde/sonrasında geçen kısa bağlam da verildi.

Görevin: Her satırın GERÇEKTEN bir bölüm/kısım/hikaye başlığı mı yoksa metnin normal bir parçası (isim, tek kelimelik cümle, söz öbeği) mı olduğuna karar vermek.

Bölüm başlığı örnekleri: "I", "II", "Birinci Bölüm", "3. Bölüm", "Birinci Gece", "GİRİŞ", "Yazarın Notu", kitaptaki bir hikayenin/bölümün adı.
Başlık OLMAYAN örnekler: bir kişi adı, tek başına kalmış bir söz öbeği, bir yer/nesne adı.

Liste:
{items}

Cevabını MUTLAKA en son satırda, başka hiçbir şey olmadan tam olarak şu formatta ver - sadece başlık olan satır numaralarının JSON listesi:
CEVAP: [1, 4, 7]

Hiçbiri başlık değilse: CEVAP: []
Bu formatın dışında CEVAP: kelimesini başka hiçbir yerde kullanma. Açıklama, yorum, gerekçe YAZMA - sadece format.
"""

TITLE_AUTHOR_PROMPT = """Aşağıda bir kitabın OCR ile taranmış ilk kısmı var. Bu kitabın BAŞLIĞINI ve YAZARININ adını bul.

ÖNEMLİ: Bu bir ÖYKÜ DERLEMESİ/KOLEKSİYON olabilir - eğer metnin en başındaki büyük/izole yazılmış satır aslında kitaptaki İLK ÖYKÜNÜN adıysa (kitabın kendisinin değil), bunu ayırt etmeye çalış. Kitabın asıl adı, künye sayfası, iç kapak, ithaf gibi başka bir yerde geçiyor olabilir. Emin değilsen, en azından bulduğun en olası adayı ver ama YALNIZCA METİNDE GEÇEN bilgiyi kullan, uydurma.

--- METİN BAŞLANGICI ---
{sample}
--- METİN SONU ---

Cevabını MUTLAKA en son satırda, başka hiçbir şey olmadan tam olarak şu formatta ver:
CEVAP: {{"title": "...", "author": "...", "note": "kısa not: bu bir derleme mi, emin misin vb (opsiyonel, boş bırakabilirsin)"}}

Emin değilsen ilgili alanı boş bırak: {{"title": "", "author": "", "note": ""}}
Bu formatın dışında CEVAP: kelimesini başka hiçbir yerde kullanma. Açıklama, yorum YAZMA - sadece format.
"""


def call_ollama(prompt: str) -> str:
    payload = {
        "model": TEXT_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "think": THINK,
        "options": {"num_ctx": NUM_CTX, "temperature": 0.0, "num_predict": NUM_PREDICT},
    }
    resp = requests.post(OLLAMA_URL, json=payload, timeout=REQUEST_TIMEOUT)
    if not resp.ok:
        raise requests.exceptions.RequestException(f"HTTP {resp.status_code} - {resp.text}")
    data = resp.json()
    message = data["message"]
    content = message.get("content", "") or ""
    thinking = message.get("thinking", "") or ""
    combined = content if "CEVAP:" in content.upper() else (thinking or content)
    matches = re.findall(r"CEVAP\s*:\s*(.+)", combined, re.IGNORECASE | re.DOTALL)
    return matches[-1].strip() if matches else ""


def noise_lines(paragraphs):
    """Sayfa başlığı/altlığı gürültüsü: kısa ve birebir tekrar eden satırlar (kitap adı, yazar adı
    gibi; >=3 kez) ve sık aralıklarla gelen yalın sayfa numaraları. Bunlar başlık sayılmaz."""
    from collections import Counter
    short = [p.strip() for p in paragraphs if p.strip() and len(p.strip()) <= 60 and "\n" not in p.strip()]
    cnt = Counter(t.casefold() for t in short)
    noise = {t for t, c in cnt.items() if c >= 3 and not is_scene_break(t)}
    nums = [i for i, p in enumerate(paragraphs) if re.fullmatch(r"\s*\d{1,4}\s*", p)]
    if len(nums) >= 6:
        gaps = sorted(b - a for a, b in zip(nums, nums[1:]))
        if gaps[len(gaps) // 2] < 15:
            noise |= {paragraphs[i].strip().casefold() for i in nums}
    return noise


def find_heading_candidates(paragraphs):
    candidates = []
    noise = noise_lines(paragraphs)
    for i, para in enumerate(paragraphs):
        text = para.strip()
        if text.casefold() in noise or is_scene_break(text):
            continue
        if not text or "\n" in text:
            continue
        if len(text) > 60 or len(text) < 1:
            continue
        if text[-1] in ".,;:":
            continue
        if text[0] in QUOTE_CHARS or text[-1] in QUOTE_CHARS:
            continue
        prev_ctx = paragraphs[i - 1].strip()[-60:] if i > 0 else ""
        next_ctx = paragraphs[i + 1].strip()[:60] if i + 1 < len(paragraphs) else ""
        candidates.append({"index": i, "text": text, "prev": prev_ctx, "next": next_ctx})
    return candidates


HEADING_WORD_RE = re.compile(r"^\s*((\d{1,3}|[IVXLCDM]+)\.?\s+)?(bölüm|kısım|kitap|perde|sahne)(\s+(\d{1,3}|[IVXLCDM]+))?\s*$"
                             r"|^\s*(birinci|ikinci|üçüncü|dördüncü|beşinci|altıncı|yedinci|sekizinci|dokuzuncu|onuncu)\s+\w+\s*$", re.I)


def rule_headings(candidates):
    """Dil modeli kapalıyken (kural tabanlı mod) yalnız biçimi kesin başlık olan satırları kabul eder:
    Önsöz/Giriş/Sonsöz gibi ön bölümler, Kısım/Kitap, 'Birinci Bölüm', 'Bölüm 3', 'I', 'IV.', '2.1 ...'.
    Tek başına sayılar ancak art arda en az 3 tane varsa (1, 2, 3...) bölüm numarası sayılır."""
    nums = [c for c in candidates if NUM_RE.match(c["text"])]
    seq_ok = len(nums) >= 3 and [int(re.sub(r"\D", "", c["text"])) for c in nums[:3]] == [1, 2, 3]
    out = []
    for c in candidates:
        t = c["text"]
        if FRONT_RE.search(t) or PART_RE.search(t) or SECTION_RE.search(t) or ROMAN_RE.match(t) or HEADING_WORD_RE.match(t):
            out.append(c)
        elif seq_ok and NUM_RE.match(t):
            out.append(c)
    return out


def classify_candidates(candidates, verbose=False):
    if not TEXT_MODEL:
        print("  Kural tabanlı mod: dil modeli kapalı, yalnız biçimi kesin başlıklar alınıyor.")
        return rule_headings(candidates)
    confirmed = []
    for start in range(0, len(candidates), BATCH_SIZE):
        batch = candidates[start:start + BATCH_SIZE]
        items_str = "\n".join(
            f'{j+1}. "{c["text"]}"  (önce: ...{c["prev"]!r}, sonra: {c["next"]!r}...)'
            for j, c in enumerate(batch)
        )
        prompt = HEADING_PROMPT.format(items=items_str)
        try:
            answer = call_ollama(prompt)
        except requests.exceptions.RequestException as e:
            print(f"  [HATA] Batch {start}: {e}")
            continue

        if verbose:
            print(f"  [batch {start}-{start+len(batch)}] ham cevap: {answer[:200]}")

        try:
            indices = json.loads(answer)
            assert isinstance(indices, list)
        except (json.JSONDecodeError, AssertionError):
            print(f"  [UYARI] Batch {start}: cevap ayrıştırılamadı, bu grup atlandı.")
            continue

        for idx in indices:
            if isinstance(idx, int) and 1 <= idx <= len(batch):
                confirmed.append(batch[idx - 1])
    return confirmed


def is_grounded(value: str, sample: str) -> bool:
    if not value.strip():
        return False
    sample_lower = sample.lower()
    words = [w for w in re.findall(r"[^\W\d_]+", value, re.UNICODE) if len(w) >= 3]
    if not words:
        return True
    return any(w.lower() in sample_lower for w in words)


def first_line_heuristic(text: str) -> str:
    """Metnin en baştaki, kısa ve izole (büyük harf ya da başlık-biçimli)
    ilk satırını basit bir aday olarak döner - AI'sız, deterministik.
    Genellikle kitap/ilk bölüm başlığı olur, kullanıcıya referans olarak
    gösterilir."""
    for para in text.split("\n\n")[:5]:
        p = para.strip()
        if p and len(p) < 80 and "\n" not in p and not p.endswith((".", ",", "!", "?")):
            return p
    return ""


def detect_title_author(full_text: str, cli_title: str, cli_author: str, no_confirm: bool):
    if cli_title and cli_author:
        return cli_title, cli_author

    sample = full_text[:SAMPLE_CHARS]
    heuristic_candidate = first_line_heuristic(full_text)

    ai_title, ai_author, ai_note = "", "", ""
    prompt = TITLE_AUTHOR_PROMPT.format(sample=sample)
    try:
        if not TEXT_MODEL:
            print("  Kural tabanlı mod: başlık için ilk satır ipucu kullanılıyor; yazarı 3. adımda elle girebilirsin.")
            raise LookupError
        answer = call_ollama(prompt)
        data = json.loads(answer)
        raw_title = data.get("title", "").strip()
        raw_author = data.get("author", "").strip()
        ai_note = data.get("note", "").strip()
        if is_grounded(raw_title, sample):
            ai_title = raw_title
        elif raw_title:
            print(f"  [UYARI] Model '{raw_title}' başlığını önerdi ama metinde bu kelimeler geçmiyor - reddedildi.")
        if is_grounded(raw_author, sample):
            ai_author = raw_author
        elif raw_author:
            print(f"  [UYARI] Model '{raw_author}' yazarını önerdi ama metinde bu kelimeler geçmiyor - reddedildi.")
    except LookupError:
        pass
    except Exception as e:
        print(f"  [UYARI] Başlık/yazar tespiti başarısız ({e}).")

    title = cli_title or ai_title or heuristic_candidate
    author = cli_author or ai_author

    if no_confirm:
        return title, author

    print("\n--- Başlık/Yazar tespiti (kontrol et) ---")
    print(f"  İlk satır ipucu (AI'sız): {heuristic_candidate!r}")
    if ai_note:
        print(f"  Model notu: {ai_note}")
    print(f"  Önerilen başlık: {title!r}")
    print(f"  Önerilen yazar:  {author!r}")
    print("  (Bu bir derleme/koleksiyonsa yukarıdaki başlık sadece İLK ÖYKÜNÜN adı olabilir - dikkat et.)")

    if not cli_title:
        new_title = input(f"  Başlık doğru mu? [Enter=evet / yeni başlık yaz]: ").strip()
        if new_title:
            title = new_title
    if not cli_author:
        new_author = input(f"  Yazar doğru mu? [Enter=evet / yeni yazar yaz]: ").strip()
        if new_author:
            author = new_author

    return title, author


def main():
    parser = argparse.ArgumentParser(description="EPUB için bölüm yapısı ve başlık/yazar tespiti")
    parser.add_argument("--input", type=str, required=True, help="*_editor.md dosyası")
    parser.add_argument("--book", type=str, required=True)
    parser.add_argument("--title", type=str, default="")
    parser.add_argument("--author", type=str, default="")
    parser.add_argument("--no-confirm", action="store_true", help="Onay istemeden AI tahminine güven (otomasyon için)")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Dosya bulunamadı: {input_path}")
        sys.exit(1)

    text = input_path.read_text(encoding="utf-8")
    paragraphs = text.split("\n\n")

    print("Başlık adayları taranıyor...")
    candidates = find_heading_candidates(paragraphs)
    print(f"{len(candidates)} aday bulundu, LLM ile doğrulanıyor...")
    confirmed = classify_candidates(candidates, verbose=args.verbose)
    print(f"{len(confirmed)} gerçek bölüm başlığı onaylandı.")
    for c in confirmed:
        print(f"  [{c['index']}] \"{c['text']}\"")

    print("\nKitap başlığı/yazar tespit ediliyor...")
    title, author = detect_title_author(text, args.title, args.author, args.no_confirm)
    print(f"\n  Kullanılacak başlık: {title or '(boş)'}")
    print(f"  Kullanılacak yazar: {author or '(boş)'}")

    structure = {
        "title": title,
        "author": author,
        "chapter_paragraph_indices": [c["index"] for c in confirmed],
        "chapter_titles": [c["text"] for c in confirmed],
        "total_paragraphs": len(paragraphs),
    }
    # bölüm ağacı: ön bölüm / kısım / bölüm / alt bölüm (adım 3'te düzenlenir)
    toc = []
    for c in confirmed:
        kind, level = classify(c["text"])
        toc.append({"idx": c["index"], "title": c["text"], "level": level, "kind": kind, "virtual": False})
    structure["toc"] = toc

    out_path = input_path.parent / f"{args.book}_yapi.json"
    if out_path.exists():
        try:  # kullanıcının seçtiği dizgi şablonu korunur
            old = json.loads(out_path.read_text(encoding="utf-8"))
            if old.get("template"):
                structure["template"] = old["template"]
        except (OSError, ValueError):
            pass
    out_path.write_text(json.dumps(structure, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nYapı dosyası kaydedildi: {out_path}")
    print("Bölüm listesini kontrol et - yanlış/eksik varsa JSON dosyasını elle düzenleyebilirsin,")
    print("build_epub.py bu dosyayı okuyacak.")


if __name__ == "__main__":
    main()