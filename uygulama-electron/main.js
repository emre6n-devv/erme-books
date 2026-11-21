// main.js - Electron ana süreç. Python betikleri bir üst klasörde (kitap_ocr/) durur ve burada
// alt süreç olarak çalıştırılır. Seçili yerel modeller betiklere KITAP_* ortam değişkenleriyle aktarılır.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { spawn, execFile } = require('child_process');

const BASE_DIR = path.resolve(__dirname, '..');
// PATH'te python olmasa da Windows'ta 'py' başlatıcısı çalışıyor.
const PYTHON = process.env.KITAP_PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
const PY_ENV = { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };

let win = null;
let current = null; // { proc, tabId, cancelled, finished }

function createWindow() {
  win = new BrowserWindow({
    width: 1340, height: 900, minWidth: 1100, minHeight: 720,
    title: 'ERME BOOKS · Hayat Ağacı', backgroundColor: '#241c16',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => { createWindow(); modelState(true).catch(() => null); });
app.on('window-all-closed', () => { killCurrent(); app.quit(); });

// ---------- yardımcılar ----------
const inputDir = () => path.join(BASE_DIR, 'input');
const outDir = (slug) => path.join(BASE_DIR, 'output', slug);

function paths(slug) {
  const o = outDir(slug);
  return {
    pdf: path.join(inputDir(), `${slug}.pdf`),
    md: path.join(o, `${slug}.md`),
    editorMd: path.join(o, `${slug}_editor.md`),
    changes: path.join(o, `${slug}_degisiklikler.txt`),
    review: path.join(o, `${slug}_incele.txt`),
    report: path.join(o, `${slug}_degerlendirme.txt`),
    pages: path.join(o, `${slug}_sayfalar.json`),
    yapi: path.join(o, `${slug}_yapi.json`),
    cover: path.join(o, 'kapak.jpg'),
    coverWrap: path.join(o, 'kapak_sarim.jpg'),     // bez cilt: arka kapak + sırt + ön kapak tek parça
    coverTheme: path.join(o, 'kapak_tema.json'),
    epub: path.join(BASE_DIR, 'epubs', `${slug}.epub`),
  };
}

async function runPy(args, maxBuffer = 16 * 1024 * 1024) {
  if (!args[0]?.startsWith('render_page')) await modelState().catch(() => null);   // seçili modeller ortama yazılsın (önizleme hariç)
  return new Promise((resolve) => {
    execFile(PYTHON, args, { cwd: BASE_DIR, env: pyEnv(), maxBuffer, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout: stdout || '', stderr: stderr || '', err }));
  });
}

function killCurrent() {
  if (!current || current.finished) return;
  current.cancelled = true;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(current.proc.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    current.proc.kill('SIGTERM');
  }
}

// ---------- kitaplar ----------
ipcMain.handle('books:list', () => {
  fs.mkdirSync(inputDir(), { recursive: true });
  fs.mkdirSync(path.join(BASE_DIR, 'output'), { recursive: true });
  const slugs = new Set();
  for (const f of fs.readdirSync(inputDir())) if (f.toLowerCase().endsWith('.pdf')) slugs.add(f.slice(0, -4));
  for (const d of fs.readdirSync(path.join(BASE_DIR, 'output'), { withFileTypes: true })) if (d.isDirectory()) slugs.add(d.name);
  return [...slugs].sort((a, b) => a.localeCompare(b, 'tr'));
});

ipcMain.handle('book:status', (_e, slug) => {
  const p = paths(slug);
  const exists = {};
  for (const k of Object.keys(p)) exists[k] = fs.existsSync(p[k]);
  return { paths: p, exists };
});

ipcMain.handle('pdf:pick', async () => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: 'PDF dosyası', extensions: ['pdf'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths.length) return null;
  const src = r.filePaths[0];
  const dest = path.join(inputDir(), path.basename(src));
  fs.mkdirSync(inputDir(), { recursive: true });
  if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
  return path.basename(dest, path.extname(dest));
});

ipcMain.handle('pdf:page', async (_e, slug, page) => {
  const pdf = paths(slug).pdf;
  if (!fs.existsSync(pdf)) return { error: 'PDF bulunamadı' };
  const r = await runPy(['render_page.py', '--pdf', pdf, '--page', String(page)], 64 * 1024 * 1024);
  if (r.code !== 0) return { error: (r.stderr || String(r.err)).slice(-300) };
  try {
    const d = JSON.parse(r.stdout.trim().split('\n').pop());
    return { count: d.count, page: d.page, src: `data:image/png;base64,${d.png}` };
  } catch { return { error: 'Sayfa okunamadı' }; }
});

// ---------- uzun süren işlemler (canlı log) ----------
ipcMain.handle('proc:run', async (_e, tabId, args) => {
  if (current && !current.finished) return { error: 'Zaten çalışan bir işlem var. Önce onu durdur.' };
  await modelState(true);   // seçili modeller ortam değişkenlerine yazılsın
  const proc = spawn(PYTHON, ['-u', ...args], { cwd: BASE_DIR, env: pyEnv(), windowsHide: true });
  const job = { proc, tabId, cancelled: false, finished: false };
  current = job;
  const send = (text) => win && win.webContents.send('proc:log', { tabId, text });
  const finish = (code) => {
    if (job.finished) return;
    job.finished = true;
    if (current === job) current = null;
    win && win.webContents.send('proc:done', { tabId, code, cancelled: job.cancelled });
  };
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', send);
  proc.stderr.on('data', send);
  proc.on('error', (err) => { send(`\n[HATA] Python başlatılamadı: ${err.message}\n`); finish(1); });
  proc.on('close', (code) => finish(code ?? 1));
  return { ok: true };
});

ipcMain.handle('proc:stop', () => { killCurrent(); return true; });

// ---------- dosyalar ----------
ipcMain.handle('file:open', async (_e, p) => {
  if (!fs.existsSync(p)) return false;
  await shell.openPath(p);
  return true;
});

ipcMain.handle('folder:epubs', async () => {
  const d = path.join(BASE_DIR, 'epubs');
  fs.mkdirSync(d, { recursive: true });
  await shell.openPath(d);
});

// ---------- bölüm ağacı (erme_structure.py ile aynı kurallar) ----------
const TOC_FRONT = /^\s*(ön\s*söz|önsöz|giriş|sunuş|takdim|yazarın notu|çevirmenin notu|editörün notu|yayıncının notu|ithaf|prolog|başlarken|okura|teşekkür|son\s*söz|sonsöz|epilog|kaynakça|açıklamalar|notlar|dizin|sözlük|ek\s*[:\d]?|foreword|preface|introduction|prologue|epilogue)(?![\p{L}\p{N}])/iu;
const TOC_PART = /((^|\s)kısım(\s|$)|(^|\s)kitap\s*$|^\s*(birinci|ikinci|üçüncü|dördüncü|beşinci|altıncı|yedinci|sekizinci|dokuzuncu|onuncu)\s+kitap|(^|\s)cilt(\s|$)|^\s*part(\s|$))/iu;
const TOC_KIND = { 1: 'part', 2: 'chapter', 3: 'section' };
function tocClassify(t) {
  t = (t || '').trim();
  if (TOC_FRONT.test(t)) return ['front', 2];
  if (TOC_PART.test(t)) return ['part', 1];
  if (/^\s*\d+\.\d+/.test(t)) return ['section', 3];
  return ['chapter', 2];
}
const editorParas = (slug) => (readText(paths(slug).editorMd) || '').replace(/\r\n/g, '\n').split('\n\n');
function tocOf(y, paras) {
  if (Array.isArray(y.toc) && y.toc.length) {
    return y.toc.filter((it) => it && Number.isFinite(+it.idx)).map((it) => {
      const level = Math.max(1, Math.min(3, +it.level || 2));
      return { idx: +it.idx, title: String(it.title || '').trim(), level, kind: it.kind || TOC_KIND[level], virtual: !!it.virtual };
    });
  }
  const titles = y.chapter_titles || [];
  return (y.chapter_paragraph_indices || []).map((idx, k) => {
    const title = titles[k] || (paras && (paras[idx] || '').trim().slice(0, 80)) || `Bölüm ${k + 1}`;
    const [kind, level] = tocClassify(title);
    return { idx: +idx, title, level, kind, virtual: false };
  });
}

ipcMain.handle('structure:read', (_e, slug) => {
  const p = paths(slug).yapi;
  if (!fs.existsSync(p)) return null;
  try {
    const y = JSON.parse(fs.readFileSync(p, 'utf8'));
    y.toc = tocOf(y, editorParas(slug));
    y.template ||= 'klasik';
    return y;
  } catch { return null; }
});

// Adım 3'te onaylanan ağaç + dizgi şablonu; eski alanlar da ağaçla eşitlenir (geriye uyum)
ipcMain.handle('structure:saveToc', (_e, slug, { toc, template }) => {
  const p = paths(slug).yapi;
  let data = {};
  if (fs.existsSync(p)) { try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { data = {}; } }
  if (Array.isArray(toc)) {
    data.toc = tocOf({ toc }, null).filter((it) => it.title);
    data.chapter_paragraph_indices = data.toc.map((it) => it.idx);
    data.chapter_titles = data.toc.map((it) => it.title);
  }
  if (['klasik', 'modern', 'genis'].includes(template)) data.template = template;
  data.title ??= ''; data.author ??= '';
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  return true;
});

ipcMain.handle('structure:paragraphs', (_e, slug) => editorParas(slug));

// 5. adım: son derlemenin özeti (build_epub.py yazar), dışa aktarma ve uygulama içi okuyucu
ipcMain.handle('epub:summary', (_e, slug) => {
  const p = paths(slug);
  if (!fs.existsSync(p.epub)) return null;
  let s = {};
  try { s = JSON.parse(fs.readFileSync(path.join(outDir(slug), `${slug}_epub.json`), 'utf8')); } catch {}
  const st = fs.statSync(p.epub);
  return { ...s, file: p.epub, size: st.size, mtime: st.mtimeMs };
});
ipcMain.handle('epub:saveAs', async (_e, file, name) => {
  if (!file || !fs.existsSync(file)) return { error: 'EPUB dosyası bulunamadı.' };
  const safe = String(name || path.basename(file, '.epub')).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'kitap';
  const r = await dialog.showSaveDialog(win, {
    title: 'EPUB\'u bilgisayara kaydet', defaultPath: path.join(app.getPath('documents'), `${safe}.epub`),
    filters: [{ name: 'EPUB e-kitap', extensions: ['epub'] }],
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  try { fs.copyFileSync(file, r.filePath); return { path: r.filePath }; } catch (err) { return { error: `Kaydedilemedi: ${err.message}` }; }
});
ipcMain.handle('epub:read', async (_e, file) => {
  if (!file || !fs.existsSync(file)) return { error: 'EPUB dosyası bulunamadı.' };
  const r = await runPy(['epub_read.py', file], 512 * 1024 * 1024);
  try { return JSON.parse(r.stdout); } catch { return { error: 'EPUB okunamadı' + (r.stderr ? `: ${r.stderr.trim().split('\n').pop()}` : '.') }; }
});

ipcMain.handle('epub:templates', () => {
  const out = {};
  for (const t of ['klasik', 'modern', 'genis']) out[t] = readText(path.join(BASE_DIR, 'assets', 'epub', 'templates', `${t}.css`)) || '';
  return out;
});

ipcMain.handle('structure:save', (_e, slug, { title, author }) => {
  const p = paths(slug).yapi;
  let data = {};
  if (fs.existsSync(p)) { try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { data = {}; } }
  data.title = title.trim();
  data.author = author.trim();
  data.chapter_paragraph_indices ??= [];
  data.chapter_titles ??= [];
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  return true;
});

// ---------- kapak ----------
let mascotNames = null; // generate_mascots_ai.py'deki tüm isimler (bir kez okunur)
ipcMain.handle('mascots:list', async () => {
  const d = path.join(BASE_DIR, 'assets', 'mascots');
  const available = new Set();
  if (fs.existsSync(d)) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) available.add(e.name);
      else if (e.name.toLowerCase().endsWith('.png') && !e.name.slice(0, -4).endsWith('_raw')) available.add(e.name.slice(0, -4));
    }
  }
  if (!mascotNames) {
    const r = await runPy(['generate_mascots_ai.py', '--list']);
    try { mascotNames = JSON.parse(r.stdout.trim().split('\n').pop()).all; } catch { mascotNames = []; }
  }
  const all = [...new Set([...mascotNames, ...available])].sort();
  return { all, available: [...available].sort() };
});

function coverDataUrl(slug) {
  const p = paths(slug).cover;
  if (!fs.existsSync(p)) return null;
  return `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}`;
}

ipcMain.handle('cover:read', (_e, slug) => coverDataUrl(slug));

ipcMain.handle('cover:generate', async (_e, slug, { title, author, color, animal }) => {
  const r = await runPy(['generate_cover_triband.py', '--title', title || ' ', '--author', author || ' ',
    '--color', color, '--animal', animal, '--output', paths(slug).cover]);
  if (r.code !== 0) return { error: (r.stdout + r.stderr).slice(-600) };
  return { src: coverDataUrl(slug) };
});

ipcMain.handle('cover:suggest', async (_e, slug, { title, author, confirmTitle, confirmLang }) => {
  const editorMd = paths(slug).editorMd;
  const args = ['suggest_cover_style.py', '--title', title, '--author', author,
    '--editor-md', fs.existsSync(editorMd) ? editorMd : ''];
  if (confirmTitle) args.push('--confirm-title', confirmTitle, '--confirm-lang', confirmLang || 'tr');
  const r = await runPy(args);
  const m = r.code === 0 ? r.stdout.match(/CEVAP\s*:\s*(\{[\s\S]*\})/) : null;
  if (!m) return { error: (r.stderr || r.stdout).slice(-200) || 'bilinmiyor' };
  try { return { data: JSON.parse(m[1]) }; } catch { return { error: 'Öneri cevabı ayrıştırılamadı.' }; }
});

// ---------- bez ciltli kapak: tema analizi, kayıt, sarım ----------
ipcMain.handle('cover:analyze', async (_e, slug, { title, author }) => {
  const editorMd = paths(slug).editorMd;
  const r = await runPy(['analyze_cover_theme.py', '--title', title || slug, '--author', author || '', '--editor-md', fs.existsSync(editorMd) ? editorMd : '']);
  const m = r.stdout.match(/CEVAP\s*:\s*(\{[\s\S]*\})/);
  if (!m) return { error: (r.stderr || r.stdout).slice(-300) || 'analiz başarısız' };
  try { return { data: JSON.parse(m[1]) }; } catch { return { error: 'Analiz cevabı ayrıştırılamadı.' }; }
});
ipcMain.handle('cover:clothRead', (_e, slug) => { try { return JSON.parse(fs.readFileSync(paths(slug).coverTheme, 'utf8')); } catch { return null; } });
ipcMain.handle('cover:clothSave', (_e, slug, { front, spread, theme }) => {
  const p = paths(slug); fs.mkdirSync(outDir(slug), { recursive: true });
  const b64 = (u) => Buffer.from(u.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  fs.writeFileSync(p.cover, b64(front));          // EPUB kapağı (ön yüz)
  fs.writeFileSync(p.coverWrap, b64(spread));     // 3D kitaplar için tam sarım
  fs.writeFileSync(p.coverTheme, JSON.stringify({ ...theme, savedAt: Date.now() }, null, 2), 'utf8');
  return { src: coverDataUrl(slug) };
});
function coverWrap(slug) {
  const p = paths(slug);
  if (!fs.existsSync(p.coverWrap)) return null;
  let t = null; try { t = JSON.parse(fs.readFileSync(p.coverTheme, 'utf8')); } catch {}
  return { src: `data:image/jpeg;base64,${fs.readFileSync(p.coverWrap).toString('base64')}`, regions: t?.regions || null, W: t?.W || 2048, H: t?.H || 1280 };
}
ipcMain.handle('cover:wrap', (_e, slug) => coverWrap(slug));

// ---------- kitaplık ----------
const epubDir = () => path.join(BASE_DIR, 'epubs');
const epubCache = new Map(); // dosya -> { mtime, info } ; EPUB'lar değişmedikçe Python tekrar çağrılmaz

async function loadEpubInfos(files) {
  const need = files.filter((f) => epubCache.get(f.file)?.mtime !== f.mtime);
  if (!need.length) return;
  const listFile = path.join(os.tmpdir(), `kitap_ocr_epubs_${process.pid}.json`);
  fs.writeFileSync(listFile, JSON.stringify(need.map((f) => f.file)), 'utf8');
  const r = await runPy(['epub_info.py', listFile], 256 * 1024 * 1024);
  let infos = [];
  try { infos = JSON.parse(r.stdout.trim().split('\n').pop()); } catch {}
  need.forEach((f, i) => epubCache.set(f.file, { mtime: f.mtime, info: infos[i] || {} }));
}

ipcMain.handle('library:list', async () => {
  const d = epubDir();
  fs.mkdirSync(d, { recursive: true });
  const files = fs.readdirSync(d).filter((f) => f.toLowerCase().endsWith('.epub')).map((f) => {
    const file = path.join(d, f), st = fs.statSync(file);
    return { file, slug: f.slice(0, -5), size: st.size, mtime: st.mtimeMs };
  });
  await loadEpubInfos(files);
  return files.map((f) => {
    const info = epubCache.get(f.file)?.info || {};
    let title = info.title || '', author = info.author || '';
    const yapi = paths(f.slug).yapi;
    if ((!title || !author) && fs.existsSync(yapi)) {
      try { const y = JSON.parse(fs.readFileSync(yapi, 'utf8')); title ||= y.title || ''; author ||= y.author || ''; } catch {}
    }
    return {
      ...f, title: title || f.slug, author,
      cover: info.cover ? `data:image/jpeg;base64,${info.cover}` : coverDataUrl(f.slug),
      color: info.color || null, own: fs.existsSync(outDir(f.slug)),
      publisher: info.publisher || '', date: info.date || '', language: info.language || '', isbn: info.isbn || '',
      subjects: info.subjects || [], description: info.description || '', pages: info.pages || 0, pagesExact: !!info.pages_exact,
      wrap: coverWrap(f.slug),
    };
  }).sort((a, b) => a.title.localeCompare(b.title, 'tr'));
});

function addEpubs(files) {
  const d = epubDir();
  fs.mkdirSync(d, { recursive: true });
  let added = 0;
  for (const src of files || []) {
    if (!src || !src.toLowerCase().endsWith('.epub') || !fs.existsSync(src)) continue;
    if (path.resolve(path.dirname(src)).toLowerCase() === path.resolve(d).toLowerCase()) continue;
    const base = path.basename(src, path.extname(src)), size = fs.statSync(src).size;
    let dest = path.join(d, `${base}.epub`), i = 2, dup = false;
    while (fs.existsSync(dest)) {
      if (fs.statSync(dest).size === size) { dup = true; break; } // aynı kitap zaten rafta
      dest = path.join(d, `${base} (${i++}).epub`);
    }
    if (dup) continue;
    fs.copyFileSync(src, dest);
    added++;
  }
  return added;
}

ipcMain.handle('library:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Kitaplığa EPUB ekle', filters: [{ name: 'EPUB kitap', extensions: ['epub'] }], properties: ['openFile', 'multiSelections'],
  });
  return r.canceled ? 0 : addEpubs(r.filePaths);
});

ipcMain.handle('library:add', (_e, files) => addEpubs(files));

ipcMain.handle('library:remove', async (_e, file) => {
  // Sadece epubs klasöründeki dosyalar, kalıcı silme yerine Geri Dönüşüm Kutusu'na
  if (path.resolve(path.dirname(file)).toLowerCase() !== path.resolve(epubDir()).toLowerCase()) return false;
  if (!fs.existsSync(file)) return false;
  await shell.trashItem(file);
  epubCache.delete(file);
  return true;
});

ipcMain.handle('file:reveal', (_e, p) => { if (fs.existsSync(p)) shell.showItemInFolder(p); });

// ---------- kitap özeti (sekmelerde gösterilen sonuçlar) ----------
// Python'un yazdığı metin/JSON dosyalarını okuyup arayüze hazır veri döner. Dosya yoksa ilgili alan boş kalır.
function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }
function parseChanges(txt) {
  // degisiklikler.txt: "Başlık (N adet)" / "Toplam N düzeltme" bölümleri, altında "eski" -> "yeni" (xK) satırları
  const out = { total: 0, groups: [], items: [] };
  if (!txt) return out;
  let group = 'Kelime düzeltmesi';
  const lines = txt.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], next = lines[i + 1] || '';
    if (/^=+$/.test(next.trim()) && l.trim()) {
      const m = l.match(/^Toplam (\d+) düzeltme/);
      group = m ? 'Kelime düzeltmesi' : l.replace(/\s*\(\d+ adet\)\s*$/, '').trim();
      out.groups.push({ name: group, count: +(l.match(/(\d+)/) || [0, 0])[1] });
      continue;
    }
    const m = l.match(/^"(.+?)" -> "(.*?)"(?:\s*\(x(\d+)\))?/);
    if (m) out.items.push({ from: m[1], to: m[2], n: +(m[3] || 1), group });
  }
  out.total = out.items.reduce((a, b) => a + b.n, 0);
  return out;
}
function parseReview(txt) {
  if (!txt) return [];
  const items = [];
  const re = /^\[(\S+?)\] (.+)\r?\n\s+Bağlam: (.*?)(?: \| öneriler: (.*?))?(?: \| model: (.*))?$/gm;
  let m;
  while ((m = re.exec(txt))) items.push({ kind: m[1], word: m[2].trim(), context: m[3].trim(), suggestions: (m[4] || '').split(',').map((x) => x.trim()).filter(Boolean), note: (m[5] || '').trim() });
  return items;
}
ipcMain.handle('book:summary', (_e, slug) => {
  const p = paths(slug), o = outDir(slug), r = {};
  // OCR
  try {
    const pages = JSON.parse(readText(p.pages) || '{}');
    const models = [pages.model].filter(Boolean);
    for (const f of fs.existsSync(o) ? fs.readdirSync(o) : []) {
      const m = f.match(new RegExp(`^${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_sayfalar_(.+)\\.json$`));
      if (m) models.push(/_ocr$/.test(m[1]) ? m[1].replace(/_ocr$/, '-ocr') : m[1].replace(/_([^_]+)$/, ':$1'));   // glm_ocr -> glm-ocr, gemma3_12b -> gemma3:12b
    }
    const ens = readText(path.join(o, `${slug}_ensemble.txt`)) || '';
    r.ocr = {
      pages: Object.keys(pages.pages || {}).length, models,
      fromSecond: +((ens.match(/Toplam (\d+) kelime ikinci modelden/) || [0, 0])[1]),
      vote: /\(oy\)/.test(ens),
    };
  } catch { r.ocr = null; }
  // Düzeltme
  r.changes = parseChanges(readText(p.changes));
  r.review = parseReview(readText(p.review));
  // metin istatistikleri
  const md = readText(p.editorMd) || readText(p.md);
  if (md) {
    const words = (md.match(/[\p{L}\p{N}]+/gu) || []).length;
    r.stats = { words, paragraphs: md.split(/\n\s*\n/).filter((x) => x.trim()).length, pagesEst: Math.max(1, Math.round(words / 260)) };
  }
  // Yapı
  try {
    const y = JSON.parse(readText(p.yapi) || 'null');
    if (y) {
      const toc = tocOf(y, editorParas(slug));
      r.structure = { title: y.title || '', author: y.author || '', template: y.template || 'klasik', chapters: toc.map((it) => ({ idx: it.idx, title: it.title, level: it.level, kind: it.kind })) };
    }
  } catch { r.structure = null; }
  // Ölçüm raporu: aşama satırları
  const rep = readText(p.report);
  if (rep) r.report = [...rep.matchAll(/^(.+?)\s{2,}([\d.]+)%\s+([\d.]+)%/gm)].map((m) => ({ stage: m[1].trim(), wer: +m[2], cer: +m[3] }));
  return r;
});

// ---------- gereken modeller ----------
// Model adları Python dosyalarından okunur; böylece bir model değişince uygulama da güncel kalır.
ipcMain.handle('models:required', async () => {   // etkin (seçili) modeller; kapalı görev = ''
  const st = await modelState();
  return { ocr: st.roles.ocr.secili, second: st.roles.second.secili, third: st.roles.third.secili, editor: st.roles.text.secili };
});

// ---------- doğruluk ölçümü ----------
ipcMain.handle('eval:ref', async (_e, slug) => {
  const r = await runPy(['degerlendir.py', '--book', slug, '--find-only']);
  try { return JSON.parse(r.stdout.trim().split('\n').pop()).epub; } catch { return null; }
});

// ---------- Ollama durumu ----------
ipcMain.handle('ollama:status', () => ollamaTags());
function ollamaTags() { return new Promise((resolve) => {
  const req = http.get('http://localhost:11434/api/tags', { timeout: 1500 }, (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => {
      try { resolve({ up: true, models: JSON.parse(body).models.map((m) => m.name) }); }
      catch { resolve({ up: true, models: [] }); }
    });
  });
  req.on('timeout', () => { req.destroy(); resolve({ up: false }); });
  req.on('error', () => resolve({ up: false }));
}); }

// ---------- donanım algılama ve model yönetimi ----------
// Her görev için ağırdan hafife seçenekler. ram: modelin çalışırken istediği yaklaşık bellek (GB, RAM+VRAM),
// hata: o seçeneğin tüm hattın kelime hata payına tahmini katkısı (yüzde puan, [alt, üst]).
const MODEL_CATALOG = {
  ocr: { ad: 'OCR · ana okuyucu', env: ['KITAP_VISION_MODEL'], zorunlu: true, secenek: [
    { id: 'qwen2.5vl:7b', ad: 'Qwen2.5-VL 7B', ram: 6, hata: [0, 0], tur: 'standart' },
    { id: 'qwen2.5vl:3b', ad: 'Qwen2.5-VL 3B', ram: 3.5, hata: [2, 3], tur: 'hafif' }] },
  second: { ad: 'OCR · ikinci okuma', env: ['KITAP_SECOND_MODEL'], secenek: [
    { id: 'glm-ocr', ad: 'GLM-OCR', ram: 2.5, hata: [0, 0], tur: 'standart' },
    { id: '', ad: 'Kapalı (tek okuma)', ram: 0, hata: [1, 2], tur: 'kapali' }] },
  third: { ad: 'OCR · anlaşmazlıkta oy', env: ['KITAP_THIRD_MODEL'], secenek: [
    { id: 'gemma3:12b', ad: 'Gemma 3 12B', ram: 9, hata: [0, 0], tur: 'standart' },
    { id: 'gemma3:4b', ad: 'Gemma 3 4B', ram: 4, hata: [0.5, 1], tur: 'hafif' },
    { id: '', ad: 'Kapalı (oylama yok)', ram: 0, hata: [1, 1.5], tur: 'kapali' }] },
  text: { ad: 'Metin düzeltme · bölüm tespiti · kapak teması', env: ['KITAP_EDITOR_MODEL', 'KITAP_TEXT_MODEL'], secenek: [
    { id: 'qwen2.5:14b-instruct', ad: 'Qwen2.5 14B Instruct', ram: 10, hata: [0, 0], tur: 'standart' },
    { id: 'qwen2.5:7b-instruct', ad: 'Qwen2.5 7B Instruct', ram: 5.5, hata: [1, 2], tur: 'hafif' },
    { id: '', ad: 'Kural tabanlı motor (dil modeli yok)', ram: 0, hata: [3, 5], tur: 'kapali' }] },
};
const BASE_ERR = [1, 2];
const settingsFile = () => path.join(app.getPath('userData'), 'model_ayarlari.json');
function readModelSettings() {
  try { const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); return { mode: s.mode === 'elle' ? 'elle' : 'otomatik', manual: s.manual || {} }; }
  catch { return { mode: 'otomatik', manual: {} }; }
}
let sysCache = null;
async function sysInfo() {
  if (sysCache) return sysCache;
  const gb = (b) => Math.round((b / 1073741824) * 10) / 10;
  let gpus = [], renderer = '';
  try {
    const g = await app.getGPUInfo('complete');
    renderer = g?.auxAttributes?.glRenderer || '';
    gpus = (g?.gpuDevice || []).map((d) => ({ vendor: d.vendorId, active: !!d.active, name: d.deviceString || '' }));
  } catch { try { const g = await app.getGPUInfo('basic'); gpus = (g?.gpuDevice || []).map((d) => ({ vendor: d.vendorId, active: !!d.active, name: '' })); } catch {} }
  const VENDOR = { 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x8086: 'Intel', 0x106b: 'Apple', 0x5143: 'Qualcomm' };
  const appleSilicon = process.platform === 'darwin' && process.arch === 'arm64';
  const names = gpus.map((d) => d.name || VENDOR[d.vendor] || 'Bilinmeyen GPU');
  const rendName = (renderer.match(/ANGLE \(([^,]+),\s*([^,(]+)/) || [])[2] || renderer;
  const dedicated = appleSilicon || gpus.some((d) => d.vendor === 0x10de || (d.vendor === 0x1002 && /RX|Pro|FirePro/i.test(d.name + renderer))) || /NVIDIA|Radeon RX|Arc A\d/i.test(renderer);
  const OSN = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  sysCache = {
    os: `${OSN[process.platform] || process.platform} ${os.release()}`, platform: process.platform, arch: process.arch,
    totalGB: gb(os.totalmem()), cpu: (os.cpus()[0]?.model || '').replace(/\s+/g, ' ').trim(), cores: os.cpus().length,
    gpu: (rendName || names.join(', ') || 'Bulunamadı').trim(), dedicated, appleSilicon,
  };
  return sysCache;
}
let modelCache = null, modelCacheT = 0;
// Otomatik mod: bellek sınırına sığan ve kurulu olan en güçlü seçenek; zorunlu olmayan görev sığmıyor/kurulu değilse kapatılır.
async function modelState(force = false) {
  if (!force && modelCache && Date.now() - modelCacheT < 15000) return modelCache;
  const [sys, tags] = await Promise.all([sysInfo(), ollamaTags()]);
  const set = readModelSettings();
  const have = new Set((tags.models || []).flatMap((m) => [m, m.replace(/:latest$/, '')]));
  const limit = Math.round(sys.totalGB * (sys.appleSilicon ? 0.75 : 0.7) * 10) / 10;
  const roles = {}, notes = [], env = {};
  let lo = BASE_ERR[0], hi = BASE_ERR[1];
  for (const [key, R] of Object.entries(MODEL_CATALOG)) {
    const opts = R.secenek.map((o) => ({ ...o, kurulu: !o.id || have.has(o.id), sigar: o.ram <= limit }));
    const best = opts[0];
    let pick;
    if (set.mode === 'elle' && opts.some((o) => o.id === set.manual[key])) pick = opts.find((o) => o.id === set.manual[key]);
    else {
      pick = opts.find((o) => o.id && o.sigar && (o.kurulu || !tags.up))
        || (R.zorunlu ? opts.find((o) => o.sigar) || opts[opts.length - 1] : opts.find((o) => !o.id));
    }
    roles[key] = { ad: R.ad, zorunlu: !!R.zorunlu, secili: pick.id, secenek: opts };
    lo += pick.hata[0]; hi += pick.hata[1];
    for (const e of R.env) env[e] = pick.id;
    if (pick.id !== best.id) {
      const neden = set.mode === 'elle' ? 'elle seçildi' : !best.sigar ? `donanım (${sys.totalGB} GB RAM, ${sys.dedicated ? 'harici GPU' : 'dahili GPU'})` : !best.kurulu ? 'model kurulu değil' : '';
      notes.push({ rol: key, rolAd: R.ad, devre: best.ad, yerine: pick.ad, kapali: !pick.id, neden, kur: !best.kurulu ? `ollama pull ${best.id}` : '' });
    }
  }
  modelEnv = env;
  modelCache = { sys, up: !!tags.up, installed: [...have], mode: set.mode, limitGB: limit, roles, notes, err: [Math.round(lo), Math.round(hi)], baseErr: BASE_ERR };
  modelCacheT = Date.now();
  return modelCache;
}
let modelEnv = {};
const pyEnv = () => ({ ...PY_ENV, ...modelEnv });
ipcMain.handle('models:state', (_e, force) => modelState(!!force));
ipcMain.handle('models:set', async (_e, s) => {
  const cur = readModelSettings();
  const next = { mode: s?.mode === 'elle' ? 'elle' : 'otomatik', manual: { ...cur.manual, ...(s?.manual || {}) } };
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8'); } catch {}
  return modelState(true);
});