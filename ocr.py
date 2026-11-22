# -*- coding: utf-8 -*-
"""
kitap_ocr - Yerel Ollama ile PDF -> Markdown OCR/düzeltme aracı.

İKİ AŞAMALI ÇALIŞIR:
  Aşama 1 (vision): Her sayfa görüntüye çevrilip VISION_MODEL ile SADE bir
    prompt'la OCR'lanır (sadece metin çıkarma, düzeltme yok).
  Aşama 2 (text):   Çıkan ham metin, config.APPLY_TEXT_CORRECTION True ise
    TEXT_MODEL ile detaylı Türkçe kurallarına göre düzeltilir.

OTOMATİK ÜSTBİLGİ TESPİTİ:
  Her kitabın ilk ~20 sayfası taranırken, sayfaların başında/sonunda tekrar
  eden metinler (kitap adı, yazar adı gibi) otomatik tespit edilir - elle
  config.KNOWN_HEADERS doldurmana gerek YOK. config.KNOWN_HEADERS hâlâ
  destekleniyor, ekstra/manuel eklemeler için kullanılabilir (otomatik
  tespitle birleştirilir). --no-auto-headers ile bu özellik kapatılabilir.

Kullanım:
    python ocr.py                          # input/ klasöründeki tüm PDF'leri işler
    python ocr.py --file "kitap.pdf"       # sadece belirtilen dosyayı işler
    python ocr.py --max-pages 3            # test için ilk N sayfa
    python ocr.py --start-page 10          # belirli bir sayfadan devam et
    python ocr.py --no-auto-headers        # otomatik üstbilgi tespitini kapat
"""

import argparse
import base64
import json
import re
import sys
import time
from collections import Counter
from pathlib import Path

import pymupdf as fitz
import requests

import config


def page_to_base64(page, dpi: int) -> str:
    pix = page.get_pixmap(dpi=dpi)
    return base64.b64encode(pix.tobytes("png")).decode("utf-8")


def call_ollama(model: str, prompt: str, images=None, num_predict=None, extra_options=None):
    """(içerik, done_reason) döner. done_reason 'length' ise çıktı num_predict
    sınırına takılıp yarıda kesilmiş demektir (doğal bitiş değil)."""
    options = {
        "num_ctx": config.NUM_CTX,
        "temperature": 0.0,       # tam determinizm: rastgele/halüsinasyon çıktı riskini en aza indirir
    }
    if extra_options:
        options.update(extra_options)
    if num_predict is not None:
        options["num_predict"] = num_predict  # çıktı token sınırı: sonsuz döngüyü teknik olarak keser

    message = {"role": "user", "content": prompt}
    if images:
        message["images"] = images

    payload = {
        "model": model,
        "messages": [message],
        "stream": False,
        "think": False,
        "options": options,
    }

    resp = requests.post(config.OLLAMA_URL, json=payload, timeout=config.REQUEST_TIMEOUT)
    if not resp.ok:
        raise requests.exceptions.RequestException(
            f"HTTP {resp.status_code} - Ollama yanıtı: {resp.text}"
        )
    data = resp.json()
    return data["message"]["content"], data.get("done_reason", "stop")


def dehyphenate(text: str) -> str:
    """Tire (-) veya görünmez 'yumuşak tire' (\u00ad) ile bölünmüş kelimeleri
    birleştirir. İki durumu da kapsar:
    1) Satır SONUNDA biten tire + bir sonraki satırın küçük harfle başlaması
       (orijinal kod satır kırılması taklidi).
    2) Düz metin AKIŞI içinde (satır atlamadan) "tire + boşluk/yeni satır +
       küçük harf" kalıbı - vision modelinin bazen satır atlamadan, orijinal
       kitaptaki tireyi olduğu gibi metne kopyalaması durumu.
    Tamamen kod tabanlı, AI kullanmaz, bu yüzden halüsinasyon riski yoktur.
    """
    lines = text.split("\n")
    n = len(lines)
    i = 0
    while i < n - 1:
        stripped = lines[i].rstrip()
        is_soft = stripped.endswith("\u00ad")
        is_hard = (not is_soft) and stripped.endswith("-") and len(stripped) >= 2 and stripped[-2].isalpha()

        if is_soft or is_hard:
            next_content = lines[i + 1].lstrip()
            if next_content and next_content[0].islower():
                base = stripped[:-1]
                lines[i + 1] = base + next_content
                del lines[i]
                n -= 1
                continue
        i += 1

    text = "\n".join(lines)

    text = re.sub(r"([a-zçğıöşü])-\s+([a-zçğıöşü])", r"\1\2", text)
    # NOT: Satır İÇİNDEKİ tireler ("kub-benin") artık burada silinmiyor. Eski
    # kural her tireyi siliyordu ve meşru birleşik kelimeleri bozuyordu
    # (gidiş-geliş -> gidişgeliş, işsiz-güçsüz -> işsizgüçsüz; Kafamda Bir
    # Tuhaflık testinde 85 kez). Bunlar editor.py'de sözlüğe bakılarak ayrılıyor.

    return text


def estimate_num_predict(raw_text: str) -> int:
    """Girdi uzunluğuna göre makul bir üst çıktı sınırı hesaplar."""
    approx_tokens = max(len(raw_text) // 3, 20)
    return min(max(approx_tokens * 4, 500), 6000)


SUSPICIOUS_MARKERS = ["**Sayfa:**", "**Paragraf:**", "---\n\n**"]


def looks_like_runaway(output: str, raw_text: str) -> bool:
    """Çıktının, girdiden anormal derecede uzun ve şablon/tekrar belirtileri
    taşıyıp taşımadığını kontrol eder."""
    if any(marker in output for marker in SUSPICIOUS_MARKERS):
        return True
    if len(raw_text.strip()) > 0 and len(output) > len(raw_text) * 6:
        return True
    return False


# --- Tekrar döngüsü koruması ---
# Kafamda Bir Tuhaflık testinde model 199. sayfada "yataktaki" kelimesini
# 3.035 kez yazdı ve sayfanın geri kalanı kayboldu. Eski kod çıktı sınırına
# takılınca AYNI ayarlarla, iki kat sınırla tekrar deniyordu; sıcaklık 0
# olduğu için model aynı döngüye yeniden giriyordu. Artık döngü tespit
# ediliyor ve sayfa sırasıyla (1) tekrar cezasıyla, (2) ikiye bölünerek
# yeniden okunuyor; o da olmazsa tekrar eden kısım kırpılıp uyarı veriliyor.
REPEAT_MIN_RUN = 8          # aynı kelime/kalıp art arda bu kadar tekrarlanırsa döngü sayılır
ANTI_LOOP_OPTIONS = {"repeat_penalty": 1.18, "repeat_last_n": 256, "temperature": 0.15}
LOOP_PAGES = []             # döngü yaşanan sayfalar (sonda raporlanır)

_REPEAT_RE = re.compile(r"((?:\S+\s+){1,4}?)\1{" + str(REPEAT_MIN_RUN - 1) + r",}")


def find_repetition(text: str):
    """Art arda tekrar eden kelime/kalıp varsa (başlangıç, bitiş) döner."""
    m = _REPEAT_RE.search(text + " ")
    return (m.start(), m.end()) if m else None


def collapse_repetition(text: str) -> str:
    """Son çare: tekrar eden kalıbı tek geçişe indirir."""
    return _REPEAT_RE.sub(lambda m: m.group(1), text + " ").rstrip()


def _is_bad(text: str, done_reason: str) -> bool:
    return done_reason == "length" or find_repetition(text) is not None


# ensemble.py ikinci turda bunları değiştirip aynı okuma mantığını başka modelle kullanır
VISION_MODEL = config.VISION_MODEL
VISION_PROMPT = None    # None = config.VISION_PROMPT; OCR'a özel modeller kendi kısa komutunu ister


def _ocr_image(img_b64: str, num_predict: int, extra_options=None):
    return call_ollama(VISION_MODEL, VISION_PROMPT or config.VISION_PROMPT, images=[img_b64],
                       num_predict=num_predict, extra_options=extra_options)


def _split_y(page) -> float:
    """Sayfayı ikiye bölmek için ortaya yakın, en boş (en beyaz) satırı bulur;
    böylece bir metin satırının ortasından kesilmez."""
    pix = page.get_pixmap(dpi=50, colorspace=fitz.csGRAY)
    w, h, data = pix.width, pix.height, pix.samples
    lo, hi = int(h * 0.4), int(h * 0.6)
    best_y, best = h // 2, -1
    for y in range(lo, hi):
        row = data[y * pix.stride: y * pix.stride + w]
        brightness = sum(row) / max(1, w)
        if brightness > best:
            best, best_y = brightness, y
    return page.rect.y0 + page.rect.height * best_y / h


def _ocr_halves(page) -> str:
    y = _split_y(page)
    r = page.rect
    parts = []
    for clip in (fitz.Rect(r.x0, r.y0, r.x1, y), fitz.Rect(r.x0, y, r.x1, r.y1)):
        pix = page.get_pixmap(dpi=config.DPI, clip=clip)
        img_b64 = base64.b64encode(pix.tobytes("png")).decode("utf-8")
        text, done = _ocr_image(img_b64, 5000, ANTI_LOOP_OPTIONS)
        if _is_bad(text, done):
            text = collapse_repetition(text)
        parts.append(text.strip())
    return "\n".join(p for p in parts if p)


def vision_extract(page) -> str:
    """AŞAMA 1: Sayfayı görüntüye çevirip sade prompt'la ham metni çıkarır.
    Tekrar döngüsüne girerse ya da çıktı sınırına takılırsa sayfayı önce
    tekrar cezasıyla, sonra ikiye bölerek yeniden okur. Model, boş/belirsiz
    sayfalarda kendi prompt'unu geri kopyalarsa boş metin döner."""
    img_b64 = page_to_base64(page, config.DPI)
    page_no = page.number + 1
    text, done_reason = _ocr_image(img_b64, 8000)

    if _is_bad(text, done_reason):
        why = "çıktı sınırına takıldı" if done_reason == "length" else "tekrar döngüsü"
        print(f"    [UYARI] Sayfa {page_no}: {why} - tekrar cezasıyla yeniden okunuyor...")
        LOOP_PAGES.append(page_no)
        text, done_reason = _ocr_image(img_b64, 8000, ANTI_LOOP_OPTIONS)
        if _is_bad(text, done_reason):
            print(f"    [UYARI] Sayfa {page_no}: hâlâ sorunlu - sayfa ikiye bölünüp okunuyor...")
            text = _ocr_halves(page)
            if find_repetition(text):
                print(f"    [UYARI] Sayfa {page_no}: tekrar kırpıldı, bu sayfayı elle kontrol et.")
                text = collapse_repetition(text)
        print(f"    [BİLGİ] Sayfa {page_no} kurtarıldı.")

    if "Sayfadaki tüm metni oku" in text or "üstbilgi/altbilgi gibi dekoratif" in text:
        print("    [UYARI] Model kendi talimatını kopyaladı (muhtemelen boş/belirsiz sayfa) - boş metin kullanıldı.")
        return ""

    return text


def extract_tagged_output(model_output: str, raw_text: str) -> str:
    """Modelin <DUZELTILMIS>...</DUZELTILMIS> etiketleri arasına yazdığı kısmı
    çıkarır. Model bazen (özellikle llama3.1 gibi 'yardımsever' modeller)
    etiketlerin dışına 'Düzenlenmiş metin:', 'Düzenleme notları:' gibi
    istenmeyen başlıklar/açıklamalar ekliyor - bu fonksiyon sadece etiket
    içindekini alıp geri kalanını görmezden gelir. Etiket bulunamazsa
    (model formatı izlemediyse), ham metni güvenlik için geri döner."""
    match = re.search(r"<DUZELTILMIS>(.*?)</DUZELTILMIS>", model_output, re.DOTALL)
    if match:
        return match.group(1).strip()

    open_match = re.search(r"<DUZELTILMIS>(.*)", model_output, re.DOTALL)
    if open_match:
        return open_match.group(1).strip()

    print("    [UYARI] Model <DUZELTILMIS> etiketini kullanmadı - ham metin kullanıldı.")
    return raw_text


def text_correct(raw_text: str) -> str:
    """AŞAMA 2: Ham metni Türkçe kurallarına göre düzeltir. Şüpheli/döngü
    belirtisi görürse ham metne geri döner (güvenlik ağı). Çıktı yarıda
    kesilirse bütçeyi büyütüp bir kez daha dener."""
    if len(raw_text.strip()) < 5:
        return raw_text

    prompt = config.TEXT_PROMPT_TEMPLATE.format(raw_text=raw_text)
    num_predict = estimate_num_predict(raw_text)
    result, done_reason = call_ollama(config.TEXT_MODEL, prompt, num_predict=num_predict)

    if done_reason == "length":
        print(f"    [BİLGİ] Düzeltme çıktısı kesildi ({num_predict} token), {num_predict * 2} ile tekrar deneniyor...")
        result, done_reason = call_ollama(config.TEXT_MODEL, prompt, num_predict=num_predict * 2)

    result = extract_tagged_output(result, raw_text)

    if looks_like_runaway(result, raw_text):
        print("    [UYARI] Düzeltme çıktısı şüpheli (döngü/şablon) - ham metin kullanıldı.")
        return raw_text
    return result


def strip_known_headers(text: str, extra_headers=None) -> str:
    """Kod tabanlı, deterministik temizlik:
    1) config.KNOWN_HEADERS + otomatik tespit edilen (extra_headers) listesiyle
       TAM eşleşen satırları siler (kitap başlığı/yazar adı gibi her sayfada
       tekrarlayan üstbilgiler).
    2) Tek başına, sadece rakamlardan oluşan satırları siler (sayfa numaraları).
    3) Modelin bazen kendiliğinden eklediği markdown kod bloğu işaretlerini
       (```plaintext, ``` gibi) siler.
    Halüsinasyon riski yok - modelin ürettiği metni değil, sadece belirlenen
    kalıpları eşleştirip kaldırıyor."""
    known = {h.strip().lower() for h in config.KNOWN_HEADERS}
    if extra_headers:
        known |= {h.strip().lower() for h in extra_headers}

    lines = text.split("\n")
    kept = []
    for line in lines:
        stripped = line.strip()
        if stripped.lower() in known:
            continue
        if stripped.isdigit():
            continue
        if stripped.startswith("```"):
            continue
        kept.append(line)
    return "\n".join(kept)


def detect_recurring_headers(doc, sample_pages: int, threshold: float = 0.3, min_occurrences: int = 3):
    """İlk birkaç sayfayı OCR'layıp, her sayfanın İLK 2 ve SON 2 satırı
    arasında tekrar eden metinleri (kitap başlığı/yazar adı gibi üstbilgi/
    altbilgiler) otomatik tespit eder. Sadece konum (sayfa başı/sonu) VE
    sıklık (örneklenen sayfaların en az %{threshold}'i, en az {min_occurrences}
    kez) ikisini birden sağlayan satırlar 'üstbilgi' sayılır - rastgele bir
    diyalog cümlesinin birkaç sayfada tesadüfen tekrarlanması bu yüzden
    yanlışlıkla yakalanmaz (üstbilgiler HER zaman sayfa başı/sonunda olur).

    Ekstra model çağrısı YAPMAZ - zaten OCR edilecek ilk sample_pages
    sayfasının çıktısını hem tespit için kullanır hem de (page_raw_texts
    olarak) ana işleme döngüsüne geri verir, tekrar OCR'lanmasınlar diye.

    Döner: (tespit_edilen_basliklar, {sayfa_no: ham_metin})
    """
    n = min(sample_pages, len(doc))
    if n < 3:
        return [], {}

    page_raw_texts = {}
    line_counts = Counter()

    for i in range(n):
        t0 = time.time()
        print(f"  >> Sayfa {i + 1} okunuyor ({VISION_MODEL})", flush=True)  # arayüz bu satırla PDF önizlemesini takip eder
        text = vision_extract(doc[i])
        page_raw_texts[i] = text
        elapsed = time.time() - t0
        print(f"    [üstbilgi taraması] Sayfa {i + 1}/{n} işlendi ({elapsed:.1f}sn)")
        lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
        candidates = lines[:2] + lines[-2:]  # üstbilgi/altbilgi hep sayfa başı/sonunda olur
        seen_this_page = set()
        for ln in candidates:
            if ln.isdigit() or len(ln) < 2 or len(ln) > 80:
                continue
            key = ln.lower()
            if key in seen_this_page:
                continue
            seen_this_page.add(key)
            line_counts[ln] += 1

    detected = [
        line for line, count in line_counts.items()
        if count >= min_occurrences and count / n >= threshold
    ]
    return detected, page_raw_texts


def process_page(page, extra_headers=None, cached_raw_text=None):
    """Bir sayfayı iki aşamada işler. (metin, kullanılan_mod) döner.
    cached_raw_text verilirse (üstbilgi tespiti sırasında zaten OCR'landıysa)
    vision_extract tekrar ÇAĞRILMAZ - gereksiz model çağrısı önlenir."""
    raw = cached_raw_text if cached_raw_text is not None else vision_extract(page)
    raw_text = dehyphenate(strip_known_headers(raw, extra_headers))

    if config.APPLY_TEXT_CORRECTION:
        corrected = dehyphenate(text_correct(raw_text))
        return corrected, "vision+text"
    else:
        return raw_text, "vision"


def process_pdf(pdf_path: Path, output_dir: Path, max_pages, start_page: int, auto_headers: bool, resume: bool = False):
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    end_page = total_pages if max_pages is None else min(total_pages, start_page + max_pages)

    book_output_dir = output_dir / pdf_path.stem
    book_output_dir.mkdir(parents=True, exist_ok=True)
    output_md = book_output_dir / f"{pdf_path.stem}.md"

    mode = "a" if output_md.exists() and start_page > 0 else "w"

    print(f"\n=== {pdf_path.name} ===")
    print(f"Toplam sayfa: {total_pages} | İşlenecek: {start_page}-{end_page - 1}")
    print(f"Çıktı: {output_md}")

    extra_headers = []
    cached_pages = {}
    pages_json = book_output_dir / f"{pdf_path.stem}_sayfalar.json"
    resume_store = None
    if resume and pages_json.exists():
        try:
            resume_store = json.loads(pages_json.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            resume_store = None
        if resume_store and resume_store.get("model") not in (None, VISION_MODEL):
            print(f"  [UYARI] Kayıtlı okuma başka bir modelle yapılmış ({resume_store.get('model')}), baştan okunacak.")
            resume_store = None
    if resume_store is not None:
        extra_headers = resume_store.get("headers", [])
        done_n = sum(1 for i in range(start_page, end_page) if str(i) in resume_store.get("pages", {}))
        print(f"  Daha önce okunan {done_n} sayfa atlanıyor (kaldığı yerden devam).")
    elif auto_headers and start_page == 0:
        sample_n = min(20, total_pages)
        print(f"  Tekrarlayan üstbilgi/altbilgi tespiti için ilk {sample_n} sayfa taranıyor...")
        extra_headers, cached_pages = detect_recurring_headers(doc, sample_n)
        if extra_headers:
            print(f"  Otomatik tespit edilen tekrarlayan üstbilgiler ({len(extra_headers)} adet):")
            for h in extra_headers:
                print(f"    - \"{h}\"")
        else:
            print("  Tekrarlayan üstbilgi tespit edilemedi (kitapta yok ya da örneklem yetersiz).")

    # Her sayfanın metni ayrıca kaydedilir: ensemble.py ikinci modelin
    # okumasını sayfa sayfa karşılaştırmak için buna ihtiyaç duyar.
    page_store = {"model": VISION_MODEL, "headers": extra_headers, "pages": {}}
    if resume_store is not None:
        page_store = resume_store
        mode = "w"   # .md her sayfadan sonra kayıtlardan baştan kurulur
    elif mode == "a" and pages_json.exists():
        try:
            page_store = json.loads(pages_json.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            pass

    t_okuma, n_okunan = time.time(), 0
    with open(output_md, mode, encoding="utf-8") as f:
        for i in range(start_page, end_page):
            if resume_store is not None and str(i) in page_store["pages"]:
                f.write(page_store["pages"][str(i)] + "\n\n")
                continue
            page = doc[i]
            t0 = time.time()
            if i not in cached_pages:
                print(f"  >> Sayfa {i + 1} okunuyor ({VISION_MODEL})", flush=True)  # arayüz bu satırla PDF önizlemesini takip eder
            try:
                cached = cached_pages.get(i)
                text, used_mode = process_page(page, extra_headers=extra_headers, cached_raw_text=cached)
            except requests.exceptions.RequestException as e:
                print(f"  [HATA] Sayfa {i + 1}: {e}")
                print("  -> Ollama çalışıyor mu? Model çekilmiş mi kontrol et.")
                sys.exit(1)

            f.write(text.strip() + "\n\n")
            f.flush()
            page_store["pages"][str(i)] = text.strip()
            n_okunan += 1
            pages_json.write_text(json.dumps(page_store, ensure_ascii=False), encoding="utf-8")
            elapsed = time.time() - t0
            print(f"  Sayfa {i + 1}/{total_pages} tamamlandı [{used_mode}] ({elapsed:.1f}sn)")

    if n_okunan:
        try:   # süre tahmini (sure_tahmini.py) bu bilgisayarın gerçek hızını öğrensin
            from sure_tahmini import sure_kaydet
            sure_kaydet("ocr", VISION_MODEL, n_okunan, time.time() - t_okuma)
        except Exception:
            pass

    full_text = output_md.read_text(encoding="utf-8")
    cleaned = dehyphenate(full_text)
    if cleaned != full_text:
        output_md.write_text(cleaned, encoding="utf-8")
        print("  (Sayfa sınırı tire birleşmeleri için son temizlik uygulandı)")

    if LOOP_PAGES:
        pages = ", ".join(map(str, sorted(set(LOOP_PAGES))))
        print(f"  [BİLGİ] Döngüye girip yeniden okunan sayfalar: {pages} - bunlara göz atmakta fayda var.")
        LOOP_PAGES.clear()

    print(f"Bitti: {output_md}")
    return output_md


def katman_dene(pdf_path: Path, max_pages=None) -> bool:
    """PDF'in metin katmanı sağlamsa kitabı ondan çıkarır (hafif_ocr.py --kaynak katman-varsa).
    Dijital PDF'lerde bu saniyeler sürer ve OCR'dan daha doğrudur; bozuk bağlı harfler sözlükle onarılır,
    eski/kötü OCR katmanları reddedilir. True: kitap katmandan yazıldı, vision OCR gerekmiyor."""
    import subprocess
    betik = Path(__file__).with_name("hafif_ocr.py")
    if not betik.exists():
        return False
    print("=== Metin katmanı denetimi (sağlamsa OCR gerekmez) ===", flush=True)
    komut = [sys.executable, str(betik), "--file", pdf_path.name, "--kaynak", "katman-varsa"]
    if max_pages:
        komut += ["--max-pages", str(max_pages)]
    try:
        kod = subprocess.run(komut).returncode
    except OSError as e:
        print(f"  [UYARI] Metin katmanı denenemedi: {e}")
        return False
    if kod == 0:
        print(f"Bitti (metin katmanından): {pdf_path.name}")
        return True
    if kod != 10:
        print(f"  [UYARI] Metin katmanı denetimi hata verdi (kod {kod}); sayfalar OCR ile okunacak.")
    return False


def main():
    parser = argparse.ArgumentParser(description="Yerel Ollama ile PDF -> Markdown OCR/düzeltme")
    parser.add_argument("--file", type=str, default=None,
                         help="input/ klasöründeki tek bir dosya adı (belirtilmezse tüm PDF'ler işlenir)")
    parser.add_argument("--max-pages", type=int, default=None,
                         help="Test için işlenecek maksimum sayfa sayısı")
    parser.add_argument("--start-page", type=int, default=0,
                         help="Hangi sayfadan başlanacağı (0-indeksli)")
    parser.add_argument("--resume", action="store_true",
                         help="Daha önce okunmuş sayfaları atla, kaldığı yerden devam et (sayfa kaydı _sayfalar.json'dan)")
    parser.add_argument("--no-auto-headers", action="store_true",
                         help="Otomatik üstbilgi/altbilgi tespitini kapat, sadece config.KNOWN_HEADERS kullan")
    parser.add_argument("--no-katman", action="store_true",
                         help="PDF'in metin katmanını deneme, her sayfayı vision modeliyle oku")
    args = parser.parse_args()

    input_dir = Path(config.INPUT_DIR)
    output_dir = Path(config.OUTPUT_DIR)
    output_dir.mkdir(exist_ok=True)

    if args.file:
        pdf_files = [input_dir / args.file]
        if not pdf_files[0].exists():
            print(f"Dosya bulunamadı: {pdf_files[0]}")
            sys.exit(1)
    else:
        pdf_files = sorted(input_dir.glob("*.pdf"))
        if not pdf_files:
            print(f"'{input_dir}' klasöründe PDF bulunamadı. PDF'lerini oraya koy.")
            sys.exit(1)

    for pdf_path in pdf_files:
        if not args.no_katman and args.start_page == 0 and katman_dene(pdf_path, args.max_pages):
            continue
        process_pdf(pdf_path, output_dir, args.max_pages, args.start_page, auto_headers=not args.no_auto_headers,
                    resume=args.resume)


if __name__ == "__main__":
    main()