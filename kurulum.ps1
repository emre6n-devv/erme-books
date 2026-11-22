# kurulum.ps1 - ERME BOOKS · Hayat Ağacı için tek tıkla kurulum (Windows 10/11)
# kurulum.bat tarafından çalıştırılır. Yaptıkları:
#   1) Node.js, Python, Tesseract ve Ollama kurulu mu bakar; eksikse winget ile kurar
#   2) Python paketlerini (requirements.txt) ve uygulama bağımlılıklarını (npm install) kurar
#   3) Türkçe sözlüğü (tdd-ai/hunspell-tr, MIT) ve Tesseract Türkçe modelini indirir
#   4) Bilgisayarın donanımına (RAM, ekran kartı) uygun yerel yapay zekâ modellerini indirir (onay sorar)
#   5) Uygulamayı başlatır
# Ekran kartı olmayan, az RAM'li bilgisayarlar da çalışır: "Hafif" profil Tesseract + glm-ocr ile işlemcide okur.
# Tekrar çalıştırmak güvenlidir: kurulu olanlar atlanır.

$ErrorActionPreference = 'Continue'   # pip/ollama ilerleme mesajları stderr'e yazar; bunlar hata sayılmasın
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

function Baslik($t) { Write-Host ''; Write-Host "== $t ==" -ForegroundColor Cyan }
function Tamam($t) { Write-Host "  [tamam] $t" -ForegroundColor Green }
function Bilgi($t) { Write-Host "  $t" }
function Uyari($t) { Write-Host "  [uyarı] $t" -ForegroundColor Yellow }
function Hata($t) { Write-Host "  [hata] $t" -ForegroundColor Red }

# Kurulumdan sonra yeni programların görünmesi için PATH'i bu pencerede tazele
function PathTazele {
  $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $u = [Environment]::GetEnvironmentVariable('Path', 'User')
  $extra = @("$env:ProgramFiles\nodejs", "$env:LOCALAPPDATA\Programs\Python\Launcher", "$env:LOCALAPPDATA\Programs\Ollama", "$env:ProgramFiles\Ollama", "$env:ProgramFiles\Tesseract-OCR", "${env:ProgramFiles(x86)}\Tesseract-OCR")
  $env:Path = (@($m, $u) + $extra | Where-Object { $_ }) -join ';'
}
function Var($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

function WingetKur($id, $ad) {
  if (-not (Var 'winget')) {
    Hata "winget bulunamadı. $ad programını elle kur, sonra kurulum.bat'ı yeniden çalıştır."
    return $false
  }
  Bilgi "$ad kuruluyor (birkaç dakika sürebilir, izin penceresi çıkarsa Evet de)..."
  & winget install --id $id -e --source winget --accept-source-agreements --accept-package-agreements --silent | Out-Host
  PathTazele
  return $true
}

Write-Host ''
Write-Host '  ERME BOOKS · Hayat Ağacı - Kurulum' -ForegroundColor Magenta
Write-Host '  ---------------------------------'
PathTazele

# ---------------------------------------------------------------- 1. programlar
Baslik '1/6 Gerekli programlar'

if (Var 'node') { Tamam "Node.js $(node --version)" }
else {
  [void](WingetKur 'OpenJS.NodeJS.LTS' 'Node.js')
  if (Var 'node') { Tamam "Node.js $(node --version)" } else { Hata 'Node.js kurulamadı. https://nodejs.org adresinden kurup tekrar dene.'; Read-Host 'Kapatmak için Enter'; exit 1 }
}

$Py = $null
if (Var 'py') { $Py = 'py' } elseif (Var 'python') { $Py = 'python' }
if ($Py) {
  $v = & $Py --version 2>&1
  if ("$v" -notmatch 'Python 3\.(1[0-9]|[2-9][0-9])') { Uyari "$v bulundu; Python 3.10 veya üstü gerekli."; $Py = $null }
}
if (-not $Py) {
  [void](WingetKur 'Python.Python.3.12' 'Python 3.12')
  if (Var 'py') { $Py = 'py' } elseif (Var 'python') { $Py = 'python' }
}
if ($Py) { Tamam "$(& $Py --version 2>&1)" } else { Hata "Python kurulamadı. https://www.python.org adresinden kur (ilk ekranda 'Add python.exe to PATH' kutusunu işaretle)."; Read-Host 'Kapatmak için Enter'; exit 1 }

# Tesseract: işlemcide hızlı okuma (Hafif / Çok hızlı profiller). UB-Mannheim kurulumu PATH'e eklemez,
# o yüzden varsayılan klasöre de bakılır; uygulama da aynı yerlere bakar.
function TesseractBul {
  if ($env:KITAP_TESSERACT -and (Test-Path $env:KITAP_TESSERACT)) { return $env:KITAP_TESSERACT }
  $c = Get-Command 'tesseract' -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($d in @("$env:ProgramFiles\Tesseract-OCR", "${env:ProgramFiles(x86)}\Tesseract-OCR", "$env:LOCALAPPDATA\Programs\Tesseract-OCR", (Join-Path $Root 'tesseract'))) {
    $e = Join-Path $d 'tesseract.exe'
    if (Test-Path $e) { return $e }
  }
  return $null
}
$Tess = TesseractBul
if (-not $Tess) {
  [void](WingetKur 'UB-Mannheim.TesseractOCR' 'Tesseract OCR')
  $Tess = TesseractBul
}
if ($Tess) { Tamam "Tesseract ($Tess)" }
else { Uyari 'Tesseract kurulamadı. https://github.com/UB-Mannheim/tesseract/wiki adresinden kurabilirsin; o olmadan Hafif/Çok hızlı profiller çalışmaz (diğerleri çalışır).' }

if (Var 'ollama') { Tamam 'Ollama kurulu' }
else {
  [void](WingetKur 'Ollama.Ollama' 'Ollama')
  if (Var 'ollama') { Tamam 'Ollama kurulu' } else { Uyari 'Ollama kurulamadı. https://ollama.com/download adresinden kurabilirsin; uygulama Ollama olmadan açılır ama OCR yapamaz.' }
}

# ---------------------------------------------------------------- 2. bağımlılıklar
Baslik '2/6 Python paketleri'
& $Py -m pip install --disable-pip-version-check -r (Join-Path $Root 'requirements.txt') | Out-Host
if ($LASTEXITCODE -eq 0) { Tamam 'Python paketleri kuruldu' } else { Uyari 'Bazı Python paketleri kurulamadı; yukarıdaki mesaja bak.' }

Baslik '3/6 Uygulama bağımlılıkları (Electron, Three.js)'
Push-Location (Join-Path $Root 'uygulama-electron')
& npm.cmd install --no-fund --no-audit | Out-Host
$npmOk = $LASTEXITCODE -eq 0
Pop-Location
if ($npmOk) { Tamam 'npm install bitti' } else { Hata 'npm install başarısız oldu; internet bağlantını kontrol edip tekrar dene.'; Read-Host 'Kapatmak için Enter'; exit 1 }

# ---------------------------------------------------------------- 3. sözlük
Baslik '4/6 Türkçe sözlük (tdd-ai/hunspell-tr)'
$base = 'https://github.com/tdd-ai/hunspell-tr/raw/main'
foreach ($f in @('tr_TR.aff', 'tr_TR.dic')) {
  $hedef = Join-Path $Root $f
  if ((Test-Path $hedef) -and ((Get-Item $hedef).Length -gt 100KB)) { Tamam "$f zaten var"; continue }
  try {
    Bilgi "$f indiriliyor..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri "$base/$f" -OutFile $hedef -UseBasicParsing -ErrorAction Stop
    if ((Get-Item $hedef).Length -lt 100KB) { throw 'dosya beklenenden küçük' }
    Tamam "$f indirildi ($([math]::Round((Get-Item $hedef).Length / 1MB, 1)) MB)"
  } catch {
    Uyari "$f indirilemedi ($($_.Exception.Message)). https://github.com/tdd-ai/hunspell-tr adresinden indirip bu klasöre koy."
  }
}

# ---------------------------------------------------------------- 5. Tesseract Türkçe modeli
Baslik '5/6 Tesseract Türkçe modeli'
$tdDir = Join-Path $Root 'tessdata'
$tdTur = Join-Path $tdDir 'tur.traineddata'
if ((Test-Path $tdTur) -and ((Get-Item $tdTur).Length -gt 1MB)) { Tamam 'tessdata\tur.traineddata zaten var' }
else {
  try {
    New-Item -ItemType Directory -Force -Path $tdDir | Out-Null
    Bilgi 'tur.traineddata indiriliyor (tesseract-ocr/tessdata_best, Apache 2.0)...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri 'https://github.com/tesseract-ocr/tessdata_best/raw/main/tur.traineddata' -OutFile $tdTur -UseBasicParsing -ErrorAction Stop
    if ((Get-Item $tdTur).Length -lt 1MB) { throw 'dosya beklenenden küçük' }
    Tamam "tur.traineddata indirildi ($([math]::Round((Get-Item $tdTur).Length / 1MB, 1)) MB)"
  } catch {
    Uyari "tur.traineddata indirilemedi ($($_.Exception.Message)). https://github.com/tesseract-ocr/tessdata_best adresinden indirip tessdata klasörüne koy."
  }
}

# ---------------------------------------------------------------- 6. modeller
Baslik '6/6 Yerel yapay zekâ modelleri'
$ramGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
$gpuAd = (Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) -join ', '
$gpu = $gpuAd -match 'NVIDIA|GeForce|Quadro|RTX|Radeon RX|Radeon Pro|Arc A'
# Profiller uygulamadakiyle aynı: Hafif (Tesseract + glm-ocr) işlemciyle her bilgisayarda çalışır;
# Standart/Güçlü ekran kartı ister. Burada indirilmeyenler sonradan uygulamadaki Modeller panelinden indirilebilir.
$modeller = @('glm-ocr'); $seviye = 'Hafif (işlemcide çalışır)'; $boyut = '~2 GB'
if ($gpu -and $ramGB -ge 15) {
  $modeller += @('qwen2.5vl:7b', 'qwen2.5:7b-instruct'); $seviye = 'Standart'; $boyut = '~13 GB'
  if ($ramGB -ge 30) { $modeller += @('gemma3:12b', 'qwen2.5:14b-instruct'); $seviye = 'Güçlü'; $boyut = '~30 GB' }
}
Bilgi "RAM: $ramGB GB, ekran kartı: $(if ($gpuAd) { $gpuAd } else { 'bulunamadı' })"
Bilgi "Önerilen en üst profil: $seviye (her kitapta başlamadan önce profil yine seçilebilir)"
Bilgi ("Modeller: " + ($modeller -join ', ') + "  (toplam indirme $boyut)")

if (-not (Var 'ollama')) {
  Uyari 'Ollama kurulu olmadığı için modeller atlandı.'
} else {
  $cevap = Read-Host '  Modeller şimdi indirilsin mi? Uzun sürebilir. (E/H)'
  if ($cevap -match '^[EeYy]') {
    # Ollama arka planda çalışmıyorsa başlat
    $acik = $false
    try { Invoke-WebRequest -Uri 'http://localhost:11434/api/tags' -UseBasicParsing -TimeoutSec 3 | Out-Null; $acik = $true } catch {}
    if (-not $acik) {
      Bilgi 'Ollama başlatılıyor...'
      Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden
      Start-Sleep -Seconds 5
    }
    foreach ($m in $modeller) {
      Bilgi "ollama pull $m"
      & ollama pull $m | Out-Host
      if ($LASTEXITCODE -eq 0) { Tamam $m } else { Uyari "$m indirilemedi; daha sonra 'ollama pull $m' ile tekrar deneyebilirsin." }
    }
  } else {
    Bilgi 'Atlandı. Daha sonra şu komutlarla indirebilirsin:'
    $modeller | ForEach-Object { Bilgi "  ollama pull $_" }
  }
}

# ---------------------------------------------------------------- 5. başlat
Write-Host ''
Write-Host '  Kurulum tamamlandı. Bundan sonra uygulamayı baslat.bat ile açabilirsin.' -ForegroundColor Green
$kilavuz = if (Test-Path (Join-Path $Root 'KULLANIM_KILAVUZU.md')) { 'KULLANIM_KILAVUZU.md' } else { 'README.md' }
Write-Host "  Ayrıntılı kullanım: $kilavuz"
$ac = Read-Host '  Uygulama şimdi açılsın mı? (E/H)'
if ($ac -match '^[EeYy]') {
  Start-Process -FilePath 'npm.cmd' -ArgumentList 'start' -WorkingDirectory (Join-Path $Root 'uygulama-electron') -WindowStyle Minimized
}
