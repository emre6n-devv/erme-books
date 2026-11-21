# -*- coding: utf-8 -*-
"""
suggest_cover_style.py - Kitabın hem kendi metnine (editor.md) hem de
İNTERNETTEN bulunan gerçek özetine dayanarak, mevcut hayvan/renk listesinden
BİR hayvan + BİR renk önerir, seçimini uydurmadan açıklar.

v2 - BELİRSİZLİK YÖNETİMİ: Kesin bir eşleşme (Google Books ya da
yazar-doğrulamalı Wikipedia) bulunamazsa, artık rastgele bir varsayılana
DÜŞMÜYOR - bunun yerine başlığa göre birkaç ADAY Wikipedia sayfası bulup
bunları GERİ DÖNDÜRÜYOR (LLM'e hiç sormadan), çağıran taraf (GUI)
kullanıcıya "bunlardan hangisi?" diye sorabilsin diye. --confirm-title ile
kullanıcının seçtiği kesin sayfa verilirse, o sayfanın özetiyle normal
akışa devam edilir.

İNTERNET ARAMASI - ÖNCELİK SIRASI:
1) Google Books API (anahtar gerektirmiyor) - yayınevinin kendi tanıtım
   metnini döner, en 'edebi' kalitede. langRestrict ile dile göre
   filtreleniyor (önce tr, sonra en).
2) Wikipedia (Türkçe, sonra İngilizce) - başlığa göre arıyor (yazar adını
   sorguya KATMIYOR - Wikipedia'nın opensearch'ü tam metin değil, sayfa
   başlığı öneki eşleştirmesi yapıyor, yazar eklenince sıfır sonuç
   dönebiliyor). Sonra GROUNDING: bulunan özette yazarın soyadı gerçekten
   geçiyorsa kabul edilir.
3) İkisi de kesin eşleşme veremezse: başlığa göre birkaç ADAY sayfa
   toplanır, kullanıcıya soru olarak döndürülür.

Not: Goodreads'in resmi/ücretsiz bir API'si YOK (Aralık 2020'de kapatıldı).

HALÜSİNASYON KONTROLÜ: LLM sadece verilen KAPALI listelerden (mevcut
hayvanlar, 10 renk) seçim yapabilir.

Kullanım:
    # Normal (otomatik tespit dener, belirsizse aday listesi döner):
    python suggest_cover_style.py --editor-md ... --title "..." --author "..."

    # Kullanıcı bir aday seçtikten sonra, o sayfayla kesinleştir:
    python suggest_cover_style.py --title "..." --author "..." \
        --confirm-title "Sayfa Başlığı" --confirm-lang tr

Çıktı: stdout'a "CEVAP: {json}". İki olası şekil:
    {"durum": "tamam", "hayvan": ..., "renk": ..., "gerekce": ...}
    {"durum": "belirsiz", "adaylar": [{"baslik":..., "aciklama":..., "lang":...}, ...]}
İlerleme/hata mesajları stderr'e gidiyor.
"""

import argparse
import json
import re
import sys
from pathlib import Path

import requests

OLLAMA_URL = "http://localhost:11434/api/chat"
TEXT_MODEL = "qwen2.5:14b-instruct"
NUM_CTX = 8192
REQUEST_TIMEOUT = 300
WIKI_TIMEOUT = 10

HTTP_HEADERS = {
    "User-Agent": "KitapOCR-KapakOnerisi/1.0 (kisisel proje, iletisim: yok)"
}

ALLOWED_COLORS = [
    "turuncu", "yesil", "lacivert", "kirmizi", "bordo",
    "mor", "petrol", "hardal", "pembe", "antrasit",
]

SUGGEST_PROMPT = """Aşağıda bir kitabın başlığı, yazarı, (varsa) internetten bulunan gerçek özeti ve
kendi açılış metni var. Bu kitap için bir kapak tasarımında kullanılacak TEK BİR HAYVAN ve TEK BİR RENK seçeceksin.

KURALLAR (ÇOK ÖNEMLİ):
1. Hayvanı SADECE şu listeden seç, başka bir hayvan YAZMA: {animal_list}
2. Rengi SADECE şu listeden seç, başka bir renk YAZMA: {color_list}
3. Gerekçeni YAZARKEN: sadece aşağıda VERİLEN bilgilere (özet ve/veya açılış metni) dayan.
   Verilmeyen bir olay, karakter adı ya da detay UYDURMA. Bilgi azsa/belirsizse, sadece genel
   tondan (karanlık/hafif/melankolik vb.) bahset, spesifik bir şey uydurmaktansa genel kal.
4. Gerekçe 1-2 cümle olsun, Türkçe yaz.

Cevabını MUTLAKA en son satırda, başka hiçbir şey olmadan tam olarak şu JSON formatında ver:
CEVAP: {{"hayvan": "...", "renk": "...", "gerekce": "..."}}

--- KİTAP ---
Başlık: {title}
Yazar: {author}

--- İNTERNETTEN BULUNAN ÖZET (varsa) ---
{wiki_summary}
--- ÖZET SONU ---

--- KİTABIN AÇILIŞ METNİ (varsa) ---
{sample}
--- METİN SONU ---
"""


def call_ollama(prompt: str) -> str:
    payload = {
        "model": TEXT_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "options": {"num_ctx": NUM_CTX, "temperature": 0.3, "num_predict": 300},
        "keep_alive": 0,
    }
    resp = requests.post(OLLAMA_URL, json=payload, timeout=REQUEST_TIMEOUT)
    if not resp.ok:
        raise requests.exceptions.RequestException(f"HTTP {resp.status_code} - {resp.text}")
    data = resp.json()
    content = data["message"].get("content", "") or ""
    matches = re.findall(r"CEVAP\s*:\s*(\{.*\})", content, re.IGNORECASE | re.DOTALL)
    return matches[-1].strip() if matches else ""


def _google_books_summary(title: str, author: str, lang: str) -> str:
    """Google Books API - anahtar gerektirmiyor, yayınevinin kendi tanıtım
    metnini döner. NOT: anonim istekler kısa pencereli bir hız sınırına
    tabi (~100 istek/100sn) - 429 alırsan birkaç dakika bekle."""
    try:
        resp = requests.get(
            "https://www.googleapis.com/books/v1/volumes",
            params={"q": f"intitle:{title} inauthor:{author}", "langRestrict": lang, "maxResults": 3},
            headers=HTTP_HEADERS,
            timeout=WIKI_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        for item in data.get("items", []):
            info = item.get("volumeInfo", {})
            desc = info.get("description", "")
            if desc and len(desc) > 40:
                return desc
        return ""
    except Exception as e:
        print(f"  [DEBUG] Google Books hatası ({lang}): {type(e).__name__}: {e}", file=sys.stderr)
        return ""


def wiki_search_candidates(lang: str, title: str, limit: int = 4) -> list:
    """Başlığa göre en fazla `limit` aday Wikipedia sayfası döner - her biri
    {'baslik':..., 'aciklama':..., 'lang':...}. Kesin eşleşme bulunamayınca
    kullanıcıya seçenek sunmak için kullanılıyor."""
    try:
        resp = requests.get(
            f"https://{lang}.wikipedia.org/w/api.php",
            params={"action": "opensearch", "search": title, "limit": limit, "format": "json"},
            headers=HTTP_HEADERS,
            timeout=WIKI_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        titles = data[1] if len(data) > 1 else []
        descs = data[2] if len(data) > 2 else []
        return [
            {"baslik": t, "aciklama": (descs[i] if i < len(descs) else ""), "lang": lang}
            for i, t in enumerate(titles)
        ]
    except Exception as e:
        print(f"  [DEBUG] Wikipedia aday arama hatası ({lang}): {type(e).__name__}: {e}", file=sys.stderr)
        return []


def wiki_summary_for_title(lang: str, page_title: str) -> str:
    """Belirli, KESİN bilinen bir sayfa başlığı için özet çeker - kullanıcı
    aday listesinden birini seçtikten sonra kullanılıyor."""
    try:
        resp = requests.get(
            f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{requests.utils.quote(page_title)}",
            headers=HTTP_HEADERS,
            timeout=WIKI_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json().get("extract", "") or ""
    except Exception as e:
        print(f"  [DEBUG] Wikipedia özet hatası ({lang}/{page_title}): {type(e).__name__}: {e}", file=sys.stderr)
        return ""


def _wiki_grounded_summary(lang: str, title: str, author_surname: str) -> str:
    """Başlığa göre arar, ilk sonucun özetini çeker, özette yazarın soyadı
    GERÇEKTEN geçiyorsa döner - geçmiyorsa (yanlış sayfa riski) boş döner."""
    try:
        resp = requests.get(
            f"https://{lang}.wikipedia.org/w/api.php",
            params={"action": "opensearch", "search": title, "limit": 1, "format": "json"},
            headers=HTTP_HEADERS,
            timeout=WIKI_TIMEOUT,
        )
        resp.raise_for_status()
        results = resp.json()
        titles = results[1] if len(results) > 1 else []
        if not titles:
            return ""
        page_title = titles[0]
        summary = wiki_summary_for_title(lang, page_title)
        if not summary:
            return ""
        if not author_surname or author_surname in summary.lower():
            return summary
        print(f"  [DEBUG] Wikipedia ({lang}) '{page_title}' buldu ama yazar adı "
              f"('{author_surname}') özette geçmiyor, reddedildi.", file=sys.stderr)
        return ""
    except Exception as e:
        print(f"  [DEBUG] Wikipedia hatası ({lang}): {type(e).__name__}: {e}", file=sys.stderr)
        return ""


def get_available_animals() -> list:
    from generate_mascots_ai import MASCOT_PROMPTS
    mascots_dir = Path("assets/mascots")
    existing = set()
    if mascots_dir.exists():
        existing |= {d.name for d in mascots_dir.iterdir() if d.is_dir()}
        existing |= {f.stem for f in mascots_dir.glob("*.png") if not f.stem.endswith("_raw")}
    return sorted(existing | set(MASCOT_PROMPTS)) or ["penguin"]


def run_llm_suggestion(title: str, author: str, wiki_summary: str, sample: str, animals: list) -> dict:
    prompt = SUGGEST_PROMPT.format(
        animal_list=", ".join(animals),
        color_list=", ".join(ALLOWED_COLORS),
        title=title,
        author=author,
        wiki_summary=wiki_summary or "(bulunamadı)",
        sample=sample or "(mevcut değil)",
    )
    try:
        raw = call_ollama(prompt)
        data = json.loads(raw)
        animal = str(data.get("hayvan", "")).strip().lower()
        color = str(data.get("renk", "")).strip().lower()
        gerekce = str(data.get("gerekce", "")).strip()

        if animal not in animals:
            animal = animals[0]
            gerekce = (gerekce + " (Not: modelin önerdiği hayvan mevcut listede yoktu, "
                       "varsayılana düşüldü.)").strip()
        if color not in ALLOWED_COLORS:
            color = ALLOWED_COLORS[0]

        return {"durum": "tamam", "hayvan": animal, "renk": color, "gerekce": gerekce or "Genel tona uygun bir seçim yapıldı."}
    except Exception as e:
        return {
            "durum": "tamam", "hayvan": animals[0], "renk": ALLOWED_COLORS[0],
            "gerekce": f"Öneri tespiti başarısız oldu ({e}), varsayılan kullanıldı.",
        }


def main():
    parser = argparse.ArgumentParser(description="Kitaba özel hayvan/renk önerisi")
    parser.add_argument("--editor-md", type=str, default="")
    parser.add_argument("--title", type=str, required=True)
    parser.add_argument("--author", type=str, required=True)
    parser.add_argument("--no-web", action="store_true", help="İnternet aramasını atla, sadece yerel metni kullan")
    parser.add_argument("--confirm-title", type=str, default="", help="Kullanıcının aday listesinden seçtiği KESİN Wikipedia sayfa başlığı")
    parser.add_argument("--confirm-lang", type=str, default="tr", help="confirm-title'ın hangi dilde olduğu (tr/en)")
    args = parser.parse_args()

    animals = get_available_animals()

    sample = ""
    editor_md_path = Path(args.editor_md) if args.editor_md else None
    if editor_md_path and editor_md_path.exists():
        sample = editor_md_path.read_text(encoding="utf-8")[:2500]

    # --- Kullanıcı bir aday sayfa ONAYLADIYSA: direkt o sayfayla devam et ---
    if args.confirm_title:
        print(f"  Onaylanan sayfa kullanılıyor: {args.confirm_title} ({args.confirm_lang})", file=sys.stderr)
        wiki_summary = wiki_summary_for_title(args.confirm_lang, args.confirm_title)
        result = run_llm_suggestion(args.title, args.author, wiki_summary, sample, animals)
        print("CEVAP: " + json.dumps(result, ensure_ascii=False))
        return

    # --- Normal akış: kesin eşleşme dene ---
    wiki_summary = ""
    if not args.no_web:
        print("  İnternetten kitap özeti aranıyor (Google Books, sonra Wikipedia)...", file=sys.stderr)

        for lang in ("tr", "en"):
            wiki_summary = _google_books_summary(args.title, args.author, lang)
            if wiki_summary:
                break

        if not wiki_summary:
            author_surname = args.author.strip().split()[-1].lower() if args.author.strip() else ""
            for lang in ("tr", "en"):
                wiki_summary = _wiki_grounded_summary(lang, args.title, author_surname)
                if wiki_summary:
                    break

        if wiki_summary:
            print(f"  Özet bulundu ({len(wiki_summary)} karakter).", file=sys.stderr)
        else:
            print("  Kesin bir eşleşme bulunamadı, aday sayfalar toplanıyor...", file=sys.stderr)
            candidates = []
            for lang in ("tr", "en"):
                candidates.extend(wiki_search_candidates(lang, args.title))

            if candidates:
                print("CEVAP: " + json.dumps({"durum": "belirsiz", "adaylar": candidates}, ensure_ascii=False))
                return
            # Hiç aday da yoksa (örn. tamamen ağ erişimi yok) - sessiz varsayılana düş
            print("  Hiçbir aday da bulunamadı, internet erişimi olmadan devam ediliyor.", file=sys.stderr)

    result = run_llm_suggestion(args.title, args.author, wiki_summary, sample, animals)
    print("CEVAP: " + json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()