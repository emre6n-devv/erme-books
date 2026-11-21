# -*- coding: utf-8 -*-
"""
kitap_ocr için ayarlar.
Buradaki değerleri ihtiyacına göre değiştir.
"""

import os

# --- Ollama ayarları ---
# Model adları uygulamanın "Model Yönetimi" panelinden ortam değişkeniyle gelir (KITAP_*);
# komut satırından çalıştırırken boşsa buradaki varsayılanlar kullanılır.
OLLAMA_URL = "http://localhost:11434/api/chat"
VISION_MODEL = os.environ.get("KITAP_VISION_MODEL") or "qwen2.5vl:7b"    # qwen3-vl'nin "thinking" modu Ollama'da güvenilir kapatılamıyor
                                   # (bilinen, çözülmemiş bir Ollama hatası) - bu model thinking yapmıyor,
                                   # çok daha hızlı ve öngörülebilir çalışıyor
TEXT_MODEL = "hf.co/ytu-ce-cosmos/Turkish-Llama-8b-Instruct-v0.1-GGUF:Q4_K_M"  # Türkçe düzeltme aşaması için (şu an kullanılmıyor)
REQUEST_TIMEOUT = 300             # saniye, büyük/karmaşık sayfalarda arttır
NUM_CTX = 16384                   # bağlam penceresi

# --- İki aşamalı işlem ---
# AŞAMA 1 (görüntü): VISION_MODEL, sayfayı SADE bir prompt'la okur (sadece
# metni çıkarır, düzeltme yapmaz).
#
# AŞAMA 2 (metin): Çıkan ham metin, TEXT_MODEL ile ayrı bir çağrıda tüm
# detaylı Türkçe kurallarına (mı/mi ayrımı, tire birleştirme, uzun çizgi vb.)
# göre düzeltilir. Bu aşama isteğe bağlı - APPLY_TEXT_CORRECTION ile kontrol edilir.
APPLY_TEXT_CORRECTION = False  # LLM tabanlı düzeltme güvenilmez bulundu - fix_known.py (deterministik) kullanılıyor

# --- Sayfa görüntüleme ayarları ---
DPI = 450                        # zamanın önemi yoksa yüksek tut - küçük/eski punto için daha net görüntü

# --- Klasörler ---
INPUT_DIR = "input"
OUTPUT_DIR = "output"

# --- Bilinen tekrarlayan üstbilgiler ---
# Kitabın her sayfasında tekrarlayan başlık/yazar adı gibi metinleri buraya
# ekle - tam olarak kendi satırında (başka metinle karışmamış) göründüklerinde
# otomatik olarak silinirler. Kod tabanlı, deterministik, halüsinasyon riski yok.
KNOWN_HEADERS = []

# --- AŞAMA 1: Görüntü OCR prompt'u (SADE - sadece çıkarma) ---
VISION_PROMPT = """Bu bir kitap sayfası görüntüsü. Sayfadaki tüm metni oku ve olduğu gibi, eksiksiz yaz.

Kurallar:
- Sayfa numarası, üstbilgi/altbilgi gibi dekoratif tekrar eden öğeleri atla.
- Paragraf yapısını koru.
- Sadece metni yaz, başka açıklama veya yorum ekleme.
- Sayfa neredeyse boşsa, sadece o kadarını yaz, uzatma.
"""

# --- AŞAMA 2: Metin düzeltme prompt'u (şu an kullanılmıyor, ileride gerekirse) ---
TEXT_PROMPT_TEMPLATE = """Sen Türkçe bir kitaptan OCR ile çıkarılmış ham metni düzelten bir uzmansın.
Aşağıdaki metni oku ve şu kurallara göre TEMİZ, YAYIMA HAZIR bir Türkçe metin üret.

## 1. Karakter ve harf düzeyi hatalar
- Yaygın OCR karakter karışıklıklarını düzelt: harflerin birbirine benzeyen
  başka harf/rakam/işaretle karışması (rn/m, I/l, "!"/l, 1/l, sondaki n/R gibi),
  fazladan eklenmiş veya eksik harfler, bağlamdan ve kelimenin doğru yazımından
  anlaşılabilecek şekilde düzeltilmeli.
- Sık görülen özel bir hata: ünlem/seslenme olan "Tanrım!" (Tanrı+ım, "aman
  Tanrım" anlamında) yanlışlıkla "Tanırım" (tanı+rım, "ben tanırım" fiili)
  olarak okunuyor. Bağlamda bir seslenme/ünlem varsa ("Ah Tanırım!", "Tanırım,
  Tanırım!.." gibi) bunu "Tanrım" olarak düzelt.
- Türkçe'ye özgü harfleri (ı, i, İ, ş, ç, ğ, ö, ü) doğru ayırt et; OCR'ın yanlış
  okuduğu i/ı, İ/I karışıklıklarını düzelt.
- Bitişik yazılmış iki kelimeyi ayır; yanlışlıkla ayrılmış tek bir kelimeyi birleştir.

## 2. Satır ve sayfa yapısı
- Satır sonunda tire ile bölünmüş kelimeleri birleştir. Birleştirdiğinde gerçek
  bir Türkçe kelime oluşmuyorsa, o tireye dokunma.
- Paragraf bütünlüğünü koru: paragraf ortasındaki satır sonlarını birleştir,
  sadece gerçek paragraf başlarında yeni satıra geç.
- Sayfa numarası, üstbilgi/altbilgi, tekrar eden dekoratif öğeleri çıktıya YAZMA.
- Dipnot numaraları/işaretleri metin içinde köşeli parantezle işaretle,
  örn: "...söyledi[1]".

## 3. Türkçe imla - ekler
- "mı, mi, mu, mü" soru ekini kelimeden HER ZAMAN ayrı yaz.
- Bağlaç "de/da" ile hal eki "-de/-da" arasındaki farkı bağlamdan ayırt et;
  emin değilsen orijinal metindeki kullanımı koru.
- İyelik/hal eki almış özel isimlerde kesme işaretini doğru kullan.

## 4. Noktalama ve tipografi
- Diyalog/konuşma başındaki uzun çizgiyi (—) kısa tireyle (-) karıştırma;
  satır başında konuşma belirten çizgiyi her zaman — olarak yaz.
- Tırnak işaretlerini ve üç nokta (…) kullanımını tutarlı hale getir.

## 5. Ne YAPMAMALISIN (ÇOK ÖNEMLİ)
- Anlamı, cümle yapısını, kelime seçimini DEĞİŞTİRME.
- Metne yorum, özet, açıklama, başlık, örnek EKLEME.
- Kendi örneklerini üretme, yukarıdaki kuralları anlatan örnek cümleleri
  ASLA çıktıya yazma - onlar sadece SANA yönelik talimattır, kitabın metni değildir.
- Girdi metni ÇOK KISAYSA (örn. tek bir sayfa numarası, tek bir başlık, boş/neredeyse
  boş bir sayfa), SADECE o kısa metni (varsa hafif düzeltmeyle) aynen çıktı olarak
  ver ve DUR. Uzatma, açıklama ekleme, "sayfa 1, sayfa 2..." gibi sahte bir liste
  ÜRETME, tekrar etme.
- Emin olmadığın bir kelimeyi tahminle "düzeltme" - okuyamadığın/anlamsız kalan
  kısmı [OKUNAMADI] olarak işaretle, uydurma.
- ÇIKTIN her zaman girdiyle YAKLAŞIK AYNI UZUNLUKTA olmalı. Girdiden çok daha
  uzun bir çıktı üretiyorsan YANLIŞ YAPIYORSUN - dur ve sadece gerçek metni ver.

ÇOK ÖNEMLİ - ÇIKTI FORMATI: Cevabını MUTLAKA aşağıdaki etiketler arasına yaz.
Etiketlerin dışına HİÇBİR ŞEY yazma - ne "işte düzeltilmiş metin", ne "düzenleme
notları", ne bir özet, ne bir liste. Sadece düzeltilmiş metnin kendisi etiketlerin
İÇİNDE olacak:

<DUZELTILMIS>
(sadece düzeltilmiş temiz metin buraya)
</DUZELTILMIS>

--- DÜZELTİLECEK HAM METİN (bu metnin dışına ASLA çıkma) ---
{raw_text}
--- HAM METİN SONU ---
"""