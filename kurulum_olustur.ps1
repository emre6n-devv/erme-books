# kurulum_olustur.ps1 - "ERME-BOOKS-Kurulum-x.y.z.exe" dosyasını üretir (geliştirici için, Windows 10/11).
# kurulum_olustur.bat tarafından çalıştırılır. İnternet bağlantısı gerekir; ilk seferde 5-15 dakika sürer.
#
# Ne yapar:
#   1) Python 3.12 gömülü (embeddable) sürümünü indirir -> build_staging\python
#   2) Python paketlerini (requirements.txt) Windows/Python 3.12 için oraya kurar
#   3) Betikleri, EPUB şablon/yazı tiplerini, Türkçe sözlüğü ve Tesseract Türkçe modelini -> build_staging\py
#   4) Tesseract OCR programını (Apache 2.0) -> build_staging\tesseract
#   5) electron-builder ile NSIS kurulum dosyasını üretir -> dist\ERME-BOOKS-Kurulum-*.exe
# Kurulum dosyası Python'u, sözlüğü ve Tesseract'ı içinde taşır; kullanıcının ayrıca bir şey kurması gerekmez.
# Böylece ekran kartı olmayan bilgisayarda bile "Hafif" profil (Tesseract + glm-ocr) hemen çalışır.
# Ollama ve yapay zekâ modelleri uygulama içindeki "Kurulum Sihirbazı" ile indirilir.

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$PyVer = '3.12.8'
$Stage = Join-Path $Root 'build_staging'
$PyDir = Join-Path $Stage 'python'
$ScDir = Join-Path $Stage 'py'
$Site  = Join-Path $PyDir 'Lib\site-packages'
$TsDir = Join-Path $Stage 'tesseract'

function Adim($t) { Write-Host ''; Write-Host "== $t ==" -ForegroundColor Cyan }
function Tamam($t) { Write-Host "  [tamam] $t" -ForegroundColor Green }
function Dur($t) { Write-Host "  [hata] $t" -ForegroundColor Red; Read-Host 'Kapatmak için Enter'; exit 1 }

Write-Host '  ERME BOOKS - Kurulum dosyası oluşturucu' -ForegroundColor Magenta

# --- 0. araçlar
Adim '0/5 Araçlar'
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { Dur 'Node.js (npm) bulunamadı. https://nodejs.org adresinden kur.' }
$HostExe = $null; $HostPre = @()
foreach ($c in @(@{ e = 'py'; p = @('-3') }, @{ e = 'python'; p = @() })) {
  try { $v = & $c.e @($c.p) --version 2>&1; if ("$v" -match 'Python 3\.(1[0-9])') { $HostExe = $c.e; $HostPre = @($c.p); break } } catch {}
}
if (-not $HostExe) { Dur 'Paketleri indirmek için bu bilgisayarda Python 3.10+ gerekli (https://www.python.org).' }
Tamam "Node.js $(node --version), $(& $HostExe @HostPre --version 2>&1)"

# --- 1. gömülü Python
Adim "1/5 Gömülü Python $PyVer"
if (Test-Path (Join-Path $PyDir 'python.exe')) { Tamam 'zaten hazır' }
else {
  New-Item -ItemType Directory -Force -Path $PyDir | Out-Null
  $zip = Join-Path $Stage "python-$PyVer-embed-amd64.zip"
  try { Invoke-WebRequest "https://www.python.org/ftp/python/$PyVer/python-$PyVer-embed-amd64.zip" -OutFile $zip -UseBasicParsing -ErrorAction Stop }
  catch { Dur "Python indirilemedi: $($_.Exception.Message)" }
  Expand-Archive -Path $zip -DestinationPath $PyDir -Force
  Remove-Item $zip
  Tamam 'indirildi'
}
# ._pth: site-packages ve betik klasörü (..\py) arama yoluna girsin
$pth = Get-ChildItem $PyDir -Filter 'python3*._pth' | Select-Object -First 1
if (-not $pth) { Dur '._pth dosyası bulunamadı.' }
$zipName = (Get-ChildItem $PyDir -Filter 'python3*.zip' | Select-Object -First 1).Name
Set-Content -Path $pth.FullName -Encoding ASCII -Value @($zipName, '.', 'Lib\site-packages', '..\py', 'import site')
New-Item -ItemType Directory -Force -Path $Site | Out-Null

# --- 2. paketler (Windows x64 / Python 3.12 için hazır wheel'ler)
Adim '2/5 Python paketleri'
$bin = @('pymupdf', 'requests', 'pillow', 'lxml', 'numpy', 'scipy', 'spylls', 'six')
$pipArgs = @('-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', '--target', $Site,
  '--platform', 'win_amd64', '--python-version', '3.12', '--implementation', 'cp', '--only-binary=:all:') + $bin
& $HostExe @HostPre @pipArgs | Out-Host
if ($LASTEXITCODE -ne 0) { Dur 'Paketler indirilemedi (yukarıdaki mesaja bak).' }
# ebooklib saf Python'dur, kaynak paketinden kurulur
$pipArgs = @('-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', '--no-deps', '--target', $Site, 'ebooklib')
& $HostExe @HostPre @pipArgs | Out-Host
if ($LASTEXITCODE -ne 0) { Dur 'ebooklib kurulamadı.' }
& (Join-Path $PyDir 'python.exe') -c "import pymupdf, numpy, scipy, lxml, ebooklib, spylls, PIL, requests; print('  paketler yükleniyor: tamam')"
if ($LASTEXITCODE -ne 0) { Dur 'Gömülü Python paketleri yükleyemedi.' }
Tamam 'paketler hazır'

# --- 3. betikler, şablonlar, sözlük
Adim '3/5 Betikler ve sözlük'
if (Test-Path $ScDir) { Remove-Item $ScDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $ScDir | Out-Null
Get-ChildItem $Root -Filter '*.py' | Where-Object { $_.Name -ne 'kurulum_olustur.py' } | Copy-Item -Destination $ScDir
Copy-Item (Join-Path $Root 'assets') -Destination $ScDir -Recurse
foreach ($f in @('tr_TR.aff', 'tr_TR.dic')) {
  $src = Join-Path $Root $f
  if (-not ((Test-Path $src) -and ((Get-Item $src).Length -gt 100KB))) {
    try { Invoke-WebRequest "https://github.com/tdd-ai/hunspell-tr/raw/main/$f" -OutFile $src -UseBasicParsing -ErrorAction Stop }
    catch { Dur "$f indirilemedi: $($_.Exception.Message)" }
  }
  Copy-Item $src -Destination $ScDir
}
# İsteğe bağlı eski sözlük (editor.py varsa kullanır)
$eski = Join-Path $Root 'eski sözlükler'
if (Test-Path $eski) { Copy-Item $eski -Destination $ScDir -Recurse }
# Tesseract Türkçe modeli (hafif_ocr.py betik klasöründeki tessdata\ klasörünü kullanır)
$tdSrc = Join-Path $Root 'tessdata\tur.traineddata'
if (-not ((Test-Path $tdSrc) -and ((Get-Item $tdSrc).Length -gt 1MB))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $tdSrc) | Out-Null
  try { Invoke-WebRequest 'https://github.com/tesseract-ocr/tessdata_best/raw/main/tur.traineddata' -OutFile $tdSrc -UseBasicParsing -ErrorAction Stop }
  catch { Dur "tur.traineddata indirilemedi: $($_.Exception.Message)" }
}
New-Item -ItemType Directory -Force -Path (Join-Path $ScDir 'tessdata') | Out-Null
Copy-Item $tdSrc -Destination (Join-Path $ScDir 'tessdata')
# Geliştirme artığı betikler kurulum dosyasına girmesin
foreach ($f in @('tani.py', 'degerlendir.py')) { Remove-Item (Join-Path $ScDir $f) -ErrorAction SilentlyContinue }
Tamam "$((Get-ChildItem $ScDir -Filter '*.py').Count) betik, şablonlar, sözlük ve Tesseract Türkçe modeli kopyalandı"

# --- 4. Tesseract programı
Adim '4/5 Tesseract OCR'
$TsSrc = $null
foreach ($d in @("$env:ProgramFiles\Tesseract-OCR", "${env:ProgramFiles(x86)}\Tesseract-OCR", "$env:LOCALAPPDATA\Programs\Tesseract-OCR")) {
  if (Test-Path (Join-Path $d 'tesseract.exe')) { $TsSrc = $d; break }
}
if (-not $TsSrc -and (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Host '  Tesseract bu bilgisayarda yok, winget ile kuruluyor (yalnızca paketlemek için)...'
  & winget install --id UB-Mannheim.TesseractOCR -e --source winget --accept-source-agreements --accept-package-agreements --silent | Out-Host
  foreach ($d in @("$env:ProgramFiles\Tesseract-OCR", "${env:ProgramFiles(x86)}\Tesseract-OCR")) {
    if (Test-Path (Join-Path $d 'tesseract.exe')) { $TsSrc = $d; break }
  }
}
if (-not $TsSrc) { Dur 'Tesseract bulunamadı. https://github.com/UB-Mannheim/tesseract/wiki adresinden kurup tekrar dene.' }
if (Test-Path $TsDir) { Remove-Item $TsDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $TsDir | Out-Null
# Yalnızca tesseract.exe, DLL'ler ve lisanslar; eğitim araçları (lstmtraining, text2image...) ve dil dosyaları alınmaz
# (Türkçe model py\tessdata içinde, kurulum küçük kalsın)
Get-ChildItem $TsSrc -File | Where-Object { ($_.Name -eq 'tesseract.exe') -or ($_.Extension -eq '.dll') -or ($_.Name -match 'LICENSE|COPYING|README') } |
  Copy-Item -Destination $TsDir
$TsExe = Join-Path $TsDir 'tesseract.exe'
if (-not (Test-Path $TsExe)) { Dur 'Tesseract kopyalanamadı.' }
# Eksik DLL'de Windows'un hata penceresi açmasın (alt süreçlere de geçer), yoksa ayıklama takılır
Add-Type -Namespace Erme -Name Hata -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetErrorMode(uint m);'
[void][Erme.Hata]::SetErrorMode(0x8003)
function TsCalisiyor { & $TsExe --version *> $null; return ($LASTEXITCODE -eq 0) }
if (-not (TsCalisiyor)) { Dur 'Kopyalanan Tesseract çalışmadı (eksik DLL).' }
# Gereksiz DLL'leri ayıkla: büyükten küçüğe her birini kenara alıp dene; Tesseract onsuz açılıyorsa gerekmiyordur
$kenar = Join-Path $Stage 'ts_kenar'
if (Test-Path $kenar) { Remove-Item $kenar -Recurse -Force }
New-Item -ItemType Directory -Force -Path $kenar | Out-Null
foreach ($dll in (Get-ChildItem $TsDir -Filter '*.dll' | Sort-Object Length -Descending)) {
  $yeni = Join-Path $kenar $dll.Name
  Move-Item $dll.FullName $yeni
  if (-not (TsCalisiyor)) { Move-Item $yeni $dll.FullName }
}
Remove-Item $kenar -Recurse -Force
# Gerçek okuma sınaması: Türkçe bir yazı çizip okut (DLL ayıklaması okumayı bozmadı mı?)
Add-Type -AssemblyName System.Drawing
$png = Join-Path $Stage 'ts_sina.png'
$bmp = New-Object System.Drawing.Bitmap 900, 120
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$g.DrawString('Güzel çiçekler açmıştı', (New-Object System.Drawing.Font('Arial', 40)), [System.Drawing.Brushes]::Black, 10, 20)
$g.Dispose(); $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
$okunan = & $TsExe $png stdout -l tur --tessdata-dir (Join-Path $ScDir 'tessdata') 2>$null
Remove-Item $png -ErrorAction SilentlyContinue
if ("$okunan" -notmatch 'çiçek') { Dur "Kopyalanan Tesseract Türkçe okuyamadı (okunan: '$okunan')." }
Write-Host "  Sınama okuması: $("$okunan".Trim())"
Tamam "Tesseract kopyalandı ($([math]::Round(((Get-ChildItem $TsDir -File | Measure-Object Length -Sum).Sum) / 1MB)) MB, $((Get-ChildItem $TsDir -Filter '*.dll').Count) DLL)"

# --- 5. kurulum dosyası
Adim '5/5 Kurulum dosyası (electron-builder)'
Push-Location (Join-Path $Root 'uygulama-electron')
& npm.cmd install --no-fund --no-audit | Out-Host
& npm.cmd install --no-save --no-fund --no-audit electron-builder@latest | Out-Host
& npx.cmd electron-builder --win nsis --x64 | Out-Host
$ok = $LASTEXITCODE -eq 0
Pop-Location
if (-not $ok) { Dur 'electron-builder başarısız oldu (yukarıdaki mesaja bak).' }

$exe = Get-ChildItem (Join-Path $Root 'dist') -Filter 'ERME-BOOKS-Kurulum-*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host ''
Write-Host "  Hazır: $($exe.FullName)  ($([math]::Round($exe.Length / 1MB)) MB)" -ForegroundColor Green
Write-Host '  Bu dosyayı GitHub > Releases sayfasına yükleyip paylaşabilirsin.'
Start-Process explorer.exe "/select,`"$($exe.FullName)`""
