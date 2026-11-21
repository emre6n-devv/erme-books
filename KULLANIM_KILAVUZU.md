# ERME BOOKS · Hayat Ağacı — Kullanım Kılavuzu

Bu kılavuz, uygulamayı ilk kez açan birinin kurulumdan ilk e-kitabına kadar hiçbir yerde takılmadan ilerleyebilmesi için yazıldı.

**İçindekiler**

1. [İlk kurulum ve ortam hazırlığı](#1-ilk-kurulum-ve-ortam-hazırlığı)
2. [Donanımına göre model seçimi ve uyarıların anlamı](#2-donanımına-göre-model-seçimi-ve-uyarıların-anlamı)
3. [Arayüz ve kontroller](#3-arayüz-ve-kontroller)
4. [Adım adım kitap dönüştürme (PDF → EPUB)](#4-adım-adım-kitap-dönüştürme-pdf--epub)
5. [Sık karşılaşılan durumlar](#5-sık-karşılaşılan-durumlar)

---

## 1. İlk kurulum ve ortam hazırlığı

Bilgisayarında şu dört şey kurulu olmalı:

| Program | Ne işe yarar | Nereden |
|---|---|---|
| **Node.js** (18+) | Uygulamanın kendisini (Electron) çalıştırır | nodejs.org |
| **Python** (3.10+) | OCR, düzeltme ve EPUB adımlarını yapar | python.org (Windows'ta kurarken *Add Python to PATH* kutusunu işaretle) |
| **Ollama** | Yapay zekâ modellerini kendi bilgisayarında çalıştırır | ollama.com/download |
| **Git** | Projeyi indirmek için (zip olarak da indirebilirsin) | git-scm.com |

Kurulum adımları:

1. **Projeyi indir:** `git clone <depo-adresi>` komutunu çalıştır ve oluşan klasöre gir.
2. **Python paketlerini kur:** proje klasöründe `pip install -r requirements.txt` çalıştır (macOS/Linux'ta `pip3`).
3. **Arayüz bağımlılıklarını kur:** `cd uygulama-electron` ve ardından `npm install`. Bu adım Electron'u ve Three.js'i indirir; ilk seferde birkaç dakika sürebilir.
4. **Türkçe sözlüğü ekle:** [tdd-ai/hunspell-tr sürümler sayfasından](https://github.com/tdd-ai/hunspell-tr/releases) `tr_TR.aff` ve `tr_TR.dic` dosyalarını indirip proje kök klasörüne koy. Sözlük olmadan 2. adım çalışmaz.
5. **Ollama'yı aç:** Windows ve macOS'ta Ollama uygulamasını başlat (sistem tepsisinde lama simgesi görünür). Linux'ta `ollama serve`.
6. **Modelleri indir:** sonraki bölümdeki tablodan donanımına uyanları seç.
7. **Uygulamayı başlat:** `uygulama-electron` klasöründe `npm start` çalıştır. Windows'ta `baslat.bat`, macOS/Linux'ta `./baslat.sh` dosyasını da kullanabilirsin.

---

## 2. Donanımına göre model seçimi ve uyarıların anlamı

### Hangi modelleri kurmalıyım?

| Bilgisayarın | Kurulacak modeller | Beklenen hata payı |
|---|---|---|
| **16 GB+ RAM** (tercihen 8 GB+ VRAM'li ekran kartı) | `qwen2.5vl:7b`, `glm-ocr`, `gemma3:12b`, `qwen2.5:14b-instruct` | %1–2 |
| **8–12 GB RAM** | `qwen2.5vl:3b`, `glm-ocr`, `gemma3:4b`, `qwen2.5:7b-instruct` | ~%5–8 |
| **8 GB altı** | `qwen2.5vl:3b`, `glm-ocr` | ~%7–12 (düzeltme kural tabanlı) |

Her model `ollama pull <model-adı>` ile kurulur, örneğin `ollama pull qwen2.5vl:3b`.

### Uygulama açılınca ne olur?

Uygulama işletim sistemini, toplam RAM'i, ekran kartını ve Ollama'da kurulu modelleri okur. Ardından her görev için **belleğe sığan ve kurulu olan en güçlü modeli** seçer. Sığmayan ya da kurulu olmayan isteğe bağlı adımları kapatır; sistem çökmez, iş hafif modellerle sürer.

**Üst çubuktaki model göstergesi:**

| Görünüm | Anlamı |
|---|---|
| 🟢 `4/4 model` | Tüm standart modeller kurulu ve kullanılıyor |
| 🟠 `Hafif mod · 3 model` | Bazı görevler hafif modele ya da kural tabanlı motora geçti |
| 🔴 `Eksik model: 1` | Seçili bir model kurulu değil; göstergeye tıklayıp kurulum komutunu kopyala |
| 🔴 `Ollama kapalı` | Ollama uygulamasını başlat |

### Bilgi kartları

Model değiştirilen bir adıma (OCR, Düzeltme, Yapı, Kapak) girdiğinde sayfanın üstünde turuncu bir kart çıkar. Örnek:

> Sistem donanımın (8 GB RAM / dahili GPU) nedeniyle yüksek kapasiteli **Qwen2.5 14B Instruct** modeli devre dışı bırakıldı. İşlemlerin sistemine uygun olan **Qwen2.5 7B Instruct** ile yapılacak. Bu modda işlem hızı yüksek kalırken, karmaşık OCR/metin düzeltme adımlarında tahmini hata payı standart %1–2 yerine yaklaşık %5–9 aralığında olabilir; 2. adımda "Elle bakılacaklar" listesini kontrol etmen önerilir.

Bu bir hata değil, bilgilendirmedir.

### Model Yönetimi paneli

Üst çubuktaki model göstergesine tıklayınca panel açılır:

- **Sistem bilgisi:** işletim sistemi, RAM ve modellere ayrılabilecek bellek, ekran kartı, işlemci, Ollama durumu.
- **Otomatik / Elle seç:** Otomatik modda seçim donanıma göre yapılır. Bir seçeneğe tıklarsan elle moda geçilir ve seçimin uyarıya rağmen kullanılır.
- **Her seçeneğin yanında:**
  - yaklaşık bellek ihtiyacı
  - hata payına etkisi
  - "kurulu" ya da "kurulu değil · `ollama pull …`" etiketi
  - gerekiyorsa "bu bilgisayar için ağır" uyarısı
- **Altta:** tüm hattın tahmini kelime hata payı.
- **↻ Yenile:** yeni model kurduktan sonra listeyi tazeler.

**Kural tabanlı motor:** dil modeli olmadan çalışır.
- Düzeltmede yalnız sözlükten kesin olan düzeltmeler uygulanır; gerisi "Elle bakılacaklar" listesine düşer.
- Bölüm tespitinde yalnız biçimi kesin başlıklar alınır: Önsöz, Birinci Kısım, Bölüm 3, IV, 2.1 …
- Kapak teması anahtar kelimelerden çıkarılır.

### Grafik kalitesi

Üst çubuktaki **Kalite** seçicisinde Otomatik, Yüksek, Orta ve Düşük vardır.

- **Otomatik:** kare hızı 35'in altına düşerse kalite bir kademe iner ve bir bildirim görünür.
- **Düşük:** gölgeleri kapatır, parçacıkları ve hayvan sayısını azaltır, çözünürlüğü 1×'e indirir.

Zayıf dizüstü bilgisayarlarda Orta ya da Düşük önerilir.

---

## 3. Arayüz ve kontroller

### Üst çubuk

| Öğe | İşlevi |
|---|---|
| **E logosu** | Ana sahneye (hayat ağacı) döner |
| **Kitap seçici** | Çalıştığın kitap. Uygulama son açtığın kitapla açılır |
| **Yeni PDF** | Bilgisayarından PDF seçer ve `input/` klasörüne kopyalar |
| **Ağaç · OCR · Düzeltme · Yapı · Kapak · EPUB** | Adımlar arasında geçiş; renkli nokta tamamlanan adımı gösterir |
| **Kitaplık** | Kovuk kütüphanesine iner |
| **Mevsim** | İlkbahar / Yaz / Sonbahar / Kış ya da "↺ Bugün" (takvime göre) |
| **Kalite** | Grafik kalitesi |
| **Model göstergesi** | Model Yönetimi paneli |

### Ana sahne: hayat ağacı

- **Fener kartları:** dallardaki beş fener, üretim adımlarıdır. Üstüne gelince adımın durumu (bekliyor, sıradaki, çalışıyor, tamamlandı) ve ayrıntısı görünür; tıklayınca o adıma gidilir.
- **Devam et düğmesi:** sol üstte, sıradaki adıma tek tıkla götürür. Kitap bittiyse "Kitaplıkta gör" olur.
- **Mevsim kadranı:** alttaki dört küre mevsimi değiştirir. Gök, ışık, coğrafya ve hayvanlar yumuşak bir geçişle değişir.
- **Kovuğa giriş:** gövdedeki ışıklı kovuğa ya da ağaçtaki kitap yığınına tıkla.
- **Açılış:** açılış animasyonunu yeniden oynatır. Animasyon sırasında tıklamak ya da Esc ile atlanır.

### 360° kovuk kütüphanesi

| Fare / tuş | Ne yapar |
|---|---|
| **Orta tuş (tekerlek) basılı + sürükle** | Odada 360° etrafa bakarsın: yukarıda kubbe ve ışık deliği, aşağıda zemin |
| **Tekerlek** | Yaklaşır / uzaklaşır |
| **Sol tık (kitaba)** | Kitabı seçer: raftan hafifçe çıkar ve sol altta bilgi kartı açılır. Seçiliyken tekrar tıklarsan açılır |
| **Sol tık basılı + sürükle** | Kitabı taşır. Rafın üstüne getirince araya yer açılır; bırakınca yerleşir. Boşluğa bırakırsan yere düşer |
| **Sağ tık (rafa)** | Rafa vurur, yakındaki kitaplar sallanıp yere düşer |
| **Yerdeki kitaba sol tık** | Kitabı rafa geri koyar |
| **Arkadaki ışıklı kemer** | Üstüne gelince parlar ve "Dışarı Çık" yazar; tıklayınca ağaca dönersin |
| **← Ağaca dön düğmesi / Esc** | Aynı şekilde dışarı çıkar |
| **EPUB dosyasını pencereye sürükle** | Dışarıdan bir e-kitabı rafa ekler |

Kırmızı ayraçlı kitaplar süren projelerdir; tıklayınca o projede sıradaki adıma gidilir. Bitmiş ERME baskıları onaylı bez cilt kapaklarıyla durur ve kartlarında "tamamlandı ✓" yazar. Rafların düzeni kaydedilir.

---

## 4. Adım adım kitap dönüştürme (PDF → EPUB)

Her adım sonucunu `output/<kitap-adı>/` klasörüne yazar. Uygulamayı kapatıp açtığında her şey kaldığı yerden yüklenir.

### Adım 1 · OCR Tarama

1. **Yeni PDF** ile kitabını ekle. Sol tarafta sayfa önizlemesi çıkar; ‹ › ile gezebilirsin.
2. **Üç model OCR** açıksa sayfa üç kez okunur ve sonuçlar kelime kelime birleştirilir. Bu yaklaşık 3 kat yavaştır ama hataları belirgin biçimde azaltır. Model Yönetimi'nde ikinci okuma kapalıysa bu seçenek kendiliğinden tek okumaya döner.
3. **Hızlı deneme** yalnız ilk 20 sayfayı işler. Yeni bir kitapta önce bununla dene.
4. **Tam Zincir** OCR'ı ve ardından Düzeltme'yi arka arkaya çalıştırır. **Sadece OCR** yalnız okuma yapar.
5. İlerleme çubuğu kalan süreyi gösterir. **Durdur** ile istediğin an kesebilirsin; tekrar başlatınca okunmuş sayfalar atlanır.

Her sayfada tekrar eden kitap adı, yazar adı ve sayfa numarası gibi satırlar otomatik ayıklanır.

### Adım 2 · Metin Düzeltme

1. **Düzeltmeyi Başlat**. Sözlük şüpheli kelimeleri bulur; dil modeli her biri için öneriler arasından karar verir. Şapkalı harfler (kâğıt, hikâye) korunur ve kitabın kendi yazım tercihleri öğrenilir.
2. **Değişiklikler** listesi her düzeltmeyi eski → yeni olarak gruplu gösterir; aranabilir.
3. **Elle bakılacaklar** listesi emin olunamayan kelimeleri bağlamıyla ve önerileriyle gösterir. Hafif ya da kural tabanlı modda bu liste daha uzun olur; göz atman önerilir.
4. **Doğruluğu Ölç:** aynı kitabın doğru bir EPUB'u `epubs/` klasöründeyse her aşamanın hata oranını (WER/CER) ölçer.

### Adım 3 · İçindekiler ağacı ve ERME BOOKS dizgi şablonu

1. **Otomatik Tespit** kitap adını, yazarı ve bölüm başlıklarını bulur. Başlık ve yazarı kontrol edip **Kaydet**'e bas.
2. **Bölüm ağacı (sol):**
   - Türler: **ÖN** (Önsöz, Giriş, Sonsöz), **KISIM**, **BÖLÜM**, **ALT** (alt bölüm)
   - **Çift tık:** yeniden adlandır
   - **← / →:** seviyeyi değiştir (Kısım ↔ Bölüm ↔ Alt bölüm)
   - **Sürükle-bırak:** sırala; bölüm metniyle birlikte taşınır
   - **× ya da Del:** başlığı sil; metni bir önceki bölüme katılır
   - **↑ / ↓:** başlıklar arasında gezin
   - Her değişiklik kendiliğinden kaydedilir.
3. **Sayfa önizlemesi (sağ):** seçili bölüm, seçilen şablonun yazı tipleri ve düzeniyle bir e-kitap sayfası olarak görünür.
   - **Eksik başlık eklemek için:** bir paragrafa tıkla ve **+ Başlık Ekle**'ye bas. Kısa bir satır başlığın kendisi olur; uzun bir paragrafın önüne yeni başlık eklenir. Önce metnin bir kısmını işaretlersen başlık adı o olur.
4. **Şablon (sağ üst):**
   - *ERME Klasik:* büyük ilk harf, ❧ süsü, iki yana yaslı ve tireli metin.
   - *Modern Minimal:* sade, büyük harf başlıklar, sola yaslı.
   - *Geniş Punto:* büyük yazı, rahat satır aralığı.

### Adım 4 · Çift modlu 3D kapak stüdyosu

- **Otomatik sekmesi:**
  - **Kitaba Özel Öner:** kitabın açılış metnini ve internetteki özetini okuyup tür, duygu, dönem ve sembollere göre kumaş, varak, motif ve arka kapak yazısı önerir.
  - **Yeni Varyasyon:** aynı temada başka bir tasarım üretir.
- **Renkler:** 29 kumaş rengi ve özel renk. Yazı rengi kontrasta göre otomatik seçilir. Varak olarak altın, gümüş, bakır, bronz, mat krem ya da siyah seçebilirsin.
- **Motif & Çerçeve:** 16 kenar motifi (satranç, botanik, deniz, gök…) ve 5 kartuş biçimi.
- **Yazı & Doku:**
  - serif, sans, kaligrafi ve gotik başlık yazı tipleri
  - keten, deri ve kâğıt dokusu
  - sırt kalınlığı
  - başlık, yazar ve arka kapak yazısı
- **3D kitap:** fareyle tutup çevir, tekerlekle yaklaş; Ön / Sırt / Arka düğmeleri o yüze döndürür.
- **Kapağı Onayla:** EPUB kapağını yüksek çözünürlükte (yaklaşık 1900×2560) kaydeder. Kütüphanedeki 3D kitap da bu kapağı giyer.

Elle yaptığın seçimler otomatik önerinin üstüne yazılır. "Kitaba Özel Öner" hepsini sıfırlar.

### Adım 5 · EPUB 3 dışa aktarım

1. **EPUB Oluştur:** kontrol listesindeki adımlar tamamsa e-kitap `epubs/` klasörüne üretilir. EPUB şunları içerir:
   - iç içe içindekiler
   - gömülü yazı tipleri
   - onaylı kapak
   - metadata: başlık, yazar, `tr` dil kodu, kalıcı kimlik, arka kapak özeti
2. Paket üretildikten sonra **doğrulanır**. Sorun bulunursa ekranda uyarı çıkar ve günlük açılır.
3. **Özet kartı** kapak önizlemesini, dosya boyutunu, bölüm/kısım sayısını ve tahmini sayfa sayısını gösterir. Üç düğmesi var:
   - **Bilgisayara Kaydet (.epub):** istediğin klasöre kaydeder.
   - **Kovuk Kütüphanesinde Gör:** kovuğa iner, kamerayı kitaba çevirir ve kartını açar.
   - **Uygulama İçinde Oku:** kitabı kendi dizgisiyle açar.

**Okuyucu kısayolları:**

| Kısayol | İşlevi |
|---|---|
| ← / → · Boşluk · PageUp/PageDown · tekerlek | Sayfa çevir |
| T ya da ☰ İçindekiler | Bölüme atla |
| + / − (A+ / A−) | Yazı boyutu |
| Home / End | Bölüm başı / sonu |
| Esc | Kapat |

Okuma konumun kitap başına hatırlanır.

---

## 5. Sık karşılaşılan durumlar

| Durum | Çözüm |
|---|---|
| Üst çubukta **Ollama kapalı** yazıyor | Ollama uygulamasını aç (Linux: `ollama serve`), sonra Model Yönetimi'nde **↻ Yenile** |
| **Eksik model** uyarısı | Göstergeye tıkla, kurulu olmayan modelin yanındaki `ollama pull …` komutunu terminalde çalıştır |
| Düzeltme "tr_TR.aff ve tr_TR.dic bu klasörde yok" diyor | Sözlük dosyalarını proje kök klasörüne koy (bölüm 1, adım 4) |
| Python bulunamadı | Windows'ta Python'u *Add to PATH* ile yeniden kur ya da `KITAP_PYTHON` değişkeniyle yorumlayıcının yolunu ver |
| Sahne takılıyor | Kalite'yi **Orta** ya da **Düşük** yap |
| Bir sayfa numarası bölüm sanıldı | 3. adımda o başlığı × ile sil |
| İşlem yarıda kaldı | Aynı düğmeyle yeniden başlat; okunan sayfalar ve kayıtlı adımlar atlanır |
| Kapak eski görünüyor | 4. adımda **Kapağı Onayla**'ya tekrar bas, sonra EPUB'u yeniden oluştur |
