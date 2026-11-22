<div align="center">

# ERME BOOKS · Hayat Ağacı

**Taranmış Türkçe kitap PDF'lerini, tamamen kendi bilgisayarında çalışan yapay zekâ modelleriyle<br>imza dizgili, bez ciltli kapaklı EPUB 3 e-kitaplara dönüştüren masaüstü stüdyo.**

Electron · Three.js · Python · Ollama — Windows · macOS · Linux — MIT

</div>

---

## Öne çıkan özellikler

| | |
|---|---|
| 🌳 **Mevsimsel 2.5D Hayat Ağacı** | Uygulamanın ana sahnesi yaşayan bir ağaç. Dört mevsimin her biri kendi göğünü, sisini, ışığını, coğrafyasını (göl, şelale, yalnız sonbaharda açılan mağara, karlı dağlar) ve 30–35 hayvanlık nüfusunu getirir. Dallardaki beş fener, kitabın üretim adımlarıdır. |
| 🍂 **Dört mevsim, dört gizli geçit** | Ağacın çevresi her mevsim değişir: ilkbaharda kurbağalar ve çiçekli kayalar, yazın başak tarlası ve iskelede sandal, sonbaharda ateşli mağara ve kirpiler, kışın buz aynası ve karda iz bırakan kutup tilkisi. Her mevsimin gizli geçidi ileride eklenecek ikinci uygulamanın kapısı. |
| 📚 **360° kovuk kütüphanesi** | Ağacın kovuğuna girince yuvarlak, kubbeli bir kütüphane açılır. Kitapları raflar arasında sürükleyip dizebilir, rafa vurup düşürebilir, yerden toplayabilirsin. **Klasik** ve **✦ Büyülü** iki modu var: büyülü modda mumlar süzülür, imleç asaya döner, kitaplar havada uçar, yanına çağrılır ve havada açılır. Fare, trackpad, klavye ve dokunmatikle gezilir; Esc ile çıkılır. |
| 🔤 **5 adımlı PDF → EPUB hattı** | 1) Üç modelli OCR → 2) sözlük + dil modeliyle düzeltme → 3) içindekiler ağacı ve dizgi → 4) kapak stüdyosu → 5) doğrulanmış EPUB 3. Her aşama diske yazılır; yarıda kalan iş kaldığı yerden sürer. |
| ✒️ **ERME BOOKS imza dizgisi** | Klasik, Modern Minimal ve Geniş Punto şablonları. Türkçe destekli gömülü yazı tipleri, büyük ilk harf, ❧ süsü, her bölüm yeni sayfadan, sahne ayraçları. Önizleme canlıdır. |
| 🎨 **Çift modlu Penguin Clothbound kapak stüdyosu** | *Otomatik*: kitabın metnini ve internetteki özetini okuyup tür, duygu ve sembollere göre kumaş, varak, motif ve arka kapak yazısı önerir. *Elle*: 29 kumaş, 6 varak, 16 motif, 5 kartuş, 4 yazı tipi, 3 doku. Sonuç gerçek zamanlı 3D kitap olarak görünür. |
| ⚙️ **Her bilgisayara uygun profil** | Her kitabın başında **Çok hızlı · Hafif · Standart · Güçlü** profillerinden birini seçersin; her birinin bu bilgisayarda bu kitapta ne kadar süreceği önceden gösterilir. Ekran kartı olmayan bilgisayarda bile **Hafif** profil (Tesseract + GLM-OCR) işlemciyle hızlı ve az hatayla çalışır. PDF'in içinde sağlam bir metin katmanı varsa OCR hiç yapılmaz; bozuk bağlı harfler (fi, fl, ti…) sözlükle onarılır. |
| 🧠 **Akıllı donanım ve yerel AI yönlendirme** | Açılışta RAM'i, ekran kartını ve kurulu Ollama modellerini okur. Kaldıramayacağın ya da kurulu olmayan modeli kapatıp hafif bir modele veya kural tabanlı motora geçer. Tahmini hata payını açıkça gösterir; modelleri elle de seçebilirsin. |
| 🔍 **Uyarlanır tarama kalitesi** | Sayfa çözünürlüğü ekran kartına göre seçilir; model ekran kartına sığmazsa kendiliğinden bir kademe düşer ve haber verir. Ayarlar → Tarama kalitesi'nden değiştirilebilir. |
| ⚡ **Uyarlanır grafik kalitesi** | Yüksek / Orta / Düşük ya da Otomatik. Kare hızı 35'in altına inerse gölge, parçacık ve hayvan yoğunluğu kendiliğinden hafifler. 4K/Retina ekranlarda çözünürlük sınırlanır. |
| 📖 **Uygulama içi okuyucu** | Üretilen EPUB, kendi dizgisiyle sayfa sayfa okunur. Okuma konumu kitap başına hatırlanır. |

Hiçbir metin ya da görsel buluta gönderilmez. Yalnızca kapak önerisi için Google Books ve Vikipedi'den kitabın kısa özeti aranır; internet yoksa bu adım atlanır.

---

## Sistem gereksinimleri

| | Minimum | Önerilen |
|---|---|---|
| İşletim sistemi | Windows 10, macOS 12, Ubuntu 22.04 (64 bit) | Windows 11, macOS 14+ (Apple Silicon), güncel Linux |
| Bellek | 8 GB RAM (Hafif profil) | 16–32 GB RAM (Standart / Güçlü) |
| Ekran kartı | WebGL 2 destekli dahili GPU (OCR için ekran kartı gerekmez) | 8 GB+ VRAM'li NVIDIA / AMD, ya da Apple Silicon |
| Disk | ~3 GB (Hafif profil) | ~40 GB (tüm modeller) |
| Yazılım | Node.js 18+, Python 3.10+, Tesseract 5, Ollama | aynı |

### Profiller

OCR'a başlamadan önce profil ekranı açılır; her profilin bu kitapta tahmini süresi gösterilir ve bilgisayarına en uygun olan önerilir. Süre tahmini her kitaptan sonra bilgisayarının gerçek hızını öğrenir.

| Profil | Ne kullanır | Ne zaman |
|---|---|---|
| **Çok hızlı** | Yalnız Tesseract (işlemci) | Çok zayıf bilgisayar ya da hızlı bir ilk deneme |
| **Hafif** | Tesseract + `glm-ocr` hakemi: yalnız şüpheli satırlar yapay zekâya okutulur | Ekran kartı olmayan ya da az RAM'li bilgisayarlar için varsayılan |
| **Standart** | `qwen2.5vl:7b` + `glm-ocr`, düzeltmede `qwen2.5:7b-instruct` | Ekran kartlı, 16 GB+ RAM |
| **Güçlü** | Standart + `gemma3:12b` oylaması, düzeltmede `qwen2.5:14b-instruct` | Güçlü ekran kartı, 32 GB RAM |

Hafif profil test kitaplarında %0,03 ile %1,4 arası kelime hatası verdi (dizgisi iyi kitaplarda alt sınıra yakın). Metin katmanı sağlam PDF'lerde hangi profil seçilirse seçilsin OCR yapılmaz, metin doğrudan PDF'ten alınır.

### Yerel AI modelleri

Uygulama bu tabloyu kullanarak, donanımına uyan en güçlü modeli kendisi seçer. Bellek değerleri yaklaşıktır (RAM + VRAM toplamı).

| Görev | Standart model | Bellek | Hafif seçenek | Bellek | Kapalıyken |
|---|---|---|---|---|---|
| OCR · ana okuyucu (zorunlu) | `qwen2.5vl:7b` | ~6 GB | `qwen2.5vl:3b` | ~3,5 GB | — |
| OCR · ikinci okuma | `glm-ocr` | ~2,5 GB | — | — | tek okuma |
| OCR · anlaşmazlıkta oy | `gemma3:12b` | ~9 GB | `gemma3:4b` | ~4 GB | oylama yok |
| Düzeltme · bölüm tespiti · kapak teması | `qwen2.5:14b-instruct` | ~10 GB | `qwen2.5:7b-instruct` | ~5,5 GB | kural tabanlı motor |

**Tahmini kelime hata payı (tüm hattın sonunda):** standart modellerle **%1–2**, hafif modellerle **~%5–8**, yalnız kural tabanlı motorla **~%7–12**. Bu oranlar dizgi kalitesi iyi PDF'ler içindir. Hafif modlarda 2. adımdaki "Elle bakılacaklar" listesini gözden geçirmen önerilir.

---

## Kurulum

### 🟢 En kolayı: Kurulum dosyası (Windows, terminal gerekmez)

1. Sağdaki **Releases** bölümünden en son **`ERME-BOOKS-Kurulum-x.y.z.exe`** dosyasını indir.
2. Çift tıkla, **İleri → Kur** de. Python, Türkçe sözlük ve Tesseract (Türkçe modeliyle) kurulum dosyasının içinde gelir; ekran kartı olmayan bilgisayarda bile Hafif profil hemen çalışır.
3. Uygulama ilk açıldığında **Kurulum Sihirbazı** çıkar. Orada sırayla:
   - **Ollama'yı İndir ve Kur:** açılan pencerede *Install*'a bas.
   - **Seçilenleri İndir:** bilgisayarına uygun modeller ilerleme çubuğuyla iner.
   - **Başla.**

Kitapların **Belgeler\ERME BOOKS** klasöründe tutulur. Windows "bilinmeyen yayıncı" uyarısı verirse **Ek bilgi → Yine de çalıştır** de; kurulum dosyası imzasız olduğu için bu uyarı normaldir.

### ⚡ Kaynak koddan tek tıkla kurulum (Windows)

1. Bu sayfada yeşil **Code** düğmesine bas, **Download ZIP** de ve ZIP'i bir klasöre çıkar (örn. `C:\erme-books`).
2. Klasördeki **`kurulum.bat`** dosyasına çift tıkla.

Betik şunları kendisi yapar:
- Node.js, Python, Tesseract ve Ollama'yı kontrol eder; eksikleri `winget` ile kurar.
- Python paketlerini ve uygulama bağımlılıklarını kurar.
- Türkçe sözlüğü ve Tesseract'ın Türkçe modelini indirir.
- Bilgisayarının RAM'ine ve ekran kartına uygun model setini önerip onayınla indirir (ekran kartı yoksa yalnız `glm-ocr`, ~2 GB).
- En sonda uygulamayı açar.

Tekrar çalıştırmak güvenlidir; kurulu olanlar atlanır. Sonraki açılışlarda **`baslat.bat`** yeterli.

> Windows "bilinmeyen yayıncı" uyarısı verirse **Ek bilgi → Yine de çalıştır** de. Modeller büyük olduğu için ilk kurulum internet hızına göre uzun sürebilir.

macOS / Linux ya da elle kurmak istersen aşağıdaki adımları izle.

### 1. Gerekli programlar

| | Windows | macOS | Linux (Ubuntu/Debian) |
|---|---|---|---|
| Node.js | [nodejs.org](https://nodejs.org) LTS kurucusu | `brew install node` | `sudo apt install nodejs npm` (ya da nvm) |
| Python | [python.org](https://www.python.org) (kurulumda *Add to PATH* seçili) | `brew install python` | `sudo apt install python3 python3-pip` |
| Ollama | [ollama.com/download](https://ollama.com/download) | aynı | `curl -fsSL https://ollama.com/install.sh \| sh` |
| Tesseract 5 | `winget install UB-Mannheim.TesseractOCR` | `brew install tesseract` | `sudo apt install tesseract-ocr` |
| Git | [git-scm.com](https://git-scm.com) | `xcode-select --install` | `sudo apt install git` |

### 2. Projeyi indir ve kur

```bash
git clone https://github.com/<kullanici-adi>/<repo-adi>.git
cd <repo-adi>

pip install -r requirements.txt          # macOS/Linux: pip3; Linux'ta gerekirse: --break-system-packages

cd uygulama-electron
npm install
cd ..
```

### 3. Türkçe sözlük

Düzeltme adımı [tdd-ai/hunspell-tr](https://github.com/tdd-ai/hunspell-tr/releases) sözlüğünü kullanır (MIT). Sözlük büyük olduğu için depoda yoktur. Son sürümdeki `tr_TR.aff` ve `tr_TR.dic` dosyalarını indirip proje kök dizinine koy. İstersen bir kopyasını `eski sözlükler/` klasörüne de koyabilirsin; o zaman daha fazla öneri üretilir.

### 3b. Tesseract Türkçe modeli

Hafif ve Çok hızlı profiller [tesseract-ocr/tessdata_best](https://github.com/tesseract-ocr/tessdata_best) deposundaki `tur.traineddata` dosyasını kullanır (Apache 2.0). Dosyayı proje kökündeki `tessdata/` klasörüne koy (`kurulum.bat` bunu kendisi yapar). Tesseract standart yerinde değilse yolunu `KITAP_TESSERACT` ortam değişkenine yaz.

### 4. Modelleri indir

Donanımına göre seç. Hepsini kurmak zorunda değilsin; uygulama kurulu olanlarla çalışır.

```bash
# Ekran kartı yok / az RAM — Hafif profil (Tesseract ile birlikte)
ollama pull glm-ocr

# 16 GB+ RAM — standart (en doğru)
ollama pull qwen2.5vl:7b
ollama pull glm-ocr
ollama pull gemma3:12b
ollama pull qwen2.5:14b-instruct

# 8–12 GB RAM — hafif
ollama pull qwen2.5vl:3b
ollama pull glm-ocr
ollama pull gemma3:4b
ollama pull qwen2.5:7b-instruct
```

### 5. Başlat

```bash
cd uygulama-electron
npm start
```

Windows'ta `baslat.bat`, macOS/Linux'ta `./baslat.sh` da aynı işi yapar.

> Python yorumlayıcısı Windows'ta `py`, diğer sistemlerde `python3` olarak aranır. Başka bir yorumlayıcı kullanmak için `KITAP_PYTHON` ortam değişkenini ayarla (ör. `KITAP_PYTHON=/opt/venv/bin/python npm start`).

Ayrıntılı kullanım için: **[KULLANIM_KILAVUZU.md](KULLANIM_KILAVUZU.md)**

---

## Kurulum dosyasını üretmek (geliştirici)

Windows'ta, bu klasörde **`kurulum_olustur.bat`** dosyasına çift tıkla. Bilgisayarında Node.js ve Python 3.10+ kurulu olmalı. Betik şunları yapar:
1. Gömülü Python 3.12'yi indirir ve paketleri onun için kurar.
2. Betikleri, şablonları, sözlüğü ve Tesseract Türkçe modelini toplar.
3. Bilgisayarındaki Tesseract'ın yalnız gereken dosyalarını pakete koyar ve bir Türkçe okuma sınamasıyla doğrular (Tesseract yoksa `winget` ile kurar).
4. `electron-builder` ile `dist\ERME-BOOKS-Kurulum-<sürüm>.exe` dosyasını üretir.

Bu dosyayı GitHub'da **Releases → Draft a new release** sayfasına sürükleyip yayınlaman yeterli. Sürüm numarası `uygulama-electron/package.json` içindeki `version` alanından gelir.

## Proje yapısı

```
.
├── uygulama-electron/          Masaüstü uygulaması (Electron)
│   ├── main.js                 ana süreç
│   ├── preload.js              güvenli API köprüsü
│   └── renderer/               arayüz ve 3D sahneler
├── assets/epub/                EPUB'a gömülen yazı tipleri ve dizgi şablonları
├── *.py                        üretim hattı (OCR, düzeltme, yapı, kapak, EPUB)
├── input/                      işlenecek PDF'ler
├── output/<kitap>/             her kitabın ara dosyaları (devam etmek için)
└── epubs/                      üretilen EPUB'lar = kütüphane rafı
```

| Modül | Görevi |
|---|---|
| `uygulama-electron/main.js` | Pencere, Python alt süreçleri, IPC uçları, donanım algılama ve model seçimi (seçili modeller betiklere `KITAP_*` ortam değişkenleriyle geçer), dışa aktarma |
| `uygulama-electron/preload.js` | `contextIsolation` altında arayüze `window.api` köprüsü |
| `renderer/index.html` · `style.css` | Arayüz iskeleti ve mevsime göre değişen tema |
| `renderer/renderer.js` | Uygulama akışı: 5 adım, ilerleme ve kalan süre, bölüm ağacı ve canlı önizleme, kapak stüdyosu, EPUB özet kartı, iç okuyucu, Ayarlar penceresi |
| `renderer/secondaryAppBridge.js` | İkinci uygulamanın bağlantı noktası ve Keşif Geçidi kartı |
| `renderer/quality.js` | Uyarlanır grafik kalitesi ve FPS izleyici |
| `renderer/tree3d.js` | Hayat ağacı: büyüme, mevsim paletleri, rüzgâr, fener kartları, kovuk |
| `renderer/scenery3d.js` | Çevre ve hayvan yerleşimi: göl, mağara, şelale, dağlar, hava olayları |
| `renderer/fauna2d.js` | Hayvan figürleri ve organik hareketler |
| `renderer/hollowLibrary3d.js` | 360° kovuk kütüphanesi: raflar, fizik, sürükle-bırak, Klasik/Büyülü mod, büyüler |
| `renderer/coverGenerator.js` | Bez cilt kapak üreticisi (2048×1280 sarım, 2× EPUB kapağı) ve 3D kapak stüdyosu |
| `renderer/book3d.js` · `scene.js` | Açılış animasyonu, 3D kitap vitrini, mevsim menüsü manzarası |
| `hafif_ocr.py` · `sure_tahmini.py` | İşlemci dostu okuma (metin katmanı ya da paralel Tesseract + yalnız şüpheli satırlarda GLM-OCR, bağlı harf onarımı); profil ve süre tahmini |
| `ocr.py` · `ensemble.py` | PDF → metin; üç modelli okuma, kelime hizalama ve oylama |
| `editor.py` · `degerlendir.py` | Sözlük + LLM düzeltme (kural tabanlı mod dahil); doğru EPUB'a karşı WER/CER ölçümü |
| `detect_structure.py` · `erme_structure.py` | Başlık/yazar ve içindekiler ağacı tespiti, sayfa başlığı gürültüsü filtresi |
| `build_epub.py` · `epub_read.py` · `epub_info.py` | EPUB 3 derleme ve doğrulama, okuyucu için güvenli ayrıştırma, kütüphane bilgisi |
| `analyze_cover_theme.py` · `suggest_cover_style.py` | Kitaba özel kapak teması (yerel LLM + internet özeti, sezgisel yedek) |
| `generate_cover_triband.py` · `generate_mascots_ai.py` | Eski üç bantlı, maskotlu kapak (isteğe bağlı; maskotlar için stable-diffusion.cpp gerekir, klasör `KITAP_SD_DIR`) |

### Kullanılan teknolojiler

**Electron** (masaüstü kabuğu, sıkı CSP) · **Three.js r158** (WebGL 2, instancing, özel shader'lar) · **HTML5 Canvas** (kumaş dokuları, varak, motifler ve hayvanlar tamamen kodla çizilir) · **Shadow DOM** (yalıtılmış sayfa önizlemesi ve okuyucu) · **Ollama** (yerel vision ve dil modelleri) · **PyMuPDF** · **spylls** (hunspell) · **ebooklib** + **lxml** (EPUB 3) · **Lora / Crimson Text / Montserrat** (OFL).

---

## Lisans

Kod [MIT](LICENSE) lisanslıdır. Gömülü yazı tipleri SIL Open Font License 1.1 ile dağıtılır (`assets/epub/fonts/OFL.txt`).
