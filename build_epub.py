# -*- coding: utf-8 -*-
"""
build_epub.py - detect_structure.py'nin ürettiği *_yapi.json'u (bölüm ağacı + şablon) ve
*_editor.md metnini kullanarak, kapakla birlikte ERME BOOKS imza dizgisiyle bir EPUB derler.

Dizgi şablonları assets/epub/templates/ altında (klasik, modern, genis); yazı tipleri
assets/epub/fonts/ altından EPUB'a gömülür (Lora gövde, Crimson Text / Montserrat başlık; OFL).
  - Kısım (seviye 1): kendi sayfasında, ortada
  - Bölüm ve ön bölümler (seviye 2): yeni sayfadan, geniş üst boşluk, başlık altında süs
  - Alt bölüm (seviye 3): aynı sayfada, bölüm dosyasının içinde (içindekilerde iç içe)
  - Bölümün ilk paragrafı: büyük ilk harf (Klasik) / girintisiz; diğerleri 1.5em girinti, iki yana yaslı, tireli
  - "* * *" vb. satırlar sahne geçişi ayracına dönüşür
İçindekiler (nav.xhtml + toc.ncx) bölüm ağacıyla iç içe üretilir.

Kullanım:
    python build_epub.py --book dostoyevski
    python build_epub.py --book dostoyevski --template modern
    python build_epub.py --book dostoyevski --editor-md ... --yapi ... --cover output/dostoyevski/kapak.jpg
"""

import argparse
import json
import re
import sys
import uuid
import zipfile
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

from ebooklib import epub

from erme_structure import is_scene_break, label_for, noise_set, sections, toc_from_structure

BASE = Path(__file__).resolve().parent
ASSETS = BASE / "assets" / "epub"
TEMPLATES = {"klasik": "ERME BOOKS Klasik", "modern": "Modern Minimal", "genis": "Geniş Punto"}
FONT_FILES = {
    "klasik": ["Lora-Regular.ttf", "Lora-Bold.ttf", "Lora-Italic.ttf", "Lora-BoldItalic.ttf", "CrimsonText-Regular.ttf", "CrimsonText-Italic.ttf", "CrimsonText-SemiBold.ttf"],
    "modern": ["Lora-Regular.ttf", "Lora-Bold.ttf", "Lora-Italic.ttf", "Lora-BoldItalic.ttf", "Montserrat-Medium.ttf", "Montserrat-SemiBold.ttf"],
    "genis": ["Lora-Regular.ttf", "Lora-Bold.ttf", "Lora-Italic.ttf", "Lora-BoldItalic.ttf", "CrimsonText-Regular.ttf", "CrimsonText-Italic.ttf", "CrimsonText-SemiBold.ttf"],
}
FALLBACK_CSS = """body { font-family: Georgia, serif; line-height: 1.65; margin: 0 5%; }
p { margin: 0; text-indent: 1.5em; text-align: justify; } p.first, p.no-indent { text-indent: 0; }
.chapter { page-break-before: always; } .chapter-head { margin: 20% 0 2em; text-align: center; }
h2.chapter-title, h1.part-title { font-weight: normal; letter-spacing: .06em; } .orn { text-align: center; }
p.scene { text-align: center; text-indent: 0; margin: 1em 0; } .titlepage { text-align: center; }"""


def escape_xhtml(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def inline(text: str) -> str:
    """Paragraf metni: kaçış + markdown italik/kalın + satır içi kırılmalar boşluk olur."""
    t = escape_xhtml(re.sub(r"\s*\n\s*", " ", text.strip()))
    t = re.sub(r"^#{1,6}\s+", "", t)
    t = re.sub(r"\*\*(?=\S)(.+?)(?<=\S)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"(?<![\*\w])\*(?=\S)([^*]+?)(?<=\S)\*(?![\*\w])", r"<em>\1</em>", t)
    t = re.sub(r"(?<![_\w])_(?=\S)([^_]+?)(?<=\S)_(?![_\w])", r"<em>\1</em>", t)
    return t


NOISE = set()   # sayfa başlığı/numarası gürültüsü (build_epub içinde doldurulur)


def body_xhtml(paras, first_cls="first") -> str:
    """Paragraflar: başlıktan sonraki ilki büyük harfli/girintisiz, sahne ayracından sonraki girintisiz."""
    out, nxt = [], first_cls
    for p in paras:
        s = p.strip()
        if not s or s.casefold() in NOISE:
            continue
        if is_scene_break(s):
            out.append('<p class="scene">*&#160;*&#160;*</p>')
            nxt = "no-indent"
            continue
        cls = f' class="{nxt}"' if nxt else ""
        out.append(f"<p{cls}>{inline(s)}</p>")
        nxt = None
    return "\n".join(out)


def head_xhtml(it: dict, anchor: str = "") -> str:
    label, title = label_for(it)
    aid = f' id="{anchor}"' if anchor else ""
    if it["kind"] == "part":
        lab = f'<p class="label">{escape_xhtml(label)}</p>' if label else ""
        return f'<div class="part">{lab}<h1 class="part-title"{aid}>{escape_xhtml(title)}</h1><p class="orn">❧</p></div>'
    if it["level"] >= 3:
        return f'<h3 class="section-title"{aid}>{escape_xhtml(title)}</h3>'
    lab = f'<p class="label">{escape_xhtml(label)}</p>' if label else ""
    return f'<div class="chapter-head">{lab}<h2 class="chapter-title"{aid}>{escape_xhtml(title)}</h2><p class="orn">❧</p></div>'


def page(body: str, cls: str = "") -> str:
    return f'<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="tr" lang="tr"><head><link rel="stylesheet" type="text/css" href="style/erme.css"/></head><body><section class="{cls}">{body}</section></body></html>'


def build_epub(book_slug: str, editor_md: Path, yapi_json: Path, cover_path: Path, output_dir: Path, template: str = ""):
    if not editor_md.exists():
        print(f"HATA: {editor_md} bulunamadı.")
        sys.exit(1)
    structure = {}
    if yapi_json.exists():
        structure = json.loads(yapi_json.read_text(encoding="utf-8"))
    else:
        print(f"  [UYARI] {yapi_json} yok - bölümsüz, tek parça derleniyor.")
    title = structure.get("title") or book_slug.replace("_", " ").title()
    author = structure.get("author") or "Bilinmeyen Yazar"
    template = template or structure.get("template") or "klasik"
    if template not in TEMPLATES:
        template = "klasik"

    paragraphs = editor_md.read_text(encoding="utf-8").split("\n\n")
    toc = toc_from_structure(structure)
    NOISE.clear()
    NOISE.update(noise_set(paragraphs, title, author))
    if NOISE:
        print(f"  Sayfa başlığı/numarası gürültüsü ayıklandı: {', '.join(sorted(NOISE)[:6])}{' …' if len(NOISE) > 6 else ''}")
    opening, secs = sections(toc, paragraphs)

    # kapak adımında onaylanan tema: arka kapak özeti ve tür
    theme = {}
    theme_path = cover_path.parent / "kapak_tema.json"
    if theme_path.exists():
        try:
            theme = json.loads(theme_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            theme = {}
    spec = theme.get("spec") or {}
    description = (spec.get("blurb") or (theme.get("edit") or {}).get("ozet") or (theme.get("theme") or {}).get("ozet") or structure.get("description") or "").strip()
    genre = ((theme.get("theme") or {}).get("tur") or "").strip()

    book = epub.EpubBook()
    # kalıcı kimlik: aynı kitap her derlemede aynı UUID'yi alır (okuyucular okuma konumunu korur)
    isbn = re.sub(r"[^0-9Xx]", "", str(structure.get("isbn") or ""))
    book_uuid = uuid.uuid5(uuid.NAMESPACE_URL, f"ermebooks:{book_slug}:{title}:{author}")
    book.set_identifier(f"urn:uuid:{book_uuid}")
    if len(isbn) in (10, 13):
        book.add_metadata("DC", "identifier", f"urn:isbn:{isbn}", {"id": "isbn"})
    book.set_title(title)
    book.set_language("tr")
    book.add_author(author)
    book.add_metadata("DC", "publisher", "ERME BOOKS")
    book.add_metadata("DC", "date", date.today().isoformat())
    if description:
        book.add_metadata("DC", "description", description)
    if genre:
        book.add_metadata("DC", "subject", genre)

    if cover_path.exists():
        book.set_cover("cover.jpg", cover_path.read_bytes())
    else:
        print(f"  [UYARI] Kapak dosyası bulunamadı ({cover_path}) - kapaksız devam ediliyor.")

    # şablon CSS'i ve gömülü yazı tipleri
    css_path = ASSETS / "templates" / f"{template}.css"
    css = css_path.read_text(encoding="utf-8") if css_path.exists() else FALLBACK_CSS
    css_item = epub.EpubItem(uid="style", file_name="style/erme.css", media_type="text/css", content=css)
    book.add_item(css_item)
    fonts = 0
    for k, fn in enumerate(FONT_FILES[template]):
        fp = ASSETS / "fonts" / fn
        if fp.exists():
            book.add_item(epub.EpubItem(uid=f"font{k}", file_name=f"fonts/{fn}", media_type="application/vnd.ms-opentype", content=fp.read_bytes()))
            fonts += 1
    if not fonts:
        print("  [UYARI] assets/epub/fonts bulunamadı - yazı tipleri gömülmedi, okuyucunun yazı tipi kullanılacak.")

    def html(name, ttl, body, cls=""):
        it = epub.EpubHtml(title=ttl, file_name=name, lang="tr")
        it.content = page(body, cls)
        it.add_item(css_item)
        book.add_item(it)
        return it

    titlepage = html("titlepage.xhtml", "Başlık", f"""<div class="titlepage"><h1>{escape_xhtml(title)}</h1>
        <p class="orn">❧</p><p class="author">{escape_xhtml(author)}</p><p class="imprint">ERME BOOKS</p></div>""")
    spine_docs = [titlepage]

    # açılış: ilk başlıktan önceki metin (varsa) başlıksız bir sayfa
    if any(p.strip() and p.strip().casefold() not in NOISE for p in opening):
        spine_docs.append(html("opening.xhtml", title, body_xhtml(opening, first_cls="first"), "chapter"))

    # dosyalar: her kısım / bölüm yeni dosya; alt bölümler önceki bölüm dosyasının içinde
    files = []          # [(EpubHtml, it)]
    cur = None          # açık bölüm: {"name", "title", "body": [...], "it", "subs": [(anchor, it)]}
    nfile = 0

    def flush():
        nonlocal cur
        if cur:
            cls = "chapter front" if cur["it"]["kind"] == "front" else "chapter"
            doc = html(cur["name"], cur["title"], "\n".join(cur["body"]), cls)
            files.append((doc, cur["it"], cur["subs"]))
            spine_docs.append(doc)
        cur = None

    for it, paras in secs:
        if it["level"] >= 3 and cur is not None:
            anchor = f"s{len(cur['subs']) + 1}"
            cur["body"].append(head_xhtml(it, anchor))
            cur["body"].append(body_xhtml(paras, first_cls="no-indent"))   # alt bölümde büyük ilk harf yok
            cur["subs"].append((anchor, it))
            continue
        flush()
        nfile += 1
        name = f"chap_{nfile:03d}.xhtml"
        first = "first" if template == "klasik" and it["kind"] != "part" else "no-indent"
        cur = {"name": name, "title": it["title"] or f"Bölüm {nfile}", "it": it, "subs": [],
               "body": [head_xhtml(it), body_xhtml(paras, first_cls=first)]}
    flush()

    # iç içe içindekiler: kısımlar > bölümler > alt bölümler
    toc_tree, part_node = [], None
    for doc, it, subs in files:
        children = [epub.Link(f"{doc.file_name}#{a}", s["title"], f"{doc.file_name}-{a}") for a, s in subs]
        node = (epub.Section(it["title"], doc.file_name), children) if children else epub.Link(doc.file_name, it["title"], doc.file_name)
        if it["level"] == 1:
            part_node = (epub.Section(it["title"], doc.file_name), list(children))
            toc_tree.append(part_node)
        elif part_node is not None and it["kind"] != "front":
            part_node[1].append(node)
        else:
            part_node = None if it["kind"] == "front" else part_node
            toc_tree.append(node)
    book.toc = tuple(toc_tree) if toc_tree else (epub.Link("titlepage.xhtml", title, "titlepage"),)

    lic = ASSETS / "fonts" / "OFL.txt"
    if fonts and lic.exists():
        ld = epub.EpubHtml(title="Yazı tipi lisansı", file_name="fonts-license.xhtml", lang="tr")
        ld.content = page(f"<h3 class=\"section-title\">Yazı tipleri</h3><pre style=\"white-space: pre-wrap; font-size: .7em\">{escape_xhtml(lic.read_text(encoding='utf-8'))}</pre>")
        book.add_item(ld)
        spine_docs.append(ld)

    nav = epub.EpubNav()
    nav.add_item(css_item)
    book.add_item(epub.EpubNcx())
    book.add_item(nav)
    book.spine = (["cover"] if cover_path.exists() else []) + [spine_docs[0], "nav"] + spine_docs[1:]

    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / f"{book_slug}.epub"
    epub.write_epub(str(out_path), book, {"epub3_pages": False})
    print(f"\nEPUB oluşturuldu: {out_path}")
    print(f"Başlık: {title} | Yazar: {author} | Şablon: {TEMPLATES[template]} | Dosya: {len(files)} | İçindekiler girdisi: {len(toc)} | Gömülü yazı tipi: {fonts}")

    problems = validate_epub(out_path)
    if problems:
        print("\n[DOĞRULAMA HATASI]")
        for p in problems[:20]:
            print("  - " + p)
    else:
        print("Doğrulama: tüm XHTML/XML dosyaları geçerli, manifest eksiksiz.")
    words = sum(len(re.findall(r"\w+", p)) for p in paragraphs if p.strip().casefold() not in NOISE)
    summary = {
        "file": str(out_path.resolve()), "size": out_path.stat().st_size, "title": title, "author": author,
        "template": template, "templateName": TEMPLATES[template], "uuid": str(book_uuid),
        "parts": sum(1 for it in toc if it["kind"] == "part"), "chapters": sum(1 for it in toc if it["kind"] == "chapter"),
        "front": sum(1 for it in toc if it["kind"] == "front"), "sections": sum(1 for it in toc if it["level"] == 3),
        "words": words, "pagesEst": max(1, round(words / 260)), "fonts": fonts, "cover": cover_path.exists(),
        "description": bool(description), "valid": not problems,
    }
    print("OZET: " + json.dumps(summary, ensure_ascii=False))
    try:   # 5. adım ekranı bu özeti okur (uygulama yeniden açılınca da)
        summary["builtAt"] = date.today().isoformat()
        (editor_md.parent / f"{book_slug}_epub.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass
    if problems:
        sys.exit(2)


def validate_epub(path: Path) -> list:
    """Paketi açıp temel EPUB 3 kurallarını denetler: mimetype ilk ve sıkıştırmasız, container ve OPF
    okunabilir, manifestteki her dosya mevcut, tüm XHTML/XML dosyaları iyi biçimli."""
    problems = []
    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile as e:
        return [f"zip açılamadı: {e}"]
    with z:
        infos = z.infolist()
        if not infos or infos[0].filename != "mimetype" or z.read("mimetype") != b"application/epub+zip":
            problems.append("mimetype dosyası ilk sırada değil ya da hatalı")
        elif infos[0].compress_type != zipfile.ZIP_STORED:
            problems.append("mimetype sıkıştırılmış olmamalı")
        names = set(z.namelist())
        for n in names:
            if n.endswith((".xhtml", ".html", ".opf", ".ncx", ".xml")):
                try:
                    ET.fromstring(z.read(n))
                except ET.ParseError as e:
                    problems.append(f"{n}: bozuk XML ({e})")
        try:
            cont = ET.fromstring(z.read("META-INF/container.xml"))
            opf_path = next(el.get("full-path") for el in cont.iter() if el.tag.endswith("rootfile"))
            opf = ET.fromstring(z.read(opf_path))
            base = opf_path.rsplit("/", 1)[0] + "/" if "/" in opf_path else ""
            for el in opf.iter():
                if el.tag.endswith("}item") and el.get("href"):
                    href = base + el.get("href").split("#")[0]
                    if href not in names:
                        problems.append(f"manifestte olup pakette olmayan dosya: {href}")
            md = {el.tag.rsplit("}", 1)[-1] for el in opf.iter() if "purl.org/dc" in el.tag}
            for need in ("identifier", "title", "language"):
                if need not in md:
                    problems.append(f"zorunlu metadata eksik: dc:{need}")
        except (KeyError, StopIteration, ET.ParseError) as e:
            problems.append(f"container/OPF okunamadı: {e}")
    return problems


def main():
    parser = argparse.ArgumentParser(description="EPUB derleyici (ERME BOOKS dizgisi)")
    parser.add_argument("--book", type=str, required=True)
    parser.add_argument("--editor-md", type=str, default=None)
    parser.add_argument("--yapi", type=str, default=None)
    parser.add_argument("--cover", type=str, default=None)
    parser.add_argument("--template", type=str, default="", choices=["", *TEMPLATES], help="klasik | modern | genis (boşsa yapi.json'daki)")
    parser.add_argument("--output-dir", type=str, default="epubs")
    args = parser.parse_args()

    editor_md = Path(args.editor_md) if args.editor_md else Path(f"output/{args.book}/{args.book}_editor.md")
    yapi_json = Path(args.yapi) if args.yapi else Path(f"output/{args.book}/{args.book}_yapi.json")
    cover_path = Path(args.cover) if args.cover else Path(f"output/{args.book}/kapak.jpg")

    build_epub(args.book, editor_md, yapi_json, cover_path, Path(args.output_dir), args.template)


if __name__ == "__main__":
    main()
