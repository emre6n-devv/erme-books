// quality.js - uyarlanır grafik kalitesi (Yüksek / Orta / Düşük) ve FPS izleyici.
// 3D sahneler (tree3d, scenery3d, hollowLibrary3d, book3d, coverGenerator) seçili ön ayarı okur ve
// değişince on(...) ile haber alır. Otomatik moddaysa sahneler her karede frame(now) çağırır;
// ortalama kare hızı 35'in altında kalırsa kalite bir kademe düşürülür.
(() => {
  const PRESETS = {
    yuksek: { ad: 'Yüksek', dpr: 2, shadows: true, shadowSize: 2048, particles: 1, fauna: 1 },
    orta: { ad: 'Orta', dpr: 1.25, shadows: true, shadowSize: 1024, particles: 0.6, fauna: 0.7 },
    dusuk: { ad: 'Düşük', dpr: 1, shadows: false, shadowSize: 512, particles: 0.3, fauna: 0.45 },
  };
  const ORDER = ['yuksek', 'orta', 'dusuk'];
  const KEY = 'erme.quality.v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { saved = {}; }
  // ilk açılış tahmini: az çekirdek / az bellek bildiren makinelerde Orta'dan başla
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  const subs = new Set();
  let winStart = 0, frames = 0, lastNow = 0, warm = 0, slow = 0;

  const Q = {
    PRESETS, ORDER,
    auto: saved.auto !== false,
    level: PRESETS[saved.level] ? saved.level : weak ? 'orta' : 'yuksek',
    fps: 0,
    get p() { return PRESETS[this.level]; },
    /** dpr üst sınırı: hem ön ayar hem de sahnenin kendi tavanı */
    dpr(cap = 2) { return Math.min(window.devicePixelRatio || 1, cap, this.p.dpr); },
    set(level, auto = this.auto, reason = 'user') {
      if (!PRESETS[level]) return;
      const changed = level !== this.level || auto !== this.auto;
      this.level = level; this.auto = !!auto; warm = 0; slow = 0;
      try { localStorage.setItem(KEY, JSON.stringify({ level: this.level, auto: this.auto })); } catch {}
      if (changed) subs.forEach((cb) => { try { cb(this.p, reason); } catch (e) { console.error(e); } });
    },
    on(cb) { subs.add(cb); return () => subs.delete(cb); },
    /** sahnenin her karesinde çağrılır (performance.now() değeriyle) */
    frame(now) {
      if (!lastNow || now - lastNow > 500) { winStart = now; frames = 0; lastNow = now; return; }   // sekme gizliydi / sahne duruyordu
      lastNow = now; frames++;
      const span = now - winStart;
      if (span < 3000) return;
      this.fps = (frames * 1000) / span; winStart = now; frames = 0;
      if (warm < 2) { warm++; return; }   // geçişlerden sonra ölçüm otursun
      if (!this.auto) return;
      if (this.fps < 35) slow++; else slow = 0;
      const i = ORDER.indexOf(this.level);
      if (slow >= 2 && i < ORDER.length - 1) this.set(ORDER[i + 1], true, 'auto');
    },
  };
  window.ErmeQuality = Q;
})();
