# -*- coding: utf-8 -*-
"""
editor.py - Taranmış (OCR) bir kitabın .md dosyasını düzeltir.

MİMARİ: hunspell ile aday bulma (AI'sız, bedava) + LLM'e ÇOKTAN SEÇMELİ
karar sorusu, BATCH (grup) halinde, POZİSYON DOĞRULAMALI.

v10 DEĞİŞİKLİKLERİ (Kafamda Bir Tuhaflık karşılaştırma testinden) - EDİTÖR
DOĞRUYU BOZMASIN: testte editör 948 hatayı düzeltip 701 doğru kelimeyi bozuyordu.
- ŞAPKALI HARF ASLA SİLİNMEZ: sözlük "kâğıt"ı tanımayıp "kağıt" öneriyordu
  (kâğıt->kağıt x38, âşık->şık x21, hikâye->hikaye...). Artık â/î/û'lu bir
  kelime, şapkasız hali geçerliyse geçerli sayılıyor; şapka silen her cevap
  reddediliyor.
- ŞAPKA TUTARLILIĞI: kitap "dükkân"ı çoğunlukla şapkalı yazıyorsa, OCR'ın
  şapkasını düşürdüğü "dükkan"lar da şapkalıya çevriliyor (kod, AI yok).
- SIK GEÇEN KELİME KORUMASI (büyük/küçük harf fark etmeksizin): kitapta 3+
  kez geçen sözlük dışı kelime büyük ihtimalle yazarın tercihi (Ağbi, Camii,
  meyva...), LLM'e sorulmuyor. Sadece bedava/kesin düzeltmesi varsa düzeltiliyor.
- YENİ BEDAVA DÜZELTMELER: OCR kekelemesi (mahalledede->mahallede,
  yürüürken->yürürken) ve w->v (zawallı->zavallı) artık AI'sız çözülüyor.
- EK KIRPMA / UZATMA KORUMASI: "Süleymancığım->Süleyman", "Anadolumuzun->
  Anadolu" gibi eki kesen cevaplar reddediliyor; "Booozaaaa", "İiiyii" gibi
  bilerek uzatılmış kelimelere hiç dokunulmuyor.
- BOŞLUK BİRLEŞTİRME SIKILAŞTI: "on iki->oniki", "Mevlut'u mutlu->
  Mevlut'umutlu", "kız aramıyor->kızaramıyor" gibi hatalar yüzünden: sayılar,
  kesme işaretinden sonra gelen ekler ve iki parçası da geçerli kelime olan
  çiftler artık birleştirme adayı değil.
- v10.1 (ikinci ölçümden): kekeleme kuralı özel isimleri bozuyordu (Camii->
  Cami, Vurallar->Vuralar, Yoo->Yo); büyük harfli ve sık geçen kelimelerde
  artık sadece düz harfi Türkçe harfe çeviren düzeltme (tipki->tıpkı) bedava
  yapılıyor, tersi (hükümet->hükumet, Tarık->Tarik) yapılmıyor. Araya tire
  sokan cevaplar da reddediliyor (alçakgönüllü -> alçak-gönüllü).
- v10.2 (üçüncü ölçümden): cins isimlerdeki kesme işareti kaldırılıyor
  (dükkân'da -> dükkânda); "Emin_DEĞİLİM" gibi farklı yazılmış cevaplar artık
  tanınıyor (metne kelime olarak giriyordu); özel ismin baş harfini değiştiren
  cevaplar (Kürtsünüz -> Türksünüz) ve sayı ekleri (1990'ların) taranmıyor.
- v10.3 (ensemble testinden): koruma eşiği metin uzunluğuna göre (kısa
  metinde 2 tekrar yeterli); sadece araya boşluk koyan öneriler (işyerleri ->
  iş yerleri) doğru birleşik kelime sayılıp incelemeye yazılmıyor.
- Çift model OCR kullanıldıysa, iki modelin aynı okuduğu sözlük dışı
  kelimeler (<kitap>_onayli.json) korunuyor: testte editörün bozduğu Ağbi,
  meyva, Dallas, gebertmene gibi kelimelerin hepsi bu listedeydi.
- v11 (Hamnet testinden, taranmış kitap): boşluk hataları kodla düzeltiliyor
  (büyükbir -> büyük bir, sandal yeyi -> sandalyeyi); yabancı isim ekleri
  kitabın kendi kuralına uyduruluyor (Agnes'in -> Agnes'ın, kitap okunuşa göre
  yazıyorsa); kelimeyi tanınmayacak kadar değiştiren model cevapları
  reddediliyor (kuşüvezi -> kavuşuver).
- TİRE BİRLEŞTİRME (sözlüklü): ocr.py artık satır içi tireleri silmiyor
  (gidiş-geliş -> gidişgeliş oluyordu). "olduğu-nu" gibi tireleme kalıntıları
  burada, sözlüğe bakılarak birleştiriliyor: birleşik hali geçerliyse ve
  parçalardan biri tek başına kelime değilse birleşir; "gidiş-geliş" kalır.

v9 DEĞİŞİKLİKLERİ (v8'den) - VERİ BÜTÜNLÜĞÜ:
- KRİTİK BUG: batch cevapları bazen SIRASI KAYMIŞ dönüyordu (model N.
  sorunun cevabını M. soruya bağlıyordu) - liste UZUNLUĞU doğru olduğu için
  eski kontrolümüz (len kontrolü) bunu YAKALAYAMIYORDU. Boşluk-adaylarında
  answer_resembles güvenlik ağı şans eseri yakaladı, ama kelime batch'lerinde
  hiçbir çapraz-kontrol yoktu - yanlış kelimeye yanlış düzeltme sessizce
  uygulanabilirdi. ÇÖZÜM: model artık her cevabın yanına hangi soruya ait
  olduğunu da (orijinal kelimeyi/ifadeyi) tekrar yazıyor, kod bunu pozisyon
  pozisyon doğruluyor - uyuşmazlık varsa TÜM batch güvenli tek-tek yönteme
  düşüyor.

v8 DEĞİŞİKLİKLERİ (v7'den) - HIZ VE MODEL:
- Kelimeler artık TEK TEK değil, WORD_BATCH_SIZE kadar grup halinde tek
  LLM çağrısında soruluyor (Hamnet gibi büyük kitaplarda süreyi kısaltmak için).
- MODEL DEĞİŞTİ: qwen3:14b -> qwen2.5:14b-instruct. qwen3 (thinking modu),
  batch/JSON formatı gibi katı talimatları sık sık çiğniyordu ("let's tackle
  this step by step" diye her elemanı ayrı ayrı uzun uzun işleyip formatı
  bozuyordu). qwen2.5-instruct (thinking yok) çok daha itaatkâr.

v7 DEĞİŞİKLİKLERİ (v6'dan):
- Büyük harfle başlayan, sık tekrarlayan kelimeler (özel isim) LLM'e hiç
  sorulmadan otomatik korunuyor (Hamnet/Hamlet olayı).

v6/v5 DEĞİŞİKLİKLERİ: iki sözlük birleştirme (yeni+eski), çakışma önleme
(boşluk-adayı parçaları tekil taranmıyor), boşluk-cevap benzerlik doğrulaması,
çok-kelimeli-cevap reddi.

Kullanım:
    python editor.py --input output/kitap/kitap.md --book kitap
    python editor.py --input output/kitap/kitap.md --book kitap --limit 30 --dry-run --verbose

Çıktılar:
    output/<kitap>/<kitap>_editor.md          <- düzeltilmiş tam metin
    output/<kitap>/<kitap>_degisiklikler.txt  <- uygulanan her düzeltme
    output/<kitap>/<kitap>_incele.txt         <- elle bakman gereken EMİN_DEĞİLİM'ler

ÖNEMLİ: --dry-run vermediğin sürece bile orijinal .md dosyasına HİÇBİR ZAMAN
yazılmaz - script sadece okur, çıktıyı her zaman ayrı bir *_editor.md
dosyasına yazar.
"""

import argparse
import difflib
import itertools
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

import requests
from spylls.hunspell import Dictionary

# --- Ayarlar ---
OLLAMA_URL = "http://localhost:11434/api/chat"
EDITOR_MODEL = os.environ.get("KITAP_EDITOR_MODEL", "qwen2.5:14b-instruct")  # boş = kural tabanlı mod (dil modeli yok); thinking yok - batch/JSON formatına çok daha sadık
NUM_CTX = 16384
REQUEST_TIMEOUT = 600
THINK = False
NUM_PREDICT_SINGLE = 800        # thinking olmadığı için düz cevap yeterli
NUM_PREDICT_BATCH = 3000
MAX_SUGGESTIONS = 3

WORD_BATCH_SIZE = 12
SPACE_BATCH_SIZE = 15

AUTO_PROTECT_MIN_COUNT = 4

TR_LETTERS = "A-Za-zÇĞİıÖŞÜçğıöşüÂâÎîÛû"
# Yabancı özel isimlerdeki harfler (é, ä, ñ, ø, č...) de kelimenin parçasıdır: yoksa "Napoléon"
# "Napol" diye kesilir ve "Jos" gibi bir parçanın düzeltmesi "José"yi bozabilirdi.
TR_LETTERS += "À-ÖØ-öø-ÿĀ-ſ"
TURKCE_HARFLER = set("abcçdefgğhıijklmnoöprsştuüvyzâîûqwxABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZÂÎÛQWX")


def yabanci_harfli(w: str) -> bool:
    """Türkçede olmayan bir harf taşıyan kelime (Napoléon, Europäers): yabancı yazımdır, düzeltilmez."""
    return any(c.isalpha() and c not in TURKCE_HARFLER for c in w)

AMBIGUOUS_PAIRS = [("i", "ı"), ("s", "ş"), ("u", "ü"), ("o", "ö"), ("c", "ç"), ("g", "ğ")]
AMBIGUOUS_CHARS = set(a for pair in AMBIGUOUS_PAIRS for a in pair)
SHORT_LEN = 3

NUMBER_WORDS = {
    "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz", "on",
    "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan", "yüz", "bin",
}

CAPITAL_PROTECT_MIN_COUNT = 2   # büyük harfli sözlük dışı kelime 2+ kez geçiyorsa özel isim (New, Opel, Vurallar)
FREQ_PROTECT_MIN_COUNT = 3      # sözlük dışı ama kitapta bu kadar geçen kelime = yazar tercihi
FREQ_PROTECT_SHORT_COUNT = 2    # kısa metinlerde (öykü, test parçası) aynı koruma için yeterli sayı
SHORT_TEXT_WORDS = 60000        # bundan az kelimeli metin "kısa" sayılır
CIRCUMFLEX_MIN_COUNT = 3        # şapka tutarlılığı için şapkalı biçimin en az geçme sayısı
CIRCUMFLEX_MIN_SHARE = 0.75     # ve tüm varyantlar içindeki payı
# Şapkalı/şapkasız hali FARKLI anlamda iki kelime olanlar: tutarlılık geçişi bunlara dokunmaz
CIRCUMFLEX_HOMOGRAPHS = {
    "hala", "kar", "hakim", "adet", "alem", "ama", "dahi", "yar", "kamil", "hal", "anı", "an",
    "rakım", "katil", "şura", "alim", "hail", "harem", "emlak", "vakıf",
}
CIRCUMFLEX_FOLD = str.maketrans("âîûÂÎÛ", "aiuAIU")
# Şapkası yaygın olarak düşürülen, şapkasız hali başka bir kelime OLMAYAN
# kökler (TDK yazımı). Sadece kitap genelinde şapkalı yazım kullanılıyorsa
# (bkz. CIRCUMFLEX_STYLE_MIN) OCR'ın düşürdüğü şapka bunlara geri konur:
# dükkan'da -> dükkân'da, aşık -> âşık, hikayesini -> hikâyesini.
CIRCUMFLEX_STEMS = [
    "dükkân", "kâğıt", "kâğıd", "hikâye", "âşık", "bekâr", "nikâh", "rüzgâr", "imkân",
    "dergâh", "kâtip", "kâbus", "kâinat", "şikâyet", "muhafazakâr", "tezgâh", "kâhya",
    "mahkûm", "sükûn", "kâfir", "yadigâr",
]
CIRCUMFLEX_STEMS = [x for x in CIRCUMFLEX_STEMS if x]
CIRCUMFLEX_STYLE_MIN = 20       # kitapta en az bu kadar şapkalı kelime varsa "şapkalı yazım" kabul edilir
URL_PARTS = {"com", "net", "org", "www", "http", "https", "tr", "html"}
# E-posta ve web adresleri: harf düzeltmesi yapılmaz (yayinevi@canyayinlari.com doğru yazımdır)
ADRES_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+|(?:https?://|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|edu|gov|info|tr)\b\S*")

STOPWORDS = {
    "bu", "şu", "o", "ne", "de", "da", "e", "ve", "ya", "ki", "bir",
    "mi", "mı", "mu", "mü", "ile", "için", "gibi", "ama", "fakat",
    "en", "her", "hiç", "tüm", "çok", "az", "the",
}

# --- Tekil promptlar (batch başarısız olursa fallback) ---

WORD_PROMPT = """Aşağıda Türkçe bir kitaptan OCR ile çıkarılmış, sözlükte bulunamadığı için ŞÜPHELİ işaretlenmiş bir kelime ve geçtiği cümle var.

Şüpheli kelime: {word}
Bağlam: {context}
Sözlüğün önerdiği olası düzeltmeler (varsa): {suggestions}

Görevin: Bu kelimenin OCR hatası içerip içermediğine karar vermek.
- "Diğer OCR modellerinin okuması" verildiyse: aynı sayfa başka modellerle de okundu ve bu kelime orada böyle okundu. Bağlama uyuyorsa ONU seç - bu, sayfada gerçekten basılı olan kelimeye en güçlü ipucudur.
- Sözlüğün önerdiği adaylardan biri bağlama uyuyorsa, onu seç.
- Öneriler bağlama uymuyorsa ama yine de bariz bir OCR hatası görüyorsan (harf karışıklığı/eksikliği), kendi bulduğun DOĞRU YAZIMINI ver. Büyük/küçük harf düzenini orijinal kelimeyle aynı tut.
- Kelime aslında doğruysa ama sözlükte yoksa (özel isim, yer adı, yabancı isim, eski/nadir kelime, argo, yazarın bilinçli tercihi) "AYNI" de.
- ÖZEL İSİMLER İÇİN DİKKATLİ OL: bariz bir harf bozulması YOKSA ismi DEĞİŞTİRME, "AYNI" de.
- Emin değilsen "EMİN_DEĞİLİM" de.
- Cevabın SADECE bu şüpheli kelimenin YERİNE GEÇECEK TEK BİR KELİME olmalı - bağlamdan başka bir kelime EKLEME.

Cevabını MUTLAKA en son satırda, başka hiçbir şey olmadan tam olarak şu formatta ver:
CEVAP: <düzeltme_ya_da_AYNI_ya_da_EMİN_DEĞİLİM>

Bu formatın dışında CEVAP: kelimesini başka hiçbir yerde kullanma.
"""

SPACE_PROMPT = """Aşağıda Türkçe bir kitaptan OCR ile çıkarılmış metinde, yanlışlıkla araya boşluk girmiş OLABİLECEK iki kelime ve birleştirilmiş hali var.

Metindeki hali: "{phrase}"
Birleştirme adayı: "{merged}"
Bağlam: {context}

Görevin: Bu bağlamda doğrusunun birleşik mi ("{merged}") yoksa ayrı mı ("{phrase}") yazılması gerektiğine karar vermek. UNUTMA: "{phrase}" içindeki kelimeler ayrı ayrı da anlamlı/geçerli olabilir - sırf birleştirince başka bir geçerli kelime çıkması, birleşik olması gerektiği anlamına GELMEZ.

- Birleşik olması gerekiyorsa "{merged}" de (TAM OLARAK bu şekilde).
- Ayrı kalması gerekiyorsa "AYNI" de.
- Emin değilsen "EMİN_DEĞİLİM" de.

Cevabını MUTLAKA en son satırda, başka hiçbir şey olmadan tam olarak şu formatta ver:
CEVAP: <birleşik_hali_ya_da_AYNI_ya_da_EMİN_DEĞİLİM>

Bu formatın dışında CEVAP: kelimesini başka hiçbir yerde kullanma.
"""

# --- Batch (grup) promptları - pozisyon doğrulamalı ---

WORD_BATCH_PROMPT = """Aşağıda Türkçe bir kitaptan OCR ile çıkarılmış, sözlükte bulunamadığı için ŞÜPHELİ işaretlenmiş kelimelerin NUMARALI bir listesi var. Her biri için bağlamı ve sözlük önerileri de verildi.

Her biri için AYRI AYRI karar ver:
- "Diğer OCR modellerinin okuması" verildiyse: aynı sayfa başka modellerle de okundu ve bu kelime orada böyle okundu. Bağlama uyuyorsa ONU seç - bu, sayfada gerçekten basılı olan kelimeye en güçlü ipucudur.
- Sözlüğün önerdiği adaylardan biri bağlama uyuyorsa, onu seç.
- Öneriler uymuyorsa ama bariz bir OCR hatası görüyorsan, kendi bulduğun DOĞRU YAZIMINI ver (büyük/küçük harf düzenini koru).
- Kelime aslında doğruysa ama sözlükte yoksa (özel isim, yer adı, yabancı isim, eski/nadir kelime, argo) "AYNI" de.
- ÖZEL İSİMLERDE bariz bir harf bozulması YOKSA "AYNI" de.
- Emin değilsen "EMİN_DEĞİLİM" de.
- Her cevap SADECE o kelimenin YERİNE GEÇECEK TEK BİR KELİME olmalı - bağlamdan başka kelime EKLEME.

Liste:
{items}

ÇOK ÖNEMLİ: Cevabında HER ELEMAN İÇİN, hangi kelimeye cevap verdiğini de tekrar yaz - böylece sıra karışmaz. Cevabını MUTLAKA en son satırda, başka hiçbir şey olmadan, TAM OLARAK {n} elemanlı şu formatta bir JSON listesi olarak ver:
CEVAP: [{{"kelime": "orijinal_kelime_1", "cevap": "..."}}, {{"kelime": "orijinal_kelime_2", "cevap": "..."}}, ...]

"kelime" alanına listedeki o maddenin ORİJİNAL kelimesini AYNEN kopyala (değiştirmeden). Bu formatın dışında CEVAP: kelimesini başka hiçbir yerde kullanma. Liste uzunluğu tam olarak {n} olmalı.
"""

SPACE_BATCH_PROMPT = """Aşağıda Türkçe bir kitaptan OCR ile çıkarılmış metinde, yanlışlıkla araya boşluk girmiş OLABİLECEK kelime çiftlerinin NUMARALI bir listesi var. Her biri için birleştirme adayı ve bağlam verildi.

Her biri için AYRI AYRI karar ver:
- Birleşik olması gerekiyorsa, verilen birleştirme adayını TAM OLARAK yaz.
- Ayrı kalması gerekiyorsa (iki ayrı, kendi başına anlamlı kelime/ek) "AYNI" de.
- Emin değilsen "EMİN_DEĞİLİM" de.
UNUTMA: sırf birleştirince başka bir geçerli kelime çıkması, birleşik olması gerektiği anlamına GELMEZ.

Liste:
{items}

ÇOK ÖNEMLİ: Cevabında HER ELEMAN İÇİN, hangi kelime çiftine cevap verdiğini de tekrar yaz - böylece sıra karışmaz. Cevabını MUTLAKA en son satırda, başka hiçbir şey olmadan, TAM OLARAK {n} elemanlı şu formatta bir JSON listesi olarak ver:
CEVAP: [{{"ifade": "orijinal_ifade_1", "cevap": "..."}}, {{"ifade": "orijinal_ifade_2", "cevap": "..."}}, ...]

"ifade" alanına listedeki o maddenin metindeki hali (tırnaklı orijinal ifadeyi) AYNEN kopyala. Bu formatın dışında CEVAP: kelimesini başka hiçbir yerde kullanma. Liste uzunluğu tam olarak {n} olmalı.
"""


def load_dictionaries():
    """Hem yeni (kapsamlı, tdd-ai) hem eski (daha isabetli öneri üreten)
    sözlüğü birlikte yükler. Geçerlilik kontrolünde ikisinden biri
    tanıyorsa yeterli sayılır; öneri listesinde ikisinin önerileri
    birleştirilir."""
    base = Path(__file__).parent / "tr_TR"
    if not (Path(__file__).parent / "tr_TR.dic").exists():
        print("HATA: tr_TR.aff ve tr_TR.dic bu klasörde yok.")
        sys.exit(1)
    new_dict = Dictionary.from_files(str(base))

    old_base = Path(__file__).parent / "eski sözlükler" / "tr_TR"
    old_dict = None
    if (Path(__file__).parent / "eski sözlükler" / "tr_TR.dic").exists():
        old_dict = Dictionary.from_files(str(old_base))
    else:
        print("UYARI: 'eski sözlükler/tr_TR.dic' bulunamadı, sadece yeni sözlükle devam ediliyor.")

    return new_dict, old_dict


def trlow(s: str) -> str:
    """Türkçe'ye uygun küçük harf: I -> ı, İ -> i (Python'un lower()'ı I'yı i yapar)."""
    return s.replace("I", "ı").replace("İ", "i").lower()


def tr_upper(s: str) -> str:
    return s.replace("i", "İ").replace("ı", "I").upper()


def tr_special_count(s: str) -> int:
    return sum(1 for ch in s if ch in "çğıöşüÇĞİÖŞÜâîûÂÎÛ")


def circumflex_count(s: str) -> int:
    return sum(1 for ch in s if ch in "âîûÂÎÛ")


_valid_cache = {}


def _lookup(dictionaries, word: str) -> bool:
    new_dict, old_dict = dictionaries
    for w in (word, trlow(word)):
        if new_dict.lookup(w) or (old_dict and old_dict.lookup(w)):
            return True
    return False


def is_valid(dictionaries, word: str) -> bool:
    """Sözlükte var mı? Şapkalı kelime (kâğıt, dükkân, hikâye), şapkasız
    hali geçerliyse geçerli sayılır - sözlük şapkalı biçimi bilmese de doğrudur."""
    if word in _valid_cache:
        return _valid_cache[word]
    ok = _lookup(dictionaries, word)
    if not ok and circumflex_count(word):
        ok = _lookup(dictionaries, word.translate(CIRCUMFLEX_FOLD))
    _valid_cache[word] = ok
    return ok


def get_suggestions(dictionaries, word: str, max_n: int = MAX_SUGGESTIONS):
    new_dict, old_dict = dictionaries
    seen = []
    try:
        for s in itertools.islice(new_dict.suggest(word), max_n):
            if s not in seen:
                seen.append(s)
    except Exception:
        pass
    if old_dict:
        try:
            for s in itertools.islice(old_dict.suggest(word), max_n):
                if s not in seen:
                    seen.append(s)
        except Exception:
            pass
    return seen[: max_n + 2]


def call_ollama_raw(prompt: str, num_predict: int, verbose: bool = False):
    payload = {
        "model": EDITOR_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "think": THINK,
        "options": {"num_ctx": NUM_CTX, "temperature": 0.0, "num_predict": num_predict},
    }
    resp = requests.post(OLLAMA_URL, json=payload, timeout=REQUEST_TIMEOUT)
    if not resp.ok:
        raise requests.exceptions.RequestException(f"HTTP {resp.status_code} - {resp.text}")
    data = resp.json()
    message = data["message"]
    content = message.get("content", "") or ""
    thinking = message.get("thinking", "") or ""
    if verbose:
        preview = thinking if thinking else content
        print(f"      (ham: {preview[:200].strip()}...)")
    return content, thinking


def call_ollama(prompt: str, verbose: bool = False) -> str:
    """Tekil (fallback) çağrı - tek satırlık CEVAP: değerini döner."""
    content, thinking = call_ollama_raw(prompt, NUM_PREDICT_SINGLE, verbose)
    combined = content if "CEVAP:" in content.upper() else (thinking or content)
    matches = re.findall(r"CEVAP\s*:\s*(.+)", combined, re.IGNORECASE)
    if matches:
        return matches[-1].strip().strip('"').strip("'").rstrip(".!:;,")
    return ""


def call_ollama_batch(prompt: str, expected_n: int, expected_keys, key_field: str, verbose: bool = False):
    """Batch çağrı - CEVAP: sonrası JSON listesini ayrıştırır. Her eleman
    {key_field: ..., "cevap": ...} formatında olmalı - key_field'ın
    expected_keys[i] ile POZİSYON POZİSYON eşleştiğini doğrular. Uzunluk
    tutsa bile SIRALAMA KAYMIŞSA (model cevapları yanlış soruya bağlamışsa)
    bunu yakalayıp None döner - çağıran taraf tüm batch'i güvenli tek-tek
    yönteme düşürür. Sadece uzunluk kontrolü bu tür sessiz kaymaları
    YAKALAYAMIYORDU."""
    content, thinking = call_ollama_raw(prompt, NUM_PREDICT_BATCH, verbose)
    combined = content if "CEVAP:" in content.upper() else (thinking or content)
    matches = re.findall(r"CEVAP\s*:\s*(.+)", combined, re.IGNORECASE | re.DOTALL)
    if not matches:
        return None
    raw = matches[-1].strip()
    raw = re.sub(r"^```(json)?", "", raw).strip()
    raw = re.sub(r"```.*$", "", raw, flags=re.DOTALL).strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\[.*\]", raw, re.DOTALL)
        if not m:
            return None
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return None

    if not isinstance(data, list) or len(data) != expected_n:
        return None

    def normalize(s):
        return re.sub(r"\s+", "", str(s).strip().lower())

    results = []
    for i, item in enumerate(data):
        if not isinstance(item, dict) or key_field not in item or "cevap" not in item:
            return None
        echoed_key = normalize(item[key_field])
        expected_key = normalize(expected_keys[i])
        if echoed_key != expected_key:
            return None  # SIRA KAYMIŞ - tüm batch'i reddet
        cevap = str(item["cevap"]).strip().strip('"').strip("'").rstrip(".!:;,")
        results.append(cevap)
    return results


def classify_answer(answer: str, key_display: str):
    if not answer:
        return "unsure", "(cevap ayıklanamadı)"
    upper = answer.upper()
    # Model "Emin_DEĞİLİM", "emin değilim", "Aynı" gibi farklı yazımlarla cevap
    # verebiliyor; hepsini harf dışı karakterleri atıp Türkçe harfleri
    # sadeleştirerek tanı (testte "Emin_DEĞİLİM" metne kelime diye girmişti).
    plain = re.sub(r"[^a-z]", "", trlow(answer).translate(str.maketrans("ığüşöçâîû", "igusocaiu")))
    if plain == "ayni" or answer.lower() == key_display.lower():
        return "same", answer
    if "emindegilim" in plain:
        return "unsure", answer
    if len(answer) > len(key_display) + 15 or "\n" in answer:
        return "unsure", f"şüpheli cevap: {answer[:40]}"
    # Model sadece araya boşluk/tire koymayı öneriyorsa (işyerleri -> iş yerleri,
    # amcaoğlu -> amca oğlu) kelime zaten doğru yazılmış bir birleşik kelimedir:
    # dokunma ve incelemeye de yazma.
    if " " not in key_display and re.sub(r"[\s\-]", "", trlow(answer)) == trlow(key_display):
        return "same", answer
    if " " not in key_display and " " in answer:
        return "unsure", f"beklenmeyen çok kelimeli cevap: {answer[:40]}"
    a_low, k_low = trlow(answer), trlow(key_display)
    if a_low.startswith(k_low) and a_low[len(k_low):] in COPULA_SUFFIXES:
        return "unsure", f"sona ek ekleyen cevap reddedildi: {answer[:40]}"   # ifadesizmiş -> ifadesizmiştir
    fold = str.maketrans("çğıöşüâîû", "cgiosuaiu")
    if a_low.translate(fold) == k_low.translate(fold) and tr_special_count(answer) < tr_special_count(key_display):
        return "unsure", f"Türkçe harf silen cevap reddedildi: {answer[:40]}"
    if " " not in key_display:
        # Şapka silen cevap: kâğıt -> kağıt, âşık -> şık
        if circumflex_count(answer) < circumflex_count(key_display):
            return "unsure", f"şapka silen cevap reddedildi: {answer[:40]}"
        # Eki kesen cevap: Süleymancığım -> Süleyman, Anadolumuzun -> Anadolu
        if len(key_display) - len(answer) >= 2 and trlow(key_display).startswith(trlow(answer)):
            return "unsure", f"eki kesen cevap reddedildi: {answer[:40]}"
        # Kelimeyi tanınmayacak kadar değiştiren cevap: kuşüvezi -> kavuşuver,
        # şıpinişi -> postnişin, kekremsi -> kükremesi. Model burada düzeltmiyor,
        # tahmin ediyor; yanlış tahmin metne doğru bir kelime gibi yerleşir.
        # (Türkçe harf farkları -ı/i, ş/s, ğ/g...- sayılmaz: "tipirti -> tıpırtı"
        # gibi nokta/çengel düzeltmeleri ne kadar çok harfe dokunursa dokunsun meşru.)
        fold = str.maketrans("ıiğşçöüâîû", "iigscouaiu")
        if levenshtein(trlow(answer).translate(fold), trlow(key_display).translate(fold)) > max(2, len(key_display) // 3):
            return "unsure", f"kelimeyi çok fazla değiştiren cevap reddedildi: {answer[:40]}"
        # Araya tire sokan cevap: alçakgönüllü -> alçak-gönüllü
        if "-" in answer and "-" not in key_display:
            return "unsure", f"tire ekleyen cevap reddedildi: {answer[:40]}"
        # Özel ismin baş harfi değişmiş: Kürtsünüz -> Türksünüz, Opel -> Öpel,
        # International -> Enternasyonali
        if key_display[:1].isupper() and answer[:1] != key_display[:1]:
            return "unsure", f"özel ismin baş harfini değiştiren cevap reddedildi: {answer[:40]}"
        # Özel isimden Türkçe harf silen cevap: Tarık -> Tarik, Kuştepe -> Kustepe
        if key_display[:1].isupper() and adds_turkish_letters_only(answer, key_display):
            return "unsure", f"özel isimden Türkçe harf silen cevap reddedildi: {answer[:40]}"
        # Baş harf büyüklüğü değişmiş: Booozaa -> boza
        if key_display[:1].isupper() != answer[:1].isupper():
            return "unsure", f"büyük/küçük harf değiştiren cevap reddedildi: {answer[:40]}"
    return "fix", answer


def generate_letter_candidates(word: str):
    positions = [i for i, ch in enumerate(word) if ch.lower() in AMBIGUOUS_CHARS]
    if not positions or len(positions) > 6:
        return []
    options_per_pos = []
    for i in positions:
        ch = word[i]
        is_upper = ch.isupper()
        chl = ch.lower()
        for a, b in AMBIGUOUS_PAIRS:
            if chl == a or chl == b:
                other = b if chl == a else a
                options_per_pos.append((i, [ch, other.upper() if is_upper else other]))
                break
    candidates = set()
    for combo in itertools.product(*[opts for _, opts in options_per_pos]):
        chars = list(word)
        for (i, _), new_ch in zip(options_per_pos, combo):
            chars[i] = new_ch
        candidates.add("".join(chars))
    candidates.discard(word)
    return candidates


def stutter_candidates(word: str):
    """OCR kekelemesi: aynı harf ya da hece iki kez okunmuş.
    yürüürken -> yürürken, mahalledede -> mahallede, aldığıını -> aldığını."""
    out = set()
    for n in (1, 2, 3):
        for i in range(len(word) - 2 * n + 1):
            if trlow(word[i:i + n]) == trlow(word[i + n:i + 2 * n]):
                out.add(word[:i + n] + word[i + 2 * n:])
    out.discard(word)
    return {c for c in out if len(c) >= 2}


TR_SPECIAL = set("çğıöşüÇĞİÖŞÜ")


def adds_turkish_letters_only(word: str, cand: str) -> bool:
    """Aday sadece düz harfi Türkçe harfe mi çeviriyor? (tipki -> tıpkı)
    OCR'ın baskın hatası bu yönde (ı yerine i: 633, tersi: 90), ters yönlü
    değişiklik (hükümet -> hükumet, Tarık -> Tarik) çoğunlukla doğruyu bozar."""
    if len(word) != len(cand):
        return False
    diffs = [(a, b) for a, b in zip(word, cand) if a != b]
    return bool(diffs) and all(a not in TR_SPECIAL and b in TR_SPECIAL for a, b in diffs)


def free_candidates(word: str, mode: str = "normal"):
    """AI'sız denenen adaylar: Türkçe harf karışması (ı/i, ş/s...), OCR
    kekelemesi ve Türkçe'de olmayan w -> v.
    mode="proper" (büyük harfli kelime): sadece düz harfi Türkçe harfe
      çeviren adaylar (Kismet -> Kısmet). Kekeleme kuralı özel isimleri
      bozuyordu: Vurallar -> Vuralar, Yoo -> Yo, Book -> Bok.
    mode="frequent" (kitapta sık geçen küçük harfli kelime): Türkçe harf
      ekleyen adaylar + kelime içi kekeleme (mahalledede, yürüürken) +
      w -> v; ama Türkçe harf silen (hükümet -> hükumet) ve kelime sonundaki
      çift harfi silen (camii -> cami) adaylar yok."""
    letters = set(generate_letter_candidates(word))
    if mode in ("proper", "frequent"):
        cands = {c for c in letters if adds_turkish_letters_only(word, c)}
    else:
        cands = letters
    if mode == "proper":
        return cands
    stutter = stutter_candidates(word)
    if mode == "frequent":
        stutter = {c for c in stutter if c[-1:] != word[-1:] or len(word) - len(c) > 1 or word[-2:-1] != word[-1:]}
    cands |= stutter
    if "w" in word or "W" in word:
        cands.add(word.replace("w", "v").replace("W", "V"))
    cands.discard(word)
    return cands


def find_context(text: str, phrase: str, max_len=140) -> str:
    idx = text.find(phrase)
    if idx == -1:
        return ""
    start = max(0, idx - max_len // 2)
    end = min(len(text), idx + len(phrase) + max_len // 2)
    return text[start:end].replace("\n", " ")


def find_suspicious_words(text: str, dictionaries):
    """Sözlükte olmayan kelimeleri bulur. AYRICA: büyük harfle başlayan ve
    metinde AUTO_PROTECT_MIN_COUNT'tan fazla geçen kelimeleri (neredeyse
    kesin özel isim) 'otomatik korunan' kümede işaretler - LLM'e hiç
    sorulmadan dokunulmadan bırakılır."""
    # Sayıya gelen ekler (1990'ların, 1950'lerden) tek başına kelime değil, tarama dışı
    scan_text = re.sub(rf"\d+['’][{TR_LETTERS}]+", " ", ADRES_RE.sub(" ", text))
    words = re.findall(rf"[{TR_LETTERS}]+(?:['’][{TR_LETTERS}]+)?", scan_text)
    counts = Counter(words)
    # Büyük/küçük harf ve ek fark etmeksizin kök sıklığı (Camii, Camii'nin, camii...)
    core_counts = Counter(trlow(re.split(r"['’]", w)[0]) for w in words)
    # Koruma eşiği metnin uzunluğuna göre: kısa bir metinde yazarın tercihi
    # olan bir kelime (Ağbi, meyva) 3 kez geçmeyebilir.
    freq_min = FREQ_PROTECT_MIN_COUNT if len(words) >= SHORT_TEXT_WORDS else FREQ_PROTECT_SHORT_COUNT

    seen = {}
    for w in words:
        if w in seen or len(w) <= 2 or w.isupper():
            continue
        if re.search(r"(.)\1\1", trlow(w)):
            continue  # Booozaaa, İiiyii: bilerek uzatılmış, dokunma
        if trlow(w) in URL_PARTS:
            continue
        if yabanci_harfli(w):
            continue  # yabancı yazım (Napoléon, Fouché): sözlükte olmaz ama hata da değildir
        if trlow(w) in SUFFIX_LIKE:
            continue  # kesme işaretinden kopmuş ek (Eliza' nın): kelime değil, "düzeltilmez"
        core = w
        if "'" in w or "’" in w:
            base = re.split(r"['’]", w)[0]
            if base[:1].isupper():
                continue
            core = base
        if not is_valid(dictionaries, core):
            seen[w] = find_context(text, w)

    protected_auto = {
        w for w in seen
        if (w[0].isupper() and counts.get(w, 0) >= CAPITAL_PROTECT_MIN_COUNT)
        or core_counts.get(trlow(re.split(r"['’]", w)[0]), 0) >= freq_min
    }

    return seen, protected_auto


def find_space_candidates(text: str, dictionaries):
    """Yanlışlıkla araya boşluk girmiş olabilecek çiftler. Testte bu adım
    doğrudan çok hata üretiyordu (on iki->oniki, kız aramıyor->kızaramıyor,
    Mevlut'u mutlu->Mevlut'umutlu), bu yüzden sadece gerçekten şüpheli
    çiftler aday: parçalardan en az biri tek başına kelime OLMAMALI."""
    # Kesme işaretli ekleri kelimeye dahil et ki "Mevlut'u" tek parça sayılsın
    tokens = re.findall(rf"[{TR_LETTERS}]+(?:['’][{TR_LETTERS}]+)?", text)
    candidates = {}
    for i in range(len(tokens) - 1):
        w1, w2 = tokens[i], tokens[i + 1]
        if "'" in w1 or "’" in w1 or "'" in w2 or "’" in w2:
            continue
        l1, l2 = trlow(w1), trlow(w2)
        if l1 in STOPWORDS or l2 in STOPWORDS:
            continue
        if l1 in NUMBER_WORDS or l2 in NUMBER_WORDS:
            continue
        if l1 == l2 or (l2.startswith("m") and l2[1:] == l1[1:]):
            continue  # ikileme: tır tır, dik dik, iş miş
        if len(w1) > SHORT_LEN and len(w2) > SHORT_LEN:
            continue
        if is_valid(dictionaries, w1) and is_valid(dictionaries, w2):
            continue  # iki parça da gerçek kelime: büyük ihtimalle ayrı yazılmalı
        merged = w1 + w2
        if is_valid(dictionaries, merged):
            key = f"{w1} {w2}"
            if key not in candidates:
                candidates[key] = (merged, find_context(text, key))
    return candidates


def answer_resembles(answer: str, expected: str) -> bool:
    a, e = answer.lower(), expected.lower()
    if a == e:
        return True
    shorter, longer = (a, e) if len(a) <= len(e) else (e, a)
    if not shorter:
        return False
    overlap = sum(1 for ch in shorter if ch in longer)
    return overlap / len(shorter) > 0.8 and abs(len(a) - len(e)) <= 2


def join_hyphenated(text: str, dictionaries):
    """Satır içi tireleme kalıntılarını sözlüğe bakarak birleştirir:
    olduğu-nu -> olduğunu, kub-benin -> kubbenin. Birleşik hali geçerli
    DEĞİLSE ya da iki parça da tek başına geçerli kelimeyse (gidiş-geliş,
    sağ-sol, işsiz-güçsüz) tire olduğu gibi kalır."""
    log = []

    def repl(m):
        a, b = m.group(1), m.group(2)
        joined = a + b
        if re.search(r"([aeıioöuü])\1", trlow(joined)):
            return m.group(0)  # Boo-zaa gibi uzatılmış nidalar
        if is_valid(dictionaries, joined) and not (is_valid(dictionaries, a) and is_valid(dictionaries, b)):
            log.append((m.group(0), joined))
            return joined
        return m.group(0)

    pattern = re.compile(rf"(?<![{TR_LETTERS}-])([{TR_LETTERS}]{{2,}})-([a-zçğıöşüâîû]{{2,}})(?![{TR_LETTERS}-])")
    return pattern.sub(repl, text), log


def restore_circumflex(text: str):
    """OCR'ın düşürdüğü şapkaları kitabın kendi yazımına göre geri koyar:
    kitap 'dükkân'ı çoğunlukla şapkalı yazıyorsa 'dükkan' da 'dükkân' olur.
    Anlamı değişen çiftlere (hala/hâlâ, kar/kâr, hakim/hâkim...) dokunmaz."""
    words = re.findall(rf"[{TR_LETTERS}]+", text)
    counts = Counter(words)
    groups = {}
    for w, c in counts.items():
        groups.setdefault(w.translate(CIRCUMFLEX_FOLD), []).append((w, c))
    mapping = {}
    for plain, variants in groups.items():
        if len(variants) < 2 or trlow(plain) in CIRCUMFLEX_HOMOGRAPHS:
            continue
        total = sum(c for _, c in variants)
        best, best_c = max(variants, key=lambda v: (circumflex_count(v[0]) > 0, v[1]))
        if circumflex_count(best) == 0 or best_c < CIRCUMFLEX_MIN_COUNT or best_c / total < CIRCUMFLEX_MIN_SHARE:
            continue
        for w, c in variants:
            if w != best and circumflex_count(w) < circumflex_count(best):
                mapping[w] = best
    # Kitap şapkalı yazımı benimsemişse, bilinen köklerde düşen şapkayı geri koy
    circ_tokens = [w for w in words if circumflex_count(w)]
    if len(circ_tokens) >= CIRCUMFLEX_STYLE_MIN and len(set(map(trlow, circ_tokens))) >= 3:
        stems = [(trlow(st).translate(CIRCUMFLEX_FOLD), st) for st in CIRCUMFLEX_STEMS]
        for w in counts:
            if circumflex_count(w) or w in mapping:
                continue
            low = trlow(w)
            for key, st in stems:
                if low.startswith(key):
                    new = st + w[len(key):]
                    if w.isupper():
                        new = tr_upper(new)
                    elif w[:1].isupper():
                        new = tr_upper(new[0]) + new[1:]
                    mapping[w] = new
                    break
    log = []
    if mapping:
        pattern = re.compile(rf"(?<![{TR_LETTERS}])(" + "|".join(map(re.escape, sorted(mapping, key=len, reverse=True))) + rf")(?![{TR_LETTERS}])")
        n = Counter()

        def repl(m):
            n[m.group(1)] += 1
            return mapping[m.group(1)]

        text = pattern.sub(repl, text)
        log = [(w, mapping[w], n[w]) for w in sorted(mapping) if n[w]]
    return text, log


def remove_common_noun_apostrophes(text: str, dictionaries, second_text: str = "", basili: bool = False):
    """Kesme işareti sadece özel isimlerden sonra gelir. OCR bazen cins
    isimlere de koyuyor (dükkân'da, söz'e, kız'a - testte 40+ kez). Küçük
    harfli, sözlükte olan bir kelimeden sonra gelen ve birleşince geçerli
    kelime oluşturan eki birleştirir: dükkân'da -> dükkânda. Yabancı kelimeler
    (booze'dan) ve bölünmüş isim parçaları (Mev-lut'un) birleşik hali geçersiz
    olduğu için olduğu gibi kalır."""
    log = []
    if basili:
        # Metin PDF'in kendi metin katmanından geldi: kesme işaretleri OCR'ın değil, basılı metnin.
        return text, log
    # Aynı kök kitapta en az 3 farklı ekle kesme işaretli geçiyorsa (ben'in, ben'den, ben'di)
    # bu yazarın tercihidir; OCR'ın rastgele koyduğu kesme işareti böyle düzenli tekrar etmez.
    bicimler = {}
    for b, e in re.findall(rf"(?<![{TR_LETTERS}'’\-\d])([a-zçğıöşüâîû]+)['’]([a-zçğıöşüâîû]{{1,6}})(?![{TR_LETTERS}])", text):
        bicimler.setdefault(b, set()).add(e)
    bilincli = {b for b, ekler in bicimler.items() if len(ekler) >= 3}
    # İkinci model de aynı yerde kesme işareti okuduysa o kesme işareti sayfada basılıdır,
    # yazarın bilinçli tercihidir (Satranç: "öteki ben'in", "iki ben'den"): dokunulmaz.
    printed = set(re.findall(rf"[{TR_LETTERS}]+'[{TR_LETTERS}]+", second_text.replace("’", "'"))) if second_text else set()

    def repl(m):
        base, suffix = m.group(1), m.group(2)
        joined = base + suffix
        if f"{base}'{suffix}" in printed or base in bilincli:
            return m.group(0)
        if is_valid(dictionaries, base) and is_valid(dictionaries, joined):
            log.append((m.group(0), joined))
            return joined
        return m.group(0)

    pattern = re.compile(rf"(?<![{TR_LETTERS}'’\-\d])([a-zçğıöşüâîû]+)['’]([a-zçğıöşüâîû]{{1,6}})(?![{TR_LETTERS}])")
    return pattern.sub(repl, text), log


def levenshtein(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


SPLIT_COMMON = {  # bitişik okunduğunda ayrılması güvenli, sık geçen bağımsız kelimeler
    "bir", "daha", "ve", "gibi", "için", "kadar", "çok", "en", "her", "hiç", "ile", "sonra", "önce",
    "bu", "şu", "ne", "teker", "olan", "olarak", "diye", "değil", "bile", "artık", "hep", "gene",
    "yine", "şimdi", "sadece", "hemen", "biraz", "bütün", "hem", "ya", "ama", "fakat",
}
# İlk parça bu eklerden biriyle bitiyorsa orada bir kelime sınırı var demektir
# (yatakta|dönüyor, kardeşlerinden|daha). Tek ünlülü ekler (-ı, -i) bilerek yok:
# "eğrelti|otu", "acili|yetini" gibi yanlış bölmelere yol açıyordu.
SPLIT_CASE_ENDINGS = ("da", "de", "ta", "te", "dan", "den", "tan", "ten", "yla", "yle",
                      "ken", "arak", "erek", "ınca", "ince", "unca", "ünce")
VOWELS = set("aeıioöuüâîû")


def split_joined_words(text: str, dictionaries, keep=frozenset(), second_text: str = ""):
    """Taranmış, iki yana yaslı sayfalarda model iki kelimeyi birleştirebiliyor
    (büyükbir, yataktadönüyor, Nasılbecerecek). Sözlükte olmayan bir kelime
    TAM OLARAK BİR şekilde iki geçerli kelimeye bölünebiliyorsa VE bölmeyi
    destekleyen bir kanıt varsa bölünür.

    Kanıt olmadan bölmek iki tür hata üretiyordu (Hamnet testinde 42 bölmenin 32'si):
      - Harf hatalı kelimeyi parçalamak: sicağın -> "sic ağın", yapişmiş -> "yap işmiş"
      - Sözlüğün bilmediği bitişik kelimeyi bölmek: büyükannesini, eğreltiotu, hamamböcekleri
    Kanıtlar (biri yeterli):
      - İkinci model (ensemble) bu iki kelimeyi ayrı okumuş.
      - Parçalardan biri "bir, daha, gibi..." gibi sık bağımsız bir kelime.
      - İlk parça açık bir hâl ekiyle bitiyor (yatakta|dönüyor).
    İkinci model kelimeyi bitişik okuduysa hiç dokunulmaz.
    keep: dokunulmayacak kelimeler (iki modelin aynı okuduğu kelimeler)."""
    log = []
    counts = Counter(re.findall(rf"[{TR_LETTERS}]+", text))

    def ok_part(part):
        # Ek gibi kısa parçalar (ları, nı, in, si) ayrı kelime sayılmaz; kısa
        # parça ancak sık kullanılan bağımsız bir kelimeyse kabul edilir.
        return len(part) >= 3 or trlow(part) in SHORT_STANDALONE

    def looks_like_letter_error(w):
        # ı/i, ş/s, ğ/g... değişimiyle ya da tekrarlanan harf silinince geçerli
        # bir kelime çıkıyorsa bu bir boşluk hatası değil, harf hatasıdır.
        return any(is_valid(dictionaries, c) for c in itertools.chain(
            generate_letter_candidates(w), stutter_candidates(w)))

    def has_evidence(w, a, b):
        if second_text and f"{a} {b}" in second_text:
            return True
        al, bl = trlow(a), trlow(b)
        if al[-1] in VOWELS and bl[0] in VOWELS:
            return False
        if al[-1] not in VOWELS and bl[0] in VOWELS:
            return False          # "ağabey|imleri", "üzerler|ini": ek kopması gibi
        if al in SPLIT_COMMON or bl in SPLIT_COMMON:
            return True
        return len(al) >= 4 and len(bl) >= 4 and al.endswith(SPLIT_CASE_ENDINGS)

    def repl(m):
        w = m.group(0)
        # Birden fazla geçen kelime büyük ihtimalle gerçek bir kelimedir;
        # OCR'ın birleştirme hatası tek seferlik olur.
        if len(w) < 6 or w in keep or counts[w] > 1 or is_valid(dictionaries, w):
            return w
        if second_text and re.search(rf"(?<![{TR_LETTERS}]){re.escape(w)}(?![{TR_LETTERS}])", second_text):
            return w              # ikinci model de bitişik okumuş: büyük ihtimalle doğru
        splits = []
        for i in range(2, len(w) - 1):
            a, b = w[:i], w[i:]
            if b[0].isupper() or not ok_part(a) or not ok_part(b) or trlow(b) in SUFFIX_LIKE:
                continue
            if is_valid(dictionaries, a) and is_valid(dictionaries, b):
                splits.append((a, b))
        if len(splits) == 1 and has_evidence(w, *splits[0]) and not looks_like_letter_error(w):
            new = f"{splits[0][0]} {splits[0][1]}"
            log.append((w, new))
            return new
        return w

    pattern = re.compile(rf"(?<![{TR_LETTERS}'’\-])[{TR_LETTERS}]+(?![{TR_LETTERS}'’\-])")
    return pattern.sub(repl, text), log


def merge_broken_words(text: str, dictionaries, keep=frozenset()):
    """Model bir kelimeyi ikiye bölebiliyor (sandal yeyi, gece nin, görünmü
    yordu). Parçalardan en az biri tek başına kelime DEĞİLSE ve birleşik hali
    geçerliyse birleştirilir. İki parça da geçerliyse (veba ya, Ham net)
    dokunulmaz: ayrı yazılmış olabilirler."""
    log = []

    def repl(m):
        a, b = m.group(1), m.group(2)
        joined = a + b
        if trlow(a) in NUMBER_WORDS or trlow(b) in NUMBER_WORDS or a in keep or b in keep:
            return m.group(0)
        if is_valid(dictionaries, a) and is_valid(dictionaries, b):
            return m.group(0)
        if is_valid(dictionaries, joined):
            log.append((m.group(0), joined))
            return joined
        return m.group(0)

    pattern = re.compile(rf"(?<![{TR_LETTERS}'’\-])([{TR_LETTERS}]+) ([a-zçğıöşüâîû]+)(?![{TR_LETTERS}'’\-])")
    return pattern.sub(repl, text), log


SHORT_STANDALONE = {"ve", "bu", "şu", "ne", "ah", "oh", "ey"}  # da/de/mi/ki bilerek yok: "akılda"yı "akıl da" yapardı
# Kelimenin sonundan koparılınca tek başına bir kelimeye benzeyen ama aslında
# ek olan parçalar: "kanları"yı "kan ları", "diyebilir"i "diye bilir" yapmasın.
SUFFIX_LIKE = {
    "lar", "ler", "ları", "leri", "dan", "den", "tan", "ten", "nda", "nde", "yla", "yle", "ıyla", "iyle",
    "nın", "nin", "nun", "nün", "ının", "inin", "unun", "ünün", "cık", "cik", "cuk", "cük", "dır", "dir",
    "dur", "dür", "tır", "tir", "der", "dar", "mış", "miş", "muş", "müş", "malı", "meli", "bilir", "malı",
    "sız", "siz", "suz", "süz", "lık", "lik", "luk", "lük", "ken", "dık", "dik", "ince", "ınca", "ınca",
}
COPULA_SUFFIXES = {"r", "dir", "dır", "dur", "dür", "tir", "tır", "tur", "tür"}
FRONT_TO_BACK = str.maketrans("eiöü", "aıou")
BACK_TO_FRONT = str.maketrans("aıou", "eiöü")


def _vowel_class(s: str):
    for ch in reversed(trlow(s)):
        if ch in "eiöü":
            return "front"
        if ch in "aıouâû":
            return "back"
    return None


def harmonize_name_suffixes(text: str, min_irregular: int = 2):
    """Özel isimlerden sonra gelen ekleri kitabın kendi kuralına uydurur.

    Çevirmenler yabancı isimlerde eki OKUNUŞA göre koyabilir: Agnes'ın,
    Hamnet'ın. OCR modelleri ise eki YAZILIŞA göre "düzeltip" Agnes'in yazar
    (Hamnet testinde 50 sayfada 70 hata). Model bu düzensiz biçimi kendiliğinden
    üretmez; kitapta bir isim düzensiz ince-kalın ekle en az min_irregular kez
    geçiyorsa bu kitabın kuralı odur, ismin diğer ekleri de buna uydurulur.

    GÜVENLİK: Sadece "kalın" yönde düzensizlik (ı, a, u, o) kanıt sayılır. Ters
    yön (Rayiha'yi gibi ince ek) çok yaygın bir OCR hatası olan ı -> i
    noktasının kaybından da çıkabildiği için kanıt sayılmaz."""
    pattern = re.compile(rf"(?<![{TR_LETTERS}])([A-ZÇĞİÖŞÜ][{TR_LETTERS}]+)(['’])([a-zçğıöşü]+)")
    by_name = {}
    for m in pattern.finditer(text):
        name, suffix = m.group(1), m.group(3)
        expected, actual = _vowel_class(name), _vowel_class(suffix)
        if expected and actual:
            d = by_name.setdefault(name, {"regular": 0, "irregular": 0})
            d["regular" if expected == actual else "irregular"] += 1
    targets = {n for n, d in by_name.items()
               if _vowel_class(n) == "front" and d["irregular"] >= min_irregular and d["regular"] > 0}
    log = []
    if not targets:
        return text, log

    def repl(m):
        name, ap, suffix = m.group(1), m.group(2), m.group(3)
        if name not in targets or _vowel_class(suffix) != "front":
            return m.group(0)
        new_suffix = suffix.translate(FRONT_TO_BACK)
        log.append((f"{name}{ap}{suffix}", f"{name}{ap}{new_suffix}"))
        return f"{name}{ap}{new_suffix}"

    return pattern.sub(repl, text), log


def other_readings(text: str, other_texts):
    """Metindeki her kelimeye, diğer modellerin aynı konumda okuduğu kelimeleri eşler.
    {kelime: [okuma1, okuma2, ...]} döner (kelimenin tüm geçişlerinden toplanır)."""
    word_re = re.compile(rf"[{TR_LETTERS}]+(?:['’][{TR_LETTERS}]+)*")
    norm = lambda w: trlow(w.replace("’", "'"))
    words = word_re.findall(text)
    out = {}
    for other in other_texts:
        o_words = word_re.findall(other)
        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(
                None, [norm(w) for w in words], [norm(w) for w in o_words], autojunk=False).get_opcodes():
            if tag == "replace" and i2 - i1 == j2 - j1 and i2 - i1 <= 2:
                for k in range(i2 - i1):
                    out.setdefault(words[i1 + k], []).append(o_words[j1 + k].replace("’", "'"))
    return out


def close_reading(word: str, alt: str) -> bool:
    """Diğer modelin okuması bu kelimenin OCR'la bozulmuş hali olabilecek kadar yakın mı?"""
    fold = str.maketrans("çğıöşüâîûÇĞİÖŞÜÂÎÛ", "cgiosuaiuCGIOSUAIU")
    a, b = trlow(word).translate(fold), trlow(alt).translate(fold)
    wl, al = trlow(word), trlow(alt)
    # Ensemble'daki gibi: GLM'in bilinen alışkanlıkları kanıt sayılmaz
    if wl.startswith(al):                                   # sonu kesilmiş: çıkardığını -> çıkardığı
        return False
    if al.startswith(wl) and al[len(wl):] in COPULA_SUFFIXES:   # ek fiil eklenmiş: gerekmiş -> gerekmiştir
        return False
    if tr_special_count(alt) < tr_special_count(word) and a == b:   # Türkçe harf düşmüş
        return False
    return levenshtein(a, b) <= max(2, len(word) // 4) and word[:1].isupper() == alt[:1].isupper()


def apply_fix(text: str, wrong: str, correct: str) -> str:
    # \b kesme işaretini kelime sınırı sayıyordu: tek başına "nın" -> "nin" düzeltmesi
    # kitaptaki BÜTÜN "Eliza'nın", "Caterina'nın" eklerini de "nin" yapıyordu.
    # Artık kelime ancak önünde harf/kesme işareti, arkasında harf yoksa değiştirilir.
    pre, post = rf"(?<![{TR_LETTERS}'’])", rf"(?![{TR_LETTERS}])"
    pattern = re.compile(pre + re.escape(wrong) + post)
    pattern_cap = re.compile(pre + re.escape(wrong.capitalize()) + post)
    # Adreslerin (e-posta, web) içine dokunma: yalnızca aralarındaki metin düzeltilir
    parcalar, son = [], 0
    for m in ADRES_RE.finditer(text):
        parcalar.append((text[son:m.start()], True))
        parcalar.append((m.group(0), False))
        son = m.end()
    parcalar.append((text[son:], True))
    out = []
    for p, duzelt in parcalar:
        if duzelt:
            p = pattern_cap.sub(correct.capitalize(), pattern.sub(correct, p))
        out.append(p)
    return "".join(out)


def process_word_batch(batch, verbose=False):
    """batch: [(word, context, suggestions_str), ...]. Döner: [(kind, value), ...]
    aynı sırada, ya da None (batch reddedildi, çağıran tek tek işlemeli)."""
    items_str = "\n".join(
        f'{j+1}. Kelime: {w}\n   Bağlam: {ctx or "(bağlam yok)"}\n   Öneriler: {sug}'
        for j, (w, ctx, sug) in enumerate(batch)
    )
    prompt = WORD_BATCH_PROMPT.format(items=items_str, n=len(batch))
    expected_keys = [w for (w, _, _) in batch]
    try:
        answers = call_ollama_batch(prompt, len(batch), expected_keys, "kelime", verbose=verbose)
    except requests.exceptions.RequestException as e:
        print(f"  [HATA] Batch: {e}")
        return None
    if answers is None:
        return None
    return [classify_answer(ans, w) for ans, (w, _, _) in zip(answers, batch)]


def process_space_batch(batch, verbose=False):
    """batch: [(phrase, merged, context), ...]. Döner: [(kind, value), ...]."""
    items_str = "\n".join(
        f'{j+1}. Metindeki hali: "{p}"  Birleştirme adayı: "{m}"\n   Bağlam: {ctx or "(bağlam yok)"}'
        for j, (p, m, ctx) in enumerate(batch)
    )
    prompt = SPACE_BATCH_PROMPT.format(items=items_str, n=len(batch))
    expected_keys = [p for (p, _, _) in batch]
    try:
        answers = call_ollama_batch(prompt, len(batch), expected_keys, "ifade", verbose=verbose)
    except requests.exceptions.RequestException as e:
        print(f"  [HATA] Batch: {e}")
        return None
    if answers is None:
        return None
    return [classify_answer(ans, p) for ans, (p, _, _) in zip(answers, batch)]


def main():
    parser = argparse.ArgumentParser(description="Hunspell aday bulma + LLM karar (batch, pozisyon doğrulamalı) ile Türkçe kitap editörü")
    parser.add_argument("--input", type=str, required=True)
    parser.add_argument("--book", type=str, required=True)
    parser.add_argument("--limit", type=int, default=None, help="Test için sadece ilk N adayı işle")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Dosya bulunamadı: {input_path}")
        sys.exit(1)

    print("Sözlükler yükleniyor...")
    dictionaries = load_dictionaries()
    text = input_path.read_text(encoding="utf-8")

    # Çift model OCR kullanıldıysa iki modelin AYNI okuduğu sözlük dışı kelimeler
    confirmed = set()
    confirmed_path = input_path.with_name(input_path.stem.removesuffix("_editor") + "_onayli.json")
    if confirmed_path.exists():
        try:
            confirmed = set(json.loads(confirmed_path.read_text(encoding="utf-8")))
        except (ValueError, OSError):
            confirmed = set()

    # Çift model OCR kullanıldıysa ikinci modelin okuması: kelime bölme kararlarında kanıt olarak kullanılır
    second_text = ""
    book_stem = input_path.stem.removesuffix("_editor")
    # Birden fazla ek model okuması olabilir (glm_ocr = ikinci model, gemma3 = oy için üçüncü model).
    # Boşluk kanıtı için ikinci model (GLM-OCR) tercih edilir, yoksa en son çalıştırılan.
    # Hepsi ayrıca şüpheli kelimelerde "diğer modellerin okuması" olarak kullanılır.
    other_texts = []
    # Hafif OCR metni PDF'in metin katmanından aldıysa (_sayfalar.json model: metin-katmani)
    # noktalama basılı metnindir; OCR kaynaklı sayılmaz.
    metin_katmani = False
    try:
        ana = json.loads(input_path.with_name(f"{book_stem}_sayfalar.json").read_text(encoding="utf-8"))
        metin_katmani = ana.get("model") == "metin-katmani"
    except (ValueError, OSError):
        pass
    for p in sorted(input_path.parent.glob(f"{book_stem}_sayfalar_*.json"),
                    key=lambda x: ("glm_ocr" in x.name, x.stat().st_mtime), reverse=True):
        try:
            pages = json.loads(p.read_text(encoding="utf-8")).get("pages", {})
            t = "\n".join(pages[k] for k in sorted(pages, key=int))
        except (ValueError, OSError):
            continue
        if not second_text:
            second_text = t
            print(f"İkinci model okuması bulundu ({p.name}), boşluk kararlarında kullanılacak.")
        other_texts.append(t)

    print("Tireleme kalıntıları birleştiriliyor (sözlüklü)...")
    text, hyphen_log = join_hyphenated(text, dictionaries)
    print(f"  {len(hyphen_log)} tireli kelime birleştirildi.")

    print("Boşluk hataları düzeltiliyor (sözlüklü)...")
    text, split_log = split_joined_words(text, dictionaries, keep=frozenset(confirmed), second_text=second_text)
    text, merge_log = merge_broken_words(text, dictionaries, keep=frozenset(confirmed))
    print(f"  {len(split_log)} birleşik kelime ayrıldı, {len(merge_log)} bölünmüş kelime birleştirildi.")

    print("Özel isim ekleri kitabın kuralına uyduruluyor...")
    text, suffix_log = harmonize_name_suffixes(text)
    print(f"  {len(suffix_log)} ek düzeltildi.")

    print("Boşluk hatası adayları taranıyor...")
    space_candidates = find_space_candidates(text, dictionaries)

    print("Şüpheli kelimeler taranıyor...")
    suspicious, auto_protected = find_suspicious_words(text, dictionaries)
    # Çift model OCR kullanıldıysa: iki modelin AYNI okuduğu sözlük dışı
    # kelimeler (Ağbi, meyva, Dallas...) sayfada gerçekten öyle basılı demektir;
    # yapay zekâya "düzeltmesi" için sorulmaz, sadece kesin/bedava düzeltmeler uygulanır.
    if confirmed:
        before = len(auto_protected)
        auto_protected |= {w for w in suspicious if w in confirmed or re.split(r"['’]", w)[0] in confirmed}
        print(f"  Çift model onaylı {len(auto_protected) - before} kelime korumaya alındı ({confirmed_path.name}).")

    fragment_tokens = set()
    for phrase in space_candidates:
        fragment_tokens.update(phrase.split())
    before_count = len(suspicious)
    suspicious = {w: c for w, c in suspicious.items() if w not in fragment_tokens}
    removed = before_count - len(suspicious)

    print(f"{len(suspicious)} şüpheli kelime ({removed} tanesi boşluk-adayı çakışması nedeniyle elendi), "
          f"{len(space_candidates)} boşluk hatası adayı bulundu.")
    if auto_protected:
        sample = ", ".join(sorted(auto_protected)[:40])
        print(f"  Sık geçtiği için korunan {len(auto_protected)} kelime (ilk 40): {sample}")
    print()

    fixes = {}
    reviews = []
    free_count = 0
    protected_count = 0
    fallback_count = 0

    # --- Kelimeler ---
    word_items = list(suspicious.items())
    if args.limit:
        word_items = word_items[: args.limit]

    readings = other_readings(text, other_texts) if other_texts else {}
    if other_texts:
        print(f"Diğer {len(other_texts)} modelin okumaları şüpheli kelimeler için eşlendi.")

    llm_word_queue = []
    for idx, (word, context) in enumerate(word_items, 1):
        protected = word in auto_protected
        if protected and word[:1].isupper():
            protected_count += 1
            print(f"  [{idx}/{len(word_items)}] {word} -> korundu (sık geçen özel isim)")
            continue
        mode = "proper" if word[:1].isupper() else ("frequent" if protected else "normal")
        candidates = free_candidates(word, mode)
        # OCR Türkçe harfleri neredeyse hep DÜŞÜRÜR, eklemez: Türkçe harf silen aday
        # (çobanpüskülüyle -> çobanpuskülüyle) düzeltme değil, bozmadır.
        valid = [c for c in candidates if is_valid(dictionaries, c) and circumflex_count(c) >= circumflex_count(word)
                 and tr_special_count(c) >= tr_special_count(word)]
        if len(valid) == 1:
            fixes[word] = valid[0]
            free_count += 1
            print(f"  [{idx}/{len(word_items)}] {word} -> {valid[0]}  (bedava/kesin)")
            continue
        if word in auto_protected:
            protected_count += 1
            print(f"  [{idx}/{len(word_items)}] {word} -> korundu (kitapta sık geçiyor, yazar tercihi)")
            continue
        alts = [a for a in readings.get(word, []) if a != word]
        valid_alts = [a for a in alts if is_valid(dictionaries, a) and close_reading(word, a)
                      and circumflex_count(a) >= circumflex_count(word)]
        if len(set(valid_alts)) == 1:
            fixes[word] = valid_alts[0]
            free_count += 1
            print(f"  [{idx}/{len(word_items)}] {word} -> {valid_alts[0]}  (diğer modelin geçerli okuması)")
            continue
        suggestions = get_suggestions(dictionaries, word)
        suggestions_str = ", ".join(suggestions) if suggestions else "(sözlük öneri bulamadı)"
        if alts:
            suggestions_str += "\n   Diğer OCR modellerinin okuması: " + ", ".join(dict.fromkeys(alts))
        llm_word_queue.append((word, context, suggestions_str))

    if not EDITOR_MODEL:   # kural tabanlı mod: dil modeli yok, emin olunamayanlar elle incelemeye
        print(f"\nKural tabanlı mod (dil modeli kapalı): {len(llm_word_queue)} kelime 'Elle bakılacaklar' listesine eklendi.")
        for (word, context, suggestions_str) in llm_word_queue:
            reviews.append(("kelime", word, f"{context} | öneriler: {suggestions_str} | model: kural tabanlı mod"))
        llm_word_queue = []
    print(f"\n{len(llm_word_queue)} kelime LLM'e {WORD_BATCH_SIZE}'lık gruplar halinde soruluyor...")
    for b_start in range(0, len(llm_word_queue), WORD_BATCH_SIZE):
        batch = llm_word_queue[b_start:b_start + WORD_BATCH_SIZE]
        results = process_word_batch(batch, verbose=args.verbose)

        if results is None:
            fallback_count += len(batch)
            print(f"  [grup {b_start}-{b_start+len(batch)}] batch reddedildi (format/sıra sorunu), tek tek işleniyor...")
            results = []
            for (word, context, suggestions_str) in batch:
                prompt = WORD_PROMPT.format(word=word, context=context or "(bağlam yok)", suggestions=suggestions_str)
                try:
                    answer = call_ollama(prompt, verbose=args.verbose)
                except requests.exceptions.RequestException as e:
                    print(f"    {word}: HATA - {e}")
                    results.append(("unsure", "(hata)"))
                    continue
                results.append(classify_answer(answer, word))

        for (word, context, suggestions_str), (kind, value) in zip(batch, results):
            if kind == "same":
                print(f"  {word} -> aynı bırakıldı")
            elif kind == "unsure":
                reviews.append(("kelime", word, f"{context} | öneriler: {suggestions_str} | model: {value}"))
                print(f"  {word} -> emin değil/geçersiz cevap ({value}), incelemeye eklendi")
            else:
                fixes[word] = value
                print(f"  {word} -> {value}  (model)")

    # --- Boşluk adayları ---
    space_items = list(space_candidates.items())
    if args.limit:
        space_items = space_items[: args.limit]

    space_queue = [(phrase, merged, context) for phrase, (merged, context) in space_items]

    if not EDITOR_MODEL:
        for (phrase, merged, context) in space_queue:
            reviews.append(("boşluk", phrase, f"{context} | öneri: {merged} | model: kural tabanlı mod"))
        space_queue = []
    print(f"\n{len(space_queue)} boşluk hatası adayı LLM'e {SPACE_BATCH_SIZE}'lık gruplar halinde soruluyor...")
    for b_start in range(0, len(space_queue), SPACE_BATCH_SIZE):
        batch = space_queue[b_start:b_start + SPACE_BATCH_SIZE]
        results = process_space_batch(batch, verbose=args.verbose)

        if results is None:
            fallback_count += len(batch)
            print(f"  [grup {b_start}-{b_start+len(batch)}] batch reddedildi (format/sıra sorunu), tek tek işleniyor...")
            results = []
            for (phrase, merged, context) in batch:
                prompt = SPACE_PROMPT.format(phrase=phrase, merged=merged, context=context or "(bağlam yok)")
                try:
                    answer = call_ollama(prompt, verbose=args.verbose)
                except requests.exceptions.RequestException as e:
                    print(f"    {phrase}: HATA - {e}")
                    results.append(("unsure", "(hata)"))
                    continue
                results.append(classify_answer(answer, phrase))

        for (phrase, merged, context), (kind, value) in zip(batch, results):
            if kind == "same":
                print(f"  \"{phrase}\" -> ayrı bırakıldı")
            elif kind == "unsure":
                reviews.append(("boşluk", phrase, f"{context} | model: {value}"))
                print(f"  \"{phrase}\" -> emin değil/geçersiz cevap ({value}), incelemeye eklendi")
            elif not answer_resembles(value, merged):
                reviews.append(("boşluk", phrase, f"{context} | model şüpheli/alakasız cevap verdi: {value} (beklenen: {merged})"))
                print(f"  \"{phrase}\" -> REDDEDİLDİ, cevap '{value}' beklenen '{merged}'e benzemiyor, incelemeye eklendi")
            else:
                fixes[phrase] = merged
                print(f"  \"{phrase}\" -> {merged}  (model)")

    print(f"\nKorunan (sık geçen / özel isim): {protected_count}")
    print(f"Bedava (harf-değişimi) çözülen: {free_count}")
    print(f"Model kararıyla düzeltilen: {len(fixes) - free_count}")
    print(f"İncelemeye eklenen (EMİN_DEĞİLİM/şüpheli/boş): {len(reviews)}")
    if fallback_count:
        print(f"Batch reddedilip tek-tek işlenen: {fallback_count}")

    if args.dry_run:
        print("\n--dry-run: dosyalar yazılmadı.")
        return

    corrected_text = text
    applied_log = []
    for wrong, correct in fixes.items():
        before = corrected_text
        corrected_text = apply_fix(corrected_text, wrong, correct)
        if corrected_text != before:
            applied_log.append((wrong, correct))

    print("Şapka tutarlılığı uygulanıyor...")
    corrected_text, circ_log = restore_circumflex(corrected_text)
    print(f"  {sum(n for _, _, n in circ_log)} kelimeye şapka geri kondu ({len(circ_log)} farklı biçim).")

    print("Cins isimlerdeki kesme işaretleri kaldırılıyor...")
    corrected_text, apos_log = remove_common_noun_apostrophes(corrected_text, dictionaries, second_text,
                                                              basili=metin_katmani)
    print(f"  {len(apos_log)} kesme işareti kaldırıldı.")

    out_dir = input_path.parent
    output_md = out_dir / f"{args.book}_editor.md"
    changes_path = out_dir / f"{args.book}_degisiklikler.txt"
    review_path = out_dir / f"{args.book}_incele.txt"

    output_md.write_text(corrected_text, encoding="utf-8")

    with open(changes_path, "w", encoding="utf-8") as f:
        f.write(f"Toplam {len(applied_log)} düzeltme uygulandı\n{'=' * 60}\n\n")
        for wrong, correct in sorted(applied_log):
            f.write(f'"{wrong}" -> "{correct}"\n')
        if hyphen_log:
            f.write(f"\n\nTireleme kalıntısı birleştirildi ({len(hyphen_log)} adet)\n{'=' * 60}\n")
            for wrong, correct in sorted(set(hyphen_log)):
                f.write(f'"{wrong}" -> "{correct}"\n')
        for title, entries in (("Birleşik kelime ayrıldı", split_log), ("Bölünmüş kelime birleştirildi", merge_log),
                               ("Özel isim eki kitabın kuralına uyduruldu", suffix_log)):
            if entries:
                f.write(f"\n\n{title} ({len(entries)} adet)\n{'=' * 60}\n")
                for wrong, correct in sorted(set(entries)):
                    f.write(f'"{wrong}" -> "{correct}" (x{entries.count((wrong, correct))})\n')
        if apos_log:
            f.write(f"\n\nCins isimden kesme işareti kaldırıldı ({len(apos_log)} adet)\n{'=' * 60}\n")
            for wrong, correct in sorted(set(apos_log)):
                f.write(f'"{wrong}" -> "{correct}"\n')
        if circ_log:
            f.write(f"\n\nŞapka geri kondu (kitabın kendi yazımına göre)\n{'=' * 60}\n")
            for wrong, correct, n in circ_log:
                f.write(f'"{wrong}" -> "{correct}" (x{n})\n')

    if reviews:
        with open(review_path, "w", encoding="utf-8") as f:
            f.write(f"Model emin olamadı, elle bakman gerekiyor ({len(reviews)} adet)\n{'=' * 60}\n\n")
            for kind, item, context in reviews:
                f.write(f"[{kind}] {item}\n  Bağlam: {context}\n\n")

    print(f"\nDüzeltilmiş metin: {output_md}")
    print(f"Değişiklik listesi: {changes_path}")
    if reviews:
        print(f"İncele: {review_path}")


if __name__ == "__main__":
    main()