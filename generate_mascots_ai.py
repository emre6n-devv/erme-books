# -*- coding: utf-8 -*-
"""
generate_mascots_ai.py - SDXL ile 1930'lar Ahşap Baskı (Woodcut) Yayınevi Maskotları

v3 DEĞİŞİKLİKLERİ:
- Prompt'lar artık "heraldic/emblem/colophon" gibi simetrik-amblem hissi
  veren ifadeler yerine, tazı örneğindeki gibi DOĞAL DURUŞ/HAREKET tarif
  ediyor (yürüyen, koşan, avlanan) - hayvan bir forma logosu değil, gerçek
  bir hayvan gibi görünsün diye.
- Dal, çerçeve, ay, manzara gibi arka plan öğeleri prompt'lardan tamamen
  çıkarıldı, negatif prompt'a da açıkça eklendi.
- TEMİZLİK: artık sadece "en büyük bağlı bileşen" yetmiyor çünkü süs
  öğeleri bazen hayvana GERÇEKTEN bitişik çiziliyor (aynı bileşen). Bunun
  için "erozyon + geodesic yeniden inşa" kullanılıyor: önce maske aşındırılıp
  ince bağlantılar kırılıyor, en büyük parça bulunuyor, sonra o parça SADECE
  orijinal sınırlar içinde tekrar büyütülüyor - hayvanın tam detayı geri
  geliyor ama kopan süs öğeleri geri gelmiyor.

v4 DEĞİŞİKLİKLERİ (otomatik eksik maskot üretimi):
- --missing: sadece henüz üretilmemiş maskotları üretir (arayüz bunu kullanıyor).
- --list: tüm/mevcut maskot isimlerini JSON olarak basar.
- Her üretim doğrulanıyor (boş, çok dolu ya da kenara taşan görüntü = hatalı);
  hatalıysa farklı seed ile 3 kez yeniden deneniyor.
- sd-cli'nin dosya oluşturmadan çıkması artık çökme yerine yeniden deneme.
- Model/VAE dosyaları başta kontrol ediliyor; bir maskot bile başarısızsa
  çıkış kodu 1 (arayüz bunu hata olarak gösteriyor).
"""

import json
import os
import random
import subprocess
import sys
from pathlib import Path
from PIL import Image
import numpy as np

try:
    from scipy import ndimage
except ImportError:
    print("HATA: scipy kurulu değil. Terminalde şunu çalıştır: pip install scipy")
    sys.exit(1)

# stable-diffusion.cpp klasörü: KITAP_SD_DIR ile değiştirilebilir (Windows: C:\SDCpp, macOS/Linux: ~/SDCpp)
SD_DIR = Path(os.environ.get("KITAP_SD_DIR") or (r"C:\SDCpp" if os.name == "nt" else Path.home() / "SDCpp"))
SD_CLI_PATH = str(SD_DIR / ("sd-cli.exe" if os.name == "nt" else "sd-cli"))
SD_MODEL_PATH = str(SD_DIR / "sd_xl_base_1.0.safetensors")
SD_VAE_PATH = str(SD_DIR / "sdxl_vae.safetensors")

BASE_DIR = Path(__file__).resolve().parent
MASCOTS_DIR = BASE_DIR / "assets" / "mascots"  # çalışma klasöründen bağımsız
MASCOTS_DIR.mkdir(parents=True, exist_ok=True)

STYLE_SUFFIX = (
    "minimalist flat vector logo design, crisp clean smooth lines, negative space, "
    "modern publishing colophon, pure solid white background, single isolated animal, "
    "monochrome flat black ink, simple elegant silhouette, no shading, no rough texture, "
    "no background pattern"
)

MASCOT_PROMPTS = {
    "penguin": f"an emperor penguin standing upright mid-waddle, one foot forward, {STYLE_SUFFIX}",
    "tazi": f"a sleek greyhound dog running at full stride, {STYLE_SUFFIX}",
    "pelikan": f"a pelican walking with wings folded, mid-stride, {STYLE_SUFFIX}",
    "baykus": f"an owl with wings spread wide about to take flight, {STYLE_SUFFIX}",
    "kedi": f"a cat stretching with arched back and raised tail, {STYLE_SUFFIX}",
    "aslan": f"a lion walking with mane flowing, one paw raised mid-stride, {STYLE_SUFFIX}",
    "kartal": f"an eagle diving steeply with wings tucked and talons forward, {STYLE_SUFFIX}",
    "tilki": f"a fox trotting briskly with tail flowing behind, {STYLE_SUFFIX}",
    "kurt": f"a wolf trotting low with head forward and tail extended, {STYLE_SUFFIX}",
    "ayi": f"a bear walking on all fours with head lowered, {STYLE_SUFFIX}",
    "geyik": f"a stag walking in profile with antlers visible, {STYLE_SUFFIX}",
    "tavsan": f"a hare leaping mid-jump with ears back, {STYLE_SUFFIX}",
    "at": f"a horse galloping at full stride with mane flowing, {STYLE_SUFFIX}",
    "balina": f"a whale swimming with body curved and tail mid-stroke, {STYLE_SUFFIX}",
    "yunus": f"a dolphin leaping mid-jump with body arched, {STYLE_SUFFIX}",
    "kaplumbaga": f"a tortoise walking slowly with head extended forward, {STYLE_SUFFIX}",
    "kelebek": f"a butterfly in flight with wings mid-flutter, {STYLE_SUFFIX}",
    "tavuskusu": f"a peacock walking with tail feathers fanned behind, {STYLE_SUFFIX}",
    "kugu": f"a swan gliding with neck curved and wings folded, {STYLE_SUFFIX}",
    "kirpi": f"a hedgehog walking with nose to the ground, {STYLE_SUFFIX}",
    "sincap": f"a squirrel sitting upright eating a nut with bushy tail curled, {STYLE_SUFFIX}",
    "kuzgun": f"a raven walking on the ground with head tilted and wings folded, {STYLE_SUFFIX}",
    "yilan": f"a snake slithering in an S-curve with tongue flicking, {STYLE_SUFFIX}",
    "ahtapot": f"an octopus swimming with tentacles trailing in motion, {STYLE_SUFFIX}",
    "zurafa": f"a giraffe walking with long neck curved and one leg raised, {STYLE_SUFFIX}",
}

NEGATIVE = (
    "woodcut, linocut, messy strokes, rough edges, 3d, sketch, shading, gradient, "
    "grayscale, background texture, scenery, multiple objects, intricate details, realistic photograph, "
    "color, frame, border, box, square card, perforated stamp edge, blurry, cheap clip art, text, logo words, "
    "branch, twig, tree, leaves, foliage, circular backdrop, circle frame, moon, crescent moon, "
    "landscape, mountains, horizon, water lines, waves, background swirls, spirals, "
    "decorative border, ornate border, vignette, radiating lines, sunburst, halo, "
    "coat of arms, crest, wreath, banner, shield, heraldic emblem, symmetrical mirrored pose, "
    "furniture, windowsill, curtain, shelf, fence post, plant pot"
)


def clean_alpha_mask(alpha_bool: np.ndarray) -> np.ndarray:
    """Erozyon ile ince bağlantıları kırar, sonra HER adayı orijinal maske
    sınırları içinde geri büyütüp GERÇEK son boyutuna göre karşılaştırır -
    'aşındırılmış haldeki boyut' yerine 'gerçek son boyut' kullanmak hem
    ince uzuvlu hayvanların (zürafa bacağı gibi) yanlışlıkla elenmesini hem
    de hayvana gerçekten kalın bağlı artıkların (mobilya, çerçeve parçası)
    kopmamasını daha güvenilir bir dengede tutuyor."""
    structure = np.ones((3, 3), dtype=bool)
    eroded = ndimage.binary_erosion(alpha_bool, iterations=2, structure=structure)
    labeled, num_features = ndimage.label(eroded, structure=structure)
    if num_features == 0:
        return alpha_bool
    if num_features == 1:
        return _geodesic_reconstruct(labeled == 1, alpha_bool, structure)

    best_mask, best_size = None, -1
    for lbl in range(1, num_features + 1):
        seed = labeled == lbl
        if seed.sum() < 30:  # gürültü boyutundaki minik parçaları atla
            continue
        grown = _geodesic_reconstruct(seed, alpha_bool, structure)
        size = int(grown.sum())
        if size > best_size:
            best_size, best_mask = size, grown
    return best_mask if best_mask is not None else alpha_bool


def _geodesic_reconstruct(seed: np.ndarray, mask: np.ndarray, structure: np.ndarray) -> np.ndarray:
    prev = seed
    for _ in range(300):
        grown = ndimage.binary_dilation(prev, structure=structure) & mask
        if np.array_equal(grown, prev):
            break
        prev = grown
    return prev


MAX_TRIES = 3


def mascot_exists(name: str) -> bool:
    return (MASCOTS_DIR / f"{name}.png").exists() or (MASCOTS_DIR / name).is_dir()


def check_generation(alpha: np.ndarray):
    """Hatalı üretimi yakalar. None = sorun yok, aksi halde sebep metni."""
    ink = alpha > 0
    coverage = ink.mean()
    if coverage < 0.01:
        return "görüntü neredeyse boş"
    if coverage > 0.55:
        return "görüntü çok dolu (beyaz zemin yok)"
    border = np.concatenate([ink[0, :], ink[-1, :], ink[:, 0], ink[:, -1]])
    if border.mean() > 0.25:
        return "hayvan/arka plan kenarlara taşıyor"
    return None


def run_sd(prompt: str, raw_path: Path, seed: int):
    """sd-cli'yi çalıştırır. (başarılı_mı, hata_metni) döner."""
    if raw_path.exists():
        raw_path.unlink()
    args = [
        SD_CLI_PATH,
        "-m", SD_MODEL_PATH,
        "--vae", SD_VAE_PATH,
        "-p", prompt,
        "-n", NEGATIVE,
        "--cfg-scale", "8.5",
        "--steps", "28",
        "-W", "1024",
        "-H", "1024",
        "-s", str(seed),
        "-o", str(raw_path),
    ]
    res = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0:
        return False, (res.stderr or res.stdout)[-400:].strip()
    if not raw_path.exists():
        return False, "sd-cli dosya oluşturmadan kapandı"
    return True, ""


def generate_and_clean_mascot(name: str, prompt: str) -> bool:
    """Üretir, beyaz zemini şeffaflaştırıp kırpar. Başarısızsa farklı seed
    ile MAX_TRIES kez dener. Başarılıysa True döner."""
    raw_path = MASCOTS_DIR / f"{name}_raw.png"
    final_path = MASCOTS_DIR / f"{name}.png"
    print(f"\n>> SDXL Maskot Üretiyor: [{name.upper()}]", flush=True)

    for attempt in range(1, MAX_TRIES + 1):
        seed = random.randint(1, 2**31 - 1)
        print(f"   deneme {attempt}/{MAX_TRIES} (seed {seed})...", flush=True)
        ok, err = run_sd(prompt, raw_path, seed)
        if not ok:
            print(f"   [HATA] {err}", flush=True)
            continue

        try:
            img = Image.open(raw_path).convert("RGB")
        except Exception as e:
            print(f"   [HATA] görüntü açılamadı: {e}", flush=True)
            continue

        arr = np.array(img)
        luminance = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
        alpha = np.where(luminance < 180, 255, 0).astype(np.uint8)

        problem = check_generation(alpha)
        if problem:
            print(f"   [REDDEDİLDİ] {problem}, yeniden deneniyor", flush=True)
            continue

        black_ink = np.zeros((img.height, img.width, 3), dtype=np.uint8)
        black_ink[:, :] = [32, 34, 36]
        clean = Image.fromarray(np.dstack((black_ink, alpha)), mode="RGBA")

        w, h = clean.size
        clean = clean.crop((int(w * 0.04), int(h * 0.04), int(w * 0.96), int(h * 0.96)))
        bbox = clean.getbbox()
        if not bbox:
            print("   [REDDEDİLDİ] kırpınca boş kaldı, yeniden deneniyor", flush=True)
            continue
        clean = clean.crop(bbox)
        clean.save(final_path, format="PNG")
        print(f"   [KAYDEDİLDİ] {final_path}", flush=True)
        return True

    print(f"   [BAŞARISIZ] {name}: {MAX_TRIES} denemede de düzgün sonuç alınamadı.", flush=True)
    return False


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Maskot üretici")
    parser.add_argument("--only", type=str, default="",
                         help="Virgülle ayrılmış isimler - sadece bunları yeniden üret (örn: zurafa,kedi)")
    parser.add_argument("--missing", action="store_true",
                         help="Sadece henüz üretilmemiş maskotları üret")
    parser.add_argument("--list", action="store_true",
                         help="Tüm ve mevcut maskot isimlerini JSON olarak yaz, çık")
    args = parser.parse_args()

    if args.list:
        print(json.dumps({
            "all": sorted(MASCOT_PROMPTS.keys()),
            "available": sorted(k for k in MASCOT_PROMPTS if mascot_exists(k)),
        }, ensure_ascii=False))
        return

    missing_files = [p for p in (SD_CLI_PATH, SD_MODEL_PATH, SD_VAE_PATH) if not Path(p).exists()]
    if missing_files:
        print("HATA: şu dosyalar bulunamadı:\n  " + "\n  ".join(missing_files))
        print(f"stable-diffusion.cpp ve SDXL model/VAE dosyalarını {SD_DIR} içine koy (ya da KITAP_SD_DIR ile klasörü göster).")
        sys.exit(1)

    targets = MASCOT_PROMPTS
    if args.only:
        wanted = {n.strip() for n in args.only.split(",") if n.strip()}
        unknown = wanted - set(MASCOT_PROMPTS.keys())
        if unknown:
            print(f"UYARI: tanınmayan isim(ler), atlanıyor: {unknown}")
        targets = {k: v for k, v in MASCOT_PROMPTS.items() if k in wanted}
        if not targets:
            print("HATA: --only içindeki isimlerin hiçbiri tanınmıyor.")
            sys.exit(1)
    if args.missing:
        targets = {k: v for k, v in targets.items() if not mascot_exists(k)}
        if not targets:
            print("Eksik maskot yok, hepsi zaten üretilmiş.")
            return

    print(f"Üretilecek: {', '.join(targets)}", flush=True)
    failed = [name for name, prompt in targets.items() if not generate_and_clean_mascot(name, prompt)]

    print(f"\nToplam {len(targets) - len(failed)}/{len(targets)} maskot üretildi.")
    if failed:
        print(f"Başarısız: {', '.join(failed)} - tekrar çalıştırınca sadece bunlar denenir.")
        sys.exit(1)


if __name__ == "__main__":
    main()