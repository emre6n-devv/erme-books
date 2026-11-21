# -*- coding: utf-8 -*-
"""
ensemble.py - Çift model OCR: ikinci bir vision modeliyle kitabı yeniden okur,
iki okumayı kelime kelime karşılaştırıp daha doğru olanı seçer.

NEDEN: Kafamda Bir Tuhaflık testinde qwen2.5vl:7b'nin yanlış okuduğu 41
kelimenin sadece 5'inde gemma3:12b de yanıldı. İki model farklı hatalar
yapıyor; özellikle editörün (sözlüğün) hiç yakalayamadığı "gerçek kelime"
hatalarını (fırtına -> fırsat, söyledim -> söylediğim) ikinci okuma ele veriyor.

AKIŞ (ocr.py normal şekilde çalıştıktan SONRA):
  1. ocr.py'nin kaydettiği sayfa sayfa okumalar (<kitap>_sayfalar.json) yüklenir.
  2. İkinci model (varsayılan gemma3:12b) tüm sayfaları okur. Kaldığı yerden
     devam edebilir: okunan sayfalar <kitap>_sayfalar_<model>.json'a yazılır.
  3. Her sayfada iki okuma kelime kelime hizalanır. Anlaşmazlıklar:
       - Sadece büyük/küçük harf farkı: ana model tamamı BÜYÜK harf yazdıysa
         ikinci modelinki alınır (qwen bazen diyaloğu BÜYÜK HARFLE yazıyor).
       - Sadece şapka farkı (Vediha / Vedihâ): ana model kalır.
       - Biri sözlükte var, diğeri yok: sözlükteki alınır (raki / rakı).
       - İkisi de sözlükte yoksa: ana model kalır.
       - İKİSİ DE GEÇERLİ KELİME (fırtına / fırsat): HAKEM karar verir.
       - 3+ kelimelik ya da kelime sayısı farklı bloklar: ana model kalır.
         (gemma testte sayfa sonuna hiç olmayan iki cümle uydurdu.)
  4. HAKEM (VARSAYILAN KAPALI; --judge visual|text ile açılır). Testte iki
     hakem de net kazanç sağlamadı: görsel hakem 26 kararın 13'ünde yanıldı.
     Kapalıyken ikisi de geçerli kelimeyse ana model kalır. Görsel hakem: her sayfanın anlaşmazlıkları, SAYFA
     GÖRÜNTÜSÜYLE birlikte bir vision modeline (qwen2.5vl:7b) tek soruda
     sorulur: "Bu cümlede sayfada 'yanına' mı yazıyor, 'yanıma' mı?" Model tüm
     sayfayı baştan okumaz, sadece o kelimelere bakar. (İlk sürümdeki metin
     hakemi görüntüyü görmediği için 418 anlaşmazlıktan sadece 10'unda karar
     verebilmişti; --judge text ile hâlâ kullanılabilir.) Emin değilse ana
     model kalır. Seçeneklerin sırası karıştırılır ki modelin "hep ilki"
     eğilimi sonucu etkilemesin.
  +  ONAYLI KELİMELER: iki modelin AYNI okuduğu ama sözlükte olmayan kelimeler
     (Ağbi, meyva, Dallas...) <kitap>_onayli.json'a yazılır. Bunlar büyük
     ihtimalle sayfada gerçekten öyle basılı; editör.py bu listeyi görürse bu
     kelimeleri yapay zekâya "düzeltmesi" için sormaz. (Testte editörün
     bozduğu kelimelerin hepsini iki model de aynı okumuştu.)
  5. Birleşik metin <kitap>.md'ye yazılır (ana modelin okuması bir kez
     <kitap>_tek_model.md olarak yedeklenir), kararlar <kitap>_ensemble.txt'ye.
     Sonra Düzeltme adımı her zamanki gibi bu .md üzerinde çalışır.

KULLANIM:
    py ensemble.py --file "Kafamda_test_50.pdf"
    py ensemble.py --file "kitap.pdf" --second-model gemma3:12b --no-judge
"""

import argparse
import difflib
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

import pymupdf

import config
import ocr
from editor import (TR_LETTERS, CIRCUMFLEX_FOLD, is_valid, load_dictionaries, trlow)

SECOND_MODEL = os.environ.get("KITAP_SECOND_MODEL") or "glm-ocr"
# ÜÇÜNCÜ MODEL (oy için): ana model ile ikinci model farklı okuduğunda üçüncü model
# ikisinden birine katılıyorsa çoğunluk kazanır. gemma3 tek başına kötü bir okuyucu
# (cümle uydurup atlıyor, %17 hata) ama kelime düzeyinde çoğu zaman doğru okuyor:
# Kafamda testinde kalan hataların 52'sinde iki model bir modele karşı doğruydu.
# Oy, kurallarla verilen ~60 kararı değiştiriyor: ~50 iyi, ~10 kötü.
THIRD_MODEL = os.environ.get("KITAP_THIRD_MODEL") or "gemma3:12b"
# OCR'a özel modeller uzun Türkçe komutla değil, eğitildikleri kısa komutla çalışır.
MODEL_PROMPTS = {"glm-ocr": "Text Recognition:"}
# İkisi de sözlükte geçerli ama farklı kelime okunduğunda hangi model kalsın?
# Kafamda testinde (5 sayfa, EPUB'a karşı): qwen "kaçırmam/anlayamıyorum/öğreniyor"
# gibi eki değişmiş GEÇERLİ kelimeler yazıyor, GLM-OCR bunları doğru okuyor
# (farklı kelime farklarında GLM 18, qwen 13 kez haklı; qwen'in haklı olduklarının
# çoğunda GLM'in kelimesi zaten sözlükte yok). gemma3 ise eki uydurduğu için
# onunla ana model kalmalı.
PREFER_SECOND_WHEN_BOTH_VALID = {"glm-ocr"}
# GLM-OCR'ın, ikisi de geçerli kelime çıktığında bile genelde YANILDIĞI üç alışkanlığı
# (Kafamda testi, 50 sayfa, EPUB'a karşı; bu kurallarla 197 farkta doğru seçim 103 -> 157):
#   - Kelimenin sonunu kesiyor: yayıldığını -> yayıldığı, satıcısı -> satıcı (qwen 24, GLM 6 kez haklı)
#   - Sona -r ekliyor: gelmişti -> gelmiştir, etmişti -> etmiştir (qwen 16, GLM 0)
#   - Türkçe harfleri düşürüyor: Hacı -> Haci, şey -> sey (sözlük internetten derlendiği için
#     "sey", "akilli" gibi biçimleri de geçerli sayıyor). Sadece harf farkında Türkçe harfi
#     çok olan biçim seçilir.
#   - (Hamnet testi) -miş -> -miştir, ve ö/ü/ğ harflerini başka harfle değiştiriyor:
#     döşekte -> düşekte, gürül -> görül, ağladı -> açladı, ağacın -> açacın
COPULA_SUFFIXES = {"r", "dir", "dır", "dur", "dür", "tir", "tır", "tur", "tür"}
GLM_SWAPS = {frozenset("öü"), frozenset("öo"), frozenset("üu"), frozenset("ou"),
             frozenset("ğç"), frozenset("ğş"), frozenset("ğg"), frozenset("ğc")}
BOTH_VALID_MIN_SIMILARITY = 0.6   # GLM uydurmadığı için buradaki eşik daha gevşek
TR_SPECIAL = set("çğıöşüÇĞİÖŞÜâîûÂÎÛ")
JUDGE_MODEL = getattr(config, "EDITOR_MODEL", "qwen2.5:14b-instruct")   # --judge text
VISUAL_JUDGE_MODEL = config.VISION_MODEL                                  # --judge visual (varsayılan)
JUDGE_BATCH = 12            # hakeme tek seferde sorulan anlaşmazlık sayısı
MAX_PAIR_BLOCK = 2          # en fazla bu kadar kelimelik 1'e 1 bloklar tek tek değerlendirilir
CONTEXT_CHARS = 90          # hakeme gösterilen bağlam (sol + sağ)
# İkinci modelin kelimesi ancak ana modelinkine BENZİYORSA alınır. Türkçe harfler
# katlandıktan sonra (ı->i, ş->s...) benzerlik bu eşiğin altındaysa ikinci model
# başka bir kelime "uydurmuş" demektir: Hamnet testinde Agnes -> Ayna,
# çitir -> görünür, ağızı -> açığı, kadıncagız -> kadınsız. Eşik o testteki 155
# değişimle seçildi: uydurmaları eliyor, firinci -> fırıncı gibi düzeltmeleri bırakıyor.
MIN_SIMILARITY = 0.75
# Ayrıca: iki modelin kitabın BAŞKA bir yerinde aynı okuduğu sözlük dışı kelime
# (Agnes, Mary, Ağbi...) sayfada gerçekten öyle basılıdır; ikinci model bir
# sayfada farklı okusa da değiştirilmez. (Sık geçmek tek başına kanıt değil:
# "oyle", "Firincinin" gibi OCR hataları da tekrar ediyor.)
FOLD = str.maketrans("çğıöşüâîûÇĞİÖŞÜÂÎÛ", "cgiosuaiuCGIOSUAIU")

TOKEN_RE = re.compile(rf"[{TR_LETTERS}]+(?:['’][{TR_LETTERS}]+)*|[^{TR_LETTERS}]+")
WORD_RE = re.compile(rf"[{TR_LETTERS}]")

JUDGE_PROMPT = """Aşağıda yayımlanmış bir Türkçe romandan cümleler var. Kitap sayfası iki kez okundu ve her cümlede ⟦ ⟧ ile işaretli yerde iki okuma birbirini tutmuyor.
Her madde için cümlenin dil bilgisine, anlamına ve bağlamına göre hangi seçeneğin kitapta yazan doğru kelime olduğuna karar ver.

Dikkat et:
- Zaman ve kişi ekleri cümlenin geri kalanıyla uyumlu olmalı (öğreniyormuş ... istiyormuş).
- Yazarın konuşma dili ve özel isimler olduğu gibi kalmalı; "daha düzgün" görünen seçeneği değil, cümleye UYAN seçeneği seç.
- Gerçekten karar veremiyorsan 0 yaz.

Her satıra SADECE "numara: 1", "numara: 2" ya da "numara: 0" yaz, başka hiçbir şey yazma.

{items}"""


VISUAL_JUDGE_PROMPT = """Bu bir kitap sayfasının görüntüsü. Sayfa iki kez okundu ve aşağıdaki cümlelerde ⟦ ⟧ ile işaretli yerde iki okuma birbirini tutmuyor.
Her madde için GÖRÜNTÜYE BAK ve o cümlede sayfada GERÇEKTEN hangi kelimenin basılı olduğunu bul. Hangisinin daha doğru Türkçe olduğuna değil, sayfada harf harf ne yazdığına göre seç: eklere (-na / -ma, -dım / -diğim, -mış) ve ı/i, ş/s, ğ/g gibi harflere özellikle dikkat et.
Sayfada ikisi de yazmıyorsa ya da seçemiyorsan 0 yaz.

Her satıra SADECE "numara: 1", "numara: 2" ya da "numara: 0" yaz, başka hiçbir şey yazma.

{items}"""


def tokenize(text: str):
    return TOKEN_RE.findall(text)


def word_positions(tokens):
    return [i for i, t in enumerate(tokens) if WORD_RE.match(t)]


def context_for(tokens, idx, width=CONTEXT_CHARS):
    left = "".join(tokens[:idx])[-width:]
    right = "".join(tokens[idx + 1:])[:width]
    left = left.split("\n")[-1]
    right = right.split("\n")[0]
    return left.lstrip(), right.rstrip()


def one_char_edit(a: str, b: str, insert: str) -> bool:
    """b, a'ya tam olarak bir tane `insert` harfi eklenmiş hali mi?"""
    if len(b) != len(a) + 1:
        return False
    return any(b[i] == insert and b[:i] + b[i + 1:] == a for i in range(len(b)))


def glm_letter_swap(a: str, b: str) -> bool:
    """İki kelime aynı uzunlukta ve SADECE GLM'in tipik harf değişimleriyle mi ayrılıyor?"""
    if len(a) != len(b) or a == b:
        return False
    return all(x == y or frozenset((x, y)) in GLM_SWAPS for x, y in zip(a, b))


def similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, trlow(a).translate(FOLD), trlow(b).translate(FOLD)).ratio()


def base_form(w: str) -> str:
    return re.split(r"['’]", w)[0]


def prompt_for(model: str):
    return next((p for name, p in MODEL_PROMPTS.items() if model.split(":")[0] == name), None)


def decide_pair(q: str, g: str, dicts, protected=frozenset(), both_valid="main"):
    """(seçim, sebep) döner. seçim: 'q', 'g', 'judge' ya da 'q_guard' (ikinci model reddedildi)."""
    if q == g or q.replace("’", "'") == g.replace("’", "'"):
        return "q", "aynı"   # sadece kesme işareti türü farkı (' / ’)
    if q in protected or base_form(q) in protected:
        return "q_guard", "iki model kitabın başka yerinde bu kelimeyi aynı okumuş"
    if trlow(q) == trlow(g):
        if q.isupper() and len(q) > 1 and not g.isupper():
            return "g", "ana model büyük harf yazmış"
        return "q", "sadece büyük/küçük harf"
    if q.translate(CIRCUMFLEX_FOLD) == g.translate(CIRCUMFLEX_FOLD):
        return "q", "sadece şapka farkı"
    qv, gv = is_valid(dicts, q), is_valid(dicts, g)
    if qv and not gv:
        return "q", "sözlük: sadece ana model geçerli"
    if gv and not qv:
        if similarity(q, g) < MIN_SIMILARITY:
            return "q_guard", f"ikinci modelin kelimesi çok farklı ({similarity(q, g):.2f})"
        return "g", "sözlük: sadece ikinci model geçerli"
    if not qv and not gv:
        return "q", "ikisi de sözlükte yok"
    if both_valid == "second":
        ql, gl = trlow(q), trlow(g)
        if ql.translate(FOLD) == gl.translate(FOLD):
            if sum(c in TR_SPECIAL for c in g) > sum(c in TR_SPECIAL for c in q):
                return "g", "ikisi de geçerli, Türkçe harfi daha çok olan"
            return "q", "ikisi de geçerli, sadece Türkçe harf farkı: ana model"
        if ql.startswith(gl):
            return "q_guard", "ikisi de geçerli ama ikinci model kelimenin sonunu kesmiş"
        if gl.startswith(ql) and gl[len(ql):] in COPULA_SUFFIXES:
            return "q_guard", "ikisi de geçerli ama ikinci model sona ek fiil eklemiş (-mişti/-miştir, -miş/-miştir)"
        if one_char_edit(ql, gl, insert="r") or one_char_edit(gl, ql, insert="t"):
            return "q_guard", "ikisi de geçerli ama ikinci model 'r' eklemiş ya da 't' düşürmüş (ulaştım/ulaştırm, çıkarmıştı/çıkarmışı)"
        if glm_letter_swap(ql, gl):
            return "q_guard", "ikisi de geçerli ama ikinci model ö/ü/o/u ya da ğ harfini değiştirmiş"
        if similarity(q, g) < BOTH_VALID_MIN_SIMILARITY:
            return "q_guard", f"ikisi de geçerli ama çok farklı ({similarity(q, g):.2f})"
        return "g", "ikisi de geçerli, ikinci model tercih edildi"
    return "judge", "ikisi de geçerli"


def _vnorm(w: str) -> str:
    return trlow(w.replace("’", "'"))


def third_map(q_words, m_text: str):
    """Ana modelin her kelime indeksine üçüncü modelin o konumdaki kelimesini eşler."""
    if not m_text:
        return {}
    m_words = [t for t in tokenize(m_text) if WORD_RE.match(t)]
    out = {}
    sm = difflib.SequenceMatcher(None, [_vnorm(w) for w in q_words], [_vnorm(w) for w in m_words], autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal" or (tag == "replace" and i2 - i1 == j2 - j1):
            for k in range(i2 - i1):
                out[i1 + k] = m_words[j1 + k]
    return out


def third_join_map(q_words, m_text: str):
    """Ana modelin iki kelimesinin (i, i+1) üçüncü modelde tek kelime olarak geçtiği yerler: {i: kelime}."""
    if not m_text:
        return {}
    m_words = [t for t in tokenize(m_text) if WORD_RE.match(t)]
    out = {}
    sm = difflib.SequenceMatcher(None, [_vnorm(w) for w in q_words], [_vnorm(w) for w in m_words], autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "replace" and i2 - i1 == 2 and j2 - j1 == 1:
            out[i1] = m_words[j1]
    return out


def align_page(q_text: str, g_text: str, dicts, protected=frozenset(), both_valid="main", m_text: str = ""):
    """Ana modelin metnini temel alır. (tokenlar, değişiklik_listesi, hakem_listesi) döner.
    değişiklik: (token_idx, yeni_kelime, sebep); hakem: (token_idx, q, g)."""
    q_tok, g_tok = tokenize(q_text), tokenize(g_text)
    q_pos, g_pos = word_positions(q_tok), word_positions(g_tok)
    q_words = [q_tok[i] for i in q_pos]
    g_words = [g_tok[i] for i in g_pos]
    changes, judge, stats = [], [], {"blok_atlandı": 0, "reddedilen": [], "oy": 0}
    m_at = third_map(q_words, m_text)
    third_join = third_join_map(q_words, m_text)
    sm = difflib.SequenceMatcher(None, q_words, g_words, autojunk=False)
    m_fold = " " + " ".join(_vnorm(w) for w in tokenize(m_text) if WORD_RE.match(w)) + " " if m_text else ""
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "insert" and (j2 - j1) <= 2 and m_fold and 0 < i1 < len(q_words):
            # Ana model 1-2 kelime atlamış (tembel tembel -> tembel): ikinci ve üçüncü model
            # aynı bağlamda bu kelimeleri okuduysa geri eklenir.
            ins = [g_words[j] for j in range(j1, j2)]
            ctx = " ".join(_vnorm(w) for w in [q_words[i1 - 1], *ins, q_words[i1]])
            if f" {ctx} " in m_fold:
                t = q_pos[i1 - 1]
                changes.append((t, q_tok[t] + " " + " ".join(w.replace("’", "'") for w in ins),
                                "ana model kelime atlamış: ikinci + üçüncü model okumuş"))
                stats["oy"] += 1
            continue
        if tag != "replace":
            continue
        if (i2 - i1) == 2 and (j2 - j1) == 1:
            # Ana model bir kelimeyi ikiye bölmüş olabilir (sandal yeyi / sandalyeyi).
            q1, q2, g = q_words[i1], q_words[i1 + 1], g_words[j1]
            parts_valid = is_valid(dicts, q1) and is_valid(dicts, q2)
            third = third_join.get(i1)   # üçüncü model de bitişik okumuş mu
            if (_vnorm(q1 + q2) == _vnorm(g) and is_valid(dicts, g)
                    and (not parts_valid or (third is not None and _vnorm(third) == _vnorm(g)))):
                t1, t2 = q_pos[i1], q_pos[i1 + 1]
                changes.append((t1, g.replace("’", "'"), "bölünmüş kelime: ikinci model bitişik okumuş"))
                for t in range(t1 + 1, t2 + 1):
                    changes.append((t, "", "bölünmüş kelime: birleştirildi"))
                continue
        if (i2 - i1) != (j2 - j1) or (i2 - i1) > MAX_PAIR_BLOCK:
            # Büyük/eşitsiz blok: Türkçe harfler katlanarak blok içinde yeniden hizalanır.
            # (qwen bazen bütün bir paragrafı Türkçe harfsiz yazıyor: "gorur gormez bir adim
            # daha yaklasti"; neredeyse her kelime farklı olduğu için blok eskiden komple atlanıyordu.)
            sub = difflib.SequenceMatcher(None, [_vnorm(w).translate(FOLD) for w in q_words[i1:i2]],
                                          [_vnorm(w).translate(FOLD) for w in g_words[j1:j2]], autojunk=False)
            pairs = [(i1 + a + k, j1 + b + k) for a, b, n in sub.get_matching_blocks() for k in range(n)]
            if not pairs:
                stats["blok_atlandı"] += 1
                continue
        else:
            pairs = [(i1 + k, j1 + k) for k in range(i2 - i1)]
        for qi, gj in pairs:
            q, g = q_words[qi], g_words[gj]
            if q == g:
                continue
            m = m_at.get(qi)
            # İki model birlikte Türkçe harf düşürmüşse (Ferhat'ın -> Ferhat'in, pilavın -> pilavin)
            # bu ortak bir eğilimdir, kanıt değil: oy sayılmaz, kurallara bırakılır.
            drops_tr = (_vnorm(q).translate(FOLD) == _vnorm(g).translate(FOLD)
                        and sum(c in TR_SPECIAL for c in g) < sum(c in TR_SPECIAL for c in q))
            q_protected = q in protected or base_form(q) in protected
            if m is not None and _vnorm(m) == _vnorm(g) and _vnorm(g) != _vnorm(q) and not drops_tr and not q_protected:
                choice, why = "g", "çoğunluk oyu: ikinci + üçüncü model"
                stats["oy"] += 1
            elif m is not None and _vnorm(m) == _vnorm(q) and _vnorm(g) != _vnorm(q):
                choice, why = "q_guard", "çoğunluk oyu: ana + üçüncü model"
                stats["oy"] += 1
            else:
                choice, why = decide_pair(q, g, dicts, protected, both_valid)
                # İki model de sözlükte olmayan (farklı) kelimeler yazdıysa ikisi de büyük
                # ihtimalle yanlış; üçüncü modelin okuması geçerli ve ana modelinkine benziyorsa
                # o alınır (kırıdanıyordu / kırıdınıyordu -> kıpırdanıyordu). İki modelin AYNI
                # okuduğu sözlük dışı kelimelere (yazar tercihi: Ağbi, meyva) dokunulmaz.
                if (why == "ikisi de sözlükte yok" and m is not None and _vnorm(m) not in (_vnorm(q), _vnorm(g))
                        and q not in protected and is_valid(dicts, m) and similarity(q, m) >= MIN_SIMILARITY):
                    choice, why, g = "g", "ikisi de geçersiz, üçüncü modelin geçerli okuması", m
                    stats["oy"] += 1
            tidx = q_pos[qi]
            if choice == "q_guard":
                stats["reddedilen"].append((q, g, why))
            elif choice == "g":
                changes.append((tidx, g.replace("’", "'") if "’" not in q_text else g, why))
            elif choice == "judge":
                judge.append((tidx, q, g))
    return q_tok, changes, judge, stats


def _judge_lines(batch, q_tok_by_page):
    lines, order = [], []
    for n, (page, tidx, q, g) in enumerate(batch, 1):
        # Sıra, kelimelere göre sabit ama rastgele görünen şekilde karıştırılır
        swap = int(hashlib.md5(f"{q}|{g}".encode("utf-8")).hexdigest(), 16) % 2 == 1
        first, second = (g, q) if swap else (q, g)
        order.append(swap)
        left, right = context_for(q_tok_by_page[page], tidx)
        lines.append(f"{n}. …{left}⟦ {first} / {second} ⟧{right}…\n   1 = {first}   2 = {second}")
    return "\n".join(lines), order


def _apply_answer(answer, batch, order, results):
    picked = {int(n): int(v) for n, v in re.findall(r"(\d+)\s*[:.)\-]\s*([012])", answer)}
    for n, (page, tidx, q, g) in enumerate(batch, 1):
        v = picked.get(n, 0)
        if v == 0:
            continue
        chose_first = v == 1
        results[(page, tidx)] = "g" if (chose_first == order[n - 1]) else "q"


def ask_judge(items, q_tok_by_page, mode="visual", pdf_path=None):
    """items: [(sayfa, token_idx, q, g)]. {(sayfa, token_idx): 'q'|'g'} döner.
    mode="visual": anlaşmazlıklar sayfa görüntüsüyle vision modeline sorulur.
    mode="text": görüntüsüz, sadece cümle bağlamıyla metin modeline sorulur."""
    results = {}
    if mode == "visual":
        doc = pymupdf.open(pdf_path)
        by_page = {}
        for it in items:
            by_page.setdefault(it[0], []).append(it)
        for n_page, (page, page_items) in enumerate(sorted(by_page.items(), key=lambda kv: int(kv[0])), 1):
            t0 = time.time()
            print(f"  >> Sayfa {int(page) + 1} okunuyor (hakem, {len(page_items)} anlaşmazlık)", flush=True)
            img = ocr.page_to_base64(doc[int(page)], config.DPI)
            for start in range(0, len(page_items), JUDGE_BATCH):
                batch = page_items[start:start + JUDGE_BATCH]
                text, order = _judge_lines(batch, q_tok_by_page)
                try:
                    answer, _ = ocr.call_ollama(VISUAL_JUDGE_MODEL, VISUAL_JUDGE_PROMPT.format(items=text),
                                                images=[img], num_predict=12 * len(batch) + 40)
                except Exception as e:  # hakem çökerse ana model kalır
                    print(f"    [UYARI] Hakem cevap veremedi ({e}); ana model okumaları korunuyor.")
                    continue
                _apply_answer(answer, batch, order, results)
            print(f"  [hakem] Sayfa {int(page) + 1} ({n_page}/{len(by_page)}) bitti ({time.time() - t0:.1f}sn)")
        return results

    for start in range(0, len(items), JUDGE_BATCH):
        batch = items[start:start + JUDGE_BATCH]
        text, order = _judge_lines(batch, q_tok_by_page)
        try:
            answer, _ = ocr.call_ollama(JUDGE_MODEL, JUDGE_PROMPT.format(items=text), num_predict=12 * len(batch) + 40)
        except Exception as e:
            print(f"    [UYARI] Hakem cevap veremedi ({e}); bu gruptaki ana model okumaları korunuyor.")
            continue
        _apply_answer(answer, batch, order, results)
    return results


def confirmed_unknown_words(q_text: str, g_text: str, dicts):
    """İki modelin aynı okuduğu ama sözlükte olmayan kelimeler."""
    q_words = [t for t in tokenize(q_text) if WORD_RE.match(t)]
    g_words = [t for t in tokenize(g_text) if WORD_RE.match(t)]
    out = set()
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, q_words, g_words, autojunk=False).get_opcodes():
        if tag == "equal":
            for w in q_words[i1:i2]:
                if len(w) > 2 and not is_valid(dicts, w):
                    out.add(w)
    return out


def run_second_pass(pdf_path: Path, store_path: Path, headers, page_ids, model: str):
    store = {"model": model, "pages": {}}
    if store_path.exists():
        try:
            store = json.loads(store_path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            pass
    todo = [p for p in page_ids if p not in store["pages"]]
    if not todo:
        print(f"  {model} okuması zaten tamam ({len(page_ids)} sayfa).")
        return store["pages"]
    ocr.VISION_MODEL = model
    ocr.VISION_PROMPT = prompt_for(model)
    doc = pymupdf.open(pdf_path)
    print(f"  {model} ile {len(todo)} sayfa okunacak"
          f"{f' ({len(page_ids) - len(todo)} sayfa önceden okunmuş)' if len(todo) < len(page_ids) else ''}.")
    for n, p in enumerate(todo, 1):
        t0 = time.time()
        print(f"  >> Sayfa {int(p) + 1} okunuyor ({model})", flush=True)  # arayüz PDF önizlemesini takip eder
        raw = ocr.vision_extract(doc[int(p)])
        text = ocr.dehyphenate(ocr.strip_known_headers(raw, headers)).strip()
        store["pages"][p] = text
        store_path.write_text(json.dumps(store, ensure_ascii=False), encoding="utf-8")
        print(f"  [{model}] Sayfa {int(p) + 1} ({n}/{len(todo)}) tamamlandı ({time.time() - t0:.1f}sn)")
    return store["pages"]


def main():
    ap = argparse.ArgumentParser(description="Çift model OCR birleştirme")
    ap.add_argument("--file", required=True, help="input/ klasöründeki PDF adı")
    ap.add_argument("--second-model", default=SECOND_MODEL)
    ap.add_argument("--no-judge", action="store_true", help="Hakemi kullanma (ikisi de geçerliyse ana model kalır)")
    ap.add_argument("--judge", choices=["none", "visual", "text"], default="none",
                    help="none: hakem yok (varsayılan), visual: sayfa görüntüsüne bakan hakem, "
                         "text: sadece cümleye bakan hakem. Testte iki hakem de net kazanç sağlamadı "
                         "(görsel hakem 26 kararın 13'ünde yanıldı), bu yüzden varsayılan kapalı.")
    ap.add_argument("--both-valid", choices=["auto", "main", "second"], default="auto",
                    help="İkisi de geçerli kelimeyse: main = ana model kalır, second = ikinci model alınır, "
                         "auto = ikinci model GLM-OCR ise second, değilse main (varsayılan)")
    ap.add_argument("--third-model", default=THIRD_MODEL,
                    help="Oy için üçüncü model (varsayılan gemma3:12b). Okuması yoksa sayfalar bu modelle okunur.")
    ap.add_argument("--no-third", action="store_true", help="Üçüncü modeli (oylamayı) kullanma")
    args = ap.parse_args()
    if args.both_valid == "auto":
        args.both_valid = "second" if args.second_model.split(":")[0] in PREFER_SECOND_WHEN_BOTH_VALID else "main"

    pdf_path = Path(config.INPUT_DIR) / args.file
    stem = pdf_path.stem
    book_dir = Path(config.OUTPUT_DIR) / stem
    main_json = book_dir / f"{stem}_sayfalar.json"
    if not main_json.exists():
        print(f"HATA: {main_json} yok. Önce bu kitap için OCR'ı (ocr.py) çalıştır.")
        sys.exit(1)
    main_store = json.loads(main_json.read_text(encoding="utf-8"))
    q_pages = main_store["pages"]
    headers = main_store.get("headers", [])
    page_ids = sorted(q_pages, key=int)
    model_tag = re.sub(r"[^A-Za-z0-9]+", "_", args.second_model).strip("_")

    print(f"\n=== Çift model OCR: {main_store.get('model', '?')} + {args.second_model} ===")
    print(f"  İkisi de geçerli kelimede: {'ikinci model' if args.both_valid == 'second' else 'ana model'} tercih edilecek.")
    print("1/3 İkinci model okuması")
    g_pages = run_second_pass(pdf_path, book_dir / f"{stem}_sayfalar_{model_tag}.json", headers, page_ids, args.second_model)

    m_pages = {}
    if not args.no_third and args.third_model and args.third_model != args.second_model:
        print(f"1b/3 Üçüncü model (oy için) okuması: {args.third_model}")
        third_tag = re.sub(r"[^A-Za-z0-9]+", "_", args.third_model).strip("_")
        m_pages = run_second_pass(pdf_path, book_dir / f"{stem}_sayfalar_{third_tag}.json", headers, page_ids, args.third_model)

    print("2/3 Okumalar karşılaştırılıyor (sözlük yükleniyor)...")
    dicts = load_dictionaries()
    tokens_by_page, changes_by_page, judge_items = {}, {}, []
    confirmed = set()
    totals = {"sözlük/biçim ile ikinci model": 0, "hakeme giden": 0, "atlanan blok": 0}
    for p in page_ids:
        confirmed |= confirmed_unknown_words(q_pages[p], g_pages.get(p, ""), dicts)
    protected = frozenset(confirmed | {base_form(w) for w in confirmed if base_form(w)[:1].isupper()})
    rejected = []
    for p in page_ids:
        q_tok, changes, judge, stats = align_page(q_pages[p], g_pages.get(p, ""), dicts, protected, args.both_valid,
                                                  m_text=m_pages.get(p, ""))
        totals["oy"] = totals.get("oy", 0) + stats["oy"]
        rejected += [(int(p) + 1, q, g, why) for q, g, why in stats["reddedilen"]]
        tokens_by_page[p], changes_by_page[p] = q_tok, changes
        judge_items += [(p, tidx, q, g) for tidx, q, g in judge]
        totals["sözlük/biçim ile ikinci model"] += len(changes)
        totals["atlanan blok"] += stats["blok_atlandı"]
    totals["hakeme giden"] = len(judge_items)
    print(f"  Sözlükle çözülüp ikinci modelden alınan: {totals['sözlük/biçim ile ikinci model']}")
    print(f"  İkisi de geçerli kelime (hakeme): {len(judge_items)}")
    print(f"  Güvenlik için atlanan çok kelimeli fark: {totals['atlanan blok']}")
    if m_pages:
        print(f"  Üçüncü modelin oyuyla karara bağlanan fark: {totals.get('oy', 0)}")
    print(f"  İkinci modelin uydurduğu/sık kelimeye dokunduğu için reddedilen: {len(rejected)}")

    verdicts = {}
    if args.no_judge:
        args.judge = "none"
    if judge_items and args.judge != "none":
        judge_name = VISUAL_JUDGE_MODEL + ", sayfa görüntüsüyle" if args.judge == "visual" else JUDGE_MODEL
        print(f"3/3 Hakem ({judge_name}) {len(judge_items)} anlaşmazlığa bakıyor...")
        t0 = time.time()
        verdicts = ask_judge(judge_items, tokens_by_page, mode=args.judge, pdf_path=pdf_path)
        print(f"  Hakem bitti ({time.time() - t0:.0f}sn): "
              f"{sum(1 for v in verdicts.values() if v == 'g')} kez ikinci model, "
              f"{sum(1 for v in verdicts.values() if v == 'q')} kez ana model, "
              f"{len(judge_items) - len(verdicts)} kararsız (ana model kaldı).")
    else:
        print("3/3 Hakem kullanılmadı.")

    log_lines = []
    merged_pages = []
    for p in page_ids:
        tok = list(tokens_by_page[p])
        for tidx, new, why in changes_by_page[p]:
            if new or WORD_RE.match(tok[tidx]):
                log_lines.append(f"s.{int(p) + 1}: \"{tok[tidx]}\" -> \"{new}\"  ({why})")
            tok[tidx] = new
        for (pp, tidx, q, g) in judge_items:
            if pp == p and verdicts.get((pp, tidx)) == "g":
                log_lines.append(f"s.{int(p) + 1}: \"{q}\" -> \"{g}\"  (hakem)")
                tok[tidx] = g
        merged_pages.append("".join(tok).strip())

    out_md = book_dir / f"{stem}.md"
    backup = book_dir / f"{stem}_tek_model.md"
    if out_md.exists() and not backup.exists():
        backup.write_text(out_md.read_text(encoding="utf-8"), encoding="utf-8")
    out_md.write_text(ocr.dehyphenate("\n\n".join(merged_pages) + "\n"), encoding="utf-8")

    confirmed_path = book_dir / f"{stem}_onayli.json"
    confirmed_path.write_text(json.dumps(sorted(confirmed), ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"  İki modelin aynı okuduğu sözlük dışı {len(confirmed)} kelime editör için korumaya alındı ({confirmed_path.name}).")

    log = book_dir / f"{stem}_ensemble.txt"
    with open(log, "w", encoding="utf-8") as f:
        f.write(f"Modeller: {main_store.get('model', '?')} + {args.second_model}"
                f"{' + ' + args.third_model + ' (oy)' if m_pages else ''}, hakem: "
                f"{'yok' if args.judge == 'none' else (VISUAL_JUDGE_MODEL + ' (görsel)' if args.judge == 'visual' else JUDGE_MODEL)}\n")
        f.write(f"Toplam {len(log_lines)} kelime ikinci modelden alındı\n{'=' * 60}\n\n")
        f.write("\n".join(log_lines) + "\n")
        if rejected:
            f.write(f"\n\nİkinci modelin okuması REDDEDİLDİ, ana model kaldı ({len(rejected)} adet)\n{'=' * 60}\n")
            f.write("\n".join(f"s.{pg}: \"{q}\" kaldı (ikinci model: \"{g}\", {why})" for pg, q, g, why in rejected) + "\n")
    print(f"\nBitti: {out_md}  ({len(log_lines)} kelime ikinci modelden alındı, ayrıntı: {log.name})")


if __name__ == "__main__":
    main()