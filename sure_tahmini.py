# -*- coding: utf-8 -*-
"""
sure_tahmini.py - Kitap başlamadan önce her okuma profili için tahmini süreyi hesaplar.

NEDEN: Program herkesin bilgisayarında çalışmalı. Kullanıcı OCR'ı başlatmadan önce her
profilin (Hafif / Standart / Güçlü) o kitap için o bilgisayarda ne kadar süreceğini, hangi
modelin indirilmesi gerektiğini ve tahmini hata oranını görüp kendisi seçer. Uygulamadaki
"Okuma profili" penceresi bu betiğin JSON çıktısını gösterir.

TAHMİN NASIL YAPILIR (en güvenilirden en kabaya):
  1. Bu bilgisayardaki gerçek ölçümler (output/_sure_kayitlari.json): hafif_ocr.py, ocr.py ve
     ensemble.py her kitap bittikçe sürelerini buraya yazar; program kullandıkça kendini ayarlar.
  2. Ölçüm yoksa: modelin boyutu + ekran kartı belleği + RAM'e göre tablo tahmini. Model ekran
     kartına sığıyorsa hızlı, kısmen sığıyorsa yavaş, hiç sığmıyorsa işlemcide çok yavaş çalışır;
     RAM de yetmiyorsa profil "çalışmaz" olarak işaretlenir.
  3. PDF'in metin katmanı sağlamsa (--katman-sina) bütün profiller katmandan okur: saniyeler.

KULLANIM:
    py sure_tahmini.py --pdf "input/kitap.pdf" --vram 16 --ram 32 --cekirdek 12 --json
    py sure_tahmini.py --pdf "input/kitap.pdf" --json --katman-sina      (katmanı gerçekten sına; yavaş)
    py sure_tahmini.py --pages 450 --ram 16 --birlesik                    (Apple Silicon)

SÜRE KAYDI (boru hattı betikleri her aşama bitince çağırır):
    from sure_tahmini import sure_kaydet
    sure_kaydet("ocr", "qwen2.5vl:7b", sayfa=450, saniye=6720)
"""

import argparse
import json
import os
import platform
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
KAYIT_DOSYASI = Path("output") / "_sure_kayitlari.json"      # çalışma klasörüne göre (uygulamanın veri klasörü)
OLLAMA_URL = "http://localhost:11434/api/tags"

# --------------------------------------------------------------- tablolar --
# boyut_gb: yaklaşık bellek/indirme boyutu (Ollama'da kuruluysa gerçek boyut oradan okunur).
# sn: model tamamen ekran kartındayken bir birim işin saniyesi. ocr/editor: sayfa, hakem: bir satır okuması.
# 2026-11 ölçümleri (RX 9070, 50 sayfalık testler): Tesseract 1,5 sn/sayfa (tek çekirdek),
# GLM-OCR satır okuması 2,4 sn, metin katmanı 0,4 sn/sayfa.
MODELLER = {
    "tesseract":            {"boyut_gb": 0.0, "sn": {"ocr": 1.5}},
    "glm-ocr":              {"boyut_gb": 2.2, "sn": {"ocr": 6.0, "hakem": 2.4}},
    "qwen2.5vl:7b":         {"boyut_gb": 6.0, "sn": {"ocr": 15.0}},
    "qwen2.5vl:3b":         {"boyut_gb": 3.2, "sn": {"ocr": 9.0}},
    "gemma3:12b":           {"boyut_gb": 8.1, "sn": {"ocr": 20.0}},
    "gemma3:4b":            {"boyut_gb": 3.3, "sn": {"ocr": 8.0}},
    "qwen2.5:7b-instruct":  {"boyut_gb": 4.7, "sn": {"editor": 8.0}},
    "qwen2.5:14b-instruct": {"boyut_gb": 9.0, "sn": {"editor": 20.0}},
}

KURAL_SN_SAYFA = 0.3        # sözlük / kural tabanlı adımlar, yapı, EPUB
MODEL_YUKLEME_SN = 30       # her model için bir kerelik yükleme
SUPHELI_SATIR_SAYFA = 3.0   # hafif hat: sayfa başına yapay zekâya giden satır (ölçülen: temiz baskı 2, eski tarama 4)
KATMAN_SN_SAYFA = 0.4       # sağlam metin katmanı: OCR yok
CEKIRDEK = os.cpu_count() or 4

# Profiller. "app": uygulamanın Model Yönetimi rolleri (main.js MODEL_CATALOG) - pencerede seçilince
# bunlar uygulanır. "ucluk": OCR sekmesindeki "Üç model OCR" (çoklu okuma) açık mı.
PROFILLER = [
    {"id": "cok_hizli", "ad": "Çok hızlı",
     "ocr": ["tesseract"], "hakem": None, "editor": None,
     "hata": "ölçülen %0,25 (temiz baskı) · ~%1,8 (eski tarama)",
     "aciklama": "Yalnız Tesseract ve sözlük, yapay zekâ yok. Zayıf bilgisayarlar için; birkaç dakika.",
     "app": {"ocr": "hafif", "second": "", "third": "", "text": ""}, "ucluk": False},
    {"id": "hafif", "ad": "Hafif",
     "ocr": ["tesseract"], "hakem": "glm-ocr", "editor": None,
     "hata": "ölçülen %0,03 (temiz baskı) · ~%0,4 (eski tarama)",
     "aciklama": "Tesseract okur, yalnız şüpheli satırları GLM-OCR'a sorar. Ekran kartı gerekmez.",
     "app": {"ocr": "hafif", "second": "glm-ocr", "third": "", "text": ""}, "ucluk": False},
    {"id": "standart", "ad": "Standart",
     "ocr": ["qwen2.5vl:7b", "glm-ocr"], "hakem": None, "editor": "qwen2.5:7b-instruct",
     "hata": "~%1–2 (henüz ölçülmedi)",
     "aciklama": "Qwen2.5-VL her sayfayı okur, GLM-OCR ikinci kez okur; 7B dil modeli düzeltir.",
     "app": {"ocr": "qwen2.5vl:7b", "second": "glm-ocr", "third": "", "text": "qwen2.5:7b-instruct"}, "ucluk": True},
    {"id": "guclu", "ad": "Güçlü",
     "ocr": ["qwen2.5vl:7b", "glm-ocr", "gemma3:12b"], "hakem": None, "editor": "qwen2.5:14b-instruct",
     "hata": "ölçülen %0,9 (Kafamda Bir Tuhaflık)",
     "aciklama": "Üç model okur, anlaşmazlıkta oy verir; 14B dil modeli düzeltir.",
     "app": {"ocr": "qwen2.5vl:7b", "second": "glm-ocr", "third": "gemma3:12b", "text": "qwen2.5:14b-instruct"},
     "ucluk": True},
]


# --------------------------------------------------------------- donanım --

def ram_bul():
    """Toplam RAM (GB). Bulunamazsa None."""
    try:
        import psutil
        return psutil.virtual_memory().total / 1024 ** 3
    except Exception:
        pass
    if platform.system() == "Windows":
        try:
            import ctypes

            class MEMSTAT(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
            m = MEMSTAT()
            m.dwLength = ctypes.sizeof(MEMSTAT)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
            return m.ullTotalPhys / 1024 ** 3
        except Exception:
            return None
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemTotal:"):
                return int(line.split()[1]) / 1024 ** 2
    except Exception:
        pass
    return None


def kurulu_modeller():
    """Ollama'daki modeller: {ad: boyut_gb}. Ollama kapalıysa None."""
    try:
        with urllib.request.urlopen(OLLAMA_URL, timeout=3) as r:
            data = json.load(r)
    except Exception:
        return None
    out = {}
    for m in data.get("models", []):
        ad = m.get("name", "")
        boyut = m.get("size", 0) / 1024 ** 3
        out[ad] = boyut
        if ad.endswith(":latest"):
            out[ad[:-7]] = boyut
    return out


def sayfa_say(pdf: Path):
    try:
        import pymupdf
        d = pymupdf.open(pdf)
        try:
            return len(d)
        finally:
            getattr(d, "close", lambda: None)()
    except ImportError:
        pass
    from pypdf import PdfReader
    return len(PdfReader(str(pdf)).pages)


def paralel_tesseract(ram):
    """hafif_ocr.py'nin varsayılanı gibi: çekirdek - 1, ama işlem başına ~0,4 GB bellek, en fazla 12."""
    bellek = max(1, int((ram * 0.5 - 1) / 0.4)) if ram else CEKIRDEK
    return max(1, min(CEKIRDEK - 1, bellek, 12))


# ----------------------------------------------------------------- kayıt --

def _makine():
    return platform.node() or "bu-bilgisayar"


def _kayitlari_oku():
    try:
        return json.loads(KAYIT_DOSYASI.read_text(encoding="utf-8"))
    except Exception:
        return {}


def sure_kaydet(rol: str, model: str, sayfa: int, saniye: float):
    """Bir aşamanın gerçek süresini (duvar saati) kaydeder (rol: ocr / hakem / editor)."""
    if sayfa <= 0 or saniye <= 0 or not model:
        return
    kayit = _kayitlari_oku()
    m = kayit.setdefault(_makine(), {})
    k = m.setdefault(f"{rol}|{model}", {"sayfa": 0, "saniye": 0.0})
    k["sayfa"] += int(sayfa)
    k["saniye"] += float(saniye)
    try:
        KAYIT_DOSYASI.parent.mkdir(parents=True, exist_ok=True)
        KAYIT_DOSYASI.write_text(json.dumps(kayit, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass


# --------------------------------------------------------------- tahmin --

def hiz_carpani(boyut_gb, vram, ram):
    """(çarpan, durum). Çarpan None ise model bu bilgisayarda çalışmaz."""
    if vram >= boyut_gb * 1.15 + 1:
        return 1.0, "ekran kartında"
    if vram >= 2 and vram + ram * 0.6 >= boyut_gb * 1.15:
        gpu_payi = min(1.0, (vram - 1) / (boyut_gb * 1.15))
        return 1.0 + 6.0 * (1.0 - gpu_payi), "ekran kartına tam sığmıyor (yavaş)"
    if ram >= boyut_gb * 1.2 + 4:
        # küçük modeller (GLM-OCR 0,9B) işlemcide büyükler kadar yavaşlamaz
        return (4.0 if boyut_gb < 3 else 8.0), "işlemcide çalışır (yavaş)"
    return None, "bellek yetmiyor"


def birim_sure(rol, model, vram, ram, kurulu, olcumler):
    """(saniye/sayfa, ölçülmüş_mü, durum) ya da çalışmıyorsa (None, False, durum)."""
    k = olcumler.get(f"{rol}|{model}")
    if k and k["sayfa"] >= 5:
        return k["saniye"] / k["sayfa"], True, "ölçülmüş"
    bilgi = MODELLER.get(model, {"boyut_gb": 8.0, "sn": {}})
    if model == "tesseract":
        return bilgi["sn"]["ocr"] / paralel_tesseract(ram), False, "işlemcide, paralel"
    boyut = (kurulu or {}).get(model) or bilgi["boyut_gb"]
    carpan, durum = hiz_carpani(boyut, vram, ram)
    if carpan is None:
        return None, False, durum
    sn = bilgi["sn"].get(rol, 15.0)
    if rol == "hakem":
        sn *= SUPHELI_SATIR_SAYFA
    return sn * carpan, False, durum


def profil_tahmini(p, sayfa, vram, ram, kurulu, olcumler, tesseract_var):
    asamalar, uyarilar, eksik = [], [], []
    toplam, olculmus_hepsi, calisir = 0.0, True, True

    roller = [("ocr", m) for m in p["ocr"]]
    if p["hakem"]:
        roller.append(("hakem", p["hakem"]))
    if p["editor"]:
        roller.append(("editor", p["editor"]))

    if "tesseract" in p["ocr"] and not tesseract_var:
        calisir = False
        uyarilar.append("Tesseract kurulu değil")

    for rol, model in roller:
        sn, olculmus, durum = birim_sure(rol, model, vram, ram, kurulu, olcumler)
        uyari = f"{model}: {durum}"
        if sn is None:
            calisir = False
            if uyari not in uyarilar:
                uyarilar.append(uyari)
            continue
        sure = sn * sayfa + (MODEL_YUKLEME_SN if model != "tesseract" else 0)
        toplam += sure
        olculmus_hepsi &= olculmus
        if durum not in ("ekran kartında", "ölçülmüş", "işlemcide, paralel") and uyari not in uyarilar:
            uyarilar.append(uyari)
        if kurulu is not None and model != "tesseract" and model not in kurulu:
            eksik.append({"model": model, "boyut_gb": MODELLER.get(model, {}).get("boyut_gb")})
        asamalar.append({"rol": rol, "model": model, "saniye": round(sure), "olculmus": olculmus})

    toplam += KURAL_SN_SAYFA * sayfa
    alt, ust = (0.9, 1.15) if olculmus_hepsi else (0.75, 1.35)
    return {
        "id": p["id"], "ad": p["ad"], "aciklama": p["aciklama"], "hata": p["hata"],
        "app": p["app"], "ucluk": p["ucluk"],
        "calisir": calisir,
        "saniye": round(toplam) if calisir else None,
        "saniye_alt": round(toplam * alt) if calisir else None,
        "saniye_ust": round(toplam * ust) if calisir else None,
        "guven": "ölçülmüş" if olculmus_hepsi else "tahmini",
        "tam_hiz": calisir and not uyarilar,
        "uyarilar": uyarilar, "indirilecek": eksik, "asamalar": asamalar,
    }


def hesapla(sayfa, vram, ram, kurulu=None, tesseract_var=True, katman_saglam=False):
    olcumler = _kayitlari_oku().get(_makine(), {})
    sonuc = [profil_tahmini(p, sayfa, vram, ram, kurulu, olcumler, tesseract_var) for p in PROFILLER]
    if katman_saglam:
        # Sağlam metin katmanı: her profil önce katmanı dener (ocr.py / hafif_ocr.py), OCR yapılmaz.
        t = KATMAN_SN_SAYFA * sayfa + 10
        for r in sonuc:
            r.update(saniye=round(t), saniye_alt=round(t * 0.5), saniye_ust=round(t * 2), calisir=True,
                     tam_hiz=True, hata="~%0 (PDF'in kendi metninden)", indirilecek=[], guven="tahmini",
                     uyarilar=["metin katmanından okunur, OCR gerekmez"])
    # Öneri: ölçümlerde Hafif hem daha hızlı hem daha doğru çıktı (Kafamda %0,03 / Güçlü %0,9).
    # Hafif çalışmıyorsa (Tesseract yok) ekran kartına tam sığan en güçlü profil.
    hafif = next(r for r in sonuc if r["id"] == "hafif")
    if hafif["calisir"] and (hafif["saniye"] or 0) <= max(1800, 8 * sayfa):
        oneri = "hafif"
    elif hafif["calisir"]:
        oneri = "cok_hizli"         # GLM-OCR işlemcide çalışacak: yapay zekâsız yol çok daha kısa sürer
    else:
        aday = [r for r in sonuc if r["calisir"] and r["tam_hiz"]] or [r for r in sonuc if r["calisir"]]
        oneri = aday[-1]["id"] if aday else "hafif"
    for r in sonuc:
        r["onerilen"] = r["id"] == oneri
    return sonuc, oneri


def katman_sina(pdf: Path):
    """hafif_ocr.py'nin gerçek katman sınaması (sözlük + Tesseract). (var_mı, sağlam_mı, açıklama)."""
    import pymupdf
    import hafif_ocr as h
    doc = pymupdf.open(pdf)
    orn = [int(len(doc) * k / 6) for k in range(1, 6)] if len(doc) > 6 else list(range(len(doc)))
    harf = sum(sum(c.isalpha() for c in doc[i].get_text("text")) for i in orn)
    if harf / max(1, len(orn)) < 300:
        return False, False, "metin katmanı yok (taranmış kitap): sayfalar OCR ile okunacak"
    h.ligatur_karakterleri_bul(doc)
    ok, _ad, aciklama = h.katman_sina(doc, h.Sozluk(), h.Tesseract(), 300)
    return True, ok, aciklama


def katman_var_mi(pdf: Path):
    try:
        import pymupdf
        d = pymupdf.open(pdf)
        n = len(d)
        orn = [int(n * k / 6) for k in range(1, 6)] if n > 6 else list(range(n))
        harf = sum(sum(c.isalpha() for c in d[i].get_text("text")) for i in orn)
        return harf / max(1, len(orn)) > 300
    except Exception:
        return False


# ----------------------------------------------------------------- çıktı --

def sure_yazi(sn):
    if sn is None:
        return "—"
    if sn < 60:
        return f"{max(1, round(sn))} sn"
    dk = round(sn / 60)
    if dk < 60:
        return f"{dk} dk"
    sa, dk = divmod(dk, 60)
    return f"{sa} sa {dk} dk" if dk else f"{sa} sa"


def aralik_yazi(r):
    if not r["calisir"]:
        return "çalışmaz"
    a, b = sure_yazi(r["saniye_alt"]), sure_yazi(r["saniye_ust"])
    return a if a == b else f"{a} – {b}"


def main():
    global CEKIRDEK
    ap = argparse.ArgumentParser(description="Okuma profillerine göre tahmini kitap süresi")
    ap.add_argument("--pdf", help="Kitabın PDF'i")
    ap.add_argument("--pages", type=int, help="Sayfa sayısı (PDF yerine)")
    ap.add_argument("--vram", type=float, help="Ekran kartı belleği (GB), yoksa 0")
    ap.add_argument("--ram", type=float, help="Toplam RAM (GB)")
    ap.add_argument("--cekirdek", type=int, help="İşlemci çekirdek sayısı")
    ap.add_argument("--birlesik", action="store_true", help="Birleşik bellek (Apple Silicon)")
    ap.add_argument("--tesseract-yok", action="store_true", help="Tesseract kurulu değil")
    ap.add_argument("--katman-sina", action="store_true", help="Metin katmanını gerçekten sına (birkaç saniye)")
    ap.add_argument("--json", action="store_true", help="Uygulama için JSON çıktı")
    a = ap.parse_args()

    if a.cekirdek:
        CEKIRDEK = a.cekirdek
    if a.pages:
        sayfa = a.pages
    elif a.pdf:
        sayfa = sayfa_say(Path(a.pdf))
    else:
        ap.error("--pdf ya da --pages gerekli")

    katman = {"var": False, "saglam": None, "aciklama": ""}
    if a.pdf:
        if a.katman_sina:
            try:
                var, saglam, aciklama = katman_sina(Path(a.pdf))
                katman = {"var": var, "saglam": saglam, "aciklama": aciklama}
            except SystemExit:
                katman = {"var": katman_var_mi(Path(a.pdf)), "saglam": None, "aciklama": "katman sınanamadı"}
            except Exception as e:
                katman = {"var": katman_var_mi(Path(a.pdf)), "saglam": None, "aciklama": f"katman sınanamadı: {e}"}
        else:
            katman["var"] = katman_var_mi(Path(a.pdf))

    ram = a.ram or ram_bul() or 8.0
    vram = a.vram if a.vram is not None else 0.0
    if a.birlesik:
        vram = ram * 0.7
    kurulu = kurulu_modeller()
    sonuc, oneri = hesapla(sayfa, vram, ram, kurulu, tesseract_var=not a.tesseract_yok,
                           katman_saglam=bool(katman["saglam"]))

    if a.json:
        for r in sonuc:
            r["sure_yazi"] = aralik_yazi(r)
        print(json.dumps({"sayfa": sayfa, "vram": vram, "ram": round(ram, 1), "cekirdek": CEKIRDEK,
                          "ollama_acik": kurulu is not None, "katman": katman, "oneri": oneri,
                          "profiller": sonuc}, ensure_ascii=False))
        return

    ad = Path(a.pdf).stem if a.pdf else "kitap"
    print(f"Kitap: {ad} ({sayfa} sayfa)")
    print(f"Donanım: {vram:g} GB ekran kartı belleği, {ram:.0f} GB RAM, {CEKIRDEK} çekirdek")
    if katman["aciklama"]:
        print(f"Metin katmanı: {katman['aciklama']}")
    elif katman["var"]:
        print("PDF'te metin katmanı var (sağlamlığı --katman-sina ile sınanır).")
    if kurulu is None:
        print("Not: Ollama'ya ulaşılamadı, kurulu modeller kontrol edilemedi.")
    print()
    print(f"{'Profil':11} {'Süre':24} {'Hata':48} Durum")
    for r in sonuc:
        durum = (["ÖNERİLEN"] if r["onerilen"] else []) + r["uyarilar"]
        if r["indirilecek"]:
            durum.append("indirilecek: " + ", ".join(e["model"] for e in r["indirilecek"]))
        print(f"{r['ad']:11} {aralik_yazi(r):24} {r['hata']:48} {'; '.join(durum) or 'hazır'}")


if __name__ == "__main__":
    main()
