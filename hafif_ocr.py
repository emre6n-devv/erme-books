# -*- coding: utf-8 -*-
"""
hafif_ocr.py - Ekran kartı gerektirmeyen hızlı OCR hattı (Hafif profil).

NEDEN: Program herkesin bilgisayarında çalışmalı. Vision modeliyle her sayfayı
okumak ekran kartı olmayan bilgisayarda saatler sürer. Bu hat işin büyük
kısmını hızlı ve kesin yöntemlerle yapar, yapay zekâyı sadece şüpheli yerlerde
çağırır.

AKIŞ:
  1. METİN KATMANI (varsa ve sağlamsa): Çoğu PDF'te metin zaten gömülüdür; OCR
     gerekmez, saniyeler sürer ve OCR'dan daha doğrudur. Katman kullanılmadan
     önce sınanır (ilk birkaç sayfa değil, kitabın içinden örnek sayfalar):
       - Sayfada yeterince metin var mı?
       - Kodlama bozukluğu: "Ã§ ÅŸ ÄŸ" (UTF-8 kayması) ya da "ý þ ð"
         (CP1254/Latin-5 kayması). İkisi de deterministik onarılır; onarımdan
         sonra hâlâ bozuksa katman reddedilir.
       - Türkçe karakter oranı (ç ğ ı ö ş ü), ortalama kelime uzunluğu
         (boşluklar kaybolmuş mu?), sözlükte bulunan kelime oranı.
       - Tesseract ile iki sayfa okunup katmanla karşılaştırılır: eski ve kötü
         bir OCR katmanı sözlüğe uyabilir ama sayfadaki yazıyla uyuşmaz.
     BAĞLI HARFLER (ligatür): Bazı PDF'lerde "ti, tı, tt, ft, fı" gibi bağlı
     harfler tek bir bozuk karaktere dönüşür (Kafamda testinde 692 kez:
     "ge?rdin", "ar?k"). Her biri sözlükle çözülür ("getirdin", "artık").
     Birden çok aday geçerliyse ("e?" -> "eti"/"etti") o satır Tesseract ile
     okunup karar verilir.
  2. TESSERACT (katman yoksa ya da bozuksa): Sayfalar işlemci çekirdeği
     sayısınca PARALEL okunur. Tesseract her kelime için güven puanı (conf) ve
     konum verir.
  3. ŞÜPHELİ KELİMELER: Güveni düşük, sözlükte olmayan, harf-rakam karışık
     kelimeler işaretlenir. İstisnalar (yapay zekâya GİTMEZ):
       - Büyük harfle başlayan ve güveni yüksek (>= 90) kelimeler: özel isim
         (Mevlut, Rayiha, Tarlabaşı'nda). Kitapta aynı yazımla en az 3 kez
         geçen büyük harfli kelimeler de isim sayılır.
       - Güveni yüksek rakamlar (1969, 12.30) ve "1960'ta" gibi rakam+ek.
  4. YAPAY ZEKÂ (varsayılan glm-ocr): Şüpheli kelimenin sadece kendisi değil,
     AİT OLDUĞU SATIRIN TAMAMI (üst/alt pay bırakılarak) kırpılıp okutulur:
     tek kelime kırpılınca model harf yüksekliğini ve bağlamı şaşırır.
     Satırdaki diğer kelimeler hizalanır, sadece şüpheli kelime değiştirilir;
     model satırı uyduruyorsa (kelime sayısı tutmuyorsa) okuması atılır.
     Bir sayfada şüpheli satırlar çoksa (kötü tarama) sayfa tek seferde okunur.
  5. Çıktı ocr.py ile AYNI biçimdedir (<kitap>.md, <kitap>_sayfalar.json),
     yani editor.py, detect_structure.py ve degerlendir.py olduğu gibi çalışır.
     Özel isimler ve yapay zekânın onayladığı sözlük dışı kelimeler
     <kitap>_onayli.json'a eklenir; editör bunları "düzeltmeye" çalışmaz.

KURULUM:
  Tesseract (Windows): winget install UB-Mannheim.TesseractOCR
  Türkçe model: tur.traineddata (tessdata_best önerilir) -> proje kökünde
  tessdata/ klasörüne konursa o kullanılır, yoksa Tesseract'ın kendi klasörü.
  Tesseract başka yerdeyse: KITAP_TESSERACT ortam değişkeni.

KULLANIM:
    py hafif_ocr.py --file "kitap.pdf"
    py hafif_ocr.py --file "kitap.pdf" --kaynak tesseract     (katmanı yok say)
    py hafif_ocr.py --file "kitap.pdf" --no-vlm               (yapay zekâsız)
    py hafif_ocr.py --file "kitap.pdf" --workers 4 --dpi 300 --max-pages 20
"""

import argparse
import base64
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from itertools import product
from pathlib import Path

import pymupdf

import config
import ocr

ROOT = Path(__file__).resolve().parent

TR_LETTERS = "A-Za-zÇĞİıÖŞÜçğıöşüÂâÎîÛû"
TR_UPPER = str.maketrans("iı", "İI")
CIRCUMFLEX_FOLD = str.maketrans("âîûÂÎÛ", "aiuAIU")

# --- eşikler ---
DUSUK_GUVEN = 55          # bunun altındaki her kelime şüpheli
ISIM_GUVEN = 90           # büyük harfli + sözlükte yok + bu kadar güven = özel isim
ISIM_MIN_SAYI = 3         # kitapta aynı yazımla en az bu kadar geçen büyük harfli kelime = isim
RAKAM_GUVEN = 60
SAYFA_TOPLU_ORAN = 0.4    # şüpheli satır oranı bunu aşarsa sayfa tek seferde okunur
VLM_UZUNLUK_ORAN = (0.6, 1.6)   # model okumasının kelime sayısı / Tesseract'ınki bu aralıkta değilse atılır

# Bozuk karakter: PDF'in eşleyemediği bağlı harfler çoğunlukla bunlara dönüşür.
BOZUK = set("\ufffe\ufffd\uffff")
LIGATUR = {"ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st"}
# Bozuk karakterin yerine geçebilecek harf grupları: bağlı harfler hep t/f ile
# başlar (ti, tı, tt, ft, fı, fk "öfke", fb "şofben"...). Sık olanlar önce.
LIG_ADAY = ["ti", "tı", "tt", "tti", "ttı", "ft", "fı", "fi", "fk", "ff", "fl", "fb", "ffi", "tf"]
LIG_ADAY += [b + k for b in ("t", "f", "tt", "ff", "ft") for k in ("", "i", "ı", "k", "b", "h", "l", "t", "f", "j", "r")
             if len(b + k) >= 2 and b + k not in LIG_ADAY]      # bağlı harf en az iki harftir

MODEL_KOMUT = {"glm-ocr": "Text Recognition:"}
VARSAYILAN_KOMUT = "Bu görüntüdeki metni olduğu gibi yaz. Sadece metni yaz, açıklama ekleme."


# Kitaba özel bozuk karakterler: Word'den çıkan PDF'lerde Calibri'nin bağlı harfleri Türkçede
# kullanılmayan Latin harflerine eşlenir (PyMuPDF: ƨ=tı, Ɵ=ti, ķ=fı, Ō=ft, ƫ=tti, Ʃ=tt).
# ligatur_karakterleri_bul() kitapta sık geçenleri buraya ekler.
DINAMIK_BOZUK = set()
TURKCE_GENIS = set("ğĞıİşŞ")


def bozuk_mu(ch: str) -> bool:
    return ch in BOZUK or 0xE000 <= ord(ch) <= 0xF8FF or ch in DINAMIK_BOZUK


TURKCE_HARF = set("abcçdefgğhıijklmnoöprsştuüvyzâîûqwx")


def ligatur_karakterleri_bul(doc, sozluk=None, en_az=2):
    """Metin katmanında bağlı harf (fi, fl, ti...) yerine geçen glifleri bulur; bunlar bozuk karakter
    sayılır, sözlükle çözülür.
    1) Türkçede kullanılmayan Latin Genişletilmiş harfler (U+0100-024F, ğ ı İ ş hariç) tekrar ediyorsa.
       Genişletilmiş-B (ƨ Ɵ ƫ ƴ...) Türkçe ya da Avrupa dillerinde kullanılmaz: tek görülmesi yeter.
    2) Başka dillerde gerçek harf olan glifler (bazı yazı tiplerinde å=fi, ý=fl: "åkri", "zayıýadı"):
       harf yalnızca görünüşüyle karar verilemez ("Napoléon" doğrudur). Sözlükle sınanır: o harfi
       içeren kelimelerin en az 3'ü (ve dörtte biri) kendi hâlinde geçersiz, harf bir bağlı harf grubuyla
       değişince geçerli oluyorsa glif sayılır. Sözlük yoksa bu adım atlanır (yanlışlıkla doğru harfi bozmamak için)."""
    say = Counter()
    adaylar = {}                      # harf -> o harfi içeren kelimeler (adım 2)
    for i in range(len(doc)):
        metin = doc[i].get_text("text")
        for ch in metin:
            if 0x0100 <= ord(ch) <= 0x024F and ch not in TURKCE_GENIS:
                say[ch] += 1
        if sozluk is not None and sozluk.var:
            for w in re.findall(r"[^\W\d_]+", metin):
                yabanci = {c for c in w if trlow(c) not in TURKCE_HARF}
                if len(yabanci) == 1 and len(w) >= 3:
                    adaylar.setdefault(yabanci.pop(), set()).add(w)
    bulunan = {ch for ch, n in say.items() if n >= (1 if ord(ch) >= 0x0180 else en_az)}
    for ch, kelimeler in adaylar.items():
        if ch in bulunan or bozuk_mu(ch):
            continue
        orn = sorted(kelimeler)[:60]
        cozulen = sum(1 for w in orn if not sozluk.gecerli(w)
                      and any(sozluk.gecerli(w.replace(ch, a)) for a in LIG_ADAY[:14]))
        # Gerçek bir yabancı harf (é, ä, å) bağlı harfle değişince neredeyse hiç Türkçe kelime vermez;
        # glifte ise kelimelerin önemli bir kısmı düzelir (2 glifli ya da sözlükte olmayanlar düzelmez).
        if cozulen >= max(3, en_az) and cozulen >= 0.25 * len(orn):
            bulunan.add(ch)
            say[ch] = sum(w.count(ch) for w in kelimeler)
    DINAMIK_BOZUK.update(bulunan)
    return {ch: say[ch] for ch in sorted(bulunan, key=lambda c: -say[c])}


def trlow(s: str) -> str:
    return s.replace("I", "ı").replace("İ", "i").lower()


def trup(s: str) -> str:
    return s.translate(TR_UPPER).upper()


KESME = str.maketrans("’‘`´", "'" * 4)


def anahtar(s: str) -> str:
    return trlow(s).translate(CIRCUMFLEX_FOLD).translate(KESME)


def yalniz_noktali_fark(a: str, b: str) -> bool:
    """İki kelime sadece ı/i (I/İ) farkıyla mı ayrılıyor? GLM-OCR'ın bilinen
    alışkanlığı: "Hızır'ın" -> "Hızır'in". Bu farkta Tesseract kalır."""
    fold = str.maketrans("ıİI", "iii")
    a, b = kesme_duzelt(a), kesme_duzelt(b)
    return a != b and len(a) == len(b) and anahtar(a).translate(fold) == anahtar(b).translate(fold)


_CEKIRDEK = re.compile(rf"^([^{TR_LETTERS}0-9\ufffe\ufffd\uffff\ue000-\uf8ff\u0100-\u024f]*)(.*?)"
                       rf"([^{TR_LETTERS}0-9\ufffe\ufffd\uffff\ue000-\uf8ff\u0100-\u024f]*)$", re.S)


def parcala(tok: str):
    """'"Rayiha'nın,' -> ('"', "Rayiha'nın", ',')"""
    m = _CEKIRDEK.match(tok)
    on, cek, son = m.group(1), m.group(2), m.group(3)
    # Kitapta bağlı harf glifi olduğu anlaşılan Latin-1 harfler (å=fi, ý=fl) noktalama sayılmasın:
    # kelime başında/sonunda kalınca ("åkri", "telaå") kesilip onarımdan kaçıyordu.
    if DINAMIK_BOZUK:
        while on and on[-1] in DINAMIK_BOZUK:
            on, cek = on[:-1], on[-1] + cek
        while son and son[0] in DINAMIK_BOZUK:
            cek, son = cek + son[0], son[1:]
    return on, cek, son


# ------------------------------------------------------------- sözlük --

class Sozluk:
    """editor.py'nin Hunspell sözlüklerini kullanır; yoksa None döner (bilinmiyor)."""

    def __init__(self):
        self.dicts = None
        self.fn = None
        test = os.environ.get("KITAP_TEST_SOZLUK")          # yalnız testler için: düz kelime listesi
        if test:
            words = set(Path(test).read_text(encoding="utf-8").split())
            words |= {w.translate(CIRCUMFLEX_FOLD) for w in words}
            self.fn = lambda _d, w: (w in words or trlow(w) in words
                                     or w.translate(CIRCUMFLEX_FOLD) in words or trlow(w).translate(CIRCUMFLEX_FOLD) in words)
            self.dicts = True
            return
        try:
            import editor
            self.dicts = editor.load_dictionaries()
            self.fn = editor.is_valid
        except SystemExit:
            print("  [UYARI] Türkçe sözlük (tr_TR.dic) yok: sadece güven puanına bakılacak.")
        except Exception as e:  # spylls kurulu değil vb.
            print(f"  [UYARI] Sözlük yüklenemedi ({e}): sadece güven puanına bakılacak.")

    @property
    def var(self):
        return self.dicts is not None

    def gecerli(self, w: str):
        if not self.var or not w:
            return None
        if self.fn(self.dicts, w):
            return True
        for ayrac in ("'", "’"):           # Tarlabaşı'nda -> kök + ek
            if ayrac in w:
                kok = w.split(ayrac)[0]
                return bool(kok) and kok[0].isupper() and bool(self.fn(self.dicts, kok))
        return False


# ---------------------------------------------------------- tesseract --

class Tesseract:
    def __init__(self, lang="tur"):
        self.lang = lang
        self.cmd = self._bul()
        self.tessdata = []
        yerel = ROOT / "tessdata"
        if (yerel / f"{lang}.traineddata").exists():
            self.tessdata = ["--tessdata-dir", str(yerel)]
        self.hata = None
        if not self.cmd:
            self.hata = ("Tesseract bulunamadı. Kurmak için: winget install UB-Mannheim.TesseractOCR "
                         "(başka yerdeyse KITAP_TESSERACT ortam değişkenine yolunu yaz)")
        else:
            r = self._calistir([*self.tessdata, "--list-langs"], None, hata_da=True)
            if not self.tessdata and lang not in r.split():
                self.hata = (f"Tesseract'ta '{lang}' dil modeli yok. tur.traineddata dosyasını "
                             f"{yerel} klasörüne koy (tessdata_best önerilir).")

    @staticmethod
    def _bul():
        exe = "tesseract.exe" if os.name == "nt" else "tesseract"
        # paketli kurulumda Tesseract betiklerin yanında gelir: resources/py -> resources/tesseract
        adaylar = [os.environ.get("KITAP_TESSERACT"), str(ROOT / "tesseract" / exe),
                   str(ROOT.parent / "tesseract" / exe), shutil.which("tesseract"),
                   r"C:\Program Files\Tesseract-OCR\tesseract.exe",
                   r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
                   "/opt/homebrew/bin/tesseract", "/usr/local/bin/tesseract", "/usr/bin/tesseract"]
        return next((a for a in adaylar if a and Path(a).exists()), None)

    def _calistir(self, args, girdi, timeout=300, hata_da=False):
        env = dict(os.environ, OMP_THREAD_LIMIT="1")    # paralel çalışırken her biri tek çekirdek
        kw = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
        r = subprocess.run([self.cmd, *args], input=girdi, capture_output=True, env=env, timeout=timeout, **kw)
        out = (r.stdout or b"").decode("utf-8", "ignore")
        if hata_da:
            out += "\n" + (r.stderr or b"").decode("utf-8", "ignore")
        return out

    def oku_tsv(self, png: bytes, psm=3):
        # "tsv" ayar dosyası yerine -c: --tessdata-dir verilince Tesseract ayar dosyalarını o klasörde
        # arar (tessdata/configs/tsv), bulamazsa sessizce düz metin döner.
        out = self._calistir(["stdin", "stdout", "-l", self.lang, "--oem", "1", "--psm", str(psm), *self.tessdata,
                              "-c", "tessedit_create_tsv=1", "-c", "tessedit_create_txt=0"], png)
        if out.strip() and not out.lstrip().startswith("level"):
            raise RuntimeError("Tesseract kelime konumlarını (TSV) vermedi: " + out[:120].replace("\n", " "))
        return out

    def oku_metin(self, png: bytes, psm=6):
        out = self._calistir(["stdin", "stdout", "-l", self.lang, "--oem", "1", "--psm", str(psm),
                              *self.tessdata], png)
        return out.strip()


_ICTIRNAK = re.compile(rf"(?<=[{TR_LETTERS}])(?:[”“\"]+['’]?|['’][”“\"]+)(?=[{TR_LETTERS}])")


def kesme_duzelt(m: str) -> str:
    """Tesseract kesme işaretini tırnak sanabiliyor: Caddesi”ndeki, Üsküdar”'ın -> Caddesi'ndeki, Üsküdar'ın"""
    return _ICTIRNAK.sub("'", m)


def tsv_satirlar(tsv: str, olcek: float):
    """Tesseract TSV -> satırlar. Koordinatlar PDF puntosuna çevrilir (olcek = 72/dpi)."""
    satirlar, sira = {}, []
    for ln in tsv.splitlines()[1:]:
        p = ln.split("\t")
        if len(p) < 12 or p[0] != "5" or not p[11].strip():
            continue
        key = (int(p[2]), int(p[3]), int(p[4]))
        x, y, w, h = (int(v) * olcek for v in p[6:10])
        if key not in satirlar:
            satirlar[key] = {"blok": key[0], "kelimeler": []}
            sira.append(key)
        satirlar[key]["kelimeler"].append({"m": kesme_duzelt(p[11].strip()), "c": float(p[10]),
                                           "k": [x, y, x + w, y + h]})
    return [satirlar[k] for k in sira]


# ------------------------------------------------------- metin katmanı --

_MOJI = re.compile("[\u00c2-\u00f4][\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6"
                   "\u02dc\u2013\u2014\u2018-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]+")
CP1254_KAYMA = str.maketrans("ýþðÝÞÐ", "ışğİŞĞ")
TURKCE = set("çğıöşüÇĞİÖŞÜ")


def _moji_onar(s: str) -> str:
    def tek(m):
        try:
            return m.group().encode("cp1252").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            return m.group()
    return _MOJI.sub(tek, s)


def onarici(ad):
    def f(s):
        for a, b in LIGATUR.items():
            s = s.replace(a, b)
        if ad in ("moji", "moji+cp1254"):
            s = _moji_onar(s)
        if ad in ("cp1254", "moji+cp1254"):
            s = s.translate(CP1254_KAYMA)
        return s
    return f


def katman_sina(doc, sozluk: Sozluk, tess: Tesseract, dpi: int):
    """(kullanılabilir_mi, onarım_adı, açıklama)"""
    n = len(doc)
    if n == 0:
        return False, None, "boş PDF"
    orn = sorted({int(n * k / 11) for k in range(1, 11)}) if n > 12 else list(range(n))
    ham = "\n".join(doc[i].get_text("text") for i in orn)
    harf = sum(c.isalpha() for c in ham)
    if harf / len(orn) < 300:
        return False, None, "metin katmanı yok (ya da çok az)"

    moji = sum(len(m.group()) for m in _MOJI.finditer(ham))
    kayma = sum(ham.count(c) for c in "ýþðÝÞÐ")
    turk = sum(ham.count(c) for c in "ışğİŞĞ")
    ad = None
    if moji / harf > 0.002:
        ad = "moji"
    if kayma / harf > 0.003 and kayma > 3 * turk:
        ad = "moji+cp1254" if ad else "cp1254"
    metin = onarici(ad)(ham)
    harf = sum(c.isalpha() for c in metin) or 1

    kalan_moji = sum(len(m.group()) for m in _MOJI.finditer(metin))
    if kalan_moji / harf > 0.002:
        return False, ad, f"kodlama bozuk ve onarılamadı (%{kalan_moji / harf * 100:.1f} bozuk karakter)"
    tr_oran = sum(c in TURKCE for c in metin) / harf
    if tr_oran < 0.04:
        return False, ad, f"Türkçe karakterler eksik ya da bozuk (ç ğ ı ö ş ü oranı %{tr_oran * 100:.1f})"
    kelimeler = re.findall(rf"[{TR_LETTERS}]+", "".join(c for c in metin if not bozuk_mu(c)))
    ort = sum(map(len, kelimeler)) / max(1, len(kelimeler))
    if ort > 11:
        return False, ad, f"kelime arası boşluklar kaybolmuş (ortalama kelime {ort:.1f} harf)"
    bozuk = sum(bozuk_mu(c) for c in metin)

    if sozluk.var:
        kucuk = [w for w in kelimeler if w[0].islower() and len(w) > 2][:800]
        oran = sum(bool(sozluk.gecerli(w)) for w in kucuk) / max(1, len(kucuk))
        if oran < 0.75:
            return False, ad, f"kelimelerin sadece %{oran * 100:.0f}'i sözlükte (katman güvenilmez)"

    if not tess.hata:  # katman sayfadaki yazıyla uyuşuyor mu, Tesseract'tan temiz mi? (eski OCR katmanlarına karşı)
        f = onarici(ad)
        uyum = []
        kirli = {"katman": [0, 0], "tess": [0, 0]}
        kirli_ornek = []

        def kelimeler_(metin):
            out = []
            for tok in ocr.dehyphenate(metin).split():      # satır sonu bölünmeleri parça sayılmasın
                cek = parcala(tok)[1]
                if cek and not any(bozuk_mu(c) for c in cek) and re.fullmatch(rf"[{TR_LETTERS}'’]+", cek):
                    out.append(cek)
            return out

        for i in orn[len(orn) // 3: len(orn) // 3 + 3]:
            kw = kelimeler_(f(doc[i].get_text("text")))
            png = doc[i].get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY).tobytes("png")
            tw = kelimeler_(tess.oku_metin(png, psm=3))
            if len(kw) > 30 and len(tw) > 30:
                uyum.append(difflib.SequenceMatcher(None, [anahtar(w) for w in kw], [anahtar(w) for w in tw],
                                                    autojunk=False).ratio())
            if sozluk.var:
                for ad_, ws in (("katman", kw), ("tess", tw)):
                    kucuk = [w for w in ws if w[0].islower() and len(w) > 2]
                    kotu = [w for w in kucuk if not sozluk.gecerli(w)]
                    if ad_ == "katman":
                        kirli_ornek.extend(kotu)
                    kirli[ad_][0] += len(kotu)
                    kirli[ad_][1] += len(kucuk)
        if uyum and min(uyum) < 0.8:
            return False, ad, f"katman sayfadaki yazıyla uyuşmuyor (uyum %{min(uyum) * 100:.0f})"
        (kk, kn), (tk, tn) = kirli["katman"], kirli["tess"]
        if kn > 100 and tn > 100:
            ko, to = kk / kn, tk / tn
            print(f"  Sözlük dışı kelime oranı: katman %{ko * 100:.1f}, Tesseract %{to * 100:.1f}"
                  f"  (katmandan örnek: {', '.join(kirli_ornek[:12]) or '-'})")
            # Dijital metin katmanında sözlük dışı kelime oranı Tesseract'ınkinden düşük olur
            # (Tesseract hata ekler, katman eklemez). Yüksekse katman eski/kötü bir OCR çıktısıdır.
            if ko > to + 0.003:
                return False, ad, (f"katman eski bir OCR çıktısı gibi: sözlük dışı kelime oranı %{ko * 100:.1f}, "
                                   f"Tesseract'ınki %{to * 100:.1f}")

    if tess.hata:
        # Tesseract yok: katmanı sayfadaki yazıyla karşılaştıramıyoruz. Eski OCR katmanlarını yakalamak için
        # sözlük dışı kelime oranına sıkı bir sınır konur (dijital katman ~%0,2-0,6, eski OCR katmanı %2+).
        if not sozluk.var:
            return False, ad, "Tesseract ve sözlük yok: katmanın doğruluğu sınanamıyor, güvenilmedi"
        kucuk = []
        for tok in ocr.dehyphenate(metin).split():
            cek = parcala(tok)[1]
            if (cek and len(cek) > 2 and cek[0].islower() and not any(bozuk_mu(c) for c in cek)
                    and re.fullmatch(rf"[{TR_LETTERS}'’]+", cek)):
                kucuk.append(cek)
        kucuk = kucuk[:1500]
        kirli_oran = sum(not sozluk.gecerli(w) for w in kucuk) / max(1, len(kucuk))
        if kirli_oran > 0.012:
            return False, ad, (f"katman eski bir OCR çıktısı olabilir (sözlük dışı kelime %{kirli_oran * 100:.1f}; "
                               f"Tesseract kurulu olmadığı için sayfayla karşılaştırılamadı)")

    notlar = [f"onarım: {ad}"] if ad else []
    if bozuk:
        notlar.append(f"örnek sayfalarda {bozuk} bozuk bağlı harf (onarılacak)")
    return True, ad, "metin katmanı sağlam" + (f" ({'; '.join(notlar)})" if notlar else "")


def katman_satirlar(page, onar):
    """pymupdf kelimeleri -> satırlar (tsv_satirlar ile aynı biçim)."""
    satirlar, sira = {}, []
    for x0, y0, x1, y1, w, b, l, _ in page.get_text("words"):
        key = (b, l)
        if key not in satirlar:
            satirlar[key] = {"blok": b, "kelimeler": []}
            sira.append(key)
        satirlar[key]["kelimeler"].append({"m": onar(w), "c": 100.0, "k": [x0, y0, x1, y1]})
    return [satirlar[k] for k in sira]


# --------------------------------------------------- satır / paragraf --

def _medyan(xs, vars=0.0):
    xs = sorted(xs)
    return xs[len(xs) // 2] if xs else vars


def satir_kutusu(s):
    ks = [w["k"] for w in s["kelimeler"]]
    return [min(k[0] for k in ks), min(k[1] for k in ks), max(k[2] for k in ks), max(k[3] for k in ks)]


def paragraflari_bul(satirlar):
    """Her satıra 'yeni' (yeni paragraf başlıyor mu) işareti koyar: girinti,
    önceki satırın kısa bitmesi, büyük dikey boşluk, ortalanmış satır, blok değişimi."""
    if not satirlar:
        return
    for s in satirlar:
        s["kutu"] = satir_kutusu(s)
    uzun = [s for s in satirlar if len(s["kelimeler"]) >= 4] or satirlar
    sol = _medyan([s["kutu"][0] for s in uzun])
    sag = _medyan([s["kutu"][2] for s in uzun])
    harf_g = _medyan([(w["k"][2] - w["k"][0]) / max(1, len(w["m"])) for s in uzun for w in s["kelimeler"]], 5.0)
    araliklar = [b["kutu"][1] - a["kutu"][1] for a, b in zip(satirlar, satirlar[1:]) if b["kutu"][1] > a["kutu"][1]]
    aralik = _medyan(araliklar, 14.0)
    onceki = None
    for s in satirlar:
        x0, y0, x1, _ = s["kutu"]
        ilk = s["kelimeler"][0]["m"]
        ortali = x0 - sol > 4 * harf_g and sag - x1 > 4 * harf_g
        if onceki is None:
            s["yeni"] = True
        else:
            px0, py0, px1, _ = onceki["kutu"]
            girinti = x0 - sol > 1.2 * harf_g
            kisa = px1 < sag - 3 * harf_g
            bosluk = y0 - py0 > 1.7 * aralik
            bas = ilk[:1].isupper() or ilk[:1] in "—–-\"“‘'«(" or ilk[:1].isdigit()
            s["yeni"] = (girinti or bosluk or ortali or onceki.get("ortali") or s["blok"] != onceki["blok"]
                         or (kisa and bas)) and not s.get("devam")
        s["ortali"] = ortali
        onceki = s


def jetonlar(satirlar, sozluk: Sozluk):
    """Satırlar -> okuma sırasında kelime listesi. Satır sonu tireli kelimeler
    birleştirilir (birleşince geçersiz, parçalar geçerliyse 'gidiş-geliş' korunur)."""
    out, atla = [], set()
    para = -1
    for si, s in enumerate(satirlar):
        if s.get("yeni"):
            para += 1
        ws = s["kelimeler"]
        for wi, w in enumerate(ws):
            if (si, wi) in atla:
                continue
            j = {"m": w["m"], "c": w["c"], "s": [si], "p": max(para, 0)}
            for anah in ("sus_devam", "kutu_sol", "kutu_alt", "ek_satir", "bosluk_ilk"):
                if anah in w:
                    j[anah] = w[anah]
            son = wi == len(ws) - 1
            if (son and si + 1 < len(satirlar) and not satirlar[si + 1].get("yeni")
                    and len(w["m"]) > 2 and (w["m"][-1] in "-\u00ad" or bozuk_mu(w["m"][-1])) and w["m"][-2].isalpha()):
                sonraki = satirlar[si + 1]["kelimeler"][0]
                bozuk_son = bozuk_mu(w["m"][-1])
                if bozuk_son and sozluk.var and not sozluk.gecerli(parcala(w["m"][:-1] + sonraki["m"])[1]):
                    pass                                   # birleşince geçersiz: bağlı harf olarak çözülecek
                elif sonraki["m"][:1].islower():
                    # Satır sonu tiresi her zaman birleşir (ocr.py ile aynı kural). Parçaların ikisi de geçerli
                    # diye tireyi korumak yanlış: "gördü-" + "güne" (ğ okunamamış) gerçek tire değildir.
                    # Birleşen kelime geçersizse şüpheli sayılır ve yapay zekâya sorulur.
                    birlesik = w["m"][:-1] + sonraki["m"]
                    j = {"m": birlesik, "c": min(w["c"], sonraki["c"]), "s": [si, si + 1], "p": max(para, 0)}
                    atla.add((si + 1, 0))
            out.append(j)
    return out


def sayfa_metni(js):
    paras = {}
    for j in js:
        if j.get("sil"):
            continue
        paras.setdefault(j["p"], []).append(j["m"])
    return "\n\n".join(" ".join(ws) for _, ws in sorted(paras.items()))


# ------------------------------------------------------------ şüphe --

# Tesseract'ın Türkçe modeli nispet î'sini okumuyor ("resmî" -> "resmi"). Şapkasız hali de geçerli bir
# kelime olduğu için ("onun resmi" / "resmî evrak") körü körüne şapka konamaz: bu kelimeler yapay zekânın
# satır okumasına eklenir, sayfada şapka görülürse konur. Liste Türkçenin genel nispet sıfatlarıdır.
NISPET_I = {anahtar(w) for w in (
    "resmî dinî millî askerî siyasî ilmî edebî ahlakî fikrî hukukî iktisadî içtimaî tabiî ilahî kalbî "
    "mahallî şahsî zihnî ruhî maddî manevî beşerî tarihî hayalî insanî dahilî haricî cehennemî ticarî "
    "tıbbî kimyevî fennî harbî bahrî lügavî nebatî hayvanî sınaî ziraî adlî mülkî idarî iradî").split()}


def sapka_sayisi(s: str) -> int:
    return sum(c in "âîûÂÎÛ" for c in s)


def rn_m_supheli(cek: str, sozluk: Sozluk, frekans: Counter) -> bool:
    """Tesseract'ın rn/rm <-> m karışması geçerli kelime de üretebilir ("Ama" -> "Arma", "modern" ->
    "modem"). Karşı biçim de geçerliyse ve kitapta çok daha sık geçiyorsa kelime şüphelidir."""
    if not sozluk.var:
        return False
    k = anahtar(cek)
    adaylar = [k.replace(x, "m", 1) for x in ("rn", "rm") if x in k]       # "Arna"/"Arma" -> "Ama"
    adaylar += [k[:i] + "rn" + k[i + 1:] for i, c in enumerate(k) if c == "m"][:3]
    for a in adaylar:
        if a != k and frekans[a] >= 3 * frekans[k] + 2 and sozluk.gecerli(a):
            return True
    return False


def suphe(j, sozluk: Sozluk, isimler: Counter, katman: bool, frekans: Counter = None):
    _, cek, _ = parcala(j["m"])
    if not cek:
        return None
    if any(bozuk_mu(c) for c in cek):
        return "glif"
    if katman:                      # dijital metin: sadece bozuk karakterler şüpheli
        return None
    if j.get("sus_devam"):
        return "süs harfi"
    harf = any(c.isalpha() for c in cek)
    rakam = any(c.isdigit() for c in cek)
    c = j["c"]
    if rakam and not harf:
        return None if c >= RAKAM_GUVEN else "düşük güven"
    if rakam:
        if c >= 80 and re.fullmatch(rf"\d+['’][{TR_LETTERS}]+", cek):
            return None
        return "rakam-harf karışık"
    kesmeli = re.fullmatch(rf"([{TR_LETTERS}]+)['’]([{TR_LETTERS}]{{1,6}})", cek)
    if kesmeli and cek[0].isupper() and c >= 30:
        # "Ferhat'ı", "Tarlabaşı'nın": Tesseract kesme işaretli kelimelere düşük güven verir;
        # kök büyük harfli ve ek kısa harf dizisiyse özel isim + ek. Yapay zekâya sormak hem boşa
        # vakit hem de ek harflerini bozma riski (GLM: "Hızır'ın" -> "Hızır'in").
        kok = kesmeli.group(1)
        if c >= 60 or isimler[kok] >= 1 or sozluk.gecerli(kok) is not False:
            return None
    if c < DUSUK_GUVEN:
        return "düşük güven"
    g = sozluk.gecerli(cek)
    if g is None:
        return None if c >= 80 else "düşük güven"
    if g:
        if frekans is not None and rn_m_supheli(cek, sozluk, frekans):
            return "rn/m karışması"
        if not sapka_sayisi(cek) and anahtar(cek) in NISPET_I:
            return "şapka?"                      # resmi / resmî: sayfaya bakılacak
        return None
    if cek[0].isupper():
        if frekans is not None and rn_m_supheli(cek, sozluk, frekans):
            return "rn/m karışması"            # "Arna" isim değil, "Ama"
        kok = re.split("['’]", cek)[0]
        if c >= ISIM_GUVEN or isimler[kok] >= ISIM_MIN_SAYI:
            return None
    return "sözlükte yok"


GLIF_OGRENILEN = {}     # glif karakteri -> Counter(bağlı harf): kitap boyunca tek anlamlı çözümlerden öğrenilir


def glif_ogren(cek: str, cozum: str):
    """Tek glifli kelimenin çözümünden glifin hangi harfleri temsil ettiğini kaydeder."""
    yer = [i for i, c in enumerate(cek) if bozuk_mu(c)]
    if len(yer) != 1 or not cozum:
        return
    i = yer[0]
    uzun = len(cozum) - (len(cek) - 1)
    if uzun >= 0 and cozum[:i] == cek[:i] and cozum[i + uzun:] == cek[i + 1:]:
        GLIF_OGRENILEN.setdefault(cek[i], Counter())[anahtar(cozum[i:i + uzun])] += 1


def glif_ogrenilen(ch: str):
    """Glifin kitapta açıkça baskın olan karşılığı (en az 3 örnek, %80 pay) ya da None."""
    c = GLIF_OGRENILEN.get(ch)
    if not c:
        return None
    aday, n = c.most_common(1)[0]
    return aday if n >= 3 and n / sum(c.values()) >= 0.8 else None


def glif_coz(cek: str, sozluk: Sozluk, frekans: Counter, ipucu: str = None):
    """Bozuk bağlı harfli kelimeyi çözer. (çözüm ya da None, yöntem)"""
    yerler = [i for i, c in enumerate(cek) if bozuk_mu(c)]
    if len(yerler) > 3:
        return None, "çok bozuk"
    buyuk = cek.isupper()
    # "" adayı: bazı PDF'lerde bozuk karakter bağlı harf değil, kaldırılmış satır sonu tiresidir
    # ("bu?çukta" -> "buçukta"). Sözlük hangisinin geçerli olduğuna karar verir.
    # Bağlı harf glifleri (ƨ, Ɵ...) her zaman en az iki harftir: boş aday yalnız gerçek bozuk karakterde.
    bos_aday = [""] if all(cek[i] not in DINAMIK_BOZUK for i in yerler) else []
    adaylar = bos_aday + (LIG_ADAY if len(yerler) == 1 else LIG_ADAY[:14])   # 2-3 bozuk karakterde kombinasyon patlamasın
    adaylar = [trup(a) for a in adaylar] if buyuk else adaylar
    sonuc = []
    for kombo in product(adaylar, repeat=len(yerler)):
        s, it = [], iter(kombo)
        for c in cek:
            s.append(next(it) if bozuk_mu(c) else c)
        sonuc.append("".join(s))
    if ipucu:
        ip = anahtar(ipucu)
        for s in sonuc:
            if anahtar(s) == ip:
                return s, "satır okumasıyla"
    gecerli = [s for s in sonuc if sozluk.gecerli(s)] if sozluk.var else []
    bos = "".join(c for c in cek if not bozuk_mu(c))
    if len(gecerli) > 1 and bos in gecerli:
        # Karakteri silmek de bağlı harfle doldurmak da geçerliyse ("anlamış?" -> anlamış / anlamıştı)
        # bağlı harf seçilir: silince geçerli kısa bir kelime kalması çoğu zaman tesadüftür.
        gecerli.remove(bos)
    if len(gecerli) == 1:
        return gecerli[0], "sözlük"
    if len(gecerli) > 1 and len(yerler) == 1:
        # Bir glif kitap boyunca hep aynı bağlı harftir: başka kelimelerden öğrenileni kullan
        # ("haŌa": hafta mı hatta mı? Ō başka yerlerde hep "ft" çıkıyorsa hafta).
        tercih = glif_ogrenilen(cek[yerler[0]])
        if tercih is not None:
            i = yerler[0]
            uyan = [g for g in gecerli if len(g) == len(cek) - 1 + len(tercih)
                    and anahtar(g[i:i + len(tercih)]) == tercih]
            if len(uyan) == 1:
                return uyan[0], "kitapta öğrenilen eşleme"
    havuz = gecerli or ([] if sozluk.var else [x for x in sonuc if x != bos] or sonuc)
    sik = [s for s in havuz if frekans[anahtar(s)] > 0]
    if len(gecerli) > 1 and not ipucu:
        return None, "birden çok aday"          # satır okuması istenecek
    if sik:
        return max(sik, key=lambda s: frekans[anahtar(s)]), "kitaptaki sıklık"
    if gecerli:
        return gecerli[0], "sözlük (ilk aday)"
    return None, "aday bulunamadı"


# ---------------------------------------------------------- yapay zekâ --

class Okuyucu:
    """Kırpılmış satır(lar)ı yapay zekâya okutur."""

    def __init__(self, model, kapali=False):
        self.model = model
        self.cagri = 0
        self.sure = 0.0
        self.sim = None
        test = os.environ.get("KITAP_TEST_VLM_JSON")       # yalnız testler için: önceki tam sayfa okumaları
        if test:
            self.sim = json.loads(Path(test).read_text(encoding="utf-8"))["pages"]
            self.acik = True
            return
        self.acik = not kapali and self._model_var()

    def _model_var(self):
        try:
            with urllib.request.urlopen(config.OLLAMA_URL.replace("/api/chat", "/api/tags"), timeout=3) as r:
                adlar = {m["name"] for m in json.load(r).get("models", [])}
        except Exception:
            print("  [UYARI] Ollama'ya ulaşılamadı: şüpheli kelimeler yapay zekâya sorulmayacak.")
            return False
        if self.model in adlar or f"{self.model}:latest" in adlar:
            return True
        print(f"  [UYARI] {self.model} kurulu değil (ollama pull {self.model}): yapay zekâsız devam.")
        return False

    def oku(self, page, kutu, dpi, sayfa_no=None):
        if self.sim is not None:
            return self.sim.get(str(sayfa_no), "")
        t0 = time.time()
        pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY, clip=pymupdf.Rect(*kutu))
        b64 = base64.b64encode(pix.tobytes("png")).decode()
        satir_sayi = max(1, round((kutu[3] - kutu[1]) / 12))
        try:
            metin, _ = ocr.call_ollama(self.model, MODEL_KOMUT.get(self.model.split(":")[0], VARSAYILAN_KOMUT),
                                       images=[b64], num_predict=80 * satir_sayi + 60)
        except Exception as e:
            print(f"  [UYARI] {self.model} okuyamadı: {e}")
            metin = ""
        self.cagri += 1
        self.sure += time.time() - t0
        return metin or ""


def kirp_kutusu(satirlar, idx, page_rect):
    ks = [satirlar[i]["kutu"] for i in idx]
    x0, y0 = min(k[0] for k in ks), min(k[1] for k in ks)
    x1, y1 = max(k[2] for k in ks), max(k[3] for k in ks)
    h = max(k[3] - k[1] for k in ks)
    py = max(8 * 72 / 300, 0.35 * h)      # ±8 px (300 dpi'da) ya da satır yüksekliğinin %35'i
    px = 0.6 * h
    return [max(page_rect.x0, x0 - px), max(page_rect.y0, y0 - py),
            min(page_rect.x1, x1 + px), min(page_rect.y1, y1 + py)]


def vlm_kelimeler(metin: str):
    metin = re.sub(r"[#*`]", " ", metin)
    metin = ocr.dehyphenate(metin)
    return metin.split()


_SADE = str.maketrans("ğışçöüâîûĞİŞÇÖÜ", "giscouaiugiscou")


def benzerlik(a: str, b: str) -> float:
    """Türkçe harf farkları (ğ/g, ı/i, ş/s...) yok sayılarak benzerlik."""
    return difflib.SequenceMatcher(None, anahtar(a).translate(_SADE), anahtar(b).translate(_SADE)).ratio()


def karar(j, g_tok, sozluk: Sozluk, neden):
    """Tesseract kelimesi j ile modelin okuduğu g_tok arasında seçim. Yeni metin ya da None."""
    on, tc, son = parcala(j["m"])
    _, gc, _ = parcala(g_tok)
    if neden == "süs harfi":
        # model süslü ilk harfi okudu: "vin" -> "Evin" (yalnız başa eklenen harfler kabul)
        if gc and len(gc) == len(tc) + 1 and gc[0].isalpha() and anahtar(gc).endswith(anahtar(tc)):
            return on + gc + son
        return None
    if neden == "şapka?":
        # Sadece şapka farkı kabul edilir: model sayfada "resmî" görüyorsa şapka konur, başka hiçbir şey değişmez
        if gc and sapka_sayisi(gc) > sapka_sayisi(tc) and anahtar(gc) == anahtar(tc):
            yeni = "".join(g if g in "âîûÂÎÛ" else t for t, g in zip(tc, gc)) if len(gc) == len(tc) else tc
            return on + yeni + son if yeni != tc else None
        return None
    if not gc or anahtar(gc) == anahtar(tc):
        return None
    if "-" in gc and "-" not in tc and sozluk.gecerli(gc.replace("-", "")):
        gc = gc.replace("-", "")                      # model satır sonu tiresini korumuş: "olamayacağı-nı"
    if any(c.isdigit() for c in gc) and not any(c.isdigit() for c in tc):
        return None                                   # model rakam uydurdu: "Christmas'1"
    if benzerlik(tc, gc) < 0.62:
        return None                                   # okumalar çok farklı: "degil" -> "değer" gibi uydurma
    tv, gv = sozluk.gecerli(tc), sozluk.gecerli(gc)
    if yalniz_noktali_fark(tc, gc) and not (gv and not tv):
        return None
    if gv is None:                                      # sözlük yok
        al = j["c"] < 75
    elif gv and not tv:
        al = True
    elif gv and tv:
        al = j["c"] < 85 or neden == "rn/m karışması"
    elif not gv and not tv:
        benz = difflib.SequenceMatcher(None, anahtar(tc), anahtar(gc)).ratio()
        al = j["c"] < 60 and benz >= 0.5
    else:
        al = False
    if not al:
        return None
    if tc[:1].isupper() and gc[:1].islower():           # cümle başı büyük harfi korunur
        gc = trup(gc[0]) + gc[1:]
    return on + gc + son


ISIM_DOGRULA_EN_COK = 30   # GLM-OCR'a sorulacak en fazla isim (sık geçenler önce)
ISIM_DUR_ARDISIK = 10      # üst üste bu kadar isim Tesseract'la aynı okunursa kalanlar sorulmaz
SAPKA_DENEME = 10          # bu kadar şapka adayında hiç şapka çıkmazsa kitap şapka kullanmıyor demektir
SAPKA_KELIME_DENEME = 3    # aynı kelime ("tarihi") bu kadar sorulup hiç şapkalı çıkmazsa o kelime bırakılır


def hizala_tek(js, idx_list, g_words, hedef):
    """js[idx_list] ile modelin kelimelerini hizalar; js[hedef]'e 1:1 denk gelen model kelimesi ya da None."""
    t = [anahtar(parcala(js[i]["m"])[1]) for i in idx_list]
    g = [anahtar(parcala(w)[1]) for w in g_words]
    if not g or hedef not in idx_list:
        return None
    k = idx_list.index(hedef)
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, t, g, autojunk=False).get_opcodes():
        if i1 <= k < i2 and op in ("equal", "replace") and i2 - i1 == j2 - j1:
            return parcala(g_words[j1 + (k - i1)])[1]
    return None


def isimleri_dogrula(sayfa_js, sayfalar_satir, kaynak, doc, okuyucu, sozluk, dpi, kayit):
    """Tesseract'ın sürekli aynı biçimde yanlış okuduğu isimler ("Longbourn" -> hep "Longboum") sık ve
    tutarlı geçtikleri için isim sayılıp hiç sorulmaz. Sık geçen her isim bir kez yapay zekâya sorulur;
    model farklı okursa ikinci bir örnekle doğrulanır, iki okuma aynı yazımı verirse kitaptaki bütün
    geçişler düzeltilir."""
    gecis = {}
    for i, js in sayfa_js.items():
        if kaynak.get(i) != "tesseract":
            continue
        for x, j in enumerate(js):
            _, cek, _ = parcala(j["m"])
            if (cek and cek[0].isupper() and not j.get("neden") and not j.get("sil") and len(cek) >= 4
                    and re.fullmatch(rf"[{TR_LETTERS}'’]+", cek) and not sozluk.gecerli(cek)):
                kok = re.split("['’]", cek)[0]
                if len(kok) >= 4 and not cek.isupper():
                    gecis.setdefault(kok, []).append((j["c"], i, x))
    adaylar = sorted((k for k, v in gecis.items() if len(v) >= 2), key=lambda k: -len(gecis[k]))
    adaylar = adaylar[:ISIM_DOGRULA_EN_COK]
    if not adaylar:
        return
    print(f"  Sık geçen {len(adaylar)} isim yapay zekâyla doğrulanıyor...", flush=True)

    def oku(kok, orn):
        _, i, x = orn
        js, satirlar = sayfa_js[i], sayfalar_satir[i]
        kutu = kirp_kutusu(satirlar, js[x]["s"], doc[i].rect)
        g = vlm_kelimeler(okuyucu.oku(doc[i], kutu, dpi, i))
        idx = [y for y, j in enumerate(js) if set(j["s"]) & set(js[x]["s"])]
        gw = hizala_tek(js, idx, g, x)
        return re.split("['’]", gw)[0] if gw else None

    ardisik_ayni = 0
    for kok in adaylar:
        if ardisik_ayni >= ISIM_DUR_ARDISIK:
            print(f"    Üst üste {ISIM_DUR_ARDISIK} isim doğru okunmuş: kalan isimler sorulmadı.", flush=True)
            break
        ornekler = sorted(gecis[kok], reverse=True)          # en yüksek güvenli örnekler önce
        ilk = oku(kok, ornekler[0])
        if not ilk or anahtar(ilk) == anahtar(kok) or benzerlik(ilk, kok) < 0.62 or any(c.isdigit() for c in ilk):
            ardisik_ayni += 1
            continue
        ardisik_ayni = 0
        ikinci = oku(kok, ornekler[1])
        if not ikinci or anahtar(ikinci) != anahtar(ilk):
            continue
        yeni_kok = ilk[0].upper() + ilk[1:] if kok[0].isupper() else ilk
        for _, i, x in gecis[kok]:
            j = sayfa_js[i][x]
            eski = j["m"]
            j["m"] = eski.replace(kok, yeni_kok, 1)
            j["onay"] = True
        kayit["duzeltme"].append((ornekler[0][1] + 1, kok, yeni_kok, f"isim doğrulama, {len(gecis[kok])} geçiş"))
        print(f"    {kok} -> {yeni_kok} ({len(gecis[kok])} yerde)", flush=True)


def kirinti_mi(j, sozluk: Sozluk) -> bool:
    """Süsleme/leke okuması gibi duran kelime: en fazla 2 harf (ya da 3 BÜYÜK harf), sözlükte yok."""
    _, cek, _ = parcala(j["m"])
    if not cek:
        return True
    kisa = len(cek) <= 2 or (len(cek) <= 3 and cek.isupper())
    if kisa and j["c"] < 25 and (cek.isdigit() or (len(cek) == 1 and cek not in "oaeOAE") or cek.isupper()):
        return True                                 # "4", "M", "TÜ" (güven 0-25): sözlükte olsa da kırıntı
    return kisa and j["c"] < 90 and not (sozluk.var and sozluk.gecerli(cek))


def grup_duzelt(js, idx_list, g_words, sozluk, frekans, kayit, sayfa_no):
    """js[idx_list] (Tesseract/katman kelimeleri) ile modelin kelimelerini hizalar,
    sadece şüpheli kelimeleri değiştirir."""
    t = [anahtar(parcala(js[i]["m"])[1]) for i in idx_list]
    g = [anahtar(parcala(w)[1]) for w in g_words if parcala(w)[1]]
    if not g and all(kirinti_mi(js[i], sozluk) for i in idx_list):
        for i in idx_list:                         # süsleme satırı: model orada yazı görmedi
            js[i]["sil"], js[i]["neden"] = True, None
            kayit["silinen"].append((sayfa_no, js[i]["m"]))
        return
    if not g or not (VLM_UZUNLUK_ORAN[0] <= len(g) / max(1, len(t)) <= VLM_UZUNLUK_ORAN[1]):
        kayit["reddedilen"] += 1
        return
    sm = difflib.SequenceMatcher(None, t, g, autojunk=False)
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "insert" and j2 - j1 == 1 and i1 < len(idx_list):
            hedef = js[idx_list[i1]]
            harf = parcala(g_words[j1])[1]
            if hedef.get("neden") == "süs harfi" and re.fullmatch(r"[A-ZÇĞİÖŞÜ]", harf):
                on, tc, son = parcala(hedef["m"])
                kayit["duzeltme"].append((sayfa_no, hedef["m"], on + harf + tc + son, "süs harfi"))
                hedef["m"], hedef["neden"] = on + harf + tc + son, None
            continue
        for k in range(i1, i2):
            jj = js[idx_list[k]]
            if not jj.get("neden"):
                continue
            if op == "equal":
                if jj["neden"] == "şapka?":             # anahtar şapkayı yok sayar: resmi == resmî
                    yeni = karar(jj, g_words[j1 + (k - i1)], sozluk, "şapka?")
                    kayit["sapka"][0] += 1
                    kayit["sapka"][1] += bool(yeni)
                    lem = kayit["sapka_kelime"].setdefault(anahtar(parcala(jj["m"])[1]), [0, 0])
                    lem[0] += 1
                    lem[1] += bool(yeni)
                    if yeni:
                        kayit["duzeltme"].append((sayfa_no, jj["m"], yeni, "şapka"))
                        jj["m"] = yeni
                    jj["neden"] = None
                    continue
                jj["onay"] = True
                continue
            if op == "delete":                          # model bu kelimeyi hiç görmedi: süsleme/leke okuması
                _, cek, _ = parcala(jj["m"])
                if jj["neden"] != "glif" and ((len(cek) <= 3 and jj["c"] < 60)
                                              or (jj["c"] < 50 and not sozluk.gecerli(cek))):
                    jj["sil"] = True
                    jj["neden"] = None
                    kayit["silinen"].append((sayfa_no, jj["m"]))
                continue
            if op != "replace":
                continue
            if i2 - i1 == j2 - j1:
                gw = g_words[j1 + (k - i1)]
            elif i2 - i1 == 1 and j2 - j1 == 2:         # model ikiye ayırdı: "geldiğini" vs "gel diğini"
                gw = g_words[j1] + " " + g_words[j1 + 1]
            else:
                gw = None
            if gw is None:
                continue
            eski = jj["m"]
            if jj["neden"] == "glif":
                _, cek, _ = parcala(eski)
                cozum, yontem = glif_coz(cek, sozluk, frekans, ipucu=parcala(gw.split()[0])[1])
                if cozum:
                    if yontem == "satır okumasıyla":
                        glif_ogren(cek, cozum)
                    on, _, son = parcala(eski)
                    jj["m"] = on + cozum + son
                    jj["neden"] = None
                    jj["glif_ilk"], jj["glif_yontem"] = eski, yontem
                continue
            if " " in gw:
                parcalar = gw.split()
                if not all(sozluk.gecerli(parcala(p)[1]) for p in parcalar) or sozluk.gecerli(parcala(eski)[1]):
                    continue
                yeni = parcala(eski)[0] + " ".join(parcala(parca)[1] for parca in parcalar) + parcala(eski)[2]
            else:
                yeni = karar(jj, gw, sozluk, jj["neden"])
            if yeni:
                jj["m"] = yeni
                kayit["duzeltme"].append((sayfa_no, eski, yeni, f'{jj["neden"]}, güven {jj["c"]:.0f}'))
            jj["neden"] = None


# ---------------------------------------------------------------- ana --

def _baslik_norm(m: str) -> str:
    m = re.sub(r"^[\d\W]+|[\d\W]+$", "", m)          # kenardaki sayfa numarası / işaretler
    return anahtar(re.sub(r"\s+", " ", m)).strip()


def _benzer(a: str, b: str) -> bool:
    return abs(len(a) - len(b)) <= max(3, len(a) // 4) and difflib.SequenceMatcher(None, a, b).ratio() >= 0.75


def basliklari_bul(sayfalar_satir, ornek=40):
    """Sayfa başı/sonunda tekrar eden satırlar (kitap/yazar adı). Tesseract üstbilgiyi her
    sayfada biraz farklı okuyabildiği için ("Jane Austen" / "Jane Awsten") benzerlere göre
    gruplanır. Örnek sayfalar ön sayfalar yerine kitabın içinden de seçilir."""
    dolu = [s for s in sayfalar_satir if s and len(s) >= 3]
    if len(dolu) > ornek:
        adim = len(dolu) / ornek
        dolu = [dolu[int(k * adim)] for k in range(ornek)]
    gruplar = []                    # [temsilci, sayı]
    for satirlar in dolu:
        metinler = [" ".join(w["m"] for w in s["kelimeler"]) for s in satirlar]
        gorulen = set()
        for m in metinler[:2] + metinler[-2:]:
            nm = _baslik_norm(m)
            if not (3 <= len(nm) <= 80):
                continue
            g = next((g for g in gruplar if _benzer(g[0], nm)), None)
            if g is None:
                g = [nm, 0]
                gruplar.append(g)
            if id(g) not in gorulen:
                gorulen.add(id(g))
                g[1] += 1
    n = len(dolu)
    return [g[0] for g in gruplar if n >= 3 and g[1] >= 3 and g[1] / n >= 0.2]


def baslik_temizle(satirlar, basliklar):
    if not basliklar:
        return satirlar
    out = []
    for i, s in enumerate(satirlar):
        nm = _baslik_norm(" ".join(w["m"] for w in s["kelimeler"]))
        if (i < 2 or i >= len(satirlar) - 2) and nm and any(_benzer(b, nm) for b in basliklar):
            continue
        out.append(s)
    return out


def gurultu_temizle(satirlar, sozluk: Sozluk):
    """Tesseract'ın süsleme/resimlerden okuduğu çöp satırları atar ("pi", "g 4", "ix"):
    bütün kelimeleri düşük güvenli ve hiçbiri sözlükte olmayan satırlar."""
    out = []
    for s in satirlar:
        ws = s["kelimeler"]
        ceks = [parcala(w["m"])[1] for w in ws]
        dusuk = all(w["c"] < 60 for w in ws)
        kisa = all(len(c) <= 3 for c in ceks)
        gecerli = any(len(c) >= 2 and sozluk.gecerli(c) for c in ceks) if sozluk.var else not dusuk
        # Sadece KISA parçalardan oluşan satırlar: uzun bir kelime (sayfa başındaki "şünmüyorum."
        # gibi bölünmüş kelime devamı) sözlükte olmasa da çöp değildir.
        if kisa and not gecerli and (dusuk or all(w["c"] < 80 for w in ws)):
            continue
        out.append(s)
    return out


def sus_harfi_bul(satirlar):
    """Bölüm başındaki süslü büyük ilk harf (drop cap). Tesseract onu çöp parçalar olarak okur ("3|", "Gis",
    "2)") ve kelimenin geri kalanını ("vin" <- "Evin") bırakır. Çöp parçalar atılır; yanındaki ilk kelime
    "süs harfi" olarak işaretlenir: yapay zekâ o satırları süs harfiyle birlikte okuyup kelimeyi tamamlar."""
    ws = [w for s in satirlar for w in s["kelimeler"]]
    yuks = sorted(w["k"][3] - w["k"][1] for w in ws if len(parcala(w["m"])[1]) >= 3)
    if len(yuks) < 20:
        return
    med = yuks[len(yuks) // 2]
    uzun = [s for s in satirlar if len(s["kelimeler"]) >= 4]
    if not uzun:
        return
    sol = _medyan([s["kelimeler"][0]["k"][0] for s in uzun])
    for s in satirlar[:8]:                        # süs harfi bölüm başında, sayfanın üst yarısında olur
        for w in s["kelimeler"]:
            yk = w["k"][3] - w["k"][1]
            digerleri = [v["k"][3] - v["k"][1] for v in s["kelimeler"] if v is not w and len(parcala(v["m"])[1]) >= 3]
            # başlık değil: aynı satırdaki öbür kelimeler normal boyda olmalı ("IV KISIM" başlığında hepsi büyük)
            normal_satir = bool(digerleri) and _medyan(digerleri) < 1.35 * med
            if (yk >= 1.8 * med and w["k"][0] <= sol + 3 * med and len(parcala(w["m"])[1]) <= 2
                    and normal_satir):
                cap = list(w["k"])
                bant = [x for x, t in enumerate(satirlar)
                        if satir_kutusu(t)[3] >= cap[1] - med and satir_kutusu(t)[1] <= cap[3] + med]
                ilk = None
                for x in bant:
                    kalan = []
                    for v in satirlar[x]["kelimeler"]:
                        cop = (v["k"][2] <= cap[2] + med and len(parcala(v["m"])[1]) <= 3)
                        if not cop:
                            kalan.append(v)
                    satirlar[x]["kelimeler"] = kalan
                    if ilk is None and kalan:
                        ilk = kalan[0]
                satirlar[:] = [t for t in satirlar if t["kelimeler"]]
                if ilk is not None:
                    ilk["sus_devam"] = True
                    ilk["kutu_sol"] = cap[0]
                    ilk["kutu_alt"] = cap[3]
                return


def bosluk_tara(satirlar, page, ust_tipik, aralik, tess, okuyucu, sozluk, dpi, kayit, sayfa_no):
    """Tesseract'ın hiç okumadığı satırları arar: süslü bir ilk harfin yanındaki satırlar çoğunlukla resim
    sanılıp atlanır. Metin bu sayfada olağandan aşağıda başlıyorsa ya da ortada anormal bir boşluk varsa
    o bölge yeniden okunur (önce Tesseract'la; yazı varsa ve yapay zekâ açıksa onunla)."""
    if not satirlar or not aralik:
        return satirlar
    kutular = [satir_kutusu(t) for t in satirlar]
    x0 = min(k[0] for k in kutular) - 4
    x1 = max(k[2] for k in kutular) + 2
    bolgeler = []
    if ust_tipik is not None and kutular[0][1] - ust_tipik > 1.4 * aralik:
        bolgeler.append((0, [x0, ust_tipik - 0.4 * aralik, x1, kutular[0][1] - 0.15 * aralik]))
    for k in range(1, len(kutular)):
        if kutular[k][1] - kutular[k - 1][3] > 2.6 * aralik:
            bolgeler.append((k, [x0, kutular[k - 1][3] + 0.15 * aralik, x1, kutular[k][1] - 0.15 * aralik]))
    eklenen = 0
    for yer, b in reversed(bolgeler):            # sondan başa: araya ekleme indeksleri kaymasın
        r = page.rect
        b = [max(r.x0, b[0]), max(r.y0, b[1]), min(r.x1, b[2]), min(r.y1, b[3])]
        if b[3] - b[1] < 0.8 * aralik:
            continue
        png = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY, clip=pymupdf.Rect(*b)).tobytes("png")
        metin = tess.oku_metin(png, psm=6) if not tess.hata else ""
        kelime = re.findall(rf"[{TR_LETTERS}]{{3,}}", metin)
        if len(kelime) < 3:
            continue                              # gerçekten boş (sahne arası, bölüm sonu)
        if okuyucu is not None and okuyucu.acik and okuyucu.sim is None:
            g = okuyucu.oku(page, b, dpi, sayfa_no - 1)
            if len(re.findall(rf"[{TR_LETTERS}]{{3,}}", g)) >= 3:
                metin = g
        if sozluk.var:
            uzun = [w for w in re.findall(rf"[{TR_LETTERS}]{{3,}}", metin)]
            if sum(bool(sozluk.gecerli(w)) for w in uzun) < 0.5 * len(uzun):
                continue                          # çöp okuma (resim, süs)
        satir_metin = [ln for ln in metin.splitlines() if ln.strip()]
        yeni = []
        # satırlar sayfanın olağan aralığıyla, bölgenin altına yaslanarak yerleşir (araya sahte boşluk girmesin)
        yuk = aralik
        for n, ln in enumerate(satir_metin):
            ws = ln.split()
            gen = (b[2] - b[0]) / max(1, len(ws))
            ky = b[3] - (len(satir_metin) - n) * aralik
            yeni.append({"blok": satirlar[min(yer, len(satirlar) - 1)]["blok"], "kelimeler": [
                {"m": w, "c": 90.0, "k": [b[0] + q * gen, ky, b[0] + (q + 1) * gen - 2, ky + yuk * 0.8]}
                for q, w in enumerate(ws)]})
        if yer < len(satirlar):                   # süs harfinin yanındaki girintili satır paragrafı bölmesin
            alt = satir_kutusu(satirlar[yer])
            if alt[1] - b[3] < 1.5 * aralik:
                satirlar[yer]["devam"] = True
        if yeni and yeni[0]["kelimeler"]:
            ilk = yeni[0]["kelimeler"]
            # süslü harften okunan kısa çöp ("ANI gnes ...") atılır, ardındaki kelime işaretlenir
            while len(ilk) > 1 and len(parcala(ilk[0]["m"])[1]) <= 3 and parcala(ilk[1]["m"])[1][:1].islower() \
                    and (parcala(ilk[0]["m"])[1].isupper() or not sozluk.gecerli(parcala(ilk[0]["m"])[1])):
                ilk.pop(0)
            ilk[0]["bosluk_ilk"] = True
        satirlar[yer:yer] = yeni
        eklenen += len(yeni)
        kayit["bosluk"].append((sayfa_no, " ".join(ln for ln in satir_metin)[:90]))
    return satirlar


BUYUK_HARFLER = "ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ"


def eksik_ilk_harf(cek: str, sozluk: Sozluk, frekans: Counter):
    """Süslü ilk harf okunamadıysa ("gnes" <- "Agnes", "vin" <- "Evin"): başa tek bir büyük harf eklenince
    kitapta sık geçen bir kelime çıkıyorsa o harf. Tek ve açık bir aday yoksa None."""
    if not cek or not cek[0].islower():
        return None
    adaylar = []
    for h in BUYUK_HARFLER:
        aday = h + cek
        n = frekans[anahtar(aday)]
        if n >= 3 or (n >= 1 and sozluk.gecerli(aday)):
            adaylar.append((n, aday))
    if not adaylar:
        return None
    adaylar.sort(reverse=True)
    if len(adaylar) == 1 or adaylar[0][0] >= 3 * adaylar[1][0]:
        return adaylar[0][1]
    return None


def sifir_harf_mi(js, k):
    """İki kelime arasında tek başına duran "0" Tesseract'ın "o" okumasıdır ("Nedir 0 diyerek")."""
    if parcala(js[k]["m"])[1] != "0":
        return False
    komsu = [parcala(js[x]["m"])[1] for x in (k - 1, k + 1) if 0 <= x < len(js)]
    return bool(komsu) and all(c and c[0].isalpha() for c in komsu)


def isim_cesitlerini_duzelt(sayfa_js, kaynak, sozluk, kayit):
    """Kitapta sık geçen bir ismin tek seferlik bozuk okuması ("Bartholomevw"; kitapta "Bartholomew" 10 kez)
    çoğunluktaki yazıma çevrilir. Yapay zekâ gerekmez."""
    if not sozluk.var:
        return
    say = Counter()
    for i, js in sayfa_js.items():
        if kaynak.get(i) != "tesseract":
            continue
        for j in js:
            cek = parcala(j["m"])[1]
            if cek and cek[0].isupper() and not cek.isupper() and re.fullmatch(rf"[{TR_LETTERS}'’]+", cek):
                kok = re.split("['’]", cek)[0]
                if len(kok) >= 6:
                    say[kok] += 1
    sik = [k for k, n in say.items() if n >= 3]
    if not sik:
        return
    for i, js in sayfa_js.items():
        if kaynak.get(i) != "tesseract":
            continue
        for j in js:
            cek = parcala(j["m"])[1]
            if not cek:
                continue
            kok = re.split("['’]", cek)[0]
            if say.get(kok) != 1 or sozluk.gecerli(kok):
                continue
            aday = [k for k in sik if abs(len(k) - len(kok)) <= 2
                    and difflib.SequenceMatcher(None, anahtar(k), anahtar(kok)).ratio() >= 0.88]
            if aday:
                dogru = max(aday, key=lambda k: say[k])
                eski = j["m"]
                j["m"] = eski.replace(kok, dogru, 1)
                kayit["duzeltme"].append((i + 1, eski, j["m"], f"isim çeşidi ({dogru} kitapta {say[dogru]} kez)"))


def sayfa_no_temizle(satirlar):
    """Sayfanın en üstünde/altında tek başına duran sayıyı (sayfa numarası) atar."""
    out = []
    for i, s in enumerate(satirlar):
        m = " ".join(w["m"] for w in s["kelimeler"]).strip()
        # "101" bazen "IOI", "l23" diye okunur: rakama benzeyen harflerden oluşan kısa satır da sayfa numarasıdır
        if (i == 0 or i == len(satirlar) - 1) and re.fullmatch(r"[-–—\s]*(\d{1,4}|[0-9IOlo|SZB]{2,4})[-–—\s]*", m):
            continue
        out.append(s)
    return out


def varsayilan_paralel():
    """Aynı anda kaç Tesseract çalışsın: çekirdek sayısı - 1, ama her biri ~400 MB bellek kullanabilir;
    az RAM'li bilgisayarda bellek dolmasın diye boş belleğe göre de sınırlanır (en fazla 12)."""
    cekirdek = max(1, (os.cpu_count() or 2) - 1)
    bos_gb = None
    try:
        import psutil
        bos_gb = psutil.virtual_memory().available / 1024 ** 3
    except Exception:
        try:
            from sure_tahmini import ram_bul
            toplam = ram_bul()
            bos_gb = toplam / 2 if toplam else None      # boş bellek bilinmiyorsa toplamın yarısı
        except Exception:
            pass
    bellek = max(1, int((bos_gb - 1) / 0.4)) if bos_gb else cekirdek
    return max(1, min(cekirdek, bellek, 12))


KATMAN_YOK = 10     # --kaynak katman-varsa: katman kullanılamadı, çağıran (ocr.py) OCR'a devam etsin


def main():
    ap = argparse.ArgumentParser(description="Ekran kartı gerektirmeyen hızlı OCR (Hafif profil)")
    ap.add_argument("--file", required=True, help="input/ klasöründeki PDF adı")
    ap.add_argument("--kaynak", choices=["auto", "katman", "tesseract", "katman-varsa"], default="auto",
                    help="auto: metin katmanı sağlamsa onu, değilse Tesseract'ı kullan (varsayılan). "
                         "katman-varsa: sadece katman sağlamsa işle, değilse hiçbir şey yazmadan 10 koduyla çık "
                         "(ocr.py vision OCR'dan önce bunu dener)")
    ap.add_argument("--vlm-model", default=os.environ.get("KITAP_HAFIF_VLM") or "glm-ocr",
                    help="Şüpheli satırları okuyacak model (varsayılan glm-ocr)")
    ap.add_argument("--no-vlm", action="store_true", help="Yapay zekâ kullanma (sadece Tesseract + sözlük)")
    ap.add_argument("--workers", type=int, default=None,
                    help="Aynı anda okunacak sayfa sayısı (varsayılan: çekirdek ve belleğe göre)")
    ap.add_argument("--dpi", type=int, default=int(os.environ.get("KITAP_HAFIF_DPI") or 300))
    ap.add_argument("--lang", default="tur")
    ap.add_argument("--max-pages", type=int, default=None)
    args = ap.parse_args()
    if args.workers is None:
        args.workers = varsayilan_paralel()

    pdf_path = Path(config.INPUT_DIR) / args.file
    if not pdf_path.exists():
        pdf_path = Path(args.file)
    if not pdf_path.exists():
        print(f"HATA: {args.file} bulunamadı.")
        sys.exit(1)
    stem = pdf_path.stem
    book_dir = Path(config.OUTPUT_DIR) / stem
    book_dir.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(pdf_path)
    toplam = len(doc)
    son = toplam if args.max_pages is None else min(toplam, args.max_pages)
    t_bas = time.time()

    print(f"\n=== Hafif OCR: {pdf_path.name} ({toplam} sayfa) ===")
    sozluk = Sozluk()
    tess = Tesseract(args.lang)

    # 1) Kaynak seçimi
    katman, onarim, aciklama = False, None, ""
    lig = ligatur_karakterleri_bul(doc, sozluk)
    if lig:
        print(f"  Bağlı harf glifleri bulundu (sözlükle onarılacak): {', '.join(f'{c}×{n}' for c, n in lig.items())}")
    if args.kaynak in ("auto", "katman", "katman-varsa"):
        print("1/4 Metin katmanı sınanıyor...")
        katman, onarim, aciklama = katman_sina(doc, sozluk, tess, args.dpi)
        print(f"  {'KULLANILACAK' if katman else 'KULLANILMAYACAK'}: {aciklama}")
        if args.kaynak == "katman-varsa" and not katman:
            print("  Metin katmanı kullanılamıyor: sayfalar OCR ile okunacak.")
            sys.exit(KATMAN_YOK)
        if args.kaynak == "katman" and not katman:
            print("  (--kaynak katman verildi, yine de katman kullanılıyor)")
            katman = True
    if not katman and tess.hata:
        print(f"HATA: {tess.hata}")
        sys.exit(1)

    # 2) Okuma (katman ya da paralel Tesseract)
    print(f"2/4 Sayfalar okunuyor ({'metin katmanı' if katman else f'Tesseract, {args.workers} paralel'})...")
    sayfalar_satir = [None] * son
    kaynak = {}
    t_ocr = time.time()
    onar = onarici(onarim)
    olcek = 72 / args.dpi
    tess_gerek = []
    for i in range(son):
        if katman:
            satirlar = katman_satirlar(doc[i], onar)
            harf = sum(len(w["m"]) for s in satirlar for w in s["kelimeler"])
            if harf < 20 and doc[i].get_images() and not tess.hata:
                tess_gerek.append(i)        # katmanlı kitapta taranmış resim sayfası
                continue
            sayfalar_satir[i] = satirlar
            kaynak[i] = "katman"
        else:
            tess_gerek.append(i)
    if args.kaynak == "katman-varsa" and tess_gerek and tess.hata:
        print(f"  {len(tess_gerek)} sayfada metin yok (taranmış sayfa) ve Tesseract kurulu değil: OCR ile okunacak.")
        sys.exit(KATMAN_YOK)

    def tess_oku(i, png):
        t0 = time.time()
        return i, tsv_satirlar(tess.oku_tsv(png), olcek), time.time() - t0

    if tess_gerek:
        with ThreadPoolExecutor(max_workers=args.workers) as havuz:
            bekleyen = []
            biten = 0
            for i in tess_gerek:
                print(f"  >> Sayfa {i + 1} okunuyor (tesseract)", flush=True)
                png = doc[i].get_pixmap(dpi=args.dpi, colorspace=pymupdf.csGRAY).tobytes("png")
                bekleyen.append(havuz.submit(tess_oku, i, png))
                while len([f for f in bekleyen if not f.done()]) >= args.workers * 2:
                    time.sleep(0.05)
                for f in [f for f in bekleyen if f.done()]:
                    bekleyen.remove(f)
                    j, satirlar, sn = f.result()
                    sayfalar_satir[j], kaynak[j] = satirlar, "tesseract"
                    biten += 1
                    print(f"  Sayfa {j + 1}/{toplam} tamamlandı [tesseract] ({sn:.1f}sn)", flush=True)
            for f in bekleyen:
                j, satirlar, sn = f.result()
                sayfalar_satir[j], kaynak[j] = satirlar, "tesseract"
                print(f"  Sayfa {j + 1}/{toplam} tamamlandı [tesseract] ({sn:.1f}sn)", flush=True)
    sure_ocr = time.time() - t_ocr

    # 3) Temizlik, paragraflar, şüpheli kelimeler
    print("3/4 Şüpheli kelimeler aranıyor...")
    basliklar = basliklari_bul(sayfalar_satir)
    if basliklar:
        print(f"  Tekrarlayan üstbilgiler: {', '.join(repr(b) for b in basliklar)}")
    okuyucu = Okuyucu(args.vlm_model, kapali=args.no_vlm)
    kayit = {"glif": [], "duzeltme": [], "silinen": [], "bosluk": [], "reddedilen": 0, "supheli": Counter(), "kalan": [],
             "sapka": [0, 0], "sapka_kelime": {}}     # [sorulan, şapka bulunan], kelime bazında aynısı
    for i in range(son):
        satirlar = sayfa_no_temizle(baslik_temizle(sayfalar_satir[i] or [], basliklar))
        if kaynak.get(i) == "tesseract":
            satirlar = gurultu_temizle(satirlar, sozluk)
        sayfalar_satir[i] = satirlar
    # Tesseract sayfalarında metnin olağan başladığı yükseklik ve satır aralığı (boşluk taraması için)
    ilkler, araliklar = [], []
    for i in range(son):
        st = sayfalar_satir[i]
        if kaynak.get(i) == "tesseract" and len(st) >= 10:
            ks = [satir_kutusu(t) for t in st]
            ilkler.append(ks[0][1])
            araliklar += [b[1] - a[1] for a, b in zip(ks, ks[1:]) if b[1] > a[1]]
    ust_tipik = _medyan(ilkler) if len(ilkler) >= 5 else None
    aralik_tipik = _medyan(araliklar, 0)
    sayfa_js = {}
    for i in range(son):
        satirlar = sayfalar_satir[i]
        if kaynak.get(i) == "tesseract" and satirlar:
            sus_harfi_bul(satirlar)
            satirlar = bosluk_tara(satirlar, doc[i], ust_tipik, aralik_tipik, tess, okuyucu, sozluk,
                                   args.dpi, kayit, i + 1)
        paragraflari_bul(satirlar)
        sayfalar_satir[i] = satirlar
        sayfa_js[i] = jetonlar(satirlar, sozluk)
    if kayit["bosluk"]:
        print(f"  Tesseract'ın atladığı {len(kayit['bosluk'])} bölge yeniden okundu (süslü ilk harf vb.)")
    isim_cesitlerini_duzelt(sayfa_js, kaynak, sozluk, kayit)

    frekans = Counter()               # temiz kelimelerin kitaptaki sıklığı (glif çözümü için)
    isimler = Counter()               # büyük harfli, sözlükte olmayan kelimeler (isim tespiti için)
    for js in sayfa_js.values():
        for j in js:
            _, cek, _ = parcala(j["m"])
            if cek and not any(bozuk_mu(c) for c in cek):
                frekans[anahtar(cek)] += 1
                if cek[0].isupper() and j["c"] >= 70 and sozluk.var and not sozluk.gecerli(cek):
                    isimler[re.split("['’]", cek)[0]] += 1

    for js in sayfa_js.values():        # glif eşlemesini önce bütün kitaptan öğren
        for j in js:
            _, cek, _ = parcala(j["m"])
            if cek and any(bozuk_mu(c) for c in cek):
                cozum, yontem = glif_coz(cek, sozluk, frekans)
                if cozum and yontem == "sözlük":
                    glif_ogren(cek, cozum)
    if GLIF_OGRENILEN:
        ogr = {c: glif_ogrenilen(c) for c in GLIF_OGRENILEN}
        print("  Öğrenilen glif eşlemeleri: " + ", ".join(f"{c}={v}" for c, v in ogr.items() if v))
    toplu_sayfa = 0
    t_vlm = time.time()
    ZAYIF = ("sözlük (ilk aday)", "kitaptaki sıklık")
    # 1. tur: şüphe, glif'lerin sözlük ve (katmanda) Tesseract satır okumasıyla çözümü. Yapay zekâ yok;
    # bu turda glif eşlemeleri öğrenilir, 2. tur öğrenileni kullanır.
    for i in range(son):
        js, satirlar = sayfa_js[i], sayfalar_satir[i]
        is_katman = kaynak.get(i) == "katman"
        for j in js:
            j["neden"] = suphe(j, sozluk, isimler, is_katman, frekans)
            if j["neden"]:
                kayit["supheli"][j["neden"]] += 1
            _, cek, _ = parcala(j["m"])
            if (not is_katman and j["neden"] and j["c"] < 30 and len(cek) <= 2
                    and not (sozluk.var and sozluk.gecerli(cek))):
                j["sil"], j["neden"] = True, None        # çok düşük güvenli kırıntı: süsleme/leke
                kayit["silinen"].append((i + 1, j["m"]))
        for j in js:                                     # glif: önce sözlük
            if j["neden"] == "glif":
                on, cek, son_ = parcala(j["m"])
                cozum, yontem = glif_coz(cek, sozluk, frekans)
                if cozum:
                    j["glif_ilk"], j["glif_yontem"] = j["m"], yontem
                    j["m"], j["neden"] = on + cozum + son_, None
        supheli = [k for k, j in enumerate(js) if j["neden"]]
        if not supheli:
            continue
        print(f"  >> Sayfa {i + 1}: {len(supheli)} şüpheli kelime", flush=True)
        if is_katman and not tess.hata:                  # kalan glif'ler: satırı Tesseract ile oku (hızlı)
            glif_satir = sorted({tuple(js[k]["s"]) for k in supheli if js[k]["neden"] == "glif"})
            for ss in glif_satir:
                kutu = kirp_kutusu(satirlar, list(ss), doc[i].rect)
                png = doc[i].get_pixmap(dpi=args.dpi, colorspace=pymupdf.csGRAY, clip=pymupdf.Rect(*kutu)).tobytes("png")
                grup = [x for x, j in enumerate(js) if set(j["s"]) & set(ss)]
                grup_duzelt(js, grup, vlm_kelimeler(tess.oku_metin(png, psm=6)), sozluk, frekans, kayit, i + 1)

    # Ara adım: öğrenilen eşlemeyle zayıf çözümleri düzelt, çözülemeyen glif'leri doğrudan eşle.
    # Bir glif kitap boyunca hep aynı bağlı harftir; eşlemesi öğrenildiyse yapay zekâya gerek yok.
    for i in range(son):
        for j in sayfa_js[i]:
            if j.get("glif_yontem") in ZAYIF:
                on, cek, son_ = parcala(j["glif_ilk"])
                cozum, yontem = glif_coz(cek, sozluk, frekans)
                if cozum and yontem == "kitapta öğrenilen eşleme":
                    j["m"], j["glif_yontem"] = on + cozum + son_, yontem
            elif j.get("neden") == "glif":
                on, cek, son_ = parcala(j["m"])
                if all(glif_ogrenilen(c) for c in cek if bozuk_mu(c)):
                    j["glif_ilk"], j["glif_yontem"] = j["m"], "öğrenilen eşleme (doğrudan)"
                    j["m"] = on + "".join(glif_ogrenilen(c) if bozuk_mu(c) else c for c in cek) + son_
                    j["neden"] = None

    # 2. tur: kalan şüpheliler yapay zekâya (Tesseract sayfalarında asıl iş burada)
    if okuyucu.acik and (okuyucu.sim is None or os.environ.get("KITAP_TEST_ISIM")) and sozluk.var:
        isimleri_dogrula(sayfa_js, sayfalar_satir, kaynak, doc, okuyucu, sozluk, args.dpi, kayit)
    if okuyucu.acik:
        n_sayfa = sum(1 for i in range(son) if any(j.get("neden") for j in sayfa_js[i]))
        if n_sayfa:
            print(f"  Yapay zekâ ({okuyucu.model}) {n_sayfa} sayfadaki şüpheli satırları okuyor...", flush=True)
    sapka_birakildi = False
    for i in range(son):
        js, satirlar = sayfa_js[i], sayfalar_satir[i]
        if not sapka_birakildi and kayit["sapka"][0] >= SAPKA_DENEME and kayit["sapka"][1] == 0:
            sapka_birakildi = True             # kitap nispet î'si kullanmıyor (ilk örneklerin hiçbirinde şapka yok)
            print(f"  İlk {kayit['sapka'][0]} şapka adayında şapka yok: kitap şapka kullanmıyor, bu kontrol bırakıldı.",
                  flush=True)
        for j in js:
            if j.get("neden") == "şapka?":
                lem = kayit["sapka_kelime"].get(anahtar(parcala(j["m"])[1]), [0, 0])
                if sapka_birakildi or (lem[0] >= SAPKA_KELIME_DENEME and lem[1] == 0):
                    j["neden"] = None              # bu kelime bu kitapta şapkasız yazılıyor
        supheli = [k for k, j in enumerate(js) if j.get("neden")]
        if not supheli or not okuyucu.acik:
            continue
        # arayüz ">> Sayfa N okunuyor" satırıyla PDF önizlemesini takip eder; uzun süren bu turda ilerleme de görünür
        print(f"  >> Sayfa {i + 1} okunuyor ({okuyucu.model}: {len(supheli)} şüpheli kelime)", flush=True)
        sup_satir = {s for k in supheli for s in js[k]["s"]}
        for k in supheli:
            if js[k].get("kutu_alt") is not None:  # süs harfi: boyu kadar alttaki satırlar da okunur
                sup_satir |= {x for x, t in enumerate(satirlar) if t["kutu"][1] <= js[k]["kutu_alt"]
                              and x >= min(js[k]["s"])}
        sup_satir = sorted(sup_satir)
        if okuyucu.sim is not None or len(sup_satir) / max(1, len(satirlar)) > SAYFA_TOPLU_ORAN:
            toplu_sayfa += 1
            r = doc[i].rect
            g = vlm_kelimeler(okuyucu.oku(doc[i], [r.x0, r.y0, r.x1, r.y1], args.dpi, i))
            grup_duzelt(js, list(range(len(js))), g, sozluk, frekans, kayit, i + 1)
        else:
            gruplar = []                       # bitişik şüpheli satırlar tek kırpıntı
            for s_ in sup_satir:
                if gruplar and s_ - gruplar[-1][-1] <= 1:
                    gruplar[-1].append(s_)
                else:
                    gruplar.append([s_])
            for gs in gruplar:
                kutu = kirp_kutusu(satirlar, gs, doc[i].rect)
                idx = [x for x, j in enumerate(js) if set(j["s"]) & set(gs)]
                sol_ek = min((js[x]["kutu_sol"] for x in idx if js[x].get("kutu_sol") is not None), default=None)
                if sol_ek is not None:
                    kutu[0] = max(doc[i].rect.x0, sol_ek - 3)
                g = vlm_kelimeler(okuyucu.oku(doc[i], kutu, args.dpi, i))
                grup_duzelt(js, idx, g, sozluk, frekans, kayit, i + 1)
    for i in range(son):
        for j in sayfa_js[i]:
            if j.get("glif_ilk"):
                kayit["glif"].append((i + 1, j["glif_ilk"], j["m"], j["glif_yontem"]))
    sure_vlm = time.time() - t_vlm

    # Süslü ilk harfi okunamayan kelimeler ve "0" yazılan "o"lar (yapay zekâ gerektirmez)
    for i in range(son):
        js = sayfa_js[i]
        if kaynak.get(i) != "tesseract":
            continue
        for k, j in enumerate(js):
            if j.get("sus_devam") or j.get("bosluk_ilk"):
                on, cek, son_ = parcala(j["m"])
                tam = eksik_ilk_harf(cek, sozluk, frekans)
                if tam:
                    kayit["duzeltme"].append((i + 1, j["m"], on + tam + son_, "süslü ilk harf"))
                    j["m"], j["neden"] = on + tam + son_, None
                elif j.get("neden") == "süs harfi":
                    j["neden"] = None
            if sifir_harf_mi(js, k):
                onceki = parcala(js[k - 1]["m"])[2] if k else ""
                harf = "O" if (k == 0 or js[k - 1]["p"] != j["p"] or any(c in onceki for c in ".!?…")) else "o"
                kayit["duzeltme"].append((i + 1, j["m"], j["m"].replace("0", harf), "0 -> o"))
                j["m"], j["neden"] = j["m"].replace("0", harf), None

    # Çözülemeyen glif'ler: en olası aday (kitapta sıklık / ilk aday) ile yazılır
    for i in range(son):
        for j in sayfa_js[i]:
            _, cek, _ = parcala(j["m"])
            if cek and any(bozuk_mu(c) for c in cek):
                on, cek, son_ = parcala(j["m"])
                adaylar = glif_coz(cek, sozluk, frekans, ipucu=None)[0]
                yeni = on + (adaylar or "".join((glif_ogrenilen(c) or "ti") if bozuk_mu(c) else c for c in cek)) + son_
                kayit["kalan"].append((i + 1, j["m"], yeni, j["c"]))
                j["m"] = yeni
            elif j.get("neden") == "şapka?":
                j["neden"] = None                       # model şapka görmedi (ya da yapay zekâ yok): olduğu gibi
            elif j.get("neden") and not j.get("sil"):
                if kaynak.get(i) == "tesseract" and kirinti_mi(j, sozluk):
                    j["sil"] = True
                    kayit["silinen"].append((i + 1, j["m"]))
                else:
                    kayit["kalan"].append((i + 1, j["m"], j["m"], j["c"]))

    # 4) Yazma (ocr.py ile aynı biçim)
    print("4/4 Yazılıyor...")
    model_tag = "metin-katmani" if katman and not tess_gerek else f"tesseract{'+' + args.vlm_model if okuyucu.acik else ''}"
    store = {"model": model_tag, "headers": basliklar, "pages": {}, "kaynak": {}}
    for i in range(son):
        store["pages"][str(i)] = sayfa_metni(sayfa_js[i]).strip()
        store["kaynak"][str(i)] = kaynak.get(i, "")
    (book_dir / f"{stem}_sayfalar.json").write_text(json.dumps(store, ensure_ascii=False), encoding="utf-8")
    md = ocr.dehyphenate("\n\n".join(store["pages"][str(i)] for i in range(son) if store["pages"][str(i)]))
    (book_dir / f"{stem}.md").write_text(md + "\n", encoding="utf-8")

    onayli_yol = book_dir / f"{stem}_onayli.json"
    try:
        onayli = set(json.loads(onayli_yol.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        onayli = set()
    for js in sayfa_js.values():
        for j in js:
            _, cek, _ = parcala(j["m"])
            if cek and sozluk.var and not sozluk.gecerli(cek) and not any(c.isdigit() for c in cek):
                if j.get("onay") or (cek[0].isupper() and (j["c"] >= ISIM_GUVEN or isimler[re.split("['’]", cek)[0]] >= ISIM_MIN_SAYI)):
                    onayli.add(cek)
    onayli_yol.write_text(json.dumps(sorted(onayli), ensure_ascii=False, indent=0), encoding="utf-8")

    sure = time.time() - t_bas
    rapor = [f"HAFİF OCR RAPORU: {pdf_path.name}", "=" * 72,
             f"Kaynak: {'metin katmanı' if katman else 'Tesseract'} - {aciklama or 'katman sınanmadı'}",
             f"Tesseract ile okunan sayfa: {len(tess_gerek)}  (okuma {sure_ocr:.0f} sn, {args.workers} paralel, {args.dpi} dpi)",
             f"Şüpheli kelimeler: {dict(kayit['supheli']) or 'yok'}",
             f"Yapay zekâ ({args.vlm_model}): {'kapalı' if not okuyucu.acik else f'{okuyucu.cagri} çağrı, {sure_vlm:.0f} sn, {toplu_sayfa} sayfa toplu okundu'}",
             f"Uydurma şüphesiyle atılan model okuması: {kayit['reddedilen']}",
             f"Toplam süre: {sure:.0f} sn", ""]
    rapor.append(f"BAĞLI HARF ONARIMLARI ({len(kayit['glif'])}):")
    rapor += [f"  s.{p}: {a!r} -> {b!r} ({y})" for p, a, b, y in kayit["glif"][:300]]
    rapor.append(f"\nYAPAY ZEKÂ DÜZELTMELERİ ({len(kayit['duzeltme'])}):")
    rapor += [f"  s.{p}: {a!r} -> {b!r} ({n})" for p, a, b, n in kayit["duzeltme"]]
    rapor.append(f"\nTESSERACT'IN ATLADIĞI, YENİDEN OKUNAN BÖLGELER ({len(kayit['bosluk'])}):")
    rapor += [f"  s.{p}: {m!r}" for p, m in kayit["bosluk"]]
    rapor.append(f"\nSİLİNEN KIRINTILAR (süsleme/leke okumaları) ({len(kayit['silinen'])}):")
    rapor += [f"  s.{p}: {a!r}" for p, a in kayit["silinen"]]
    rapor.append(f"\nKARAR VERİLEMEYEN ŞÜPHELİLER ({len(kayit['kalan'])}) - editör adımında bakılır:")
    rapor += [f"  s.{p}: {a!r}" + (f" -> {b!r}" if a != b else "") + f"  (güven {c:.0f})" for p, a, b, c in kayit["kalan"][:300]]
    (book_dir / f"{stem}_hafif_rapor.txt").write_text("\n".join(rapor) + "\n", encoding="utf-8")

    try:
        from sure_tahmini import sure_kaydet
        if tess_gerek:
            sure_kaydet("ocr", "tesseract", len(tess_gerek), sure_ocr)
        if okuyucu.cagri:
            sure_kaydet("hakem", args.vlm_model, son, sure_vlm)
    except Exception:
        pass

    print("\n".join(rapor[2:8]))
    print(f"Bitti: {book_dir / (stem + '.md')}")


if __name__ == "__main__":
    main()
