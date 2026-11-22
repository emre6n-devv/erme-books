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

### En kolay yol: Kurulum dosyası (Windows)

1. Projenin GitHub sayfasında sağdaki **Releases** bölümüne gir ve **`ERME-BOOKS-Kurulum-….exe`** dosyasını indir.
2. Dosyaya çift tıkla. Windows mavi bir "bilinmeyen yayıncı" uyarısı gösterirse **Ek bilgi → Yine de çalıştır** de.
3. Kurulum penceresinde **İleri → Kur → Son** de. Masaüstüne **ERME BOOKS** kısayolu gelir ve uygulama açılır.
4. İlk açılışta **Kurulum Sihirbazı** çıkar:

| Sihirbaz adımı | Ne yapmalısın |
|---|---|
| **Yapay zekâ motoru (Ollama)** | **Ollama'yı İndir ve Kur**'a bas. Ollama'nın kendi kurulum penceresi açılınca **Install** de. Ollama'nın açtığı pencerede bir şey seçmene gerek yok; kapatabilirsin. Sihirbaz kurulumun bittiğini kendisi anlar |
| **Türkçe sözlük** | Kurulum dosyasıyla geldiği için zaten hazırdır |
| **Yapay zekâ modelleri** | Bilgisayarına uygun set işaretli gelir. **Seçilenleri İndir**'e bas; her modelin ilerleme çubuğu görünür |
| **Başla** | Her şey tamamlanınca etkinleşir |

Sihirbazı daha sonra üst çubuktaki model göstergesine tıklayıp **Kurulum Sihirbazı** düğmesiyle yeniden açabilirsin. Kitapların, kapakların ve EPUB'ların **Belgeler\ERME BOOKS** klasöründe tutulur.

### Kaynak koddan tek tıkla kurulum (Windows)

1. GitHub sayfasında **Code → Download ZIP** ile projeyi indir ve ZIP'i bir klasöre çıkar (örn. `C:\erme-books`).
2. Klasördeki **`kurulum.bat`** dosyasına çift tıkla. Açılan pencere adım adım şunları yapar:

| Adım | Ne olur |
|---|---|
| 1/5 Gerekli programlar | Node.js, Python 3.12 ve Ollama kurulu değilse `winget` ile kurulur. İzin penceresi çıkarsa **Evet** de |
| 2/5 Python paketleri | `requirements.txt` kurulur |
| 3/5 Uygulama bağımlılıkları | `npm install` (Electron ve Three.js) |
| 4/5 Türkçe sözlük | `tr_TR.aff` ve `tr_TR.dic` indirilip klasöre konur |
| 5/5 Yapay zekâ modelleri | RAM'ine göre önerilen set gösterilir; **E** dersen indirilir. 16 GB+ için standart (~25 GB), 8–12 GB için hafif (~12 GB) set |

3. Sonunda "Uygulama şimdi açılsın mı?" sorusuna **E** de.

Sonraki açılışlarda yalnızca **`baslat.bat`**'a çift tıkla. Kurulum yarıda kalırsa `kurulum.bat`'ı yeniden çalıştırman yeterli; kurulu olanlar atlanır.

### Elle kurulum (macOS, Linux ya da her şeyi kendin kurmak istersen)

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

### Profil seçimi (her kitapta)

OCR'ı başlattığında önce **profil ekranı** açılır. Her profilin bu kitapta bu bilgisayarda tahmini süresi yazar; bilgisayarına en uygun olan işaretlidir. PDF'in içinde sağlam bir metin katmanı varsa ekranda bu da yazar: o zaman OCR yapılmaz, metin birkaç saniyede PDF'ten alınır.

| Profil | Ne kullanır | Kimin için |
|---|---|---|
| **Çok hızlı** | Yalnız Tesseract | Çok zayıf bilgisayar, hızlı deneme |
| **Hafif** | Tesseract + `glm-ocr` (yalnız şüpheli satırlar) | Ekran kartı olmayan ya da az RAM'li bilgisayar (varsayılan) |
| **Standart** | `qwen2.5vl:7b` + `glm-ocr` + `qwen2.5:7b-instruct` | Ekran kartlı, 16 GB+ RAM |
| **Güçlü** | Standart + `gemma3:12b` + `qwen2.5:14b-instruct` | Güçlü ekran kartı, 32 GB RAM |

Hafif profil test kitaplarında %0,03–1,4 kelime hatası verdi. Tesseract kurulum dosyasının içinde gelir; kaynak koddan kurduysan `kurulum.bat` onu da kurar.

### Hangi modelleri kurmalıyım?

| Bilgisayarın | Kurulacak modeller | Beklenen hata payı |
|---|---|---|
| **Ekran kartı yok / az RAM** | `glm-ocr` (Hafif profil, Tesseract ile) | %0,03–1,4 (test kitaplarında) |
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

### Ayarlar penceresi

Bütün ayarlar tek pencerede: üst çubuktaki **⚙ Ayarlar** düğmesine tıkla ya da **Ctrl+,** tuşlarına bas (macOS'ta Cmd+,). Model göstergesine tıklamak da pencereyi Modeller sekmesinde açar. **Esc** ile kapanır.

Soldaki sekmeler:

- **Modeller:** sistem bilgisi (işletim sistemi, RAM, ekran kartı ve belleği, işlemci, Ollama durumu) ve her görev için model seçimi.
  - **Otomatik / Elle seç:** Otomatik modda seçim donanıma göre yapılır. Bir seçeneğe tıklarsan elle moda geçilir ve seçimin uyarıya rağmen kullanılır.
  - Her seçeneğin yanında yaklaşık bellek ihtiyacı, hata payına etkisi, "kurulu" ya da "kurulu değil · İndir" etiketi ve gerekiyorsa "bu bilgisayar için ağır" uyarısı yazar.
  - Altta tüm hattın tahmini kelime hata payı görünür.
- **Tarama kalitesi:** sayfaların okuyucu modele hangi çözünürlükte gönderileceği.

  | Seviye | Çözünürlük | Kime göre |
  |---|---|---|
  | Hızlı | 250 DPI | ekran kartı belleği 6 GB ve altı |
  | Dengeli | 300 DPI | 8 GB civarı ekran kartı |
  | En net | 450 DPI | 12 GB ve üstü; küçük/eski puntolu kitaplar |

  **Otomatik** (önerilen) seviyeyi ekran kartına göre seçer. İlk sayfa okunduktan sonra modelin ekran kartına tamamen sığıp sığmadığını ölçer. Sığmıyorsa (modelin bir kısmı işlemcide çalışıyorsa sayfa başına süre birkaç katına çıkar) bir kademe düşürür, okumayı kaldığı yerden sürdürür ve sağ altta bir kartla haber verir. Karttaki **Geri al** eski seviyeye döner ve ayarı elle sabitler. Elle seçtiğin seviye hiç değişmez.
- **Görünüm:** grafik kalitesi (aşağıda).
- **Kurulum:** Python, Ollama, Türkçe sözlük ve OCR modelinin durumu, kurulu modeller; **Kurulum Sihirbazını aç** ve **Veri klasörünü aç** düğmeleri. Eksik bir şey varsa sekmenin yanında turuncu nokta çıkar.
- **Hakkında:** sürüm, kitapların durduğu klasör ve GitHub sayfası.

Pencerenin sağ üstündeki **↻ Yenile**, yeni model kurduktan sonra listeyi tazeler.

**Kural tabanlı motor:** dil modeli olmadan çalışır.
- Düzeltmede yalnız sözlükten kesin olan düzeltmeler uygulanır; gerisi "Elle bakılacaklar" listesine düşer.
- Bölüm tespitinde yalnız biçimi kesin başlıklar alınır: Önsöz, Birinci Kısım, Bölüm 3, IV, 2.1 …
- Kapak teması anahtar kelimelerden çıkarılır.

### Grafik kalitesi

**Ayarlar → Görünüm** sekmesinde Otomatik, Yüksek, Orta ve Düşük vardır. Bu ayar yalnızca görüntüyü etkiler; OCR hızını değiştirmez.

- **Otomatik:** kare hızı 35'in altına düşerse kalite bir kademe iner ve bir bildirim görünür.
- **Düşük:** gölgeleri kapatır, parçacıkları ve hayvan sayısını azaltır, çözünürlüğü 1×'e indirir.

Zayıf dizüstü bilgisayarlarda Orta ya da Düşük önerilir.

---

## 3. Arayüz ve kontroller

### Üst çubuk

Uygulama açılışta ekranı kaplayacak şekilde büyütülmüş açılır; üstte Windows'un File/Edit menüsü yoktur. **F11** tam ekrana geçirir ve geri alır.

| Öğe | İşlevi |
|---|---|
| **E logosu** | Ana sahneye (hayat ağacı) döner |
| **Kitap seçici** | Çalıştığın kitap. Uygulama son açtığın kitapla açılır |
| **Yeni PDF** | Bilgisayarından PDF seçer ve `input/` klasörüne kopyalar |
| **Ağaç · OCR · Düzeltme · Yapı · Kapak · EPUB** | Adımlar arasında geçiş; renkli nokta tamamlanan adımı gösterir |
| **Kitaplık** | Kovuk kütüphanesine iner |
| **Mevsim** | İlkbahar / Yaz / Sonbahar / Kış ya da "↺ Bugün" (takvime göre) |
| **Model göstergesi** | Modellerin durumu; tıklayınca Ayarlar → Modeller |
| **⚙ Ayarlar** | Modeller, tarama kalitesi, görünüm, kurulum, hakkında (Ctrl+,) |

### Ana sahne: hayat ağacı

- **Fener kartları:** dallardaki beş fener, üretim adımlarıdır. Üstüne gelince adımın durumu (bekliyor, sıradaki, çalışıyor, tamamlandı) ve ayrıntısı görünür; tıklayınca o adıma gidilir.
- **Devam et düğmesi:** sol üstte, sıradaki adıma tek tıkla götürür. Kitap bittiyse "Kitaplıkta gör" olur.
- **Mevsim kadranı:** alttaki dört küre mevsimi değiştirir. Gök, ışık, coğrafya ve hayvanlar yumuşak bir geçişle değişir.
- **Kovuğa giriş:** gövdedeki ışıklı kovuğa ya da ağaçtaki kitap yığınına tıkla.
- **Açılış:** açılış animasyonunu yeniden oynatır. Animasyon sırasında tıklamak ya da Esc ile atlanır.

### Dört mevsim ve gizli geçitler

Ortadaki hayat ağacı, fenerleri ve kovuğu hep yerinde durur; çevresi her mevsim kendine özgü bir hal alır. Her mevsimde manzarada bir **gizli geçit** vardır. Üstüne gelince parıldar ve "✦ Gizli Geçit" yazar. Tıklayınca kamera geçide doğru yaklaşır ve bir **Keşif Geçidi** kartı açılır. Bu geçitler ileride eklenecek ikinci uygulamanın kapılarıdır; şimdilik kartta mevsimin küçük bir mesajı var. **← Ağaca Dön** (ya da Esc) kamerayı yavaşça eski yerine döndürür.

| Mevsim | Manzara | Hayvanlar | Gizli geçit |
|---|---|---|---|
| **İlkbahar** | Gür şelale ve dibinde genişleyen su halkaları, kayalarda papatya ve menekşeler, sarmaşıklarla kapanmış mağara, polen zerreleri, yağmurdan sonra gökkuşağı, dönerek inen pembe çiçek yaprakları | Kıyı taşlarında zıplayan kurbağalar, kelebekler ve yusufçuklar, köklerde güneşlenen tavşan ailesi, geyikler | **Şelale perdesinin ardındaki** hafifçe parlayan kaya oyuğu |
| **Yaz** | Gölet çekilir, ortada atlama taşları ve nilüferler çıkar; sağ çayırda rüzgârda dalgalanan altın başaklar; gölette güneş parıltıları, yapraklar arasından ışık hüzmeleri, köklerin gölgesinde ateş böcekleri | Taşta dinlenen kaplumbağa, ördek aileleri, başakların arasından bakan tilki, dallarda ötücü kuşlar, martılar | **İskeleye yanaşmış sandal** |
| **Sonbahar** | Mağara açılır, ağzında ateş yanar; köklerde orman mantarları, kıyıda kuru yaprak yığınları, gölette süzülen yapraklar, uzak tepelerde sis | Dallarda palamut taşıyan sincaplar, mağaranın önünde kıvrılmış kirpi ailesi, V düzeninde göçmen kuşlar, mağaraya sığınan ayılar | **Mağaradaki ateşin derinliği** |
| **Kış** | Şelale buz sarkıtlarına döner, gölet buz tutar, mağara karla örtülür; dolunaylı gece, yanıp sönen yıldızlar, sarkıtlarda kristal ışıltılar, dallardan dökülen kar tozu | Kovukta baykuşlar, buzun kıyısında karda iz bırakarak yürüyen kutup tilkisi, uzak tepede geyik silüeti, kurt sürüsü, tavşanlar | **Donmuş göletin ortasındaki dolunaylı buz aynası** |

Geçit yalnızca kendi mevsiminde ve mevsim geçişi bittikten sonra tıklanabilir.

### 360° kovuk kütüphanesi

Kovuğa tepedeki ışık açıklığından süzülerek inersin. Raflar ve merdiven rayı odanın çevresini kesintisiz dolaşır. Dışarı çıkmak için sol üstteki **← Ağaca dön** düğmesine bas ya da **Esc**'ye bas.

Üst ortadaki anahtarla iki mod arasında geçersin; seçimin hatırlanır:

- **Klasik:** sıcak ahşap ve kehribar ışık, kahverengi orman baykuşu.
- **✦ Büyülü:** oda gece mavisine döner. Tavanda mumlar süzülür, aralarında altın tozlar ve kanat çırpar gibi uçan açık kitaplar dolaşır. Baykuş, yanında mühürlü bir mektupla kar beyazı bir baykuşa dönüşür. İmleç asaya döner ve arkasında kıvılcım izi bırakır.

Alt ortada moda göre kısa bir ipucu şeridi 4 saniye görünür; sağ alttaki **?** ile tekrar açılır.

**Her iki modda:**

| Fare / tuş | Ne yapar |
|---|---|
| **Boş bir yeri sol tıkla tutup sürükle** | Odada 360° etrafa bakarsın. Hızlıca bırakırsan biraz süzülür. Orta tuşla sürüklemek de olur |
| **Trackpad: iki parmakla kaydır** | Etrafa bakar |
| **Trackpad: iki parmakla kıstır / aç** | Yaklaşır / uzaklaşır (duvara ve zemine girmez) |
| **Ok tuşları ya da W A S D** | Etrafa bakar · **+ / −** ya da **Q / E** yaklaşır |
| **Fare tekerleği** | Yaklaşır / uzaklaşır (Shift + tekerlek: sağa sola bakar) |
| **Dokunmatik ekran** | Tek parmakla sürükle: bak · iki parmakla kıstır: yaklaş |
| **Kitaba tıkla** | Kitabı seçer: raftan hafifçe çıkar ve sol altta bilgi kartı açılır |
| **Kitabı tutup sürükle** | Başka rafa ya da sıraya taşır (5 pikselden az kıpırdarsa tıklama sayılır) |
| **Merdiveni tutup sürükle** | Raydaki merdiven odanın çevresinde kayar |
| **Boş bir yere çift tıkla** | Merdiven oraya yuvarlanır |
| **Baykuşa tıkla** | Bazen kanat çırpar, bazen öter. Çok sık dürtersen (5 saniyede 4 kez) başka rafa uçar 🦉 |
| **Ortadaki döner kitaplık** | Tıklayınca döner; sürükleyip fırlatırsan bir süre kendi kendine döner |
| **Gizli bölmeler (iki rafın boş yeri)** | Tıklayınca raf gıcırdayarak döner, arkasında mumlu gizli bir köşe çıkar |
| **EPUB dosyasını pencereye sürükle** | Dışarıdan bir e-kitabı rafa ekler |

**Klasik modda ayrıca:**

| Fare / tuş | Ne yapar |
|---|---|
| **Seçili kitaba tekrar tıkla** | Kitabı açar |
| **Merdivene tıkla** | Merdiveni seçer (turuncu parlar); **← →** ile kaydırırsın. Başka yere tıklayınca bırakılır |
| **Sağ tık (rafa)** | Rafa vurur; yakındaki kitaplar sallanıp yere düşer. Yerdeki kitaba tıklayınca rafa geri döner |

**Büyülü modda ayrıca:**

| Asa ile | Ne yapar |
|---|---|
| **Kitabı tutup sürükle** | Kitap altın bir haleyle havada süzülür. Bıraktığın rafa uçar; rafa denk gelmezse yere düşer (yerdeki kitaba tıklayınca rafa geri uçar) |
| **Kitaba sağ tık ya da çift tık** | Kitap kıvılcımlarla raftan çıkıp önüne süzülür. Seni takip eder |
| **Önündeki kitaba tıkla** | Kitap havada açılır. **← →** tuşlarıyla, asayı kitabın üstünde yana savurarak ya da sayfayı tutup yana çekerek sayfa çevrilir. Gerçek kitaplarda ilk sayfa iç kapaktır; okumak için karttaki **Kitabı aç** düğmesi |
| **Önündeki kitaba sağ tık** | Kitap rafındaki yerine uçar |
| **Merdivene tıkla** | Merdiven baktığın rafa kendi kendine süzülür |
| **Boşluğa tıkla** | Asanın ucundan bir ışık küresi çıkıp tıkladığın yere süzülür ve oradaki rafları birkaç saniye aydınlatır |
| **Esc** | Önce havadaki kitap kapanır, sonra önündeki kitap rafına döner, sonra kovuktan çıkarsın |

Kırmızı ayraçlı kitaplar süren projelerdir; tıklayınca o projede sıradaki adıma gidilir. Bitmiş ERME baskıları onaylı bez cilt kapaklarıyla durur ve kartlarında "tamamlandı ✓" yazar. Rafların düzeni kaydedilir.

---

## 4. Adım adım kitap dönüştürme (PDF → EPUB)

Her adım sonucunu `output/<kitap-adı>/` klasörüne yazar. Uygulamayı kapatıp açtığında her şey kaldığı yerden yüklenir.

### Adım 1 · OCR Tarama

1. **Yeni PDF** ile kitabını ekle. Sol tarafta sayfa önizlemesi çıkar; ‹ › ile gezebilirsin.
2. **Üç model OCR** açıksa sayfa üç kez okunur ve sonuçlar kelime kelime birleştirilir. Bu yaklaşık 3 kat yavaştır ama hataları belirgin biçimde azaltır. Ayarlar → Modeller'de ikinci okuma kapalıysa bu seçenek kendiliğinden tek okumaya döner.
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
| Üst çubukta **Ollama kapalı** yazıyor | Ollama uygulamasını aç (Linux: `ollama serve`), sonra Ayarlar penceresinde **↻ Yenile** |
| **Eksik model** uyarısı | Göstergeye tıkla, kurulu olmayan modelin yanındaki `ollama pull …` komutunu terminalde çalıştır |
| Düzeltme "tr_TR.aff ve tr_TR.dic bu klasörde yok" diyor | Sözlük dosyalarını proje kök klasörüne koy (bölüm 1, adım 4) |
| Python bulunamadı | Windows'ta Python'u *Add to PATH* ile yeniden kur ya da `KITAP_PYTHON` değişkeniyle yorumlayıcının yolunu ver |
| Sahne takılıyor | Kalite'yi **Orta** ya da **Düşük** yap |
| Bir sayfa numarası bölüm sanıldı | 3. adımda o başlığı × ile sil |
| İşlem yarıda kaldı | Aynı düğmeyle yeniden başlat; okunan sayfalar ve kayıtlı adımlar atlanır |
| Kapak eski görünüyor | 4. adımda **Kapağı Onayla**'ya tekrar bas, sonra EPUB'u yeniden oluştur |
