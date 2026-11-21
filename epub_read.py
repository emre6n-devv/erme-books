# -*- coding: utf-8 -*-
"""
epub_read.py - Uygulama içi okuyucu için bir EPUB'u açar ve güvenli, okunabilir parçalara ayırır.

Kullanım (Electron arayüzü çağırır):
    py epub_read.py kitap.epub
Çıktı (JSON, stdout):
    {title, author, language, css, toc: [{title, spine, frag, level}], spine: [{href, html}]}
  - html: her bölümün <body> içeriği; betikler, iframe/form/olay öznitelikleri ayıklanır,
    resimler data: URL'ye gömülür, iç bağlantılar data-href olur (okuyucu kendi yönetir).
  - css: kitabın kendi stil dosyaları birleştirilmiş halde (@font-face/@import çıkarılır;
    ERME BOOKS yazı tipleri uygulamada zaten yüklüdür).
Ek kütüphane gerekmez: zipfile + lxml (ebooklib ile birlikte kurulur).
"""

import base64
import json
import mimetypes
import posixpath
import re
import sys
import zipfile
from urllib.parse import unquote, urldefrag

from lxml import etree, html as lhtml

DROP_TAGS = {"script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "link", "meta", "style", "base", "audio", "video", "noscript"}
MAX_IMG = 6 * 1024 * 1024


def local(tag) -> str:
    return tag.rsplit("}", 1)[-1].lower() if isinstance(tag, str) else ""


def text_of(el) -> str:
    return re.sub(r"\s+", " ", "".join(el.itertext())).strip()


def resolve(base: str, href: str) -> str:
    return posixpath.normpath(posixpath.join(posixpath.dirname(base), unquote(href))).lstrip("/")


def data_url(z, name: str) -> str:
    try:
        info = z.getinfo(name)
    except KeyError:
        return ""
    if info.file_size > MAX_IMG:
        return ""
    mt = mimetypes.guess_type(name)[0] or "image/jpeg"
    return f"data:{mt};base64,{base64.b64encode(z.read(name)).decode()}"


def clean_css(css: str) -> str:
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r"@font-face\s*{[^}]*}", "", css)
    css = re.sub(r"@import[^;]*;", "", css)
    css = re.sub(r"url\([^)]*\)", "none", css)   # dış kaynak yok
    return css


def parse_doc(raw: bytes):
    try:
        return etree.fromstring(raw, etree.XMLParser(recover=True, resolve_entities=False, no_network=True))
    except etree.XMLSyntaxError:
        return lhtml.fromstring(raw)


def body_html(z, name: str, href_to_spine: dict) -> tuple:
    root = parse_doc(z.read(name))
    css_links = []
    styles = []
    for el in root.iter():
        t = local(el.tag)
        if t == "link" and "stylesheet" in (el.get("rel") or "") and el.get("href"):
            css_links.append(resolve(name, el.get("href")))
        elif t == "style" and el.text:
            styles.append(el.text)
    body = next((el for el in root.iter() if local(el.tag) == "body"), root)
    # ad alanlarını at: HTML olarak serileştirilecek
    for el in body.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.rsplit("}", 1)[-1]
        for k in list(el.attrib):
            lk = k.rsplit("}", 1)[-1]
            if "}" in k:
                v = el.attrib.pop(k)
                if lk in ("href", "lang", "type"):
                    el.set("data-" + lk if lk == "type" else lk, v)
    for el in list(body.iter()):
        if not isinstance(el.tag, str):   # yorum / işlem talimatı
            if el.getparent() is not None:
                el.getparent().remove(el)
            continue
        t = el.tag.lower()
        if t in DROP_TAGS and el is not body:
            p = el.getparent()
            if p is not None:
                tail = el.tail
                p.remove(el)
                if tail:
                    prev = p[-1] if len(p) else None
                    if prev is not None:
                        prev.tail = (prev.tail or "") + tail
                    else:
                        p.text = (p.text or "") + tail
            continue
        for k in list(el.attrib):
            if k.lower().startswith("on"):
                del el.attrib[k]
        if t == "img" and el.get("src"):
            el.set("src", data_url(z, resolve(name, el.get("src"))))
        if t == "image" and el.get("href"):   # svg içindeki görsel
            el.set("href", data_url(z, resolve(name, el.get("href"))))
        if t == "a" and el.get("href") is not None:
            h = el.attrib.pop("href")
            if re.match(r"^[a-z]+:", h, re.I):
                if h.lower().startswith(("http:", "https:", "mailto:")):
                    el.set("data-ext", h)
            else:
                path, frag = urldefrag(h)
                target = resolve(name, path) if path else name
                if target in href_to_spine:
                    el.set("data-href", f"{href_to_spine[target]}#{frag}")
    body.tag = "div"
    body.attrib.pop("xmlns", None)
    out = etree.tostring(body, method="html", encoding="unicode")
    out = re.sub(r'\sxmlns(:\w+)?="[^"]*"', "", out)
    return out, css_links, styles


def nav_toc(z, nav_name: str, href_to_spine: dict) -> list:
    root = parse_doc(z.read(nav_name))
    navs = [el for el in root.iter() if local(el.tag) == "nav"]
    nav = next((n for n in navs if "toc" in " ".join(v for k, v in n.attrib.items() if k.endswith("type"))), navs[0] if navs else None)
    out = []

    def walk(ol, level):
        for li in ol:
            if local(li.tag) != "li":
                continue
            a = next((c for c in li if local(c.tag) in ("a", "span")), None)
            if a is not None:
                href = a.get("href") or ""
                path, frag = urldefrag(href)
                tgt = resolve(nav_name, path) if path else ""
                if tgt in href_to_spine:
                    out.append({"title": text_of(a), "spine": href_to_spine[tgt], "frag": frag, "level": level})
            for sub in li:
                if local(sub.tag) == "ol":
                    walk(sub, level + 1)

    if nav is not None:
        ol = next((c for c in nav.iter() if local(c.tag) == "ol"), None)
        if ol is not None:
            walk(ol, 1)
    return out


def ncx_toc(z, ncx_name: str, href_to_spine: dict) -> list:
    root = parse_doc(z.read(ncx_name))
    out = []

    def walk(el, level):
        for np in el:
            if local(np.tag) != "navpoint":
                continue
            lab = next((c for c in np.iter() if local(c.tag) == "text"), None)
            con = next((c for c in np if local(c.tag) == "content"), None)
            if con is not None:
                path, frag = urldefrag(con.get("src") or "")
                tgt = resolve(ncx_name, path)
                if tgt in href_to_spine:
                    out.append({"title": text_of(lab) if lab is not None else "", "spine": href_to_spine[tgt], "frag": frag, "level": level})
            walk(np, level + 1)

    navmap = next((c for c in root.iter() if local(c.tag) == "navmap"), None)
    if navmap is not None:
        walk(navmap, 1)
    return out


def read(path: str) -> dict:
    z = zipfile.ZipFile(path)
    cont = etree.fromstring(z.read("META-INF/container.xml"))
    opf_name = next(el.get("full-path") for el in cont.iter() if local(el.tag) == "rootfile")
    opf = etree.fromstring(z.read(opf_name))
    meta = lambda n: next((text_of(el) for el in opf.iter() if local(el.tag) == n and text_of(el)), "")
    manifest = {}
    nav_name = ncx_name = None
    for el in opf.iter():
        if local(el.tag) == "item" and el.get("href"):
            full = resolve(opf_name, el.get("href"))
            manifest[el.get("id")] = (full, el.get("media-type") or "")
            if "nav" in (el.get("properties") or "").split():
                nav_name = full
            if (el.get("media-type") or "") == "application/x-dtbncx+xml":
                ncx_name = full
    spine_ids = [el.get("idref") for el in opf.iter() if local(el.tag) == "itemref" and el.get("linear", "yes") != "no"]
    spine_files = [manifest[i][0] for i in spine_ids if i in manifest and "html" in manifest[i][1]]
    href_to_spine = {f: k for k, f in enumerate(spine_files)}

    spine, css_files, inline_css = [], [], []
    for f in spine_files:
        try:
            body, links, styles = body_html(z, f, href_to_spine)
        except (KeyError, etree.XMLSyntaxError, ValueError):
            body, links, styles = "<div></div>", [], []
        spine.append({"href": f, "html": body})
        for c in links:
            if c not in css_files:
                css_files.append(c)
        inline_css.extend(styles)
    css = "\n".join(clean_css(z.read(c).decode("utf-8", "replace")) for c in css_files if c in z.namelist())
    css += "\n" + "\n".join(clean_css(s) for s in inline_css)

    toc = []
    try:
        if nav_name:
            toc = nav_toc(z, nav_name, href_to_spine)
        if not toc and ncx_name:
            toc = ncx_toc(z, ncx_name, href_to_spine)
    except (KeyError, etree.XMLSyntaxError, StopIteration):
        toc = []
    return {"title": meta("title"), "author": meta("creator"), "language": meta("language"), "css": css, "toc": toc, "spine": spine}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        print(json.dumps(read(sys.argv[1]), ensure_ascii=False))
    except Exception as e:  # okuyucu arayüzü bu mesajı gösterir
        print(json.dumps({"error": f"EPUB okunamadı: {e}"}, ensure_ascii=False))
