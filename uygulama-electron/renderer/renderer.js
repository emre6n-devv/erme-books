// renderer.js - arayüz mantığı. Python tarafıyla sadece window.api üzerinden konuşur.
const $ = (id) => document.getElementById(id);

const SWATCHES = { // style.py / generate_cover_triband.py ile aynı 10 renk
  turuncu: [245, 102, 45], yesil: [46, 125, 80], lacivert: [24, 58, 102], kirmizi: [196, 38, 46],
  bordo: [139, 32, 40], mor: [108, 58, 120], petrol: [24, 84, 92], hardal: [196, 144, 38],
  pembe: [196, 74, 110], antrasit: [58, 62, 68],
};
const SEASON_NAMES = { kis: 'KIŞ', ilkbahar: 'İLKBAHAR', yaz: 'YAZ', sonbahar: 'SONBAHAR' };
const TABS = ['ocr', 'editor', 'structure', 'cover', 'epub'];

const state = { slug: '', st: null, running: null, pdfPage: 0, pdfCount: 0, pdfSeq: 0, coverSeq: 0, coverTimer: null, color: 'turuncu', cands: [], candSel: -1, mascots: { all: [], available: [] } };
const finishers = {};

// ---------- genel yardımcılar ----------
let toastTimer;
function toast(msg, isErr = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast' + (isErr ? ' err' : '')), 3500);
}
function setStatus(tab, text, kind = '') { const el = $(`status-${tab}`); el.textContent = text; el.className = 'status ' + kind; }
function appendLog(tab, text) {
  const el = $(`log-${tab}`);
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.textContent += text;
  if (atBottom) el.scrollTop = el.scrollHeight;
  // Günlük kapalıyken özet satırında son satır görünür
  const last = el.closest('details')?.querySelector('.last-line');
  if (last) {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !/^=+$/.test(l));
    if (lines.length) last.textContent = lines[lines.length - 1].replace(/^=+\s*|\s*=+$/g, '');
  }
  if (/HATA|Traceback|Error/.test(text)) openLog(tab);
}
function openLog(tab) { $(`log-${tab}`).closest('details')?.setAttribute('open', ''); }
function requireBook() { if (!state.slug) { toast("Önce üstten bir kitap seç ya da 'Yeni PDF' ile ekle.", true); return false; } return true; }
const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

// ---------- mevsim ----------
function seasonForToday() {
  const m = new Date().getMonth() + 1;
  if (m === 12 || m <= 2) return 'kis';
  if (m <= 5) return 'ilkbahar';
  if (m <= 8) return 'yaz';
  return 'sonbahar';
}
const SEASON_ORDER = ['kis', 'ilkbahar', 'yaz', 'sonbahar'];
function applySeason(choice) {
  const auto = choice === 'bugun' || !SEASON_ORDER.includes(choice);
  const s = auto ? seasonForToday() : choice;
  document.body.dataset.season = s;
  $('seasonName').textContent = SEASON_NAMES[s];
  $('seasonBtnText').textContent = { kis: 'Kış', ilkbahar: 'İlkbahar', yaz: 'Yaz', sonbahar: 'Sonbahar' }[s];
  $('segInd').style.transform = `translateX(${SEASON_ORDER.indexOf(s) * 100}%)`;
  document.querySelectorAll('#seasonSeg button').forEach((b) => b.classList.toggle('active', b.dataset.s === s));
  $('seasonToday').classList.toggle('active', auto);
  if (window.SeasonScene) window.SeasonScene.set(s);
  if (typeof tree !== 'undefined' && tree) setTimeout(() => tree.setSeason(s), 0);
  updateDial(s);
  localStorage.setItem('season', auto ? 'bugun' : s);
}
document.querySelectorAll('#seasonSeg button').forEach((b) => b.addEventListener('click', () => applySeason(b.dataset.s)));
$('seasonToday').addEventListener('click', () => applySeason('bugun'));

// ---------- sekmeler ----------
function showTab(tab) {
  // Kitaplık: ağacın kovuğundaki 360° kütüphane (ana sayfanın üstünde açılır)
  if (tab === 'library' && window.HollowLibrary) { if (!$('page-home').classList.contains('active')) showTab('home'); requestAnimationFrame(() => enterHollow()); return; }
  if (hollowLib?.active) exitHollow();
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.tab === tab));
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${tab}`));
  document.querySelectorAll('#pipeline button').forEach((b) => b.classList.toggle('cur', b.dataset.tab === tab));
  document.querySelector('main').classList.toggle('flush', tab === 'home');
  document.querySelectorAll('.top-nav[data-tab]').forEach((b) => b.classList.toggle('cur', b.dataset.tab === tab));
  if (tab === 'home') { ensureTree(); if (tree) tree.reset(); updateHome(); }
  if (tab === 'cover') { ensureClothStudio(); if ($('legacyCover').open) ensureShowcase('cover'); refreshCover(); }
  if (tab === 'epub') { ensureShowcase('epub'); renderEpub(); }
  if (tab === 'library') loadLibrary();
}
document.querySelectorAll('#pipeline button, .top-nav[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
// mevsim seçici: üst çubukta açılır pencere (küçük mevsim sahnesiyle)
$('seasonBtn').addEventListener('click', (e) => { e.stopPropagation(); $('seasonPop').classList.toggle('open'); });
$('seasonPop').addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => $('seasonPop').classList.remove('open'));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('seasonPop').classList.remove('open'); });
document.querySelectorAll('.nav-item').forEach((n) => n.addEventListener('click', () => showTab(n.dataset.tab)));

// ---------- süreç çalıştırma ----------
function setRunning(tab) {
  state.running = tab;
  for (const t of TABS) {
    const start = $(`${t}-start`), stop = $(`${t}-stop`);
    if (!start) continue;
    start.disabled = !!tab;
    start.classList.toggle('running', tab === t);
    stop.disabled = tab !== t;
  }
  $('ocr-chain').disabled = !!tab;
  $('ocr-chain').classList.toggle('running', tab === 'ocr' && !!state.chain);
  $('evalRun').disabled = !!tab || !state.evalRef;
  document.querySelectorAll('#pipeline button').forEach((b) => b.classList.toggle('run', b.dataset.tab === tab));
  if (typeof updateHome === 'function') updateHome();
}
async function runTab(tab, args, onFinish, keepLog = false) {
  if (!keepLog) $(`log-${tab}`).textContent = '';
  $(`log-${tab}`).hidden = false;
  finishers[tab] = onFinish;
  setRunning(tab);
  const r = await api.run(tab, args);
  if (r.error) { appendLog(tab, r.error + '\n'); setRunning(null); }
}
api.onLog(({ tabId, text }) => {
  appendLog(tabId, text);
  if (tabId === 'ocr') followOcrPage(text);
  if (prog[tabId]) for (const line of text.split('\n')) progLine(tabId, line);
});

// ---------- ilerleme ve kalan süre ----------
// Python scriptlerinin zaten yazdığı satırlardan okunur; scriptlere ek bir şey gerekmez.
const prog = {};
// Her ilerleme kutusunun 3D "dolan kitabı" (book3d.js; WebGL yoksa null)
const books3d = {};
function book3d(tab) {
  if (!(tab in books3d)) {
    const cv = $(`prog-${tab}`)?.querySelector('.prog-book');
    books3d[tab] = cv && window.BookProgress ? window.BookProgress.attach(cv) : null;
    if (!books3d[tab] && cv) cv.style.display = 'none';
  }
  return books3d[tab];
}
const avgTime = (p) => { const r = p.times.slice(-8); return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0; };
function fmtDur(sec) {
  if (!isFinite(sec) || sec <= 0) return '';
  const m = Math.round(sec / 60);
  if (m < 1) return '< 1 dk';
  return m < 60 ? `${m} dk` : `${Math.floor(m / 60)} sa ${m % 60} dk`;
}
function progStart(tab, plannedSteps) {
  prog[tab] = { step: 0, steps: plannedSteps, stage: 'Başlıyor…', total: 0, done: 0, times: [], t0: Date.now(), indet: true };
  const box = $(`prog-${tab}`);
  box.hidden = false;
  box.classList.remove('done', 'fail');
  const b = book3d(tab);
  if (b) {
    b.start(); b.busy(true);
    if (state.slug) api.readCover(state.slug).then((src) => b.setCover(src, state.slug.replace(/_/g, ' ')));
  }
  progRender(tab);
}
function progStage(tab, name, total = 0, counts = true) {
  const p = prog[tab]; if (!p) return;
  if (counts) p.step++;
  Object.assign(p, { stage: name, total, done: 0, times: [], indet: !total });
  const b = book3d(tab);
  if (b) { b.busy(!total); b.setFraction(0); if (total) b.pageStarted(12); }
  progRender(tab);
}
// bir sayfa bitti: 3D kitapta sayfa çevrilir, yenisi okunurken dolmaya başlar
function progPageDone(tab) {
  const p = prog[tab], b = book3d(tab); if (!p || !b) return;
  b.pageDone();
  b.pageStarted(avgTime(p) || 12);
}
function progLine(tab, line) {
  const p = prog[tab]; let m;
  if ((m = line.match(/Toplam sayfa: (\d+) \| İşlenecek: (\d+)-(\d+)/))) progStage(tab, 'qwen2.5vl ana okuma', +m[3] - +m[2] + 1);
  else if ((m = line.match(/Daha önce okunan (\d+) sayfa atlanıyor/))) { p.done = +m[1]; p.skipped = +m[1]; }
  else if ((m = line.match(/\[üstbilgi taraması\] Sayfa (\d+)\/(\d+) işlendi \(([\d.]+)sn\)/))) {
    p.sub = `üstbilgi taraması ${m[1]}/${m[2]}`; p.times.push(+m[3]);
  } else if ((m = line.match(/Sayfa \d+\/\d+ tamamlandı \[[^\]]*\] \(([\d.]+)sn\)/))) { p.done++; if (+m[1] > 0.5) { p.times.push(+m[1]); progPageDone(tab); } p.sub = ''; } // üstbilgi taramasında okunmuş sayfalar ~0 sn: süre tahminini bozmasın
  else if ((m = line.match(/^\s*(\S+) ile (\d+) sayfa okunacak/))) progStage(tab, `${m[1]} okuması`, +m[2]);
  else if ((m = line.match(/^\s*(\S+) okuması zaten tamam/))) { progStage(tab, `${m[1]} okuması (kayıtlı)`, 1); p.done = 1; }
  else if ((m = line.match(/\[\S+\] Sayfa \d+ \((\d+)\/(\d+)\) tamamlandı \(([\d.]+)sn\)/))) { p.done = +m[1]; p.total = +m[2]; p.times.push(+m[3]); progPageDone(tab); }
  else if (/Okumalar karşılaştırılıyor/.test(line)) progStage(tab, 'Okumalar birleştiriliyor', 0, false);
  else if (/Sözlükler yükleniyor/.test(line)) progStage(tab, 'Düzeltme: şüpheli kelimeler taranıyor', 0);
  else if ((m = line.match(/^\s*\[(\d+)\/(\d+)\] /))) { p.stage = 'Düzeltme: şüpheli kelimeler'; p.total = +m[2]; p.done = +m[1]; p.indet = false; }
  else if ((m = line.match(/(\d+) kelime LLM'e/))) progStage(tab, `Düzeltme: ${m[1]} kelime yapay zekâya soruluyor`, 0, false);
  else if (/EPUB okunuyor/.test(line)) progStage(tab, 'Doğruluk ölçülüyor', 0, false);
  else return;
  progRender(tab);
}
function progRender(tab) {
  const p = prog[tab], box = $(`prog-${tab}`); if (!p || !box) return;
  const stepTxt = p.steps > 1 && p.step ? ` · adım ${Math.min(p.step, p.steps)}/${p.steps}` : '';
  box.querySelector('.prog-stage').textContent = p.stage + stepTxt;
  box.classList.toggle('indet', !!p.indet);
  const pct = p.total ? Math.min(100, (p.done / p.total) * 100) : 0;
  if (p.total) book3d(tab)?.setFraction(p.done / p.total);
  box.querySelector('.prog-fill').style.width = `${pct}%`;
  const recent = p.times.slice(-8), avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const left = p.total ? fmtDur(avg * (p.total - p.done)) : '';
  box.querySelector('.prog-eta').textContent = left ? `bu adımda ~${left} kaldı` : '';
  const counter = p.total && !p.indet ? `${p.done}/${p.total}` : '';
  box.querySelector('.prog-sub').textContent = [counter, p.sub, `geçen süre ${fmtDur((Date.now() - p.t0) / 1000) || '< 1 dk'}`].filter(Boolean).join(' · ');
}
function progEnd(tab, ok, text) {
  const p = prog[tab], box = $(`prog-${tab}`); if (!p) return;
  p.stage = text; p.indet = false; p.total = 0;
  box.classList.add(ok ? 'done' : 'fail');
  book3d(tab)?.finish(ok);
  progRender(tab);
  box.querySelector('.prog-eta').textContent = '';
  delete prog[tab];
}
setInterval(() => { for (const t of Object.keys(prog)) progRender(t); }, 30000);
// OCR ilerledikçe PDF önizlemesi o an okunan sayfaya geçer
function followOcrPage(text) {
  const all = [...text.matchAll(/Sayfa (\d+) okunuyor(?: \(([^)]+)\))?/g)];
  if (!all.length) return;
  const last = all[all.length - 1];
  const n = parseInt(last[1], 10), model = last[2] || '';
  $('pdfLive').textContent = `Okunuyor: sayfa ${n}${model ? ' · ' + model : ''}`;
  $('pdfLive').parentElement.parentElement.classList.add('live');
  if (state.pdfPage !== n - 1) loadPdfPage(n - 1);
}
api.onDone(async ({ tabId, code, cancelled }) => {
  setRunning(null);
  if (tabId === 'ocr') document.querySelector('.pdf-card').classList.remove('live');
  if (cancelled) {
    appendLog(tabId, '\n=== İşlem iptal edildi (tekrar başlatınca kaldığı yerden devam eder) ===\n');
    state.chain = null;
    progEnd(tabId, false, 'Durduruldu');
  } else if (finishers[tabId]) finishers[tabId](code);
  await refreshStatus();
});
for (const t of TABS) { const s = $(`${t}-stop`); if (s) s.addEventListener('click', () => api.stop()); }

// ---------- kitap seçimi ----------
async function loadBooks(selectSlug) {
  const books = await api.listBooks();
  const sel = $('bookSelect');
  sel.innerHTML = books.map((b) => `<option>${b.replace(/</g, '&lt;')}</option>`).join('');
  if (selectSlug && books.includes(selectSlug)) state.slug = selectSlug;
  else if (!books.includes(state.slug)) state.slug = books[0] || '';
  sel.value = state.slug;
  await onBookChanged();
}
async function onBookChanged() {
  state.pdfPage = 0;
  try { if (state.slug) localStorage.setItem('lastBook', state.slug); } catch {}   // açılışta kalınan kitaptan devam
  $('coverTitle').value = ''; $('coverAuthor').value = ''; $('coverReason').textContent = '';
  await refreshStatus();
  loadPdfPage(0);
  await loadStructureFields();
  refreshCover();
}
$('bookSelect').addEventListener('change', (e) => { state.slug = e.target.value; onBookChanged(); });
$('refreshBooks').addEventListener('click', () => loadBooks(state.slug));
$('pickPdf').addEventListener('click', async () => { const s = await api.pickPdf(); if (s) loadBooks(s); });

async function refreshStatus() {
  if (!state.slug) {
    for (const t of TABS) setStatus(t, 'Önce üstten bir kitap seç.');
    state.st = null;
    return;
  }
  const st = (state.st = await api.bookStatus(state.slug));
  const e = st.exists, n = `'${state.slug}'`;
  if (e.md) setStatus('ocr', `${n} için OCR tamamlanmış.`, 'ok');
  else if (e.pdf) setStatus('ocr', `${n} — PDF hazır, henüz OCR yapılmadı.`);
  else setStatus('ocr', `${n} — input/ klasöründe PDF bulunamadı.`, 'err');

  if (e.editorMd) setStatus('editor', `${n} için düzeltme tamamlanmış.`, 'ok');
  else if (e.md) setStatus('editor', `${n} — ham OCR hazır, henüz düzeltilmedi.`);
  else setStatus('editor', `${n} — önce OCR adımını çalıştır.`, 'err');

  if (e.yapi) setStatus('structure', `${n} için bölüm ağacı hazır.`, 'ok');
  else setStatus('structure', `${n} — henüz başlık/bölüm tespiti yapılmadı.`);

  if (e.cover) setStatus('cover', `${n} için kapak var.`, 'ok');
  else setStatus('cover', `${n} — kapak henüz oluşturulmadı.`);

  if (e.epub) setStatus('epub', `${n} için EPUB hazır.`, 'ok');
  else setStatus('epub', `${n} — EPUB henüz oluşturulmadı.`);

  state.evalRef = await api.evalRef(state.slug);
  const refName = state.evalRef ? state.evalRef.split(/[\\/]/).pop() : '';
  $('evalHint').textContent = state.evalRef
    ? `Bu kitabın doğru metni bulundu (${refName}). Çıktıyı onunla karşılaştırıp hata oranını ölçebilirsin.`
    : 'Doğruluk ölçümü için kitabın aynı baskısının EPUB\'ı epubs/ klasöründe olmalı. Normal kitaplarda gerekmez.';
  $('evalRun').disabled = !!state.running || !state.evalRef;
  $('openReport').disabled = !e.report;

  const done = { ocr: e.md, editor: e.editorMd, structure: e.yapi, cover: e.cover, epub: e.epub };
  document.querySelectorAll('.nav-item').forEach((n2) => n2.classList.toggle('done', !!done[n2.dataset.tab]));
  const pipe = [...document.querySelectorAll('#pipeline > *')];
  pipe.forEach((el, i) => {
    if (el.tagName === 'BUTTON') el.classList.toggle('done', !!done[el.dataset.tab]);
    else el.classList.toggle('done', !!done[pipe[i - 1].dataset.tab] && !!done[pipe[i + 1].dataset.tab]);
  });
  await loadSummary();
  updateHome();
}

// ---------- PDF önizleme ----------
async function loadPdfPage(page) {
  const img = $('pdfImg'), empty = $('pdfEmpty');
  if (!state.slug || !state.st || !state.st.exists.pdf) {
    img.classList.remove('show'); empty.style.display = ''; empty.textContent = 'PDF yok';
    state.pdfCount = 0; updatePdfNav(); return;
  }
  const seq = ++state.pdfSeq;
  empty.textContent = 'Yükleniyor…';
  const r = await api.pdfPage(state.slug, page);
  if (seq !== state.pdfSeq) return;
  if (r.error) { img.classList.remove('show'); empty.style.display = ''; empty.textContent = 'Önizleme açılamadı'; return; }
  state.pdfPage = r.page; state.pdfCount = r.count;
  img.src = r.src; img.classList.remove('show'); void img.offsetWidth; img.classList.add('show');
  empty.style.display = 'none';
  updatePdfNav();
}
function updatePdfNav() {
  $('pdfPageInput').value = state.pdfCount ? state.pdfPage + 1 : 0;
  $('pdfCount').textContent = `/ ${state.pdfCount}`;
  $('pdfPrev').disabled = state.pdfPage <= 0;
  $('pdfNext').disabled = state.pdfPage >= state.pdfCount - 1;
}
$('pdfPrev').addEventListener('click', () => loadPdfPage(state.pdfPage - 1));
$('pdfNext').addEventListener('click', () => loadPdfPage(state.pdfPage + 1));
$('pdfPageInput').addEventListener('change', (e) => loadPdfPage((parseInt(e.target.value, 10) || 1) - 1));

// ---------- 1 OCR ----------
// Üç model kutucuğu varsayılan olarak açık ve seçim hatırlanır
$('ocrEnsemble').checked = localStorage.getItem('ocrEnsemble') !== '0';
$('ocrEnsemble').addEventListener('change', (e) => localStorage.setItem('ocrEnsemble', e.target.checked ? '1' : '0'));

// Bir adım listesini arka arkaya çalıştırır; biri hata verirse durur.
function runSteps(tab, steps, onAllDone) {
  const next = (i) => {
    if (i >= steps.length) return onAllDone && onAllDone(true);
    const st = steps[i];
    if (i > 0) appendLog(tab, `\n=== ${st.label} ===\n`);
    runTab(tab, st.args, (code) => {
      if (code !== 0) {
        appendLog(tab, `\n=== HATA: "${st.label}" adımı başarısız oldu. Ollama açık mı, günlüğün son satırlarına bak. ===\n`);
        return onAllDone && onAllDone(false);
      }
      next(i + 1);
    }, i > 0);
  };
  next(0);
}

// Başlamadan önce: Ollama açık mı, gereken modeller kurulu mu?
async function checkReady(tab, needs) {
  await pollOllama(true);
  if (needs.every((k) => !roleOn(k === 'editor' ? 'text' : k))) return true;   // kural tabanlı mod: dil modeli gerekmez
  const [s, req] = await Promise.all([api.ollamaStatus(), api.requiredModels()]);
  const log = (t) => { $(`log-${tab}`).hidden = false; $(`log-${tab}`).textContent = t; openLog(tab); };
  if (!s.up) {
    log('Ollama çalışmıyor.\n\nBaşlat menüsünden Ollama uygulamasını aç (sağ altta lama simgesi görünmeli)\nya da bir terminalde "ollama serve" yazıp o pencereyi açık bırak. Sonra tekrar başlat.');
    toast('Ollama kapalı. Önce Ollama uygulamasını aç.', true);
    return false;
  }
  const have = new Set((s.models || []).flatMap((m) => [m, m.replace(/:latest$/, '')]));
  const missing = needs.map((k) => req[k]).filter((m) => m && !have.has(m));
  if (missing.length) {
    log('Eksik model var, önce kurulması gerekiyor. Bir terminalde şunları çalıştır:\n\n' + missing.map((m) => `  ollama pull ${m}`).join('\n'));
    toast(`Eksik model: ${missing.join(', ')}`, true);
    return false;
  }
  return true;
}

// Çoklu okuma, Model Yönetimi'nde ikinci okuma kapalıysa atlanır; oy modeli kapalıysa yalnız iki okuma birleştirilir.
const roleOn = (k) => !state.models || !!state.models.roles[k]?.secili;
const multiOcr = () => $('ocrEnsemble').checked && roleOn('second');
function ocrSteps() {
  const ocrArgs = ['ocr.py', '--file', `${state.slug}.pdf`, '--resume'];
  if ($('ocrTest').checked) ocrArgs.push('--max-pages', '20');
  const steps = [{ label: `OCR: ${state.models?.roles.ocr.secili || 'ana model'}`, args: ocrArgs }];
  if (multiOcr()) {
    const args = ['ensemble.py', '--file', `${state.slug}.pdf`];
    if (!roleOn('third')) args.push('--no-third');
    steps.push({ label: roleOn('third') ? 'İkinci ve üçüncü model okuması, birleştirme' : 'İkinci model okuması, birleştirme', args });
  }
  return steps;
}
const ocrNeeds = () => (multiOcr() ? ['ocr', 'second', ...(roleOn('third') ? ['third'] : [])] : ['ocr']);

$('ocr-start').addEventListener('click', async () => {
  if (!requireBook()) return;
  if (!state.st.exists.pdf) return toast('Bu kitabın PDF dosyası input/ klasöründe yok.', true);
  if (!(await checkReady('ocr', ocrNeeds()))) return;
  const steps = ocrSteps();
  progStart('ocr', steps.length === 1 ? 1 : 3);
  runSteps('ocr', steps, (ok) => {
    appendLog('ocr', ok ? '\n=== OCR TAMAMLANDI ===\n' : '');
    progEnd('ocr', ok, ok ? 'OCR tamamlandı' : 'Hata oluştu; ayrıntılar günlükte');
  });
});

// Tek tuşla tam zincir: OCR (seçiliyse üç model) -> Düzeltme -> (doğru metin varsa) ölçüm
$('ocr-chain').addEventListener('click', async () => {
  if (!requireBook()) return;
  if (!state.st.exists.pdf) return toast('Bu kitabın PDF dosyası input/ klasöründe yok.', true);
  if (!(await checkReady('ocr', [...ocrNeeds(), 'editor']))) return;
  const md = state.st.paths.md;
  const steps = [...ocrSteps(), { label: 'Düzeltme (editör)', args: ['editor.py', '--input', md, '--book', state.slug] }];
  if (state.evalRef) steps.push({ label: 'Doğruluk ölçümü', args: ['degerlendir.py', '--book', state.slug] });
  state.chain = true;
  progStart('ocr', $('ocrEnsemble').checked ? 4 : 2);
  setRunning(state.running);
  runSteps('ocr', steps, async (ok) => {
    state.chain = null;
    appendLog('ocr', ok ? '\n=== TAM ZİNCİR TAMAMLANDI - "İncelenecekleri Aç" ile kalan birkaç kelimeye bakabilirsin ===\n' : '');
    progEnd('ocr', ok, ok ? 'Tam zincir tamamlandı' : 'Hata oluştu; ayrıntılar günlükte');
    await refreshStatus();
    if (ok) toast(`'${state.slug}' hazır: OCR ve düzeltme bitti.`);
  });
});

// ---------- 2 Düzeltme ----------
$('editor-start').addEventListener('click', async () => {
  if (!requireBook()) return;
  if (!state.st.exists.md) return toast('Ham OCR dosyası yok. Önce OCR adımını çalıştır.', true);
  if (!(await checkReady('editor', ['editor']))) return;
  const args = ['editor.py', '--input', state.st.paths.md, '--book', state.slug];
  if ($('editorTest').checked) args.push('--limit', '60');
  progStart('editor', 1);
  runTab('editor', args, (code) => {
    appendLog('editor', code === 0 ? '\n=== DÜZELTME TAMAMLANDI ===\n' : '\n=== HATA ya da eksik çıktı ===\n');
    progEnd('editor', code === 0, code === 0 ? 'Düzeltme tamamlandı' : 'Hata oluştu; ayrıntılar günlükte');
  });
});

// Doğruluk ölçümü: sadece kitabın "doğru metni" olan bir EPUB epubs/ klasöründe varsa
$('evalRun').addEventListener('click', () => {
  if (!requireBook() || !state.evalRef) return;
  if (!state.st.exists.md) return toast('Ölçülecek çıktı yok. Önce OCR adımını çalıştır.', true);
  progStart('editor', 1);
  runTab('editor', ['degerlendir.py', '--book', state.slug], (code) => {
    progEnd('editor', code === 0, code === 0 ? 'Ölçüm tamamlandı' : 'Ölçüm yapılamadı');
    if (code === 0) openIf('report', 'Ölçüm raporu');
  });
});
$('openReport').addEventListener('click', () => openIf('report', 'Ölçüm raporu'));
async function openIf(key, label) {
  if (!requireBook()) return;
  if (!(await api.openPath(state.st.paths[key]))) toast(`${label} henüz oluşmadı.`, true);
}
$('openChanges').addEventListener('click', () => openIf('changes', 'Değişiklik listesi'));
$('openReview').addEventListener('click', () => openIf('review', 'İnceleme listesi'));

// ---------- 3 Yapı: bölüm ağacı + ERME dizgi önizlemesi ----------
// Ağaç öğesi: {idx, title, level 1-3, kind front|part|chapter|section, virtual}. Kurallar erme_structure.py ile aynı.
const tocS = { slug: null, toc: [], paras: [], template: 'klasik', css: null, sel: -1, pick: null, timer: 0, root: null, drag: -1 };
const TOC_BADGE = { front: 'ÖN', part: 'KISIM', chapter: 'BÖLÜM', section: 'ALT' };
const TOC_FRONT_RE = /^\s*(ön\s*söz|önsöz|giriş|sunuş|takdim|yazarın notu|çevirmenin notu|editörün notu|yayıncının notu|ithaf|prolog|başlarken|okura|teşekkür|son\s*söz|sonsöz|epilog|kaynakça|açıklamalar|notlar|dizin|sözlük|foreword|preface|introduction|prologue|epilogue)(?![\p{L}\p{N}])/iu;
const SCENE_RE = /^\s*(?:(?:\*\s*){3,}|⁂|(?:[-–—]\s*){3,}|(?:•\s*){3,}|(?:·\s*){3,}|#|§)\s*$/;
function tocKindFor(level, title) {
  if (level === 1) return 'part';
  if (level === 3) return 'section';
  return TOC_FRONT_RE.test(title || '') ? 'front' : 'chapter';
}
function tocNoise() {   // erme_structure.noise_set ile aynı: tekrar eden sayfa başlığı ve sayfa numaraları
  const keys = tocS.paras.map((p) => p.trim()), cnt = new Map();
  for (const k of keys) if (k && k.length <= 60 && !k.includes('\n')) cnt.set(k.toLowerCase(), (cnt.get(k.toLowerCase()) || 0) + 1);
  const named = new Set([$('structTitle').value.trim().toLowerCase(), $('structAuthor').value.trim().toLowerCase()].filter(Boolean));
  const noise = new Set();
  for (const k of new Set(keys)) {
    const ck = k.toLowerCase();
    if ((cnt.get(ck) || 0) >= 3 && !SCENE_RE.test(k) && !/[.!?…:;,]$/.test(k) && (named.has(ck) || (/\p{L}/u.test(k) && k === k.toUpperCase()))) noise.add(ck);
  }
  const nums = keys.map((k, i) => (/^\d{1,4}$/.test(k) ? i : -1)).filter((i) => i >= 0);
  if (nums.length >= 6) {
    const gaps = nums.slice(1).map((v, i) => v - nums[i]).sort((a, b) => a - b);
    if (gaps[gaps.length >> 1] < 15) nums.forEach((i) => noise.add(keys[i]));
  }
  return noise;
}
function tocRanges() {   // her öğenin metin aralığı [başlangıç, bitiş)
  const n = tocS.paras.length, marks = [...new Set(tocS.toc.map((it) => it.idx))].sort((a, b) => a - b);
  const next = (i) => { const m = marks.find((x) => x > i); return m === undefined ? n : m; };
  return tocS.toc.map((it) => [it.virtual ? it.idx : it.idx + 1, next(it.idx)]);
}
const tocInline = (t) => escapeHtml(t.replace(/\s*\n\s*/g, ' ').trim()).replace(/\*\*(?=\S)(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*\w])\*(?=\S)([^*]+?)\*(?![*\w])/g, '$1<em>$2</em>');
function tocLabel(it) {
  const t = it.title.trim();
  if (it.kind === 'part' && !/kısım|kitap|cilt|part/i.test(t)) return ['Kısım', t];
  if (it.kind === 'chapter' && /^\s*([IVXLCDM]+|\d{1,3})\.?\s*$/.test(t)) return ['Bölüm', t.replace(/\.$/, '')];
  return ['', t];
}

async function loadStructureFields() {
  const slug = state.slug;
  const [d, paras, css] = await Promise.all([
    slug ? api.readStructure(slug) : null, slug ? api.readParagraphs(slug).catch(() => []) : [],
    tocS.css ? tocS.css : api.epubTemplates().catch(() => ({})),
  ]);
  if (slug !== state.slug) return;
  $('structTitle').value = d?.title || '';
  $('structAuthor').value = d?.author || '';
  Object.assign(tocS, { slug, toc: d?.toc || [], paras: paras || [], template: d?.template || 'klasik', css, sel: (d?.toc || []).length ? 0 : -1, pick: null });
  $('tocSaved').textContent = '';
  renderTocTree(); renderPreview(); syncTplSeg();
}
function syncTplSeg() { $('tplSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === tocS.template)); }
$('tplSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  tocS.template = b.dataset.t; syncTplSeg(); renderPreview();
  if (state.slug) saveTocSoon(0);
});
function saveTocSoon(ms = 600) {
  clearTimeout(tocS.timer);
  $('tocSaved').textContent = 'kaydediliyor…';
  tocS.timer = setTimeout(async () => {
    if (!tocS.slug) return;
    await api.saveToc(tocS.slug, { toc: tocS.toc, template: tocS.template });
    $('tocSaved').textContent = 'kaydedildi ✓';
    loadSummary();
  }, ms);
}
function tocChanged(sel = tocS.sel) {
  tocS.sel = Math.min(sel, tocS.toc.length - 1);
  renderTocTree(); renderPreview(); saveTocSoon();
}

function renderToc() {   // özet yenilenince ağacı kitabın kendi verisinden tazele (adım 3 açık değilse sadece sayaç)
  if (tocS.slug !== state.slug) loadStructureFields();
}
function renderTocTree() {
  const toc = tocS.toc, el = $('tocList');
  const parts = toc.filter((it) => it.kind === 'part').length, chs = toc.filter((it) => it.kind === 'chapter').length;
  $('tocCount').textContent = toc.length ? [parts && `${parts} kısım`, chs && `${chs} bölüm`, `${toc.length} başlık`].filter(Boolean).join(' · ') : '';
  if (!toc.length) {
    el.innerHTML = `<div class="empty-note"><b>Bölüm ağacı boş</b>${state.slug ? '"Otomatik Tespit" ile başlıkları bul ya da sağdaki önizlemede bir satır seçip "+ Başlık Ekle" de.' : 'Önce bir kitap seç.'}</div>`;
    return;
  }
  el.innerHTML = toc.map((it, i) => `<li class="tn lv${it.level} k-${it.kind}${i === tocS.sel ? ' on' : ''}${it.virtual ? ' virt' : ''}" draggable="true" tabindex="0" data-i="${i}">
      <span class="grip" aria-hidden="true">⋮⋮</span><span class="kb">${TOC_BADGE[it.kind]}</span><span class="tt" title="${escapeHtml(it.title)}">${escapeHtml(it.title)}</span>
      <span class="tn-act"><button data-a="out" title="Üst seviyeye al (←)">←</button><button data-a="in" title="Alt seviyeye al (→)">→</button><button data-a="del" title="Sil (Del)">×</button></span></li>`).join('');
}
function tocSetLevel(i, d) {
  const it = tocS.toc[i]; if (!it) return;
  const lv = Math.max(1, Math.min(3, it.level + d)); if (lv === it.level) return;
  it.level = lv; it.kind = tocKindFor(lv, it.title); tocChanged(i);
}
function tocDelete(i) {
  if (!tocS.toc[i]) return;
  tocS.toc.splice(i, 1); tocChanged(Math.max(0, Math.min(i, tocS.toc.length - 1)));
  toast('Başlık silindi; metni bir önceki bölüme katıldı.');
}
function tocRename(i) {
  const li = $('tocList').querySelector(`li[data-i="${i}"]`); if (!li) return;
  const tt = li.querySelector('.tt'), it = tocS.toc[i];
  const inp = document.createElement('input'); inp.className = 'tn-edit'; inp.value = it.title;
  tt.replaceWith(inp); inp.focus(); inp.select(); li.draggable = false;
  let done = false;
  const end = (ok) => {
    if (done) return; done = true;
    const v = inp.value.trim();
    if (ok && v && v !== it.title) {
      it.title = v; if (it.level === 2) it.kind = tocKindFor(2, v); tocChanged(i);
    } else renderTocTree();
    $('tocList').querySelector(`li[data-i="${i}"]`)?.focus();
  };
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') end(true); if (e.key === 'Escape') end(false); });
  inp.addEventListener('blur', () => end(true));
}
const tocLi = (e) => e.target.closest('li.tn');
$('tocList').addEventListener('click', (e) => {
  const li = tocLi(e); if (!li) return;
  const i = +li.dataset.i, a = e.target.closest('button')?.dataset.a;
  if (a === 'out') return tocSetLevel(i, -1);
  if (a === 'in') return tocSetLevel(i, 1);
  if (a === 'del') return tocDelete(i);
  if (e.target.closest('input')) return;
  if (tocS.sel !== i) { tocS.sel = i; tocS.pick = null; renderTocTree(); renderPreview(); }
  $('tocList').querySelector(`li[data-i="${i}"]`)?.focus();
});
$('tocList').addEventListener('dblclick', (e) => { const li = tocLi(e); if (li && !e.target.closest('button')) tocRename(+li.dataset.i); });
$('tocList').addEventListener('keydown', (e) => {
  const li = tocLi(e); if (!li || e.target.tagName === 'INPUT') return;
  const i = +li.dataset.i;
  const go = (j) => { if (j < 0 || j >= tocS.toc.length) return; tocS.sel = j; tocS.pick = null; renderTocTree(); renderPreview(); $('tocList').querySelector(`li[data-i="${j}"]`)?.focus(); };
  const k = { ArrowLeft: () => tocSetLevel(i, -1), ArrowRight: () => tocSetLevel(i, 1), Delete: () => tocDelete(i), F2: () => tocRename(i), Enter: () => tocRename(i), ArrowUp: () => go(i - 1), ArrowDown: () => go(i + 1) }[e.key];
  if (!k) return;
  e.preventDefault(); k();
  if (/Arrow(Left|Right)|Delete/.test(e.key)) $('tocList').querySelector(`li[data-i="${tocS.sel}"]`)?.focus();
});
// sürükle-bırak sıralama: bölüm metniyle birlikte taşınır
$('tocList').addEventListener('dragstart', (e) => { const li = tocLi(e); if (!li) return; tocS.drag = +li.dataset.i; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', li.dataset.i); });
$('tocList').addEventListener('dragend', () => { tocS.drag = -1; $('tocList').querySelectorAll('.dragging,.drop-a,.drop-b').forEach((x) => x.classList.remove('dragging', 'drop-a', 'drop-b')); });
$('tocList').addEventListener('dragover', (e) => {
  const li = tocLi(e); if (!li || tocS.drag < 0) return;
  e.preventDefault();
  const r = li.getBoundingClientRect(), below = e.clientY > r.top + r.height / 2;
  $('tocList').querySelectorAll('.drop-a,.drop-b').forEach((x) => x.classList.remove('drop-a', 'drop-b'));
  li.classList.add(below ? 'drop-b' : 'drop-a');
});
$('tocList').addEventListener('drop', (e) => {
  const li = tocLi(e); if (!li || tocS.drag < 0) return;
  e.preventDefault();
  const from = tocS.drag, r = li.getBoundingClientRect();
  let to = +li.dataset.i + (e.clientY > r.top + r.height / 2 ? 1 : 0);
  if (to > from) to--;
  if (to === from) return;
  const [it] = tocS.toc.splice(from, 1); tocS.toc.splice(to, 0, it);
  tocChanged(to);
});

// ---- canlı sayfa önizlemesi (gölge DOM içinde gerçek şablon CSS'i) ----
function previewCss() {
  const css = (tocS.css && tocS.css[tocS.template]) || '';
  return css.replace(/@font-face\s*{[^}]*}/g, '').replace(/^\s*html\s*{/gm, '.pg {').replace(/^\s*body\s*{/gm, '.pg {')
    + `\n:host { display: block; } .pg { background: #fbf7ee; min-height: 640px; margin: 0 !important; padding: 7% 10% 12%; box-sizing: border-box; }
    .pg > section { break-before: auto; } .pg p[data-p] { cursor: pointer; border-radius: 3px; transition: background .15s; }
    .pg p[data-p]:hover { background: rgba(164,89,47,.08); } .pg p.pick { background: rgba(164,89,47,.18); box-shadow: -6px 0 0 rgba(164,89,47,.5); }
    .more { text-align: center; text-indent: 0; font-style: italic; opacity: .55; margin-top: 1.5em; } .empty { opacity: .55; text-align: center; text-indent: 0; margin-top: 30%; }`;
}
function renderPreview() {
  const host = $('readerHost');
  tocS.root ||= host.attachShadow({ mode: 'open' });
  const toc = tocS.toc, i = tocS.sel, it = toc[i];
  let head = '', range;
  if (it) {
    range = tocRanges()[i];
    const [label, title] = tocLabel(it);
    const lab = label ? `<p class="label">${escapeHtml(label)}</p>` : '';
    head = it.kind === 'part' ? `<div class="part" style="page-break-before:auto">${lab}<h1 class="part-title">${escapeHtml(title)}</h1><p class="orn">❧</p></div>`
      : it.level >= 3 ? `<h3 class="section-title">${escapeHtml(title)}</h3>`
      : `<div class="chapter-head">${lab}<h2 class="chapter-title">${escapeHtml(title)}</h2><p class="orn">❧</p></div>`;
  } else {
    const first = toc.length ? Math.min(...toc.map((x) => x.idx)) : tocS.paras.length;
    range = [0, first];
  }
  const LIMIT = 80, body = [], noise = tocNoise();
  let cls = it && it.kind !== 'part' && it.level < 3 && tocS.template === 'klasik' ? 'first' : 'no-indent', shown = 0;
  for (let p = range[0]; p < range[1] && shown < LIMIT; p++) {
    const t = (tocS.paras[p] || '').trim(); if (!t || noise.has(t.toLowerCase())) continue;
    if (SCENE_RE.test(t)) { body.push(`<p class="scene" data-p="${p}">*&#160;*&#160;*</p>`); cls = 'no-indent'; continue; }
    body.push(`<p data-p="${p}"${cls ? ` class="${cls}"` : ''}>${tocInline(t)}</p>`); cls = ''; shown++;
  }
  const rest = range[1] - range[0] - shown;
  const empty = !state.slug ? 'Önce bir kitap seç.' : !tocS.paras.length ? 'Düzeltilmiş metin bulunamadı.' : !body.length ? 'Bu başlığın altında metin yok.' : '';
  tocS.root.innerHTML = `<style>${previewCss()}</style><div class="pg"><section class="${it ? (it.kind === 'front' ? 'chapter front' : it.kind === 'part' ? '' : 'chapter') : ''}">${head}${body.join('')}
    ${empty ? `<p class="empty">${empty}</p>` : ''}${rest > LIMIT / 4 && body.length ? `<p class="more">… bölümün devamı (${fmtN(rest)} paragraf daha)</p>` : ''}</section></div>`;
  $('readerHost').closest('.reader-wrap').scrollTop = 0;
  $('pvPrev').disabled = i <= (toc.length && Math.min(...toc.map((x) => x.idx)) > 0 ? -1 : 0);
  $('pvNext').disabled = i >= toc.length - 1;
  tocS.pick = null; $('tocAdd').disabled = true;
}
$('readerHost').addEventListener('click', (e) => {
  const p = e.composedPath().find((x) => x.dataset && x.dataset.p !== undefined); if (!p) return;
  tocS.root.querySelectorAll('p.pick').forEach((x) => x.classList.remove('pick'));
  p.classList.add('pick'); tocS.pick = +p.dataset.p; $('tocAdd').disabled = false;
});
$('pvPrev').addEventListener('click', () => { tocS.sel--; renderTocTree(); renderPreview(); });
$('pvNext').addEventListener('click', () => { tocS.sel++; renderTocTree(); renderPreview(); });
$('tocAdd').addEventListener('click', () => {
  if (tocS.pick == null || !state.slug) return;
  const p = tocS.pick, text = (tocS.paras[p] || '').trim();
  const selTxt = ((tocS.root.getSelection ? tocS.root.getSelection() : document.getSelection())?.toString() || '').replace(/\s+/g, ' ').trim();
  const short = text.length <= 80 && !/[.!?…]["”»]?$/.test(text) && !text.includes('\n');
  const title = (selTxt && selTxt.length <= 120 ? selTxt : '') || (short ? text : 'Yeni Bölüm');
  const cur = tocS.toc[tocS.sel];
  const level = cur ? Math.max(2, cur.level) : 2;
  const item = { idx: p, title, level, kind: tocKindFor(level, title), virtual: !short };
  if (tocS.toc.some((x) => x.idx === p && x.virtual === item.virtual)) return toast('Bu satırda zaten bir başlık var.', true);
  const at = tocS.sel + 1;
  tocS.toc.splice(at, 0, item);
  tocChanged(at);
  toast(short ? 'Satır başlık yapıldı.' : 'Paragrafın önüne yeni başlık eklendi — adını çift tıkla değiştir.');
  if (!short && title === 'Yeni Bölüm') setTimeout(() => tocRename(at), 30);
});
$('structure-start').addEventListener('click', () => {
  if (!requireBook()) return;
  if (!state.st.exists.editorMd) return toast('Düzeltilmiş metin yok. Önce Düzeltme adımını çalıştır.', true);
  runTab('structure', ['detect_structure.py', '--input', state.st.paths.editorMd, '--book', state.slug, '--no-confirm'], async (code) => {
    if (code === 0) { appendLog('structure', '\n=== TESPİT TAMAMLANDI: bölüm ağacını kontrol et ===\n'); await loadStructureFields(); }
    else appendLog('structure', '\n=== HATA ===\n');
  });
});
$('openYapi').addEventListener('click', () => openIf('yapi', 'Yapı dosyası'));
$('saveStruct').addEventListener('click', async () => {
  if (!requireBook()) return;
  await api.saveStructure(state.slug, { title: $('structTitle').value, author: $('structAuthor').value });
  $('coverTitle').value = $('structTitle').value.trim();
  $('coverAuthor').value = $('structAuthor').value.trim();
  toast('Başlık/yazar kaydedildi.');
  refreshStatus();
});

// ---------- 4 Kapak: bez ciltli ERME BOOKS kapağı (coverGenerator.js) ----------
// İki mod: Otomatik (kitaba özel analiz + varyasyonlar) ve Manuel (renk, motif, kartuş, yazı, doku).
// Elle yapılan her seçim cloth.edit'e yazılır ve otomatik önerinin üstüne geçer.
const cloth = { studio: null, slug: null, theme: null, edit: {}, variant: 0, built: null, timer: 0, busy: false };
const CLOTH_ALT = { satranc: ['bordo', 'komur', 'gece'], botanik: ['orman', 'adacayi', 'kahve'], tuy: ['kahve', 'bordo', 'lacivert'], deniz: ['lacivert', 'deniz', 'gece'],
  gok: ['gece', 'lacivert', 'mor'], geometrik: ['bordo', 'petrol', 'antrasit'], kus: ['petrol', 'adacayi', 'lacivert'], anahtar: ['antrasit', 'murdum', 'sarap'], maske: ['murdum', 'bordo', 'gul'],
  artdeco: ['gece', 'komur', 'sarap'], minimal: ['krem', 'fildisi', 'kul'], gotik: ['sarap', 'komur', 'mor'], kesif: ['lacivert', 'deniz', 'kahve'], masal: ['lavanta', 'gece', 'gul'],
  tarih: ['kehribar', 'bordo', 'komur'], sark: ['petrol', 'sarap', 'safran'] };
const MOTIF_ALT = { satranc: ['satranc', 'tarih', 'geometrik'], botanik: ['botanik', 'kus', 'sark'], tuy: ['tuy', 'minimal', 'geometrik'], deniz: ['deniz', 'kesif', 'gok'], gok: ['gok', 'masal', 'minimal'],
  geometrik: ['geometrik', 'artdeco', 'minimal'], kus: ['kus', 'botanik', 'gok'], anahtar: ['anahtar', 'gotik', 'minimal'], maske: ['maske', 'artdeco', 'tuy'], artdeco: ['artdeco', 'geometrik', 'minimal'],
  minimal: ['minimal', 'geometrik', 'artdeco'], gotik: ['gotik', 'anahtar', 'gok'], kesif: ['kesif', 'deniz', 'gok'], masal: ['masal', 'gok', 'botanik'], tarih: ['tarih', 'satranc', 'geometrik'], sark: ['sark', 'botanik', 'geometrik'] };
const AUTO_STYLE = { artdeco: { kartus: 'rozet', font: 'sans' }, minimal: { kartus: 'cerceve' }, gotik: { kartus: 'kemer' }, masal: { kartus: 'oval' }, sark: { kartus: 'kemer' }, tarih: { kartus: 'kemer', doku: 'deri' }, kesif: { kartus: 'oval' } };
const KART_ALT = ['klasik', 'oval', 'kemer', 'rozet', 'cerceve'];
const FOIL_ALT = ['altin', 'bakir', 'gumus'];
function guessMotif(title) {   // analiz yokken ilk taslak için kaba tahmin
  const t = (title || '').toLowerCase();
  return /satran|chess/.test(t) ? 'satranc' : /deniz|gemi|kaptan|ada/.test(t) ? 'deniz' : /bahçe|çiçek|ağaç|orman/.test(t) ? 'botanik' : /gece|yıldız|ay /.test(t) ? 'gok' : 'geometrik';
}
function clothSpec() {
  const CG = window.CoverGen, th = cloth.theme || {}, ed = cloth.edit, v = cloth.variant;
  const m0 = th.motif || guessMotif($('coverTitle').value), mAlts = MOTIF_ALT[m0] || [m0];
  const motif = ed.motif || mAlts[Math.floor(v / 4) % mAlts.length];
  const st = { kartus: 'klasik', font: 'serif', doku: 'keten', ...(AUTO_STYLE[motif] || {}) };
  const alts = CLOTH_ALT[motif] || ['bordo'];
  const kumas = ed.kumas || (v ? alts[v % alts.length] : th.kumas || alts[0]);
  const varak = ed.varak || (v >= 3 ? FOIL_ALT[Math.floor(v / 3) % FOIL_ALT.length] : th.varak || 'altin');
  const kartus = ed.kartus || (v ? KART_ALT[(KART_ALT.indexOf(st.kartus) + v) % KART_ALT.length] : st.kartus);
  const words = th.kelime || state.sum?.stats?.words || 60000;
  return { title: $('coverTitle').value.trim() || slugTitle(state.slug || ''), author: $('coverAuthor').value.trim(), blurb: ed.ozet ?? th.ozet ?? '',
    motif, kumas, cloth: CG.CLOTHS[kumas] || kumas, foil: varak, varak, ink: ed.ink || null, cartouche: kartus, font: ed.font || st.font, texture: ed.doku || st.doku,
    spineW: ed.spineW || null, pages: Math.max(48, Math.round(words / 260)), variant: v };
}
function setEdit(k, v, delay = 0) { if (v === null || v === undefined) delete cloth.edit[k]; else cloth.edit[k] = v; delay ? scheduleCloth(delay) : renderCloth(); }
function ensureClothStudio() {
  if (cloth.studio || !window.CoverStudio) return;
  cloth.studio = window.CoverStudio.attach($('clothStage'));
  const CG = window.CoverGen;
  // sekmeler
  document.querySelectorAll('.cp-tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.cp-tabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.cp-pane').forEach((p) => p.classList.toggle('on', p.dataset.p === b.dataset.p));
  }));
  // renkler
  $('clothGroups').innerHTML = CG.CLOTH_GROUPS.map(([g, list]) => `<small class="cp-sub">${g}</small><div class="cp-swatches">${Object.entries(list).map(([k, [hex, n]]) =>
    `<button class="cp-sw" data-k="${k}" title="${n}" style="background:${hex}"></button>`).join('')}</div>`).join('');
  $('clothGroups').querySelectorAll('.cp-sw').forEach((el) => el.addEventListener('click', () => setEdit('kumas', el.dataset.k)));
  $('clothPick').addEventListener('input', (e) => setEdit('kumas', e.target.value, 60));
  $('clothHex').addEventListener('change', (e) => { let v = e.target.value.trim(); if (v && !v.startsWith('#')) v = '#' + v; if (/^#[0-9a-f]{6}$/i.test(v)) setEdit('kumas', v.toLowerCase()); else toast('Renk #rrggbb biçiminde olmalı.', true); });
  $('foilSel').innerHTML = Object.entries(CG.FOILS).map(([k, f]) => `<button class="cp-chip" data-k="${k}"><i style="background:${f.metal ? `linear-gradient(135deg, ${f.hex}, #fff9 50%, ${f.hex})` : f.hex}"></i>${f.name}</button>`).join('');
  $('foilSel').querySelectorAll('button').forEach((el) => el.addEventListener('click', () => setEdit('varak', el.dataset.k)));
  $('inkAuto').addEventListener('click', () => setEdit('ink', null));
  $('inkPick').addEventListener('input', (e) => setEdit('ink', e.target.value, 60));
  // motif kütüphanesi (kategorilere göre, küçük önizlemelerle)
  const cats = {}; for (const [k, m] of Object.entries(CG.MOTIFS)) (cats[m.cat] = cats[m.cat] || []).push(k);
  $('motifGrid').innerHTML = Object.entries(cats).map(([c, ks]) => `<small class="cp-sub">${c}</small><div class="cp-motifs">${ks.map((k) =>
    `<button class="cp-motif" data-k="${k}"><canvas width="132" height="44"></canvas><span>${CG.MOTIFS[k].name}</span></button>`).join('')}</div>`).join('');
  $('motifGrid').querySelectorAll('.cp-motif').forEach((el) => el.addEventListener('click', () => setEdit('motif', el.dataset.k)));
  $('cartSel').innerHTML = Object.entries(CG.CARTS).map(([k, n]) => `<button class="cp-chip" data-k="${k}"><b class="cart-ico ${k}"></b>${n}</button>`).join('');
  $('cartSel').querySelectorAll('button').forEach((el) => el.addEventListener('click', () => setEdit('kartus', el.dataset.k)));
  // yazı ve doku
  $('fontSel').innerHTML = Object.entries(CG.FONTS).map(([k, f]) => `<button class="cp-chip font" data-k="${k}" style="font-family:${f.family.replace(/"/g, "'")};font-weight:${f.weight}">${f.upper ? 'Aa' : 'Aa'} <small>${f.name}</small></button>`).join('');
  $('fontSel').querySelectorAll('button').forEach((el) => el.addEventListener('click', () => setEdit('font', el.dataset.k)));
  $('texSel').innerHTML = Object.entries(CG.TEXTURES).map(([k, n]) => `<button class="cp-chip tex-${k}" data-k="${k}"><i></i>${n}</button>`).join('');
  $('texSel').querySelectorAll('button').forEach((el) => el.addEventListener('click', () => setEdit('doku', el.dataset.k)));
  $('spineIn').addEventListener('input', (e) => setEdit('spineW', +e.target.value, 80));
  $('spineAuto').addEventListener('click', () => setEdit('spineW', null));
  $('blurbIn').addEventListener('input', () => setEdit('ozet', $('blurbIn').value, 350));
  document.querySelectorAll('.cs-views button').forEach((b) => b.addEventListener('click', () => cloth.studio && cloth.studio.showSide(b.dataset.v)));
}
function scheduleCloth(ms) { clearTimeout(cloth.timer); cloth.timer = setTimeout(renderCloth, ms); }
function renderCloth() {
  if (!window.CoverGen || !state.slug) return;
  const CG = window.CoverGen, spec = clothSpec(), ed = cloth.edit;
  cloth.built = CG.build(spec);
  if (cloth.studio) cloth.studio.setCover(cloth.built);
  // seçili durumlar
  const sel = (root, attr, val) => root.querySelectorAll(`[data-${attr}]`).forEach((el) => el.classList.toggle('sel', el.dataset[attr] === val));
  sel($('clothGroups'), 'k', spec.kumas); sel($('foilSel'), 'k', spec.varak); sel($('motifGrid'), 'k', spec.motif); sel($('cartSel'), 'k', spec.cartouche);
  sel($('fontSel'), 'k', spec.font); sel($('texSel'), 'k', spec.texture);
  $('clothPick').value = spec.cloth; if (document.activeElement !== $('clothHex')) $('clothHex').value = spec.cloth;
  $('clothName').textContent = CG.CLOTH_NAMES[spec.kumas] || 'Özel renk';
  const ai = CG.autoInk(spec.cloth), ink = spec.ink || ai.hex;
  $('inkAuto').innerHTML = `<i style="background:${ai.hex}"></i>Otomatik · ${ai.name}`; $('inkAuto').classList.toggle('sel', !spec.ink);
  $('inkPick').value = ink; const cr = CG.contrast(spec.cloth, ink);
  $('inkNote').textContent = `kontrast ${cr.toFixed(1)}:1${cr < 3 ? ' · zor okunur' : ''}`; $('inkNote').classList.toggle('warn', cr < 3);
  $('motifGrid').querySelectorAll('.cp-motif canvas').forEach((cv) => CG.preview(cv, cv.parentElement.dataset.k, spec.cloth, spec.varak));
  const sw = cloth.built.regions.spine[1] - cloth.built.regions.spine[0];
  if (document.activeElement !== $('spineIn')) $('spineIn').value = sw;
  $('spineVal').textContent = ed.spineW ? '· elle' : `· otomatik (${fmtN(spec.pages)} sayfa)`; $('spineAuto').classList.toggle('sel', !ed.spineW);
  if (document.activeElement !== $('blurbIn')) $('blurbIn').value = spec.blurb;
  renderThemeBox(spec);
}
function renderThemeBox(spec) {
  const th = cloth.theme, CG = window.CoverGen, n = Object.keys(cloth.edit).filter((k) => k !== 'ozet').length;
  const row = (k, v) => (v ? `<div class="tb-row"><span>${k}</span><b>${escapeHtml(v)}</b></div>` : '');
  const look = spec ? `<div class="tb-look"><i style="background:${spec.cloth}"></i><span>${escapeHtml(CG.CLOTH_NAMES[spec.kumas] || 'Özel renk')} · ${escapeHtml(CG.FOILS[spec.varak]?.name || '')} · ${escapeHtml(CG.MOTIFS[spec.motif]?.name || '')} · ${escapeHtml(CG.CARTS[spec.cartouche] || '')}</span></div>` : '';
  if (!th) { $('themeBox').innerHTML = `<p class="muted">Tema henüz çıkarılmadı.</p>${look}`; return; }
  $('themeBox').innerHTML = `<p class="tb-kicker">KİTABIN TEMASI <em>${escapeHtml(th.kaynak || '')}</em></p>
    ${row('Tür', th.tur)}${row('Duygu', th.duygu)}${row('Dönem', th.donem)}
    ${th.semboller?.length ? `<div class="tb-chips">${th.semboller.map((x) => `<span>${escapeHtml(x)}</span>`).join('')}</div>` : ''}
    ${look}${cloth.variant ? `<div class="tb-row"><span>Varyasyon</span><b>${cloth.variant}</b></div>` : ''}${n ? `<div class="tb-row"><span>Elle değiştirilen</span><b>${n} seçim</b></div>` : ''}`;
}
async function loadCloth() {
  if (!state.slug || !window.CoverGen) return;
  if (cloth.slug !== state.slug) { cloth.slug = state.slug; cloth.theme = null; cloth.edit = {}; cloth.variant = 0; }
  const saved = await api.readCloth(state.slug);
  if (saved && !cloth.theme) {
    cloth.theme = saved.theme || saved; cloth.edit = saved.edit || {}; cloth.variant = saved.variant || 0;
    $('clothNote').textContent = 'Onaylanmış kapak yüklendi. Değişiklik yapıp yeniden onaylayabilirsin.';
  }
  renderCloth();
  if (!cloth.theme) analyzeCloth();
}
async function analyzeCloth() {
  if (!state.slug || cloth.busy) return;
  cloth.busy = true; $('clothBusy').classList.add('show'); $('clothNote').textContent = ''; $('clothSuggest').disabled = true;
  const slug = state.slug;
  const r = await api.analyzeCover(slug, { title: $('coverTitle').value.trim() || slugTitle(slug), author: $('coverAuthor').value.trim() });
  cloth.busy = false; $('clothBusy').classList.remove('show'); $('clothSuggest').disabled = false;
  if (slug !== state.slug) return;
  if (r.error) { $('clothNote').textContent = 'Analiz yapılamadı, kitabın adına göre bir tema kullanılıyor: ' + r.error; return; }
  cloth.theme = r.data; cloth.edit = {}; cloth.variant = 0;
  renderCloth();
  $('clothNote').textContent = r.data.kaynak === 'sezgisel' ? 'Yerel model kullanılamadı; tema anahtar kelimelerden seçildi. Arka kapak yazısını Yazı & Doku sekmesinden yazabilirsin.' : '';
}
$('clothSuggest').addEventListener('click', () => { if (requireBook()) { cloth.theme = null; cloth.edit = {}; cloth.variant = 0; analyzeCloth(); } });
$('clothRegen').addEventListener('click', () => {   // aynı temanın başka bir yorumu: kumaş tonu, kartuş, varak ve yakın motifler sırayla değişir
  if (!requireBook()) return;
  cloth.variant++; for (const k of ['kumas', 'varak', 'kartus', 'motif']) delete cloth.edit[k];
  renderCloth();
});
$('clothApprove').addEventListener('click', async () => {
  if (!requireBook() || !cloth.built) return;
  const b = cloth.built, spec = clothSpec();
  const r = await api.saveCloth(state.slug, { front: b.frontHiJpeg(0.92), spread: b.spreadJpeg(0.9),
    theme: { theme: cloth.theme, edit: cloth.edit, variant: cloth.variant, spec, regions: b.regions, W: b.W, H: b.H } });
  toast('Kapak onaylandı: EPUB kapağı ve kütüphanedeki 3D kitap güncellendi.');
  $('clothNote').textContent = 'Onaylandı. EPUB adımında bu kapak kullanılacak.';
  showCover(r.src); refreshStatus();
});

// ---------- 4 Kapak (eski, maskotlu) ----------
function renderSwatches() {
  $('swatches').innerHTML = Object.entries(SWATCHES)
    .map(([name, rgb]) => `<div class="swatch" data-c="${name}" title="${name}" style="background:${hex(rgb)}"></div>`).join('');
  document.querySelectorAll('.swatch').forEach((s) => s.addEventListener('click', () => setColor(s.dataset.c)));
}
function setColor(c, regen = true) {
  state.color = c;
  const isHex = c.startsWith('#');
  $('hexInput').value = isHex ? c : '';
  $('colorPicker').value = isHex ? c : hex(SWATCHES[c] || [245, 102, 45]);
  document.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('sel', s.dataset.c === c));
  if (regen) scheduleCover(0);
}
$('colorPicker').addEventListener('input', (e) => setColor(e.target.value));
$('hexInput').addEventListener('change', (e) => {
  let v = e.target.value.trim();
  if (v && !v.startsWith('#')) v = '#' + v;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) setColor(v.toLowerCase());
  else toast('Renk kodu #rrggbb biçiminde olmalı.', true);
});
$('animalSelect').addEventListener('change', () => { if (ensureMascot($('animalSelect').value)) scheduleCover(0); });
['coverTitle', 'coverAuthor'].forEach((id) => $(id).addEventListener('input', () => scheduleCloth(300)));
$('legacyCover').addEventListener('toggle', () => { if ($('legacyCover').open) ensureShowcase('cover'); });

function scheduleCover(delay) {
  clearTimeout(state.coverTimer);
  state.coverTimer = setTimeout(() => generateCover(false), delay);
}
async function generateCover(showErrors) {
  if (!state.slug) return;
  const title = $('coverTitle').value.trim(), author = $('coverAuthor').value.trim();
  if (!title && !author) return;
  const seq = ++state.coverSeq;
  const r = await api.generateCover(state.slug, { title, author, color: state.color, animal: $('animalSelect').value || 'penguin' });
  if (seq !== state.coverSeq) return;
  if (r.error) { if (showErrors) toast('Kapak oluşturulamadı: ' + r.error, true); return; }
  showCover(r.src);
  refreshStatus();
}
function showCover(src) {
  const img = $('coverImg');
  if (src) { img.src = src; img.classList.remove('show'); void img.offsetWidth; img.classList.add('show'); $('coverEmpty').style.display = 'none'; }
  else { img.classList.remove('show'); $('coverEmpty').style.display = ''; }
  $('coverOpen').disabled = !src;
  state.coverSrc = src || null;
  $('coverImg').closest('.cover-frame').classList.toggle('has', !!src);
  if (showcases.cover) showcases.cover.setCover(src, $('coverTitle').value, $('coverAuthor').value);
  if (showcases.epub) showcases.epub.setCover(src, state.sum?.structure?.title || state.slug, state.sum?.structure?.author || '');
}
async function refreshCover() {
  state.mascots = await api.listMascots();
  const { all, available } = state.mascots;
  const list = all.length ? all : ['penguin'];
  const sel = $('animalSelect'), prev = sel.value;
  sel.innerHTML = list.map((m) => `<option value="${m}">${available.includes(m) ? m : m + '  (yok · seçince üretilir)'}</option>`).join('');
  sel.value = list.includes(prev) ? prev : (available[0] || list[0]);
  const missing = list.length - available.length;
  $('mascotWarn').textContent = missing ? `${missing} maskot henüz üretilmemiş. Seçtiğinde otomatik üretilir.` : '';
  if (!state.slug) return showCover(null);
  if (!$('coverTitle').value && !$('coverAuthor').value) {
    $('coverTitle').value = $('structTitle').value; $('coverAuthor').value = $('structAuthor').value;
  }
  showCover(await api.readCover(state.slug));
  loadCloth();
}
function ensureMascot(name) {
  if (state.mascots.available.includes(name)) return true;
  if (state.running) { toast('Başka bir işlem çalışıyor, bitince hayvanı tekrar seç.', true); return false; }
  toast(`'${name}' maskotu yok, üretiliyor (1–2 dk)…`);
  runTab('cover', ['generate_mascots_ai.py', '--only', name], async (code) => {
    await refreshCover();
    if (code === 0 && state.mascots.available.includes(name)) {
      $('animalSelect').value = name;
      toast(`'${name}' maskotu hazır.`);
      generateCover(true);
    } else toast(`'${name}' maskotu üretilemedi, alttaki günlüğe bak.`, true);
  });
  return false;
}
$('cover-start').addEventListener('click', () => runTab('cover', ['generate_mascots_ai.py', '--missing'], async (code) => {
  await refreshCover();
  toast(code === 0 ? 'Eksik maskotlar üretildi.' : 'Bazı maskotlar üretilemedi, günlüğe bak.', code !== 0);
}));
$('coverGen').addEventListener('click', () => { if (requireBook()) generateCover(true); });
$('coverOpen').addEventListener('click', () => openIf('cover', 'Kapak'));

async function suggest(confirm) {
  if (!requireBook()) return;
  const title = $('coverTitle').value.trim(), author = $('coverAuthor').value.trim();
  if (!title || !author) return toast('Önce başlık ve yazar alanlarını doldur.', true);
  $('coverSuggest').disabled = true;
  $('coverReason').textContent = confirm ? `'${confirm.baslik}' seçildi, özet çekiliyor…` : 'Kitaba göre öneri hazırlanıyor…';
  const r = await api.suggestCover(state.slug, { title, author, confirmTitle: confirm?.baslik, confirmLang: confirm?.lang });
  $('coverSuggest').disabled = false;
  if (r.error) { $('coverReason').textContent = 'Öneri alınamadı: ' + r.error; return; }
  const d = r.data;
  if (d.durum === 'belirsiz') return openCandidates(d.adaylar || []);
  const options = [...$('animalSelect').options].map((o) => o.value);
  if (d.hayvan && options.includes(d.hayvan)) $('animalSelect').value = d.hayvan;
  if (d.renk) setColor(d.renk, false);
  $('coverReason').textContent = `Öneri: ${d.hayvan || '-'} + ${d.renk || '-'}\n${d.gerekce || ''}`;
  if (ensureMascot($('animalSelect').value)) generateCover(true);
}
$('coverSuggest').addEventListener('click', () => suggest(null));

function openCandidates(cands) {
  if (!cands.length) { $('coverReason').textContent = 'Kitap internette bulunamadı, aday da yok. Rengi/hayvanı elle seçebilirsin.'; return; }
  state.cands = cands; state.candSel = -1;
  $('candList').innerHTML = cands.map((c, i) =>
    `<div class="cand" data-i="${i}"><b>[${c.lang === 'tr' ? 'TR' : 'EN'}] ${c.baslik || ''}</b>${c.aciklama ? `<small>${c.aciklama.slice(0, 110)}</small>` : ''}</div>`).join('');
  document.querySelectorAll('.cand').forEach((el) => el.addEventListener('click', () => {
    state.candSel = +el.dataset.i;
    document.querySelectorAll('.cand').forEach((x) => x.classList.toggle('sel', x === el));
  }));
  $('candModal').classList.add('show');
}
$('candOk').addEventListener('click', () => {
  if (state.candSel < 0) return toast("Listeden bir kitap seç ya da 'Hiçbiri' de.", true);
  $('candModal').classList.remove('show');
  suggest(state.cands[state.candSel]);
});
$('candNone').addEventListener('click', () => {
  $('candModal').classList.remove('show');
  $('coverReason').textContent = 'Kitap listede yoktu, öneri uygulanmadı; rengi ve hayvanı elle seçebilirsin.';
});

// ---------- 5 EPUB ----------
$('epub-start').addEventListener('click', () => {
  if (!requireBook()) return;
  if (!state.st.exists.editorMd) return toast('Düzeltilmiş metin yok. Önce Düzeltme adımını çalıştır.', true);
  $('epDone').hidden = true;
  runTab('epub', ['build_epub.py', '--book', state.slug], async (code) => {
    appendLog('epub', code === 0 ? `\n=== EPUB HAZIR: ${state.st.paths.epub} ===\n` : code === 2 ? '\n=== EPUB OLUŞTU AMA DOĞRULAMADA SORUN VAR ===\n' : '\n=== HATA ===\n');
    if (code !== 0 && code !== 2) return openLog('epub');
    await refreshStatus();
    if (showcases.epub) showcases.epub.setCover(state.coverSrc, state.sum?.structure?.title || state.slug, state.sum?.structure?.author || '');
    if (code === 2) { openLog('epub'); toast('EPUB oluştu ama doğrulamada sorun bulundu; ayrıntılar günlükte.', true); }
    else toast(`'${state.sum?.structure?.title || state.slug}' EPUB olarak hazır.`);
  });
});
$('openEpubFolder').addEventListener('click', () => api.openEpubFolder());
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
let epSum = null;
async function renderEpubResult() {
  const slug = state.slug, e = state.st?.exists || {};
  if (!slug || !e.epub) { $('epDone').hidden = true; epSum = null; return; }
  const s = await api.epubSummary(slug).catch(() => null);
  if (slug !== state.slug) return;
  epSum = s;
  if (!s) { $('epDone').hidden = true; return; }
  const st = state.sum?.structure || {};
  $('epDone').hidden = false;
  $('erCover').style.backgroundImage = state.coverSrc ? `url("${state.coverSrc}")` : '';
  $('erCover').classList.toggle('none', !state.coverSrc);
  $('erName').textContent = s.title || st.title || slug;
  const when = new Date(s.mtime).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  $('erSub').textContent = [s.author || st.author, s.templateName, when].filter(Boolean).join(' · ');
  $('erBadge').textContent = s.valid === false ? 'EPUB oluştu · doğrulamada uyarı var' : 'EPUB 3 hazır · doğrulandı';
  $('epDone').classList.toggle('warn', s.valid === false);
  const chapters = s.chapters ?? st.chapters?.length ?? 0;
  const rows = [['Boyut', fmtSize(s.size)], ['Bölüm', fmtN(chapters + (s.front || 0))], s.parts ? ['Kısım', fmtN(s.parts)] : null, ['Sayfa', `~${fmtN(s.pagesEst || state.sum?.stats?.pagesEst || 0)}`]].filter(Boolean);
  $('erStats').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
}
$('erSave').addEventListener('click', async () => {
  if (!epSum) return;
  const r = await api.saveEpubAs(epSum.file, [epSum.author, epSum.title].filter(Boolean).join(' - ') || state.slug);
  if (r?.error) toast(r.error, true);
  else if (r?.path) toast(`Kaydedildi: ${r.path}`);
});
$('erHollow').addEventListener('click', () => {   // kitabı tamamlanmış haliyle kovuk rafında göster
  if (!state.slug) return;
  const id = `e:${state.slug}`;
  if (!$('page-home').classList.contains('active')) showTab('home');
  requestAnimationFrame(() => enterHollow(id));
});
$('erRead').addEventListener('click', () => { if (epSum) openReader(epSum.file); });

// ---------- uygulama içi okuyucu ----------
// EPUB'un kendisini açar (epub_read.py): kitabın kendi CSS'i ve gömülü ERME yazı tipleriyle, sayfa sayfa.
const RV_KEY = 'erme.reader.v1';
const rv = { d: null, file: '', idx: 0, page: 0, pages: 1, fs: 18, root: null, W: 0, H: 0, busy: false, wheelT: 0 };
try { rv.fs = JSON.parse(localStorage.getItem(RV_KEY) || '{}').fs || 18; } catch {}
function rvStore(patch) {
  try {
    const o = JSON.parse(localStorage.getItem(RV_KEY) || '{}');
    o.pos ||= {};
    if (patch.pos) o.pos[rv.file] = patch.pos;
    if (patch.fs) o.fs = patch.fs;
    localStorage.setItem(RV_KEY, JSON.stringify(o));
  } catch {}
}
function rvSavedPos(file) { try { return JSON.parse(localStorage.getItem(RV_KEY) || '{}').pos?.[file] || null; } catch { return null; } }
function rvBookCss(css) {
  return (css || '').replace(/(^|[\s,}])(html|body)(?=[\s,{.#:>[])/g, '$1.bk');
}
async function openReader(file) {
  if (!file) return;
  const view = $('readerView');
  view.hidden = false; void view.offsetWidth; view.classList.add('show');
  $('rvBusy').classList.add('show'); $('rvTitle').textContent = ''; $('rvAuthor').textContent = '';
  rv.root ||= $('rvPage').attachShadow({ mode: 'open' });
  rv.root.innerHTML = '';
  const d = await api.readEpub(file).catch((err) => ({ error: String(err) }));
  $('rvBusy').classList.remove('show');
  if (!view.classList.contains('show')) return;
  if (!d || d.error || !d.spine?.length) { toast(d?.error || 'Bu EPUB\'da okunacak bölüm bulunamadı.', true); closeReader(); return; }
  Object.assign(rv, { d, file });
  $('rvTitle').textContent = d.title || 'Adsız kitap'; $('rvAuthor').textContent = d.author || '';
  $('rvTocList').innerHTML = (d.toc.length ? d.toc : d.spine.map((s, k) => ({ title: `Bölüm ${k + 1}`, spine: k, frag: '', level: 1 })))
    .map((t) => `<li class="l${Math.min(3, t.level)}"><button data-s="${t.spine}" data-f="${escapeHtml(t.frag || '')}">${escapeHtml(t.title || '—')}</button></li>`).join('');
  const pos = rvSavedPos(file);
  rvShow(pos ? Math.min(pos.idx, d.spine.length - 1) : 0, pos ? pos.frac : 0);
}
function closeReader() {
  const view = $('readerView');
  view.classList.remove('show', 'toc-open');
  setTimeout(() => { if (!view.classList.contains('show')) { view.hidden = true; if (rv.root) rv.root.innerHTML = ''; rv.d = null; } }, 300);
}
function rvMeasure() {
  const st = $('rvStage').getBoundingClientRect();
  rv.H = Math.max(320, Math.floor(st.height - 24));
  rv.W = Math.max(300, Math.min(680, Math.floor(rv.H * 0.7), Math.floor(st.width - 140)));
  $('rvPage').style.width = rv.W + 'px'; $('rvPage').style.height = rv.H + 'px';
}
// where: sayfa kesri (0..1), 'end' ya da '#parça'
function rvShow(idx, where = 0) {
  const d = rv.d; if (!d) return;
  rv.idx = Math.max(0, Math.min(d.spine.length - 1, idx));
  rvMeasure();
  const padX = Math.round(rv.W * 0.09), padY = Math.round(rv.H * 0.07), cw = rv.W - 2 * padX;
  rv.root.innerHTML = `<style>${rvBookCss(d.css)}
    :host { display: block; }
    .vp { width: ${rv.W}px; height: ${rv.H}px; overflow: hidden; background: #fbf7ee; box-sizing: border-box; padding: ${padY}px ${padX}px; position: relative; }
    .cols { width: ${cw}px; height: ${rv.H - 2 * padY}px; column-width: ${cw}px; column-gap: ${2 * padX}px; column-fill: auto; transition: transform .38s cubic-bezier(.3,.7,.2,1); }
    .bk { margin: 0 !important; padding: 0 !important; font-size: ${rv.fs}px; color: #1d1915; }
    .bk img, .bk svg { max-width: 100%; max-height: ${rv.H - 2 * padY - 4}px; height: auto; break-inside: avoid; }
    .bk a[data-href], .bk a[data-ext] { color: inherit; text-decoration: underline; text-decoration-color: rgba(138,106,74,.5); cursor: pointer; }
    .bk .chapter, .bk .part { break-before: auto !important; page-break-before: auto !important; }
    .bk .chapter-head { margin-top: 12% !important; } .bk .part .label { margin-top: 30% !important; }
    .bk .titlepage h1 { margin-top: 20% !important; } .bk .titlepage .imprint { margin-top: 25% !important; }
  </style><div class="vp"><div class="cols"><div class="bk" lang="${escapeHtml((d.language || 'tr').slice(0, 5))}">${d.spine[rv.idx].html}</div></div></div>`;
  const cols = rv.root.querySelector('.cols');
  cols.style.transition = 'none';
  rv.pages = Math.max(1, Math.round((cols.scrollWidth + 2 * padX) / rv.W));
  let page = 0;
  if (where === 'end') page = rv.pages - 1;
  else if (typeof where === 'string' && where.startsWith('#')) {
    const el = where.length > 1 && rv.root.getElementById(where.slice(1));
    if (el) page = Math.floor((el.getBoundingClientRect().left - cols.getBoundingClientRect().left) / rv.W);
  } else page = Math.round((+where || 0) * (rv.pages - 1));
  rvGo(page, false);
  requestAnimationFrame(() => { cols.style.transition = ''; });
}
function rvGo(page, save = true) {
  rv.page = Math.max(0, Math.min(rv.pages - 1, page));
  const cols = rv.root.querySelector('.cols');
  if (cols) cols.style.transform = `translateX(${-rv.page * rv.W}px)`;
  const d = rv.d, n = d.spine.length;
  const cur = [...d.toc].reverse().find((t) => t.spine === rv.idx) || [...d.toc].reverse().find((t) => t.spine < rv.idx);
  $('rvWhere').textContent = cur ? cur.title : d.title || '';
  $('rvPageNo').textContent = `Sayfa ${rv.page + 1} / ${rv.pages}`;
  $('rvBar').style.width = `${((rv.idx + (rv.pages > 1 ? rv.page / (rv.pages - 1) : 1)) / n) * 100}%`;
  $('rvPrev').disabled = rv.idx === 0 && rv.page === 0;
  $('rvNext').disabled = rv.idx === n - 1 && rv.page === rv.pages - 1;
  $('rvTocList').querySelectorAll('button').forEach((b) => b.classList.toggle('on', cur && +b.dataset.s === cur.spine && b.textContent === cur.title));
  if (save) rvStore({ pos: { idx: rv.idx, frac: rv.pages > 1 ? rv.page / (rv.pages - 1) : 0 } });
}
function rvNext() { if (!rv.d) return; if (rv.page < rv.pages - 1) rvGo(rv.page + 1); else if (rv.idx < rv.d.spine.length - 1) { rvShow(rv.idx + 1, 0); rvStore({ pos: { idx: rv.idx, frac: 0 } }); } }
function rvPrev() { if (!rv.d) return; if (rv.page > 0) rvGo(rv.page - 1); else if (rv.idx > 0) { rvShow(rv.idx - 1, 'end'); rvStore({ pos: { idx: rv.idx, frac: 1 } }); } }
function rvFont(dlt) {
  rv.fs = Math.max(13, Math.min(28, rv.fs + dlt)); rvStore({ fs: rv.fs });
  const frac = rv.pages > 1 ? rv.page / (rv.pages - 1) : 0; rvShow(rv.idx, frac);
}
$('rvNext').addEventListener('click', rvNext);
$('rvPrev').addEventListener('click', rvPrev);
$('rvClose').addEventListener('click', closeReader);
$('rvBigger').addEventListener('click', () => rvFont(1));
$('rvSmaller').addEventListener('click', () => rvFont(-1));
$('rvToc').addEventListener('click', () => $('readerView').classList.toggle('toc-open'));
$('rvTocList').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  rvShow(+b.dataset.s, b.dataset.f ? '#' + b.dataset.f : 0); rvGo(rv.page);
  $('readerView').classList.remove('toc-open');
});
$('rvPage').addEventListener('click', (e) => {
  const a = e.composedPath().find((x) => x.dataset && (x.dataset.href !== undefined || x.dataset.ext !== undefined)); if (!a) return;
  e.preventDefault();
  if (a.dataset.ext) return;   // dış bağlantılar okuyucuda açılmaz
  const [s, f] = a.dataset.href.split('#');
  rvShow(+s, f ? '#' + f : 0); rvGo(rv.page);
});
$('rvStage').addEventListener('wheel', (e) => {
  e.preventDefault();
  const t = performance.now(); if (t - rv.wheelT < 280 || Math.abs(e.deltaY) < 4) return;
  rv.wheelT = t; e.deltaY > 0 ? rvNext() : rvPrev();
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if ($('readerView').hidden) return;
  const k = e.key;
  const act = { ArrowRight: rvNext, PageDown: rvNext, ' ': rvNext, ArrowLeft: rvPrev, PageUp: rvPrev, Escape: () => ($('readerView').classList.contains('toc-open') ? $('readerView').classList.remove('toc-open') : closeReader()),
    '+': () => rvFont(1), '=': () => rvFont(1), '-': () => rvFont(-1), t: () => $('readerView').classList.toggle('toc-open'), T: () => $('readerView').classList.toggle('toc-open'),
    Home: () => rvGo(0), End: () => rvGo(rv.pages - 1) }[k];
  if (!act) return;
  e.preventDefault(); e.stopPropagation(); act();
}, true);
let rvResizeT = 0;
window.addEventListener('resize', () => {
  if ($('readerView').hidden || !rv.d) return;
  clearTimeout(rvResizeT);
  rvResizeT = setTimeout(() => rvShow(rv.idx, rv.pages > 1 ? rv.page / (rv.pages - 1) : 0), 150);
});

// ---------- ana sayfa: hayat ağacı ----------
let tree = null, introDone = false;
const STEP_NAMES = { ocr: 'OCR Tarama', editor: 'Düzeltme', structure: 'Yapı & Dizgi', cover: 'Kapak', epub: 'EPUB' };
function ensureTree() {
  if (tree || !introDone || !window.TreeHome) return;
  tree = window.TreeHome.attach($('treeWrap'), { onPick: (tab) => showTab(tab), onHollow: enterHollow });
  if (tree) { tree.setSeason(document.body.dataset.season); updateHome(); }
}
// ---------- ağacın kovuğundaki kütüphane ----------
let hollowLib = null, hollowDummy = null;
const slugTitle = (s) => s.replace(/_test_\d+$/, '').replace(/[_-]+/g, ' ');
async function enterHollow(focus) {   // focus: rafta öne çıkarılacak kitap kimliği (ör. 'e:slug')
  if (!window.HollowLibrary) { showTab('library'); return; }
  if (!hollowLib) hollowLib = window.HollowLibrary.attach($('hollowWrap'), {
    onCovered: () => tree && tree.setPaused(true),
    onExit: () => { if (tree) { tree.setPaused(false); tree.reset(); } },
    onOpen: openFromHollow,
  });
  if (!hollowLib) { showTab('library'); return; }
  if (hollowLib.active) { if (typeof focus === 'string') hollowLib.focus(focus); return; }
  hollowLib.enter(await hollowBooks(), document.body.dataset.season, typeof focus === 'string' ? focus : null);
}
async function hollowBooks() {
  let lib = [], projects = [];
  try { [lib, projects] = await Promise.all([api.listLibrary(), api.listBooks()]); } catch {}
  libBooks = lib;
  const own = new Set(lib.map((b) => b.slug));
  return [
    ...lib.map((b) => ({ ...b, id: `e:${b.slug}`, kind: 'epub' })),
    ...(await Promise.all(projects.filter((p) => !own.has(p)).map(async (p) => ({ id: `p:${p}`, kind: 'project', slug: p, title: slugTitle(p), author: '', color: '#5a3a26', wrap: await api.coverWrap(p).catch(() => null) })))),
  ];
}
// EPUB dosyalarını kütüphanenin üstüne sürükleyip bırakınca rafa eklenir
{ const hw = $('hollowWrap');
  ['dragenter', 'dragover'].forEach((ev) => hw.addEventListener(ev, (e) => { e.preventDefault(); hw.classList.add('drag'); }));
  hw.addEventListener('dragleave', (e) => { if (!hw.contains(e.relatedTarget)) hw.classList.remove('drag'); });
  hw.addEventListener('drop', async (e) => {
    e.preventDefault(); hw.classList.remove('drag');
    const files = [...e.dataTransfer.files].filter((f) => f.name.toLowerCase().endsWith('.epub')).map((f) => api.pathForFile(f));
    if (!files.length) return toast('Sadece .epub dosyaları rafa eklenebilir.', true);
    const n = await api.addEpubs(files);
    toast(n ? `${n} kitap rafa eklendi.` : 'Bu kitaplar zaten rafta.', !n);
    if (n && hollowLib?.active) hollowLib.setBooks(await hollowBooks());
  }); }
function exitHollow() { if (hollowLib && hollowLib.active) hollowLib.exit(); }
$('hlBack').addEventListener('click', exitHollow);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && hollowLib?.active && !bv) exitHollow(); });
function openFromHollow(b) {
  if (b.kind === 'project') {   // proje: kütüphaneden çık, kitabı seç, sıradaki adıma git
    exitHollow();
    setTimeout(async () => { $('bookSelect').value = b.slug; state.slug = b.slug; await onBookChanged(); const hs = homeState(); showTab(hs.next || 'editor'); }, 900);
    return;
  }
  // EPUB: mevcut kitap görünümü, kütüphanenin üstünde açılır
  if (!hollowDummy) { hollowDummy = document.createElement('div'); hollowDummy.className = 'hl-dummy'; document.body.appendChild(hollowDummy); }
  openBook(b, hollowDummy);
}
function homeState() {
  const e = state.st?.exists || {};
  const done = { ocr: !!e.md, editor: !!e.editorMd, structure: !!e.yapi, cover: !!e.cover, epub: !!e.epub };
  const next = state.slug ? TABS.find((t) => !done[t]) || null : 'ocr';
  return { done, next, running: state.running || null };
}
function updateHome() {
  if (!$('homeTitle')) return;
  const hs = homeState(), n = TABS.filter((t) => hs.done[t]).length;
  if (tree) {
    tree.setState(hs);
    const d = state.sum || {};
    tree.setInfo({
      cover: state.coverSrc || null, pct: n / 5,
      details: {
        ocr: d.ocr?.pages ? `${fmtN(d.ocr.pages)} sayfa · ${d.ocr.models.length} model` : 'Henüz okunmadı',
        editor: d.changes?.items?.length ? `${fmtN(d.changes.total)} düzeltme · ${d.review?.length || 0} elle bakılacak` : 'Henüz düzeltilmedi',
        structure: d.structure ? `${d.structure.chapters?.length || 0} bölüm · ${d.structure.title || ''}` : 'Başlık ve bölümler bekliyor',
        cover: hs.done.cover ? 'ERME BOOKS kapağı hazır' : 'Kapak henüz yok',
        epub: hs.done.epub ? 'EPUB hazır · Kitaplıkta' : 'EPUB henüz oluşturulmadı',
      },
    });
  }
  refreshHomeStats(n);
  const s = state.sum || {};
  $('homeTitle').textContent = state.slug ? (s.structure?.title || state.slug) : 'Hoş geldin';
  $('homeSub').textContent = !state.slug ? 'Başlamak için bir PDF ekle; kitap adım adım dallara tırmanacak.'
    : `${s.structure?.author ? s.structure.author + ' · ' : ''}${n} / 5 adım tamamlandı${state.running ? ' · şu an: ' + STEP_NAMES[state.running] : ''}`;
  $('homeBar').style.width = (n / 5) * 100 + '%';
  const btn = $('homeNext');
  if (!state.slug) { btn.innerHTML = 'Yeni PDF Ekle →'; btn.dataset.go = 'pdf'; }
  else if (state.running) { btn.innerHTML = `${STEP_NAMES[state.running]} sürüyor · izle →`; btn.dataset.go = state.running; }
  else if (hs.next) { btn.innerHTML = `Devam et: ${STEP_NAMES[hs.next]} →`; btn.dataset.go = hs.next; }
  else { btn.innerHTML = 'Kitap hazır · Kitaplıkta gör →'; btn.dataset.go = 'library'; }
}
// alttaki istatistik satırı: kitaplık ve bu kitap
let libCount = null;
async function refreshHomeStats(n) {
  if (libCount === null) { try { libCount = (await api.listLibrary()).length; } catch { libCount = 0; } }
  const d = state.sum || {}, parts = [`Kitaplıkta ${fmtN(libCount)} kitap`];
  if (state.slug) { parts.push(`'${d.structure?.title || state.slug}'`); if (d.stats?.words) parts.push(`${fmtN(d.stats.words)} kelime`, `~${fmtN(d.stats.pagesEst)} sayfa`); parts.push(`${n} / 5 adım`); }
  const el = document.querySelector('.home-hint'); if (el) el.textContent = parts.join(' · ');
}
$('homeNext').addEventListener('click', async () => {
  const go = $('homeNext').dataset.go;
  if (go === 'pdf') { const s = await api.pickPdf(); if (s) loadBooks(s); return; }
  showTab(go);
});
$('homeIntro').addEventListener('click', () => window.BookIntro && window.BookIntro.play(() => tree && tree.grow()));
// mevsim kadranı (ana sayfanın altında): ortadaki seçili, yanlardaki öncekiler/sonrakiler
(function buildDialTicks() {
  const g = $('dialTicks'); let h = '';
  for (let i = 0; i <= 44; i++) {
    const a = Math.PI * (1.08 + (i / 44) * 0.84), long = i % 4 === 0, r0 = 104, r1 = long ? 92 : 97;
    const cx = 180, cy = 122;
    h += `<line x1="${(cx + Math.cos(a) * r0).toFixed(1)}" y1="${(cy + Math.sin(a) * r0).toFixed(1)}" x2="${(cx + Math.cos(a) * r1).toFixed(1)}" y2="${(cy + Math.sin(a) * r1).toFixed(1)}" class="${long ? 'l' : ''}"/>`;
  }
  g.innerHTML = h;
})();
function updateDial(s) {
  const order = SEASON_ORDER, i = order.indexOf(s);
  $('dialLabel').textContent = { kis: 'Kış', ilkbahar: 'İlkbahar', yaz: 'Yaz', sonbahar: 'Sonbahar' }[s];
  $('dialLabel').classList.remove('pop'); void $('dialLabel').offsetWidth; $('dialLabel').classList.add('pop');
  // dört mevsim yan yana; seçili olan büyür, kadranın çizgileri ona doğru döner
  document.querySelectorAll('#seasonDial .orb').forEach((o) => {
    const k = order.indexOf(o.dataset.s);
    o.style.setProperty('--x', `${(k - 1.5) * 76}px`);
    o.dataset.pos = k === i ? 'cur' : 'side';
  });
  $('dialTicks').style.transform = `rotate(${(i - 1.5) * 9}deg)`;
  $('dialLabel').style.left = `calc(50% + ${(i - 1.5) * 76}px)`;
}
document.querySelectorAll('#seasonDial .orb').forEach((o) => o.addEventListener('click', () => applySeason(o.dataset.s)));

// ---------- özet: sayılar, listeler, içindekiler, künye ----------
const showcases = {};
function ensureShowcase(which) {
  if (showcases[which] !== undefined || !window.BookShowcase) return;
  const cv = $(which === 'cover' ? 'coverStage' : 'epubStage');
  showcases[which] = window.BookShowcase.attach(cv);
  if (which === 'cover' && showcases.cover) cv.closest('.cover-frame').classList.add('three');
  if (showcases[which]) {
    const t = which === 'cover' ? $('coverTitle').value : (state.sum?.structure?.title || state.slug);
    const a = which === 'cover' ? $('coverAuthor').value : (state.sum?.structure?.author || '');
    showcases[which].setCover(state.coverSrc, t, a);
  }
}
const fmtN = (n) => Number(n || 0).toLocaleString('tr-TR');
function countUp(root) {
  root.querySelectorAll('[data-n]').forEach((el) => {
    const to = +el.dataset.n, t0 = performance.now(), dur = 700 + Math.min(600, to);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmtN(Math.round(to * e)) + (el.dataset.suf || '');
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
function stagger(root, sel) {
  root.querySelectorAll(sel).forEach((el, i) => { el.classList.add('rise'); el.style.animationDelay = Math.min(i, 14) * 28 + 'ms'; });
}
async function loadSummary() {
  const seq = (state.sumSeq = (state.sumSeq || 0) + 1);
  const sum = state.slug ? await api.bookSummary(state.slug).catch(() => null) : null;
  if (seq !== state.sumSeq) return;
  state.sum = sum || {};
  state.chgGroup = ''; $('chgSearch').value = '';
  renderOcrSum(); renderEditor(); renderToc(); renderEpub();
}
function renderOcrSum() {
  const o = state.sum.ocr, el = $('ocrSum');
  if (!o || !o.pages) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<div class="s"><b data-n="${o.pages}">0</b><small>sayfa okundu</small></div>
    <div class="s"><b data-n="${o.models.length}">0</b><small>model</small></div>
    <div class="s"><b data-n="${o.fromSecond}">0</b><small>kelime diğer modellerden</small></div>
    <div class="models">${o.models.map((m) => `<span>${escapeHtml(m)}</span>`).join('')}${o.vote ? '<span>oylama açık</span>' : ''}</div>`;
  countUp(el);
}
function renderEditor() {
  const s = state.sum, ch = s.changes || { items: [], groups: [], total: 0 }, rv = s.review || [];
  const done = !!state.st?.exists.editorMd;
  $('edStats').innerHTML = !state.slug ? '' : `
    <div class="stat c-ok"><span class="v" data-n="${ch.total}">0</span><span class="k">otomatik düzeltme</span></div>
    <div class="stat c-warn"><span class="v" data-n="${rv.length}">0</span><span class="k">elle bakılacak kelime</span></div>
    <div class="stat"><span class="v" data-n="${s.stats?.words || 0}">0</span><span class="k">kelime</span></div>
    <div class="stat c-dim"><span class="v" data-n="${s.stats?.pagesEst || 0}">0</span><span class="k">sayfa (tahmini, e-kitapta)</span></div>`;
  countUp($('edStats'));
  $('chgCount').textContent = ch.items.length ? fmtN(ch.total) : '';
  $('revCount').textContent = rv.length ? fmtN(rv.length) : '';
  const groups = ch.groups.filter((g) => ch.items.some((it) => it.group === g.name));
  $('chgFilter').innerHTML = groups.length > 1
    ? [`<button class="chip on" data-g="">Hepsi<em>${ch.items.length}</em></button>`, ...groups.map((g) =>
        `<button class="chip" data-g="${escapeHtml(g.name)}">${escapeHtml(g.name)}<em>${ch.items.filter((it) => it.group === g.name).length}</em></button>`)].join('')
    : '';
  $('chgFilter').querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
    state.chgGroup = c.dataset.g;
    $('chgFilter').querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
    renderChanges();
  }));
  $('chgSearch').closest('.list-tools').hidden = !ch.items.length;
  renderChanges();
  $('revList').innerHTML = rv.length ? rv.map((r) => {
    const ctx = escapeHtml(r.context).replace(new RegExp(escapeHtml(r.word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), (w) => `<mark>${w}</mark>`);
    return `<div class="rev-item"><div class="rev-kind">${escapeHtml(r.kind)}</div><div class="rev-ctx">…${ctx}…</div>
      ${r.suggestions.length ? `<div class="rev-sugs">${r.suggestions.slice(0, 5).map((x) => `<span>${escapeHtml(x)}</span>`).join('')}</div>` : ''}
      ${r.note ? `<div class="rev-note">Model: ${escapeHtml(r.note)}</div>` : ''}</div>`;
  }).join('') : `<div class="empty-note">${done ? '<b>Bakılacak kelime kalmadı</b>Şüpheli her kelime otomatik çözüldü.' : '<b>Henüz düzeltme yapılmadı</b>Düzeltmeyi başlatınca emin olunamayan kelimeler burada bağlamıyla görünür.'}</div>`;
  stagger($('revList'), '.rev-item');
  const rep = s.report || [];
  const max = Math.max(...rep.map((x) => x.wer), 1);
  const best = rep.length ? Math.min(...rep.map((x) => x.wer)) : null;
  $('accBars').innerHTML = rep.map((x) => `<div class="acc-row${x.wer === best ? ' best' : ''}"><span class="lbl" title="${escapeHtml(x.stage)}">${escapeHtml(x.stage)}</span>
    <span class="bar"><i data-w="${(x.wer / max) * 100}"></i></span><span class="val">%${x.wer.toFixed(2)}</span></div>`).join('');
  requestAnimationFrame(() => $('accBars').querySelectorAll('i').forEach((i) => (i.style.width = i.dataset.w + '%')));
}
function renderChanges() {
  const ch = state.sum.changes || { items: [] }, q = $('chgSearch').value.trim().toLocaleLowerCase('tr');
  const list = ch.items.filter((it) => (!state.chgGroup || it.group === state.chgGroup) &&
    (!q || it.from.toLocaleLowerCase('tr').includes(q) || it.to.toLocaleLowerCase('tr').includes(q)));
  const shown = list.slice(0, 400);
  $('chgList').innerHTML = shown.length ? shown.map((it) => `<div class="chg-row"><span class="from" title="${escapeHtml(it.from)}">${escapeHtml(it.from)}</span><span class="arr">→</span>
      <span class="to" title="${escapeHtml(it.to)}">${escapeHtml(it.to) || '<i class="muted">(silindi)</i>'}</span>${!state.chgGroup && it.group ? `<span class="tag" title="${escapeHtml(it.group)}">${escapeHtml(it.group)}</span>` : '<span></span>'}<span class="n">${it.n > 1 ? '×' + it.n : ''}</span></div>`).join('')
      + (list.length > shown.length ? `<div class="empty-note">… ve ${fmtN(list.length - shown.length)} tane daha (dosyayı aç)</div>` : '')
    : `<div class="empty-note">${ch.items.length ? 'Aramaya uyan değişiklik yok.' : '<b>Henüz değişiklik yok</b>Düzeltme bitince her değişiklik eski → yeni olarak burada listelenir.'}</div>`;
  stagger($('chgList'), '.chg-row');
}
$('chgSearch').addEventListener('input', renderChanges);
function renderEpub() {
  const s = state.sum || {}, e = state.st?.exists || {};
  $('epTitle').textContent = s.structure?.title || state.slug || '—';
  $('epAuthor').textContent = s.structure?.author || (state.slug ? 'Yazar belirtilmedi' : '');
  const m = [['Kelime', s.stats?.words], ['Paragraf', s.stats?.paragraphs], ['Bölüm', s.structure?.chapters?.length], ['Sayfa (tahmini)', s.stats?.pagesEst]];
  $('epMeta').innerHTML = m.map(([k, v]) => `<div><dt>${k}</dt><dd data-n="${v || 0}">0</dd></div>`).join('');
  countUp($('epMeta'));
  const tick = '<svg class="ico" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>';
  const rows = [
    ['editor', e.editorMd, 'Düzeltilmiş metin', e.editorMd ? `${fmtN(s.changes?.total || 0)} düzeltme yapıldı` : 'Gerekli: önce Düzeltme adımı'],
    ['structure', e.yapi, 'Başlık ve bölümler', e.yapi ? `${s.structure?.chapters?.length || 0} bölüm bulundu` : 'İsteğe bağlı: yoksa tek bölüm olur'],
    ['cover', e.cover, 'Kapak', e.cover ? 'ERME BOOKS kapağı hazır' : 'İsteğe bağlı: yoksa kapaksız olur'],
  ];
  $('epChecks').innerHTML = rows.map(([tab, ok, t, d]) => `<li class="${ok ? 'ok' : ''}"><span class="mk">${tick}</span><div><b>${t}</b><small>${d}</small></div>
    ${ok ? '' : `<button class="btn ghost go" data-go="${tab}">Git →</button>`}</li>`).join('');
  $('epChecks').querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.go)));
  renderEpubResult();
}

// ---------- Kitaplık ----------
let libBooks = [], libCurrent = null;
const escapeHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function spineColor(slug) {
  const vals = Object.values(SWATCHES);
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return hex(vals[h % vals.length]);
}
function hashOf(str) { let h = 0; for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
function spineStyle(b) {
  // Kapağın ortalama rengini biraz koyulaştırarak sırt rengi yap; yazı rengini parlaklığa göre seç
  let rgb = b.color ? [1, 3, 5].map((i) => parseInt(b.color.slice(i, i + 2), 16)) : SWATCHES[Object.keys(SWATCHES)[hashOf(b.slug) % 10]];
  rgb = rgb.map((v) => Math.round(v * 0.82));
  const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  const h = hashOf(b.slug);
  const height = 172 + (h % 26), width = 27 + ((h >> 5) % 14);
  return `--c:${hex(rgb)};--tc:${lum > 150 ? '#231a12' : '#f7efe2'};--h:${height}px;--w:${width}px;--d:${Math.round(height * 0.66)}px`;
}
function bookFace(b) {
  return b.cover ? `<img src="${b.cover}" alt="">`
    : `<div class="book-fallback" style="background:${b.color || spineColor(b.slug)}"><b>${escapeHtml(b.title)}</b><span>${escapeHtml(b.author || 'ERME BOOKS')}</span></div>`;
}
function spineInner(b) {
  const surname = (b.author || '').split(',')[0].trim().split(/\s+/).pop() || '';
  return `<span class="bk-band"></span><span class="bk-band thin"></span>
    <span class="bk-title">${escapeHtml(b.title)}</span>
    ${surname ? `<span class="bk-author">${escapeHtml(surname)}</span>` : ''}
    <span class="bk-band"></span>`;
}
function spineHtml(b, i) {
  return `<div class="bk" data-i="${i}" style="${spineStyle(b)};animation-delay:${i * 45}ms" title="${escapeHtml(b.title)}">
    <div class="bk-body"><div class="bk-top"></div><div class="bk-spine">${spineInner(b)}</div></div></div>`;
}
async function loadLibrary() {
  $('libStatus').textContent = 'Raf hazırlanıyor…';
  libBooks = await api.listLibrary();
  $('libStatus').textContent = libBooks.length ? `${libBooks.length} kitap rafta.` : '';
  renderShelves();
}
function renderShelves() {
  const box = $('shelves');
  if (!libBooks.length) {
    box.innerHTML = `<div class="shelf"><div class="shelf-empty"><b>Raf henüz boş</b>"EPUB Ekle" ile ya da dosyaları buraya sürükleyerek kitap ekleyebilirsin.</div><div class="plank"></div></div>`;
    return;
  }
  const maxW = box.clientWidth - 60 - 36 - 90; // sağda, dönen kapağa pay bırak
  const rows = [[]];
  let used = 0;
  libBooks.forEach((b, i) => {
    const w = parseInt(spineStyle(b).match(/--w:(\d+)px/)[1], 10) + 3;
    if (used + w > maxW && rows[rows.length - 1].length) { rows.push([]); used = 0; }
    rows[rows.length - 1].push(spineHtml(b, i)); used += w;
  });
  box.innerHTML = rows.map((r) => `<div class="shelf"><div class="shelf-books">${r.join('')}</div><div class="plank"></div></div>`).join('');
  box.querySelectorAll('.bk').forEach((el) => {
    const open = (e) => { e.preventDefault(); openBook(libBooks[+el.dataset.i], el); };
    el.addEventListener('click', open);
    el.addEventListener('contextmenu', open);
  });
}
$('libAdd').addEventListener('click', async () => {
  const n = await api.pickEpubs();
  if (n) { toast(`${n} kitap rafa eklendi.`); loadLibrary(); }
});
const shelvesBox = $('shelves');
['dragenter', 'dragover'].forEach((ev) => shelvesBox.addEventListener(ev, (e) => { e.preventDefault(); shelvesBox.classList.add('drag'); }));
shelvesBox.addEventListener('dragleave', (e) => { if (!shelvesBox.contains(e.relatedTarget)) shelvesBox.classList.remove('drag'); });
shelvesBox.addEventListener('drop', async (e) => {
  e.preventDefault(); shelvesBox.classList.remove('drag');
  const files = [...e.dataTransfer.files].filter((f) => f.name.toLowerCase().endsWith('.epub')).map((f) => api.pathForFile(f));
  if (!files.length) return toast('Sadece .epub dosyaları rafa eklenebilir.', true);
  const n = await api.addEpubs(files);
  toast(n ? `${n} kitap rafa eklendi.` : 'Bu kitaplar zaten rafta.', !n);
  if (n) loadLibrary();
});
// Pencereye yanlışlıkla bırakılan dosya uygulamayı o dosyaya yönlendirmesin
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
let shelfTimer;
window.addEventListener('resize', () => {
  clearTimeout(shelfTimer);
  shelfTimer = setTimeout(() => { if ($('page-library').classList.contains('active')) renderShelves(); }, 150);
});
// ---------- Kitap görünümü: kitap raftan eğilerek çıkar, dönüp ön kapağını gösterir ----------
let bv = null; // { b, el, fly, kfs, ready, closing }
const LANGS = { tr: 'Türkçe', en: 'İngilizce', de: 'Almanca', fr: 'Fransızca', ru: 'Rusça', es: 'İspanyolca', it: 'İtalyanca', ar: 'Arapça', ja: 'Japonca', fa: 'Farsça' };
const trDate = (d) => d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
function fmtDate(d) {
  if (!d) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) { const x = new Date(d.slice(0, 10)); if (!isNaN(x)) return trDate(x); }
  return d.slice(0, 10);
}
function fillPanel(b) {
  $('bvKicker').textContent = b.own ? 'ERME BOOKS · senin baskın' : 'Dışarıdan eklendi';
  $('bvTitle').textContent = b.title;
  $('bvAuthor').textContent = b.author || '';
  const lang = (b.language || '').slice(0, 2).toLowerCase();
  const rows = [
    ['Yayınevi', b.publisher],
    ['Sayfa', b.pages ? (b.pagesExact ? String(b.pages) : `≈ ${b.pages} (tahmini)`) : ''],
    ['Dil', LANGS[lang] || b.language],
    ['Yayın tarihi', fmtDate(b.date)],
    ['ISBN', b.isbn],
    ['Tür', (b.subjects || []).join(', ')],
    ['Dosya', `${(b.size / 1048576).toFixed(1)} MB`],
    ['Rafa eklendi', trDate(new Date(b.mtime))],
  ].filter((r) => r[1]);
  $('bvMeta').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('');
  $('bvDesc').textContent = b.description || '';
  $('bdSelect').style.display = b.own ? '' : 'none';
}

function openBook(b, el) {
  if (bv) return;
  libCurrent = b;
  const r = el.getBoundingClientRect();
  const H0 = el.offsetHeight, T0 = el.offsetWidth;
  const D0 = parseFloat(getComputedStyle(el).getPropertyValue('--d')) || H0 * 0.66;
  const Hb = Math.min(window.innerHeight * 0.66, 480), s = Hb / H0;
  const Db = D0 * s, Tb = Math.max(T0 * s * 0.85, 16);
  const cx = Math.min(window.innerWidth * 0.34, window.innerWidth / 2 - 80), cy = window.innerHeight / 2;

  const fly = document.createElement('div');
  fly.className = 'fly';
  fly.setAttribute('style', spineStyle(b));
  Object.assign(fly.style, { left: `${cx - Db / 2}px`, top: `${cy - Hb / 2}px`, width: `${Db}px`, height: `${Hb}px` });
  fly.innerHTML = `
    <div class="f-back" style="transform:rotateY(180deg) translateZ(${Tb / 2}px)"></div>
    <div class="f-pages" style="left:${(Db - Tb) / 2}px;width:${Tb - 2}px;height:${Hb - 6}px;transform:rotateY(90deg) translateZ(${Db / 2 - 3}px)"></div>
    <div class="f-top" style="top:${(Hb - Tb) / 2}px;width:${Db - 4}px;height:${Tb - 2}px;transform:rotateX(90deg) translateZ(${Hb / 2 - 2}px)"></div>
    <div class="f-spine" style="left:${(Db - Tb) / 2}px;width:${Tb}px;height:${Hb}px;transform:rotateY(-90deg) translateZ(${Db / 2}px)">
      <div class="bk-spine" style="inset:auto;left:0;top:0;width:${Tb / s}px;height:${H0}px;transform:scale(${s})">${spineInner(b)}</div></div>
    <div class="f-front" style="transform:translateZ(${Tb / 2}px);font-size:${Hb / 34}px">${bookFace(b)}</div>`;
  $('bvStage').innerHTML = '';
  $('bvStage').appendChild(fly);

  const dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy, inv = 1 / s, mid = (inv + 1) / 2;
  const kfs = [
    `translate3d(${dx}px,${dy - 6}px,${-D0 / 2 + 12}px) rotateX(-13deg) scale3d(${inv},${inv},${inv}) rotateY(90deg)`,
    `translate3d(${dx}px,${dy - 26}px,${-D0 / 2 + 60}px) rotateX(-24deg) scale3d(${inv},${inv},${inv}) rotateY(90deg)`,
    `translate3d(${dx * 0.35}px,${dy * 0.35 - 40}px,160px) rotateX(-8deg) scale3d(${mid},${mid},${mid}) rotateY(52deg)`,
    'translate3d(0px,0px,0px) rotateX(0deg) scale3d(1,1,1) rotateY(20deg)',
  ];
  bv = { b, el, fly, kfs, ready: false, closing: false };
  fillPanel(b);
  $('bvPanel').style.left = `${cx + Db / 2 + 70}px`;
  el.classList.add('away');
  const view = $('bookView');
  view.classList.add('show');
  void view.offsetWidth;
  view.classList.add('open');

  const anim = fly.animate(
    [{ transform: kfs[0] }, { transform: kfs[1], offset: 0.2 }, { transform: kfs[2], offset: 0.62 }, { transform: kfs[3] }],
    { duration: 1150, easing: 'cubic-bezier(.45,.05,.2,1)', fill: 'forwards' });
  anim.finished.then(() => {
    if (!bv || bv.fly !== fly || bv.closing) return;
    fly.style.transform = kfs[3];
    anim.cancel();
    fly.style.transition = 'transform .35s ease-out';
    bv.ready = true;
    view.classList.add('ready');
  });
}

async function closeBook() {
  if (!bv || bv.closing) return;
  bv.closing = true;
  const { fly, el, kfs } = bv, view = $('bookView');
  view.classList.remove('ready', 'open');
  const current = getComputedStyle(fly).transform;
  fly.getAnimations().forEach((a) => a.cancel());
  fly.style.transition = 'none';
  await fly.animate(
    [{ transform: current === 'none' ? kfs[3] : current }, { transform: kfs[2], offset: 0.4 }, { transform: kfs[1], offset: 0.8 }, { transform: kfs[0] }],
    { duration: 850, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' }).finished;
  el.classList.remove('away');
  view.classList.remove('show');
  $('bvStage').innerHTML = '';
  bv = null;
}

// Kitap açıkken fareyi gezdirince hafifçe fareyi takip etsin
$('bookView').addEventListener('mousemove', (e) => {
  if (!bv || !bv.ready || bv.closing) return;
  const nx = e.clientX / window.innerWidth - 0.5, ny = e.clientY / window.innerHeight - 0.5;
  bv.fly.style.transform = `translate3d(0px,0px,0px) rotateX(${(-ny * 10).toFixed(2)}deg) scale3d(1,1,1) rotateY(${(20 + nx * 18).toFixed(2)}deg)`;
});
$('bvBackdrop').addEventListener('click', closeBook);
$('bvBackdrop').addEventListener('contextmenu', (e) => { e.preventDefault(); closeBook(); });
$('bdClose').addEventListener('click', closeBook);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBook(); });
$('bdOpen').addEventListener('click', () => api.openPath(libCurrent.file));
$('bdRead').addEventListener('click', () => { if (libCurrent?.file) openReader(libCurrent.file); });
$('bdReveal').addEventListener('click', () => api.revealFile(libCurrent.file));
$('bdSelect').addEventListener('click', async () => {
  const slug = libCurrent.slug;
  await closeBook();
  await loadBooks(slug);
  showTab('epub');
});
$('bdRemove').addEventListener('click', async () => {
  const b = libCurrent;
  if (!confirm(`'${b.title}' kitaplıktan kaldırılsın mı? (Dosya Geri Dönüşüm Kutusu'na taşınır.)`)) return;
  await closeBook();
  if (await api.removeEpub(b.file)) { toast('Kitap kaldırıldı.'); loadLibrary(); if (hollowLib?.active) hollowLib.setBooks(await hollowBooks()); }
});
$('libFolder').addEventListener('click', () => api.openEpubFolder());

// ---------- Ollama ----------
// ---------- model yönetimi: donanım + yerel modeller ----------
// Ana süreç (main.js) donanımı ve kurulu Ollama modellerini okuyup her görev için etkin modeli seçer;
// burada üst çubuk göstergesi, Model Yönetimi paneli ve adım sayfalarındaki bilgi kartları çizilir.
state.models = null;
const errTxt = (e) => { const f = (v) => v.toLocaleString('tr-TR'); return e[0] === e[1] ? `%${f(e[0])}` : `%${f(e[0])}–${f(e[1])}`; };
async function pollOllama(force = false) {
  const st = await api.modelState(force).catch(() => null);
  if (!st) return;
  state.models = st;
  const box = $('ollamaBox'), roles = Object.values(st.roles);
  const used = roles.filter((r) => r.secili), missing = used.filter((r) => st.up && !st.installed.includes(r.secili));
  if (!st.up) { $('ollamaDot').className = 'dot down'; $('ollamaText').textContent = 'Ollama kapalı'; }
  else if (missing.length) { $('ollamaDot').className = 'dot down'; $('ollamaText').textContent = `Eksik model: ${missing.length}`; }
  else if (st.notes.length) { $('ollamaDot').className = 'dot warn'; $('ollamaText').textContent = `Hafif mod · ${used.length} model`; }
  else { $('ollamaDot').className = 'dot up'; $('ollamaText').textContent = `${used.length}/${used.length} model`; }
  box.title = (st.up ? 'Ollama açık' : 'Ollama kapalı. Ollama uygulamasını aç.') + '\n'
    + roles.map((r) => `${r.secili ? (st.installed.includes(r.secili) ? '✓' : '✗') : '–'} ${r.ad}: ${r.secili || r.secenek.find((o) => !o.id)?.ad || 'kapalı'}`).join('\n')
    + `\n\nTahmini hata payı: ${errTxt(st.err)} · ayrıntı için tıkla`;
  renderModelNotes();
  if ($('modelModal').classList.contains('show')) renderModelPanel();
}
function noteSentence(n, st) {
  const hw = `${fmtN(st.sys.totalGB)} GB RAM / ${st.sys.dedicated ? 'harici GPU' : 'dahili GPU'}`;
  const yerine = n.kapali ? (n.rol === 'text' ? 'kural tabanlı motor' : `${n.yerine.toLocaleLowerCase('tr')} ayarı`) : n.yerine;
  if (n.neden === 'model kurulu değil') return `<b>${escapeHtml(n.devre)}</b> bilgisayarında kurulu olmadığı için işlemler <b>${escapeHtml(yerine)}</b> ile yapılacak.${n.kur ? ` Kurmak için: <code>${escapeHtml(n.kur)}</code>` : ''}`;
  if (n.neden === 'elle seçildi') return `${escapeHtml(n.rolAd)} için elle <b>${escapeHtml(yerine)}</b> seçildi (standart: ${escapeHtml(n.devre)}).`;
  return `Sistem donanımın (${hw}) nedeniyle yüksek kapasiteli <b>${escapeHtml(n.devre)}</b> modeli devre dışı bırakıldı. İşlemlerin sistemine uygun olan <b>${escapeHtml(yerine)}</b> ile yapılacak.`;
}
function renderModelNotes() {
  const st = state.models;
  document.querySelectorAll('.model-note').forEach((el) => {
    const roles = el.dataset.roles.split(' ');
    const notes = st ? st.notes.filter((n) => roles.includes(n.rol)) : [];
    el.hidden = !notes.length;
    if (!notes.length) return;
    const step2 = roles.includes('text') && el.closest('#page-editor') ? 'Bu adımda' : '2. adımda';
    el.innerHTML = `<div class="mn-ico">i</div><div class="mn-body"><b class="mn-title">Donanımına göre ayarlanan modeller</b>
      ${notes.map((n) => `<p>${noteSentence(n, st)}</p>`).join('')}
      <p class="mn-err">Bu modda işlem hızı yüksek kalırken, karmaşık OCR/metin düzeltme adımlarında tahmini hata payı standart ${errTxt(st.baseErr)} yerine yaklaşık <b>${errTxt(st.err)}</b> aralığında olabilir; ${step2} "Elle bakılacaklar" listesini kontrol etmen önerilir.</p></div>
      <button class="btn plain sm mn-go">Modelleri Yönet</button>`;
    el.querySelector('.mn-go').addEventListener('click', openModelPanel);
  });
}
function openModelPanel() { $('modelModal').classList.add('show'); renderModelPanel(); }
function renderModelPanel() {
  const st = state.models;
  if (!st) { $('mmRoles').innerHTML = '<div class="empty-note">Donanım bilgisi okunuyor…</div>'; return; }
  const s = st.sys;
  $('mmSys').innerHTML = [['İşletim sistemi', s.os], ['Bellek', `${fmtN(s.totalGB)} GB RAM · modellere ayrılabilir ≈ ${fmtN(st.limitGB)} GB`],
    ['Ekran kartı', `${s.gpu}${s.dedicated ? '' : ' (dahili)'}`], ['İşlemci', `${s.cpu} · ${s.cores} çekirdek`], ['Ollama', st.up ? `açık · ${st.installed.length} model kurulu` : 'kapalı']]
    .map(([k, v]) => `<div><span>${k}</span><b>${escapeHtml(String(v))}</b></div>`).join('');
  $('modelModal').querySelectorAll('.mm-mode button').forEach((b) => b.classList.toggle('on', b.dataset.m === st.mode));
  $('mmRoles').innerHTML = Object.entries(st.roles).map(([key, r]) => `<section class="mm-role"><h4>${escapeHtml(r.ad)}${r.zorunlu ? '' : ' <small>isteğe bağlı</small>'}</h4>
    ${r.secenek.map((o) => {
      const on = o.id === r.secili, tags = [];
      if (o.id) tags.push(`<span class="mm-ram">~${fmtN(o.ram)} GB</span>`);
      tags.push(`<span class="mm-err">${o.hata[1] ? `+${errTxt(o.hata)} hata` : 'en doğru'}</span>`);
      if (o.id && !o.sigar) tags.push('<span class="mm-tag bad">bu bilgisayar için ağır</span>');
      if (o.id && st.up && !o.kurulu) tags.push(`<span class="mm-tag miss" title="Terminalde çalıştır">kurulu değil · <code>ollama pull ${escapeHtml(o.id)}</code></span>`);
      if (o.id && st.up && o.kurulu) tags.push('<span class="mm-tag ok">kurulu</span>');
      return `<button class="mm-opt${on ? ' on' : ''}" data-role="${key}" data-id="${escapeHtml(o.id)}"><i></i><span class="mm-name">${escapeHtml(o.ad)}${o.tur === 'standart' ? ' <em>standart</em>' : o.tur === 'hafif' ? ' <em>hafif</em>' : ''}</span>${tags.join('')}</button>`;
    }).join('')}</section>`).join('');
  $('mmFoot').innerHTML = `<div class="mm-total"><span>Tüm hattın tahmini kelime hata payı</span><b>${errTxt(st.err)}</b><small>standart: ${errTxt(st.baseErr)}</small></div>
    <p class="muted">${st.mode === 'otomatik' ? 'Otomatik modda belleğe sığan ve kurulu olan en güçlü model seçilir; sığmayan ya da kurulu olmayan isteğe bağlı adımlar kapatılır.' : 'Elle modda seçimin donanım uyarısına rağmen kullanılır. Bellek yetmezse Ollama modeli yavaş çalıştırır ya da hata verir.'}
    Değerler yaklaşıktır; RAM+VRAM toplamına göre hesaplanır.</p>`;
}
$('ollamaBox').addEventListener('click', openModelPanel);
$('ollamaBox').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModelPanel(); } });
$('mmClose').addEventListener('click', () => $('modelModal').classList.remove('show'));
$('modelModal').addEventListener('click', (e) => { if (e.target === $('modelModal')) $('modelModal').classList.remove('show'); });
$('mmRefresh').addEventListener('click', () => pollOllama(true));
$('modelModal').querySelector('.mm-mode').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b || !state.models) return;
  const manual = {}; for (const [k, r] of Object.entries(state.models.roles)) manual[k] = r.secili;   // elle moda geçerken mevcut seçimler korunur
  state.models = await api.setModels({ mode: b.dataset.m, manual }); pollOllama();
});
$('mmRoles').addEventListener('click', async (e) => {
  const b = e.target.closest('.mm-opt'); if (!b) return;
  state.models = await api.setModels({ mode: 'elle', manual: { [b.dataset.role]: b.dataset.id } });
  pollOllama();
});

// ---------- grafik kalitesi (quality.js) ----------
function syncQualitySel() {
  const EQ = window.ErmeQuality; if (!EQ) { $('qualitySel').closest('.quality-pick').hidden = true; return; }
  const sel = $('qualitySel');
  sel.options[0].textContent = `Otomatik · ${EQ.p.ad}`;
  sel.value = EQ.auto ? 'oto' : EQ.level;
}
if (window.ErmeQuality) {
  window.ErmeQuality.on((p, reason) => { syncQualitySel(); if (reason === 'auto') toast(`Akıcılık için grafik kalitesi "${p.ad}" seviyesine indirildi (gölge, parçacık ve hayvan yoğunluğu hafifletildi).`); });
  $('qualitySel').addEventListener('change', (e) => {
    const v = e.target.value, EQ = window.ErmeQuality;
    if (v === 'oto') EQ.set('yuksek', true); else EQ.set(v, false);
    syncQualitySel();
  });
}
syncQualitySel();

// ---------- açılış sahnesi (book3d.js) ----------
const afterIntro = () => { if (introDone) return; introDone = true; if (document.getElementById('page-home').classList.contains('active')) ensureTree(); };
if (window.BookIntro) window.BookIntro.play(afterIntro); else afterIntro();
setTimeout(() => { document.querySelector('.intro:not(.out)')?.click(); afterIntro(); }, 9000);   // ne olursa olsun: açılış kapansın, ağaç gelsin
document.querySelector('.logo').addEventListener('click', () => showTab('home'));
document.querySelector('.logo').title = 'Ana sayfa: hayat ağacı';

// ---------- başlangıç ----------
applySeason(localStorage.getItem('season') || 'bugun');
renderSwatches();
setColor('turuncu', false);
setRunning(null);
loadBooks((() => { try { return localStorage.getItem('lastBook') || ''; } catch { return ''; } })());
pollOllama();
setInterval(pollOllama, 10000);