# -*- coding: utf-8 -*-
"""
analyze_cover_theme.py - Bez ciltli (clothbound) kapak için kitabın temasını çıkarır.

Kitabın kendi açılış metnine (editor.md) ve varsa internetten bulunan gerçek
özetine (Google Books, sonra yazar-doğrulamalı Wikipedia; suggest_cover_style.py'deki
fonksiyonlar kullanılır) dayanarak yerel LLM'den (Ollama) şunları ister:
  - tür, duygu, dönem, ana semboller
  - motif seti (KAPALI listeden): kapak çerçevesindeki tekrarlı ikonlar
  - kumaş rengi (KAPALI listeden) ve varak rengi (altın/gümüş/bakır)
  - arka kapak tanıtım yazısı (3-4 cümle, Türkçe, verilmeyen bilgi uydurmadan)
Ayrıca metindeki kelime sayısını döner (sırt kalınlığı için).

LLM'e ulaşılamazsa ya da cevap geçersizse anahtar kelime sezgileriyle
yedek bir tema üretir (motif/kumaş), özet olarak internetten bulunan metnin
ilk cümlelerini kullanır.

Kullanım:
    python analyze_cover_theme.py --title "Satranç" --author "Stefan Zweig" --editor-md output/x/x_editor.md [--no-web]
Çıktı: stdout'a "CEVAP: {json}". İlerleme mesajları stderr'e gider.
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

try:
    import requests
except ImportError:  # requests yoksa yalnız sezgisel tema
    requests = None

try:
    import suggest_cover_style as scs
except Exception:  # betik yoksa internet özeti atlanır
    scs = None

OLLAMA_URL = "http://localhost:11434/api/chat"
TEXT_MODEL = os.environ.get("KITAP_TEXT_MODEL", getattr(scs, "TEXT_MODEL", "qwen2.5:14b-instruct") if scs else "qwen2.5:14b-instruct")   # boş = yalnız sezgisel tema

MOTIFS = {
    "satranc": "satranç taşları ve kareleri (strateji, oyun, zihin, takıntı)",
    "botanik": "yapraklar, dallar, çiçekler (doğa, bahçe, köy hayatı, şifalı otlar, aile)",
    "tuy": "kuş tüyü kalem, mürekkep hokkası, açık kitap (yazı, edebiyat, mektup, şiir, tiyatro yazarlığı)",
    "deniz": "çapa, dalga, deniz kabuğu, dümen (deniz, yolculuk, macera, liman)",
    "gok": "yıldız, hilal, güneş (gece, rüya, gökyüzü, kader, masal)",
    "geometrik": "geometrik rozetler, baklava ve dörtyapraklı süsler (genel klasik, felsefe, şehir, modern)",
    "kus": "kuşlar ve tüyler (özgürlük, göç, hasret, kır)",
    "anahtar": "anahtar, anahtar deliği, mum (gizem, sır, polisiye, korku)",
    "maske": "tiyatro maskesi, gül, perde (dram, aşk, trajedi, sahne)",
    "artdeco": "yelpaze, şerit ve zikzak süsler (1920'ler, caz çağı, şehir hayatı, şıklık, Gatsby)",
    "minimal": "neredeyse süssüz ince çizgiler (modern, felsefi, sade, deneme)",
    "gotik": "sivri kemer, yarasa, mum, hilal (gotik, korku, vampir, karanlık romantizm)",
    "kesif": "pusula gülü, çapa, yıldız (keşif, harita, seyahat, coğrafi macera)",
    "masal": "şato, taç, yıldız, çiçek (masal, çocuk klasikleri, fantastik)",
    "tarih": "kılıç, kalkan, taç, zambak (tarih, savaş, hanedan, şövalye)",
    "sark": "lale, hilal, rozet (Doğu, Osmanlı, İran, Arap edebiyatı, tasavvuf)",
}
CLOTHS = {
    "bordo": "#6B1D24", "orman": "#1E463A", "gece": "#1A2238", "kehribar": "#B5762A", "komur": "#262626", "krem": "#E9DFC8",
    "lacivert": "#1B365D", "kahve": "#4E3423", "murdum": "#4A2545", "petrol": "#1F4E5A", "hardal": "#8A6A1E", "antrasit": "#2E3236",
    "kiremit": "#8C3B22", "zeytin": "#4F5A2A", "adacayi": "#7C8F72", "gul": "#9C4A5A", "lavanta": "#6E5C8A", "deniz": "#2C6E7F",
    "safran": "#C08A1E", "tarcin": "#7A3E1E", "sarap": "#4E1420", "mor": "#3B2252", "ardic": "#2F4A3F", "kul": "#6B6B66",
}
FOILS = {"altin": "#D4AF37", "gumus": "#C3C8CE", "bakir": "#C07A4A", "bronz": "#A8773A", "krem": "#EFE3C8", "siyah": "#1E1A18"}

PROMPT = """Aşağıda bir kitabın başlığı, yazarı, (varsa) internetten bulunan gerçek özeti ve kendi açılış metni var.
Bu kitap için klasik bez ciltli (Penguin Clothbound Classics tarzı) bir kapak tasarlanacak.

KURALLAR (ÇOK ÖNEMLİ):
1. "motif" alanını SADECE şu anahtarlardan biri yap: {motifs}
2. "kumas" alanını SADECE şu anahtarlardan biri yap: {cloths}
   (yol gösterici: psikolojik/klasik/karanlık eserler için bordo, deniz/macera için lacivert, doğa/tarih için orman)
3. "varak" alanını SADECE şunlardan biri yap: altin, gumus, bakir, bronz, krem, siyah (krem/siyah mat baskıdır, açık kumaşta siyah)
4. "ozet": kitabın arka kapağı için 3-4 cümlelik akıcı, edebi bir TÜRKÇE tanıtım yazısı. SADECE aşağıda verilen
   bilgilere dayan; verilmeyen olay, karakter adı ya da sonu UYDURMA, sonu verme. Bilgi azsa genel tonla yaz.
5. "tur", "duygu", "donem" kısa (1-4 kelime) Türkçe ifadeler; "semboller" 3-5 kısa Türkçe kelimelik bir liste.

Motif anlamları:
{motif_help}

Cevabını MUTLAKA en son satırda, başka hiçbir şey olmadan tam olarak şu JSON formatında ver:
CEVAP: {{"tur": "...", "duygu": "...", "donem": "...", "semboller": ["...", "..."], "motif": "...", "kumas": "...", "varak": "...", "ozet": "..."}}

--- KİTAP ---
Başlık: {title}
Yazar: {author}

--- İNTERNETTEN BULUNAN ÖZET (varsa) ---
{summary}
--- ÖZET SONU ---

--- KİTABIN AÇILIŞ METNİ (varsa) ---
{sample}
--- METİN SONU ---
"""

KEYWORDS = {
    "satranc": ["satranç", "şah ", "piyon", "vezir", "kale ", "fil ", "hamle", "chess", "turnuva"],
    "deniz": ["deniz", "gemi", "kaptan", "okyanus", "liman", "balina", "dalga", "vapur", "ada "],
    "botanik": ["bahçe", "çiçek", "ağaç", "orman", "yaprak", "ot ", "tarla", "köy", "şifa"],
    "tuy": ["mektup", "kalem", "mürekkep", "şiir", "yazdı", "kitap", "oyun yazarı", "sayfa"],
    "gok": ["yıldız", "gece", "gökyüzü", "rüya", "ay ışığı", "güneş", "masal"],
    "kus": ["kuş", "kanat", "uçtu", "göç", "yuva", "serçe", "kırlangıç"],
    "anahtar": ["cinayet", "sır", "dedektif", "gizem", "anahtar", "kayıp", "polis", "hayalet"],
    "maske": ["tiyatro", "sahne", "aktör", "perde", "oyun", "aşk", "trajedi"],
    "gotik": ["vampir", "hayalet", "mezar", "şato", "lanet", "korku"],
    "kesif": ["harita", "keşif", "seyahat", "kutup", "çöl", "kıta"],
    "masal": ["prenses", "prens", "peri", "büyü", "ejderha", "masal"],
    "tarih": ["savaş", "imparator", "kral", "ordu", "şövalye", "sultan"],
    "sark": ["padişah", "derviş", "istanbul", "saray", "lale", "bağdat"],
}
MOTIF_CLOTH = {"satranc": "bordo", "deniz": "lacivert", "botanik": "orman", "tuy": "kahve", "gok": "gece",
               "kus": "petrol", "anahtar": "antrasit", "maske": "murdum", "geometrik": "bordo", "artdeco": "gece",
               "minimal": "krem", "gotik": "sarap", "kesif": "lacivert", "masal": "lavanta", "tarih": "kehribar", "sark": "petrol"}


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def clean_sample(text: str, limit: int = 6000) -> str:
    lines = [l.strip() for l in text.splitlines()]
    lines = [l for l in lines if l and not l.startswith(("#", "<!--", "---"))]
    return " ".join(lines)[:limit]


def heuristic(title: str, summary: str, sample: str) -> dict:
    blob = f" {title} {summary} {sample[:4000]} ".lower()
    scores = {k: sum(blob.count(w) for w in ws) for k, ws in KEYWORDS.items()}
    scores["satranc"] += 20 * ("satran" in title.lower())
    motif = max(scores, key=scores.get) if max(scores.values()) >= 2 else "geometrik"
    sentences = re.split(r"(?<=[.!?…])\s+", summary.strip()) if summary else []
    ozet = " ".join(sentences[:3]).strip()
    return {"tur": "", "duygu": "", "donem": "", "semboller": [], "motif": motif, "kumas": MOTIF_CLOTH[motif],
            "varak": "altin", "ozet": ozet}


def call_llm(prompt: str) -> dict:
    payload = {
        "model": TEXT_MODEL, "messages": [{"role": "user", "content": prompt}], "stream": False,
        "options": {"num_ctx": 8192, "temperature": 0.4, "num_predict": 600}, "keep_alive": 0,
    }
    resp = requests.post(OLLAMA_URL, json=payload, timeout=300)
    resp.raise_for_status()
    content = resp.json()["message"].get("content", "") or ""
    m = re.findall(r"CEVAP\s*:\s*(\{.*\})", content, re.IGNORECASE | re.DOTALL)
    if not m:
        raise ValueError("Modelin cevabında CEVAP satırı yok")
    return json.loads(m[-1])


def main():
    ap = argparse.ArgumentParser(description="Bez ciltli kapak için tema analizi")
    ap.add_argument("--title", required=True)
    ap.add_argument("--author", default="")
    ap.add_argument("--editor-md", default="")
    ap.add_argument("--no-web", action="store_true")
    args = ap.parse_args()

    raw = ""
    p = Path(args.editor_md) if args.editor_md else None
    if p and p.exists():
        raw = p.read_text(encoding="utf-8", errors="ignore")
    words = len(re.findall(r"\w+", raw))
    sample = clean_sample(raw)

    summary, source = "", "metin"
    if not args.no_web and scs and requests:
        log("İnternetten kitap özeti aranıyor (Google Books, sonra Wikipedia)…")
        for lang in ("tr", "en"):
            summary = scs._google_books_summary(args.title, args.author, lang)
            if summary:
                source = "Google Books"
                break
        if not summary:
            surname = args.author.strip().split()[-1].lower() if args.author.strip() else ""
            for lang in ("tr", "en"):
                summary = scs._wiki_grounded_summary(lang, args.title, surname)
                if summary:
                    source = "Wikipedia"
                    break
        log(f"Özet: {'bulundu (' + source + ')' if summary else 'bulunamadı, yalnız metin kullanılacak'}")

    result = heuristic(args.title, summary, sample)
    result["kaynak"] = "sezgisel"
    if requests and TEXT_MODEL:
        try:
            log(f"Yerel model ({TEXT_MODEL}) temayı çıkarıyor…")
            prompt = PROMPT.format(
                motifs=", ".join(MOTIFS), cloths=", ".join(CLOTHS),
                motif_help="\n".join(f"- {k}: {v}" for k, v in MOTIFS.items()),
                title=args.title, author=args.author or "(bilinmiyor)",
                summary=summary or "(bulunamadı)", sample=sample[:3500] or "(mevcut değil)")
            d = call_llm(prompt)
            for k in ("tur", "duygu", "donem", "ozet"):
                if isinstance(d.get(k), str) and d[k].strip():
                    result[k] = d[k].strip()
            if isinstance(d.get("semboller"), list):
                result["semboller"] = [str(s).strip() for s in d["semboller"] if str(s).strip()][:5]
            if d.get("motif") in MOTIFS:
                result["motif"] = d["motif"]
            if d.get("kumas") in CLOTHS:
                result["kumas"] = d["kumas"]
            if d.get("varak") in FOILS:
                result["varak"] = d["varak"]
            result["kaynak"] = "yapay zekâ" + (f" + {source}" if summary else " + metin")
        except Exception as e:
            log(f"Model kullanılamadı ({type(e).__name__}: {e}); sezgisel tema kullanılıyor.")

    result["kelime"] = words
    result["renkler"] = {"kumas": CLOTHS[result["kumas"]], "varak": FOILS[result["varak"]], "krem": "#F4ECD8"}
    print("CEVAP: " + json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
