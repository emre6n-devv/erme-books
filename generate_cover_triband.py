# -*- coding: utf-8 -*-
"""
generate_cover_triband.py - ERME Books Tri-Band Dinamik ve Poz Varyasyonlu Kapak Motoru

v2: Arka kapak + sırt + ön kapak birleşik "tam sarma" (full wrap) üretimi
eklendi - dijital raf (KOReader Bookshelf.koplugin gibi) uygulamalarında
kitabın sırt görünümü için. --full-wrap bayrağıyla etkinleşir.
v3: Renk paleti 10 hazır tona indirildi AMA artık --color ayrıca bir
'#rrggbb' hex kodu da kabul ediyor (resolve_color) - kullanıcı arayüzdeki
tam renk seçici/hex kutusundan seçtiği HERHANGİ bir rengi kullanabiliyor,
sadece 10 hazır isimle sınırlı değil.
"""

import argparse
import json
import math
import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

WIDTH = 1600
HEIGHT = 2560

PENGUIN_COLORS = {
    "turuncu": (245, 102, 45),    # Roman / Kurgu
    "yesil": (46, 125, 80),       # Polisiye / Suç
    "lacivert": (24, 58, 102),    # Klasik / Biyografi
    "kirmizi": (196, 38, 46),     # Dram / Trajedi
    "bordo": (139, 32, 40),       # Gerilim / Aksiyon
    "mor": (108, 58, 120),        # Şiir / Felsefe
    "petrol": (24, 84, 92),       # Doğa / Deneme
    "hardal": (196, 144, 38),     # Mizah / Hiciv
    "pembe": (196, 74, 110),      # Aşk / Romantizm
    "antrasit": (58, 62, 68),     # Bilim / Teknoloji
}


def resolve_color(color_arg: str) -> tuple:
    """Ya bir hazır renk ismi ('turuncu' gibi) ya da '#a1b2c3' formatında
    bir hex kod kabul eder - kullanıcı Tkinter renk seçicisinden ya da hex
    kutusundan seçtiği ÖZGÜN rengi de kullanabilsin diye."""
    if color_arg.startswith("#"):
        hex_str = color_arg.lstrip("#")
        if len(hex_str) == 6:
            try:
                return tuple(int(hex_str[i:i + 2], 16) for i in (0, 2, 4))
            except ValueError:
                pass
        return PENGUIN_COLORS["turuncu"]
    return PENGUIN_COLORS.get(color_arg.lower(), PENGUIN_COLORS["turuncu"])


# Tüm hayvanlar için TEK, sabit marka adı - hayvan seçimi artık sadece
# görsel bir tercih, marka/yayınevi ismini değiştirmiyor.
BRAND_LABEL = "ERME\nBOOKS"

CREAM_BG = (250, 246, 236)
TEXT_COLOR = (32, 34, 36)
MASCOTS_DIR = Path("assets/mascots")


def get_font(size: int, bold: bool = False):
    font_names = [
        "GillSans-Bold.ttf" if bold else "GillSans.ttf",
        "trebucbd.ttf" if bold else "trebuc.ttf",
        "arialbd.ttf" if bold else "arial.ttf",
    ]
    for name in font_names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_cartouche(draw: ImageDraw.Draw, center_x: int, center_y: int, width: int, height: int, fill_color: tuple, outline_color: tuple):
    """Simetrik, yuvarlak/dolgun bir mühür şekli - Penguin'in kendi tescilli
    4-loblu 'kemik' oranından (cos(4*rad)) kasıtlı olarak farklı bir ailede
    (cos(2*rad), 2-loblu) - düzenli/simetrik ama görsel olarak ayırt
    edilebilir bir siluet."""
    hw, hh = width / 2, height / 2
    points = []
    for deg in range(360):
        rad = math.radians(deg)
        r = 1.0 - 0.10 * math.cos(2 * rad)
        x = center_x + hw * r * math.cos(rad)
        y = center_y + hh * r * math.sin(rad)
        points.append((x, y))
    draw.polygon(points, fill=fill_color, outline=outline_color)

    inner_points = []
    for deg in range(360):
        rad = math.radians(deg)
        r = 0.90 - 0.08 * math.cos(2 * rad)
        x = center_x + hw * r * math.cos(rad)
        y = center_y + hh * r * math.sin(rad)
        inner_points.append((x, y))
    draw.line(inner_points + [inner_points[0]], fill=outline_color, width=1)


def get_available_mascots() -> list[str]:
    """assets/mascots dizinindeki ana hayvan gruplarını listeler."""
    if not MASCOTS_DIR.exists():
        return ["penguin"]
    subdirs = [d.name for d in MASCOTS_DIR.iterdir() if d.is_dir()]
    files = [f.stem for f in MASCOTS_DIR.glob("*.png") if not f.stem.endswith("_raw")]
    return sorted(list(set(subdirs + files)))


def recolor_mascot(mascot: Image.Image, fill_color: tuple) -> Image.Image:
    """Mevcut alfa (şeffaflık) kanalını olduğu gibi korur, ama iç dolguyu
    istenen renge boyar - böylece aynı kaynak PNG hangi bant rengine
    yapıştırılırsa yapıştırılsın her zaman yüksek kontrastla, net okunur."""
    mascot = mascot.convert("RGBA")
    alpha = mascot.split()[3]
    solid = Image.new("RGBA", mascot.size, (*fill_color, 255))
    solid.putalpha(alpha)
    return solid


def stamp_mascot(cover: Image.Image, animal_name: str, seed_text: str, center_x: int, center_y: int, target_height: int = 185):
    """
    Seçilen hayvanın varsa farklı poz varyasyonlarından (klasör içi) kitabın adına göre
    deterministik veya rastgele farklı bir tanesini seçer. Böylece aynı hayvan bile her seferinde farklı görünür.
    Ayrıca hayvan, her zaman krem/açık renkte (CREAM_BG) yeniden boyanır - hangi bant
    rengi seçilirse seçilsin yüksek kontrastla net okunur kalır.
    """
    target_dir = MASCOTS_DIR / animal_name
    mascot_file = None

    if target_dir.is_dir():
        poses = sorted(list(target_dir.glob("*.png")))
        if poses:
            idx = abs(hash(seed_text)) % len(poses)
            mascot_file = poses[idx]

    if not mascot_file or not mascot_file.exists():
        single_file = MASCOTS_DIR / f"{animal_name}.png"
        if single_file.exists():
            mascot_file = single_file

    if mascot_file and mascot_file.exists():
        mascot = Image.open(mascot_file).convert("RGBA")
        mascot = recolor_mascot(mascot, CREAM_BG)
        ratio = target_height / mascot.height
        new_size = (int(mascot.width * ratio), target_height)
        mascot = mascot.resize(new_size, Image.LANCZOS)

        pos_x = center_x - (mascot.width // 2)
        pos_y = center_y - (mascot.height // 2)
        cover.paste(mascot, (pos_x, pos_y), mascot)
    else:
        draw = ImageDraw.Draw(cover)
        draw.ellipse([center_x - 30, center_y - 45, center_x + 30, center_y + 45], fill=CREAM_BG)


def draw_vertical_text(img: Image.Image, text: str, font, color: tuple, center_x: int, center_y: int):
    """Metni 90 derece döndürerek dikey olarak (sırt için) çizer - ayrı bir
    şeffaf katmanda yazıp döndürdükten sonra ana görsele yapıştırıyoruz,
    Pillow'un doğrudan döndürülmüş metin çizme desteği olmadığı için."""
    tmp = Image.new("RGBA", (800, 120), (0, 0, 0, 0))
    tdraw = ImageDraw.Draw(tmp)
    w = tdraw.textlength(text, font=font)
    tdraw.text(((800 - w) / 2, 10), text, font=font, fill=color)
    rotated = tmp.rotate(90, expand=True, resample=Image.BICUBIC)
    px = int(center_x - rotated.width / 2)
    py = int(center_y - rotated.height / 2)
    img.paste(rotated, (px, py), rotated)


def estimate_spine_width(editor_md_path: Path = None, min_w: int = 90, max_w: int = 220) -> int:
    """Sırt genişliğini kitabın kelime sayısına göre KABACA orantılar -
    fiziksel baskı hassasiyeti gerekmiyor (dijital raf için), sadece uzun
    kitapların rafta biraz daha 'kalın' durması için görsel bir ipucu."""
    if not editor_md_path or not editor_md_path.exists():
        return 140
    word_count = len(editor_md_path.read_text(encoding="utf-8").split())
    scaled = int(90 + (word_count / 150000) * (max_w - min_w))
    return max(min_w, min(max_w, scaled))


def generate_spine(title: str, author: str, genre_color: str, animal: str, spine_width: int) -> Image.Image:
    band_color = resolve_color(genre_color)
    spine = Image.new("RGB", (spine_width, HEIGHT), band_color)
    draw = ImageDraw.Draw(spine)

    title_font = get_font(46, bold=True)
    draw_vertical_text(spine, title.upper(), title_font, CREAM_BG, spine_width // 2, HEIGHT // 2 - 40)

    author_font = get_font(30, bold=True)
    draw_vertical_text(spine, author.upper(), author_font, CREAM_BG, spine_width // 2, HEIGHT // 2 + 140)

    small_brand_font = get_font(22, bold=True)
    bw = draw.textlength("ERME", font=small_brand_font)
    draw.text(((spine_width - bw) / 2, 40), "ERME", fill=CREAM_BG, font=small_brand_font)

    stamp_mascot(spine, animal.lower(), title + author + "_spine", spine_width // 2, HEIGHT - 90, target_height=70)

    return spine


def generate_back_cover(genre_color: str, animal: str) -> Image.Image:
    band_color = resolve_color(genre_color)
    back = Image.new("RGB", (WIDTH, HEIGHT), CREAM_BG)
    draw = ImageDraw.Draw(back)

    top_band_h = int(HEIGHT * 0.285)
    bot_band_y = int(HEIGHT * 0.715)
    draw.rectangle([0, 0, WIDTH, top_band_h], fill=band_color)
    draw.rectangle([0, bot_band_y, WIDTH, HEIGHT], fill=band_color)

    mid_center_y = (top_band_h + bot_band_y) // 2
    stamp_mascot(back, animal.lower(), "back_cover", WIDTH // 2, mid_center_y, target_height=260)

    return back


def _draw_front_cover_onto(cover: Image.Image, title: str, author: str, genre_color: str, animal: str):
    draw = ImageDraw.Draw(cover)
    band_color = resolve_color(genre_color)

    top_band_h = int(HEIGHT * 0.285)
    bot_band_y = int(HEIGHT * 0.715)

    draw.rectangle([0, 0, WIDTH, top_band_h], fill=band_color)
    draw.rectangle([0, bot_band_y, WIDTH, HEIGHT], fill=band_color)

    cart_w, cart_h = 580, 320
    cart_y = int(top_band_h * 0.52)
    draw_cartouche(draw, WIDTH // 2, cart_y, cart_w, cart_h, fill_color=CREAM_BG, outline_color=(25, 25, 25))

    header_text = BRAND_LABEL
    pub_font = get_font(48, bold=True)
    lines = header_text.split("\n")
    w1 = draw.textlength(lines[0], font=pub_font)
    w2 = draw.textlength(lines[1], font=pub_font)
    draw.text(((WIDTH - w1) / 2, cart_y - 55), lines[0], fill=TEXT_COLOR, font=pub_font)
    draw.text(((WIDTH - w2) / 2, cart_y + 10), lines[1], fill=TEXT_COLOR, font=pub_font)

    mid_center_y = (top_band_h + bot_band_y) // 2

    title_font = get_font(105, bold=True)
    title_clean = title.upper()
    title_w = draw.textlength(title_clean, font=title_font)

    if title_w > (WIDTH - 240):
        words = title_clean.split()
        mid = len(words) // 2
        line1, line2 = " ".join(words[:mid]), " ".join(words[mid:])
        w1, w2 = draw.textlength(line1, font=title_font), draw.textlength(line2, font=title_font)
        draw.text(((WIDTH - w1) / 2, mid_center_y - 170), line1, fill=TEXT_COLOR, font=title_font)
        draw.text(((WIDTH - w2) / 2, mid_center_y - 45), line2, fill=TEXT_COLOR, font=title_font)
    else:
        draw.text(((WIDTH - title_w) / 2, mid_center_y - 110), title_clean, fill=TEXT_COLOR, font=title_font)

    sep_w = 160
    draw.line([(WIDTH // 2 - sep_w // 2, mid_center_y + 45), (WIDTH // 2 + sep_w // 2, mid_center_y + 45)], fill=band_color, width=4)

    author_font = get_font(56, bold=True)
    author_clean = author.upper()
    author_w = draw.textlength(author_clean, font=author_font)
    draw.text(((WIDTH - author_w) / 2, mid_center_y + 90), author_clean, fill=TEXT_COLOR, font=author_font)

    bot_center_y = (bot_band_y + HEIGHT) // 2
    stamp_mascot(cover, animal.lower(), title + author, WIDTH // 2, bot_center_y, target_height=190)


def generate_single_cover(title: str, author: str, genre_color: str, animal: str, output_path: Path):
    cover = Image.new("RGB", (WIDTH, HEIGHT), CREAM_BG)
    _draw_front_cover_onto(cover, title, author, genre_color, animal)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    cover.save(output_path, quality=95)
    print(f"  Kapak hazırlandı [{animal.upper()}]: {output_path}")


def generate_full_wrap(title: str, author: str, genre_color: str, animal: str, output_path: Path, editor_md_path: Path = None):
    """Arka kapak | sırt | ön kapak sırasında BİRLEŞİK tek bir 'sarma'
    görseli üretir - dijital raf (KOReader Bookshelf.koplugin gibi)
    uygulamalarında kitabın sırt görünümü için kullanılacak."""
    spine_width = estimate_spine_width(editor_md_path)

    front = Image.new("RGB", (WIDTH, HEIGHT), CREAM_BG)
    _draw_front_cover_onto(front, title, author, genre_color, animal)

    back = generate_back_cover(genre_color, animal)
    spine = generate_spine(title, author, genre_color, animal, spine_width)

    total_width = WIDTH + spine_width + WIDTH
    wrap = Image.new("RGB", (total_width, HEIGHT), CREAM_BG)
    wrap.paste(back, (0, 0))
    wrap.paste(spine, (WIDTH, 0))
    wrap.paste(front, (WIDTH + spine_width, 0))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    wrap.save(output_path, quality=95)
    print(f"  Tam sarma (arka+sırt+ön) kaydedildi: {output_path}")

    front_path = output_path.parent / f"{output_path.stem}_on.jpg"
    front.save(front_path, quality=95)
    return front_path


def main():
    available = get_available_mascots()

    parser = argparse.ArgumentParser(description="ERME Books Tri-Band Poz Varyasyonlu Kapak Motoru")
    parser.add_argument("--title", type=str, required=True)
    parser.add_argument("--author", type=str, required=True)
    parser.add_argument("--color", type=str, default="turuncu", help="Hazır renk ismi ya da #rrggbb hex kod")
    parser.add_argument("--animal", type=str, default="penguin", help=f"Hayvan grubu: {', '.join(available)}")
    parser.add_argument("--output", type=str, default="output/kapak.jpg")
    parser.add_argument("--preview-all", action="store_true", help="Tüm hayvanlar ve poz varyantlarıyla kütüphane önizlemesi üretir")
    parser.add_argument("--full-wrap", action="store_true", help="Arka+sırt+ön birleşik sarma görseli üret")
    parser.add_argument("--editor-md", type=str, default="", help="Sırt kalınlığını tahmin etmek için kitabın _editor.md dosyası (opsiyonel)")
    args = parser.parse_args()

    out_path = Path(args.output)

    if args.preview_all:
        out_dir = out_path.parent / "triband_varyasyonlar"
        out_dir.mkdir(parents=True, exist_ok=True)
        manifest = []

        print(f">> Maskotlar ve poz varyasyonları taranıyor...")
        for animal_name in available:
            target_dir = MASCOTS_DIR / animal_name
            if target_dir.is_dir():
                poses = sorted(list(target_dir.glob("*.png")))
                for pose_file in poses:
                    pose_name = f"{animal_name}_{pose_file.stem}"
                    file_dest = out_dir / f"kapak_{pose_name}.jpg"
                    generate_single_cover(args.title, args.author, args.color, animal_name, file_dest)
                    manifest.append({"hayvan": pose_name, "dosya": str(file_dest)})
            else:
                file_dest = out_dir / f"kapak_{animal_name}.jpg"
                generate_single_cover(args.title, args.author, args.color, animal_name, file_dest)
                manifest.append({"hayvan": animal_name, "dosya": str(file_dest)})

        with open(out_dir / "varyasyonlar_manifest.json", "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        print(f"\nTüm varyantlar ve manifest oluşturuldu: {out_dir}")

    elif args.full_wrap:
        editor_md_path = Path(args.editor_md) if args.editor_md else None
        generate_full_wrap(args.title, args.author, args.color, args.animal, out_path, editor_md_path)

    else:
        generate_single_cover(args.title, args.author, args.color, args.animal, out_path)


if __name__ == "__main__":
    main()