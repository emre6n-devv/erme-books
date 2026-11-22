// secondaryAppBridge.js - İkinci uygulamanın bağlanacağı nokta ve "Keşif Geçidi" kartı.
//
// Her mevsimde hayat ağacının manzarasında bir gizli geçit vardır:
//   ilkbahar: şelale perdesinin ardındaki kaya oyuğu · yaz: iskeledeki sandal
//   sonbahar: mağaradaki ateş · kış: donmuş göletteki dolunaylı buz aynası
// Geçide tıklanınca kamera ona yaklaşır ve openSecondaryApp(seasonContext) çağrılır.
//
// İkinci uygulama hazır olduğunda yalnızca kayıt olması yeterlidir:
//   window.SecondaryApp.register(async (ctx) => {
//     // ctx = { season, portal, title, at }  →  ikinci uygulamayı aç
//     return true;   // false dönerse (ya da hata verirse) mevsimin kartı gösterilir
//   });
// Kayıtlı bir uygulama yokken geçitler, mevsime yakışan sıcak bir "Keşif Geçidi" kartı açar.
(function () {
  const PORTALS = {
    ilkbahar: { portal: 'selale', title: 'Şelalenin Ardındaki Geçit', glyph: '❀',
      msg: 'Su perdesinin ardındaki bu gizli geçit henüz uyanıyor... Çok yakında yeni bir dünyanın kapısı burada aralanacak.' },
    yaz: { portal: 'sandal', title: 'Kıyıdaki Sandal', glyph: '☀',
      msg: 'Sandal henüz kıyıya bağlı, rüzgarın dolmasını bekliyor... Çok yakında yeni bir yolculuk buradan başlayacak.' },
    sonbahar: { portal: 'magara', title: 'Ateşli Mağara', glyph: '❦',
      msg: 'Mağaranın derinliklerindeki kıvılcım henüz harlanıyor... Çok yakında yeni bir sığınak burada açılacak.' },
    kis: { portal: 'buz-aynasi', title: 'Dolunaylı Buz Aynası', glyph: '❄',
      msg: 'Buzun altındaki ay yansıması henüz şekilleniyor... Çok yakında yeni bir keşif kapısı burada belirecek.' },
  };
  let handler = null, cardEl = null, onReturn = null, closing = 0;

  function build() {
    if (cardEl) return cardEl;
    cardEl = document.createElement('div');
    cardEl.className = 'portal-card'; cardEl.hidden = true;
    cardEl.setAttribute('role', 'dialog'); cardEl.setAttribute('aria-modal', 'true'); cardEl.setAttribute('aria-labelledby', 'pcTitle');
    cardEl.innerHTML = `<div class="pc-box"><div class="pc-glyph" aria-hidden="true"></div><small class="pc-kicker">Keşif Geçidi</small>
      <h3 id="pcTitle"></h3><p class="pc-msg"></p><button class="pc-back" type="button">← Ağaca Dön</button></div>`;
    cardEl.querySelector('.pc-back').addEventListener('click', () => close());
    cardEl.addEventListener('click', (e) => { if (e.target === cardEl) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cardEl && !cardEl.hidden) { e.stopPropagation(); close(); } }, true);
    document.body.appendChild(cardEl);
    return cardEl;
  }
  function showCard(ctx, info) {
    const el = build(); clearTimeout(closing);
    el.dataset.season = ctx.season || 'ilkbahar';
    el.querySelector('.pc-glyph').textContent = info.glyph;
    el.querySelector('h3').textContent = info.title;
    el.querySelector('.pc-msg').textContent = info.msg;
    el.hidden = false; void el.offsetWidth; el.classList.add('show');
    setTimeout(() => el.querySelector('.pc-back').focus({ preventScroll: true }), 350);
  }
  // silent: kart kapanır ama kamera geri çağrılmaz (ör. başka sekmeye geçilirken)
  function close(silent) {
    if (!cardEl || cardEl.hidden) { if (!silent && onReturn) { const f = onReturn; onReturn = null; f(); } return; }
    cardEl.classList.remove('show'); closing = setTimeout(() => { if (!cardEl.classList.contains('show')) cardEl.hidden = true; }, 380);
    const f = onReturn; onReturn = null; if (!silent && f) f();
  }
  async function openSecondaryApp(seasonContext = {}) {
    const season = PORTALS[seasonContext.season] ? seasonContext.season : 'ilkbahar', info = PORTALS[season];
    onReturn = typeof seasonContext.onReturn === 'function' ? seasonContext.onReturn : null;
    const ctx = { season, portal: info.portal, title: info.title, at: new Date() };
    if (handler) {
      try { const ok = await handler(ctx); if (ok !== false) return { opened: true, ctx }; }
      catch (e) { console.error('[ikinci uygulama]', e); }
    }
    showCard(ctx, info);
    return { opened: false, ctx };
  }
  window.SecondaryApp = {
    register(fn) { handler = typeof fn === 'function' ? fn : null; },
    open: openSecondaryApp, close, PORTALS,
    get isOpen() { return !!cardEl && !cardEl.hidden; },
  };
  window.openSecondaryApp = openSecondaryApp;
})();
