/* PhotoFest Desktop (Windows) — lapisan desktop untuk photofest.html.
   Hanya aktif di dalam aplikasi Electron (window.PFNative dari preload.js).
   Isi: klien penyimpanan lokal (pengganti Supabase), penyimpanan internal/folder/cloud, Google Drive,
   daftar semua printer, daftar semua kamera + kontrol kamera (ISO, aperture, dst), dan panel Pengaturan. */
(() => {
  'use strict';
  const N = window.PFNative;
  if (!N) return;
  let SET = N.settings || {};
  const LOCAL = SET.account !== 'online';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  const h = (t, p = {}, ...k) => {
    const e = document.createElement(t);
    for (const a in p) {
      const v = p[a];
      if (a === 'class') e.className = v;
      else if (a.startsWith('on')) e[a] = v;
      else if (v === true) e.setAttribute(a, '');
      else if (v !== false && v != null) e.setAttribute(a, v);
    }
    e.append(...k);
    return e;
  };
  const toast = (t, m, ms) => { const p = window.__pf; if (p && p.toast) p.toast(t, m || '', ms || 4200); else console.log(t, m || ''); };
  const errText = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const save = async (p) => { SET = await N.patchSettings(p); return SET; };
  const fmtBytes = (b) => (b == null ? '-' : b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : (b / 1e6).toFixed(0) + ' MB');

  /* ================= aset: pakai file lokal bila ada, selain itu ambil dari Supabase ================= */
  let LOCALSET = new Set(), ROWS = [];
  const manifestP = fetch('assets/manifest.json').then((r) => r.json()).then((rows) => {
    ROWS = rows.filter((r) => r.active !== false);
    LOCALSET = new Set(rows.filter((r) => r.local).map((r) => r.path));
  }).catch((e) => console.warn('manifest aset tidak terbaca', e));
  const ORI = location.origin; // pfapp://pf di aplikasi
  const assetUrl = (p, supaUrl) => (LOCALSET.has(p) ? ORI + '/app/assets/' + p : (supaUrl || '') + '/storage/v1/object/public/assets/' + p);

  /* ================= klien lokal: meniru bagian Supabase yang dipakai PhotoFest ================= */
  const takeUrl = (id, name, dl) => ORI + '/take/' + id + '/' + encodeURIComponent(name) + (dl ? '?dl=' + encodeURIComponent(dl) : '');
  const parsePath = (p) => { const a = String(p).split('/'); return { id: a[1], name: a[a.length - 1] }; };
  const wrap = async (fn) => { try { return { data: await fn(), error: null }; } catch (e) { return { data: null, error: { message: errText(e) } }; } };
  function query(resolve) {
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: () => q, single: () => q, then: (ok, no) => resolve().then(ok, no) };
    return q;
  }
  function localClient() {
    const profile = { id: 'local', username: 'Lokal', role: 'user', disabled: false };
    const noAcct = () => ({ data: null, error: { message: 'Mode lokal: tidak memakai akun. Ganti ke mode Online di Pengaturan > Aplikasi.' } });
    return {
      from: (t) => query(() => {
        if (t === 'catalog') return manifestP.then(() => ({ data: ROWS.map(({ kind, key, name, path, meta }) => ({ kind, key, name, path, meta })), error: null }));
        if (t === 'profiles') return Promise.resolve({ data: profile, error: null });
        if (t === 'takes') {
          return wrap(async () => (await N.take.list()).map((x) => ({ ...x, status: 'ready', files: x.files.map((n) => 'local/' + x.id + '/' + n) })));
        }
        return Promise.resolve({ data: t === 'designs' ? [] : null, error: null });
      }),
      rpc: (name, a = {}) => {
        if (name === 'quota_info') return wrap(() => N.take.quota());
        if (name === 'begin_take') return wrap(() => N.take.begin());
        if (name === 'finish_take') return wrap(() => N.take.finish(a.p_id, (a.p_files || []).map((f) => parsePath(f).name)));
        if (name === 'delete_take') return wrap(() => N.take.remove(a.p_id));
        return Promise.resolve(noAcct());
      },
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'local' } } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: async () => ({ error: null }),
        signInWithPassword: async () => noAcct(), signUp: async () => noAcct(),
      },
      functions: { invoke: async () => noAcct() },
      storage: {
        from: () => ({
          upload: async (path, blob) => {
            const { id, name } = parsePath(path);
            return wrap(async () => { await N.take.put(id, name, await blob.arrayBuffer()); return { path }; });
          },
          createSignedUrl: async (path, _s, o) => { const { id, name } = parsePath(path); return { data: { signedUrl: takeUrl(id, name, o && o.download) }, error: null }; },
          createSignedUrls: async (paths) => ({ data: paths.map((p) => { const { id, name } = parsePath(p); return { path: p, signedUrl: takeUrl(id, name) }; }), error: null }),
          remove: async () => ({ data: [], error: null }),
        }),
      },
    };
  }
  // Mode online: tetap pakai Supabase, tapi setiap file juga disalin ke penyimpanan pilihan di komputer ini.
  function mirrorClient(real) {
    const from = real.storage.from.bind(real.storage);
    real.storage.from = (b) => {
      const bk = from(b);
      if (b !== 'takes') return bk;
      const up = bk.upload.bind(bk);
      bk.upload = async (path, blob, o) => {
        const r = await up(path, blob, o);
        if (!r.error) { const { id, name } = parsePath(path); blob.arrayBuffer().then((ab) => N.take.put(id, name, ab)).catch((e) => console.warn('salinan lokal gagal', e)); }
        return r;
      };
      return bk;
    };
    return real;
  }

  /* ================= kamera ================= */
  const md = navigator.mediaDevices;
  const origGUM = md.getUserMedia.bind(md), origEnum = md.enumerateDevices.bind(md);
  const DSLR_ID = 'dslr:digicamcontrol';
  const camSaved = () => (SET.camera && SET.camera.saved) || {};
  const idOf = (c) => { const d = c && c.video && c.video.deviceId; return d && (d.exact || d.ideal || (typeof d === 'string' ? d : '')); };

  async function dslrStream() {
    await N.dslr.liveStart().catch(() => {});
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
    const grab = async () => { const buf = await N.dslr.frame(); return createImageBitmap(new Blob([buf], { type: 'image/jpeg' })); };
    let bm = null;
    for (let i = 0; i < 20 && !bm; i++) { try { bm = await grab(); } catch { await sleep(500); } }
    if (!bm) throw new DOMException('Live view digiCamControl tidak aktif', 'NotFoundError');
    cv.width = bm.width; cv.height = bm.height; ctx.drawImage(bm, 0, 0); bm.close();
    const stream = cv.captureStream(30), tr = stream.getVideoTracks()[0], stop = tr.stop.bind(tr);
    let run = true;
    tr.stop = () => { run = false; N.dslr.liveStop().catch(() => {}); stop(); };
    (async () => {
      while (run) {
        try {
          const b = await grab();
          if (cv.width !== b.width || cv.height !== b.height) { cv.width = b.width; cv.height = b.height; }
          ctx.drawImage(b, 0, 0); b.close();
        } catch { await sleep(250); }
        await sleep(12);
      }
    })();
    return stream;
  }

  async function applyAdv(track, adv) {
    try { await track.applyConstraints({ advanced: [adv] }); return true; } catch {}
    let ok = false;
    for (const k of Object.keys(adv)) { try { await track.applyConstraints({ advanced: [{ [k]: adv[k] }] }); ok = true; } catch {} }
    return ok;
  }
  md.getUserMedia = async (c) => {
    const id = idOf(c);
    if (id === DSLR_ID) return dslrStream();
    let cc = c;
    const sv = camSaved()[id];
    if (sv && sv.width && c && typeof c.video === 'object') cc = { ...c, video: { ...c.video, width: { ideal: sv.width }, height: { ideal: sv.height } } };
    const s = await origGUM(cc);
    const t = s.getVideoTracks()[0];
    const real = t && t.getSettings && t.getSettings().deviceId;
    const adv = camSaved()[real] && camSaved()[real].adv;
    if (t && adv && Object.keys(adv).length) applyAdv(t, adv);
    return s;
  };

  let DSLR = { running: false, cameras: [] };
  async function refreshDevices() {
    const sel = $('#dev');
    if (!sel) return;
    let ds = [];
    try { ds = (await origEnum()).filter((d) => d.kind === 'videoinput'); } catch {}
    if (ds.length && !ds[0].label) { // label baru terbaca setelah izin kamera diberikan
      try { (await origGUM({ video: true })).getTracks().forEach((t) => t.stop()); ds = (await origEnum()).filter((d) => d.kind === 'videoinput'); } catch {}
    }
    DSLR = await N.dslr.status().catch(() => ({ running: false, cameras: [] }));
    const cur = sel.value || camSaved().__last || '';
    sel.replaceChildren(new Option('Kamera default', ''));
    ds.forEach((d, i) => sel.append(new Option(d.label || 'Kamera ' + (i + 1), d.deviceId)));
    if (DSLR.running) sel.append(new Option('DSLR / Mirrorless (digiCamControl)' + (DSLR.cameras[0] ? ' · ' + DSLR.cameras[0] : ''), DSLR_ID));
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  }
  md.addEventListener('devicechange', () => { refreshDevices(); });

  const liveTrack = () => { const v = $('#vid'), s = v && v.srcObject; return s && s.getVideoTracks && s.getVideoTracks()[0]; };
  const restartCam = () => { const s = $('#dev'); if (s) s.dispatchEvent(new Event('change')); };

  const RANGES = [
    ['brightness', 'Brightness'], ['contrast', 'Contrast'], ['saturation', 'Saturation'], ['sharpness', 'Sharpness'],
    ['exposureCompensation', 'Exposure compensation'], ['exposureTime', 'Waktu eksposur (shutter, satuan 100 µs)'], ['iso', 'ISO'],
    ['colorTemperature', 'Suhu warna (K)'], ['focusDistance', 'Jarak fokus'], ['zoom', 'Zoom'], ['pan', 'Pan'], ['tilt', 'Tilt'],
  ];
  const MODES = [['exposureMode', 'Mode eksposur'], ['whiteBalanceMode', 'White balance'], ['focusMode', 'Mode fokus']];
  const NEEDS = { exposureTime: ['exposureMode', 'manual'], iso: ['exposureMode', 'manual'], colorTemperature: ['whiteBalanceMode', 'manual'], focusDistance: ['focusMode', 'manual'] };

  function buildWebcam(box) {
    const t = liveTrack();
    box.replaceChildren();
    if (!t || !t.getCapabilities) { box.append(h('p', { class: 'mut' }, 'Nyalakan kamera di halaman foto dulu (langkah ambil foto), lalu buka tab ini lagi.')); return; }
    const caps = t.getCapabilities(), cur = () => t.getSettings(), id = cur().deviceId;
    if (!id) { box.append(h('p', { class: 'mut' }, 'Kamera ini (mis. DSLR lewat digiCamControl) diatur di bagian DSLR di bawah.')); return; }
    const persist = (adv) => {
      const s = { ...camSaved() };
      s[id] = { ...(s[id] || {}), adv: { ...((s[id] && s[id].adv) || {}), ...adv } };
      return save({ camera: { saved: s } });
    };
    const set = async (k, v) => {
      const adv = { [k]: v };
      if (NEEDS[k] && caps[NEEDS[k][0]] && caps[NEEDS[k][0]].includes(NEEDS[k][1])) adv[NEEDS[k][0]] = NEEDS[k][1];
      if (await applyAdv(t, adv)) { await persist(adv); return true; }
      toast('Kamera menolak pengaturan ini', 'Driver kamera ini tidak mendukungnya.'); return false;
    };
    // resolusi
    if (caps.width && caps.height) {
      const all = [[640, 480], [1280, 720], [1280, 960], [1920, 1080], [2560, 1440], [3840, 2160]].filter(([w, hh]) => w <= caps.width.max && hh <= caps.height.max);
      const sel = h('select', { onchange: async () => { const [w, hh] = sel.value.split('x').map(Number); const s = { ...camSaved() }; s[id] = { ...(s[id] || {}), width: w, height: hh }; await save({ camera: { saved: s } }); restartCam(); } }, ...all.map(([w, hh]) => new Option(`${w} x ${hh}`, `${w}x${hh}`)));
      const sv = camSaved()[id], s0 = cur();
      sel.value = sv && sv.width ? `${sv.width}x${sv.height}` : `${s0.width}x${s0.height}`;
      box.append(h('label', {}, 'Resolusi (kamera dinyalakan ulang)', sel));
    }
    let n = 0;
    for (const [k, label] of MODES) {
      if (!Array.isArray(caps[k]) || !caps[k].length) continue;
      n++;
      const sel = h('select', { onchange: () => set(k, sel.value) }, ...caps[k].map((m) => new Option(m, m)));
      sel.value = cur()[k] || caps[k][0];
      box.append(h('label', {}, label, sel));
    }
    for (const [k, label] of RANGES) {
      const c = caps[k];
      if (!c || c.max == null || c.min === c.max) continue;
      n++;
      const val = h('b', {}, String(cur()[k] ?? c.min));
      const r = h('input', { type: 'range', min: c.min, max: c.max, step: c.step || (c.max - c.min) / 100 });
      r.value = cur()[k] ?? c.min;
      r.oninput = () => { val.textContent = r.value; };
      r.onchange = () => set(k, Number(r.value));
      box.append(h('label', {}, h('span', {}, label + ': ', val), r));
    }
    if (caps.torch) { n++; const c = h('input', { type: 'checkbox', onchange: () => set('torch', c.checked) }); c.checked = !!cur().torch; box.append(h('label', { class: 'pfck' }, c, ' Lampu / torch')); }
    if (!n) box.append(h('p', { class: 'mut' }, 'Driver kamera ini tidak membuka kontrol manual (ISO, shutter, dst). Kamera DSLR/mirrorless bisa diatur lengkap lewat digiCamControl di bawah.'));
    box.append(h('div', { class: 'row' }, h('button', { class: 'btn s g', onclick: async () => {
      const s = { ...camSaved() }; delete s[id]; await save({ camera: { saved: s } });
      const adv = {}; for (const [k] of MODES) if (caps[k] && caps[k].includes('continuous')) adv[k] = 'continuous';
      if (Object.keys(adv).length) await applyAdv(t, adv);
      restartCam(); setTimeout(() => buildWebcam(box), 1500);
    } }, 'Kembalikan ke otomatis')));
  }

  async function buildDslr(box) {
    box.replaceChildren(h('p', { class: 'mut' }, 'Memeriksa digiCamControl...'));
    DSLR = await N.dslr.status().catch(() => ({ running: false, cameras: [] }));
    if (!DSLR.running) {
      box.replaceChildren(
        h('p', { class: 'mut' }, 'digiCamControl belum terdeteksi. Untuk kamera DSLR/mirrorless (Canon, Nikon, Sony, Fuji, dll): pasang digiCamControl (gratis), sambungkan kamera lewat USB, lalu di digiCamControl buka Settings > Webserver dan centang "Use web server" (port 5513). Kamera yang sudah dipasang sebagai webcam (Canon EOS Webcam Utility, Sony Imaging Edge Webcam, dll) cukup muncul di daftar kamera di atas.'),
        h('button', { class: 'btn s', onclick: async () => { await refreshDevices(); buildDslr(box); } }, 'Cek lagi'));
      return;
    }
    const { props, options } = await N.dslr.options();
    const cam = DSLR.cameras.length ? DSLR.cameras.join(', ') : 'tidak ada kamera terdeteksi';
    box.replaceChildren(h('p', { class: 'mut' }, 'Terhubung ke digiCamControl. Kamera: ' + cam + '. Pilih "DSLR / Mirrorless" di daftar kamera pada halaman foto untuk memakainya sebagai kamera photobooth.'));
    let any = false;
    for (const [k, label] of props) {
      const o = options[k] || [];
      if (!o.length) continue;
      any = true;
      const sel = h('select', { onchange: async () => { if (!sel.value) return; try { await N.dslr.set(k, sel.value); toast(label, 'Diatur ke ' + sel.value, 2200); } catch (e) { toast('Gagal mengatur ' + label, errText(e), 6000); } } }, new Option('(biarkan seperti sekarang)', ''), ...o.map((v) => new Option(v, v)));
      box.append(h('label', {}, label, sel));
    }
    if (!any) box.append(h('p', { class: 'mut' }, 'Belum ada kamera yang terhubung, atau kamera belum memberi daftar pengaturan. Pastikan kamera menyala dan dikenali digiCamControl, lalu Cek lagi.'));
    const out = h('div', {});
    box.append(h('div', { class: 'row' },
      h('button', { class: 'btn s g', onclick: () => buildDslr(box) }, 'Muat ulang'),
      h('button', { class: 'btn s', onclick: async (e) => {
        e.target.disabled = true; out.replaceChildren(h('p', { class: 'mut' }, 'Menjepret...'));
        try { const buf = await N.dslr.capture(); out.replaceChildren(h('img', { src: URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' })), style: 'max-width:100%;border:3px solid var(--line);border-radius:12px' })); }
        catch (er) { out.replaceChildren(h('p', { class: 'mut' }, 'Gagal: ' + errText(er))); }
        e.target.disabled = false;
      } }, 'Jepret tes (resolusi penuh)')), out);
  }

  /* ================= cetak ================= */
  async function printSheet(o) {
    try {
      const prn = $('#pfdPrn'), cop = $('#pfdCop'), sil = $('#pfdSil');
      await N.print.sheet({ dataUrl: o.src, paper: o.paper, n: o.n, printer: prn ? prn.value : undefined, copies: cop ? Number(cop.value) || 1 : undefined, silent: sil ? sil.checked : undefined });
      toast('Dikirim ke printer', (prn && prn.value) || 'printer bawaan Windows');
    } catch (e) { toast('Gagal mencetak', errText(e), 9000); }
  }
  async function fillPrinters(sel, withDefault) {
    let list = [];
    try { list = await N.print.list(); } catch {}
    const want = sel.value || SET.printer.name || '';
    sel.replaceChildren(new Option(withDefault ? 'Printer bawaan Windows' : '(pilih printer)', ''));
    list.forEach((p) => sel.append(new Option(p.displayName + (p.isDefault ? ' (bawaan)' : ''), p.name)));
    if ([...sel.options].some((o) => o.value === want)) sel.value = want;
    return list;
  }
  function enhancePrintDialog() {
    const dc = $('#pvd .dc'), row = dc && $('.row', dc);
    if (!dc || !row || $('#pfdPrn')) return;
    const prn = h('select', { id: 'pfdPrn', onchange: () => save({ printer: { name: prn.value } }) });
    const cop = h('input', { id: 'pfdCop', type: 'number', min: 1, max: 99, value: SET.printer.copies, onchange: () => save({ printer: { copies: Number(cop.value) || 1 } }) });
    const sil = h('input', { id: 'pfdSil', type: 'checkbox', onchange: () => save({ printer: { silent: sil.checked } }) });
    sil.checked = SET.printer.silent;
    row.before(h('div', { class: 'pfblk' }, h('label', {}, 'Printer', prn), h('label', {}, 'Jumlah salinan', cop), h('label', { class: 'pfck' }, sil, ' Cetak langsung tanpa dialog Windows')));
    new MutationObserver(() => { if ($('#pvd').open) { fillPrinters(prn, true); cop.value = SET.printer.copies; sil.checked = SET.printer.silent; } }).observe($('#pvd'), { attributes: true, attributeFilter: ['open'] });
  }

  /* ================= panel Pengaturan ================= */
  const css = `
  #pfd{max-width:min(96vw,800px)}
  #pfd .dc h2{font-size:30px}
  #pfd .pfs{border-top:3px dashed var(--line);margin-top:16px;padding-top:14px}
  #pfd .pfs h3{margin:0 0 8px;font-size:20px}
  #pfd input[type=text],#pfd input[type=password],#pfd input[type=number]{padding:10px 12px;border-radius:12px;border:3px solid var(--line);background:var(--card);font:inherit;font-weight:700;width:100%;min-width:0;box-sizing:border-box}
  #pfd .pfck,.pfblk .pfck{display:flex;flex-direction:row;align-items:center;gap:8px}
  #pfd .pfck input,.pfblk .pfck input{width:auto}
  #pfd .pfg{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
  #pfd .pfcl{display:grid;gap:8px;margin:8px 0}
  #pfd .btn[aria-pressed=true]{background:var(--g);color:#fff}
  #pfd code{background:var(--soft);padding:1px 6px;border-radius:6px;word-break:break-all}
  .pfblk{display:grid;gap:8px;margin:10px 0}
  .pfblk input[type=number],.pfblk select{width:100%;box-sizing:border-box}
  #pfBtn{position:fixed;left:14px;bottom:14px;z-index:60}`;

  let dlg = null, curTab = 'sim';
  const TABS = [['sim', 'Penyimpanan'], ['prn', 'Printer'], ['cam', 'Kamera'], ['app', 'Aplikasi']];

  function section(title, ...k) { return h('div', { class: 'pfs' }, h('h3', {}, title), ...k); }
  function numField(label, key, min, max, hint) {
    const i = h('input', { type: 'number', min, max, value: SET[key] || 0, onchange: async () => { await save({ [key]: Number(i.value) || 0 }); toast('Tersimpan', '', 1500); } });
    return h('label', {}, label, i, h('span', { class: 'mut' }, hint));
  }

  async function tabStorage(box) {
    const info = await N.storage.info().catch(() => ({}));
    const clouds = await N.storage.clouds().catch(() => []);
    const rerender = () => tabStorage(box);
    const mode = SET.storage.mode;
    const cur = h('p', {}, 'Foto disimpan di: ', h('code', {}, info.root || '-'), h('br'), h('span', { class: 'mut' }, `Sesi tersimpan: ${info.sessions ?? 0} · Ruang kosong: ${fmtBytes(info.free)}`));
    const used = (p) => mode === 'folder' && SET.storage.folder.toLowerCase() === p.toLowerCase();
    const btns = [
      h('button', { class: 'btn s', 'aria-pressed': mode === 'internal', onclick: async () => { await N.storage.use('internal'); await refreshSet(); rerender(); } }, 'Internal (folder Pictures)'),
      h('button', { class: 'btn s', onclick: async () => { const r = await N.storage.pick(); if (r) { await refreshSet(); rerender(); } } }, 'Pilih folder lain... (disk, flashdisk, NAS)'),
    ];
    const cl = clouds.length
      ? clouds.map((c) => h('button', { class: 'btn s g', 'aria-pressed': used(c.path), onclick: async () => { try { await N.storage.use('folder', c.path); await refreshSet(); rerender(); } catch (e) { toast('Gagal', errText(e)); } } }, `${c.label}: ${c.path}`))
      : [h('p', { class: 'mut' }, 'Belum ada folder cloud terdeteksi. Pasang Google Drive for Desktop, OneDrive, Dropbox, iCloud, MEGA, dll, atau pilih foldernya lewat tombol "Pilih folder lain". Semua yang tersinkron otomatis akan ikut terunggah.')];
    const g = SET.gdrive;
    const gs = await N.gdrive.status().catch(() => ({}));
    const cid = h('input', { type: 'text', placeholder: 'xxxx.apps.googleusercontent.com', value: g.clientId || '', autocomplete: 'off', spellcheck: 'false' });
    const sec = h('input', { type: 'password', placeholder: g.hasSecret ? '(tersimpan)' : 'Client Secret', autocomplete: 'off' });
    const stat = h('p', { class: 'mut' }, gs.connected ? `Terhubung${gs.email ? ' sebagai ' + gs.email : ''}. Antrean upload: ${gs.pending}.${gs.error ? ' Terakhir gagal: ' + gs.error : ''}` : 'Belum terhubung.');
    const off = N.onGdrive((s) => { if (stat.isConnected) stat.textContent = s.connected ? `Terhubung${s.email ? ' sebagai ' + s.email : ''}. Antrean upload: ${s.pending}.${s.error ? ' Terakhir gagal: ' + s.error : ''}` : 'Belum terhubung.'; else off(); });
    box.replaceChildren(
      cur,
      h('div', { class: 'pfcl' }, ...btns),
      h('p', { class: 'mut' }, 'Folder cloud yang terdeteksi:'),
      h('div', { class: 'pfcl' }, ...cl),
      h('div', { class: 'row' },
        h('button', { class: 'btn s g', onclick: () => N.storage.open() }, 'Buka folder'),
        h('button', { class: 'btn s g', onclick: async () => { try { await N.storage.test(); toast('Folder bisa ditulisi', info.root, 3000); } catch (e) { toast('Folder tidak bisa ditulisi', errText(e), 7000); } } }, 'Tes tulis')),
      section('Aturan sesi', h('div', { class: 'pfg' },
        numField('Hapus otomatis setelah (hari)', 'retentionDays', 0, 3650, '0 = tidak pernah dihapus'),
        numField('Maksimal sesi di galeri', 'maxSessions', 0, 100000, '0 = tanpa batas. Penuh = tidak bisa foto sampai ada sesi dihapus.'))),
      section('Google Drive (upload otomatis lewat API)',
        h('p', { class: 'mut' }, 'Opsional. Setiap file ikut diunggah ke folder PhotoFest/print, animated, original di Google Drive-mu, dan dicoba ulang otomatis kalau internet putus. Butuh OAuth Client ID tipe "Desktop app" dari Google Cloud Console (panduan di README bagian Google Drive). Jika sudah memakai Google Drive for Desktop di atas, bagian ini tidak perlu.'),
        h('div', { class: 'pfg' }, h('label', {}, 'Client ID', cid), h('label', {}, 'Client Secret', sec)),
        stat,
        h('div', { class: 'row' },
          h('button', { class: 'btn s', onclick: async (e) => {
            e.target.disabled = true;
            try { await save({ gdrive: { clientId: cid.value } }); await N.gdrive.connect({ clientId: cid.value, clientSecret: sec.value }); await refreshSet(); toast('Google Drive terhubung', ''); }
            catch (er) { toast('Gagal menghubungkan', errText(er), 8000); }
            e.target.disabled = false; rerender();
          } }, gs.connected ? 'Hubungkan ulang' : 'Hubungkan Google'),
          gs.connected ? h('button', { class: 'btn s r', onclick: async () => { await N.gdrive.disconnect(); await refreshSet(); rerender(); } }, 'Putuskan') : null)));
  }

  async function tabPrinter(box) {
    const p = SET.printer;
    const prn = h('select', { onchange: () => save({ printer: { name: prn.value } }) });
    const list = await fillPrinters(prn, true);
    const paper = h('select', { onchange: () => save({ printer: { paper: paper.value } }) }, new Option('Strip 5 x 15 cm (ukuran di bawah)', 'strip'), new Option('4R (4 x 6 inci, 2 strip berdampingan)', '4r'), new Option('A4', 'a4'));
    paper.value = p.paper;
    const num = (k, label) => { const i = h('input', { type: 'number', min: 10, max: 1000, value: p[k], onchange: () => save({ printer: { [k]: Number(i.value) } }) }); return h('label', {}, label, i); };
    const cop = h('input', { type: 'number', min: 1, max: 99, value: p.copies, onchange: () => save({ printer: { copies: Number(cop.value) || 1 } }) });
    const sil = h('input', { type: 'checkbox', onchange: () => save({ printer: { silent: sil.checked } }) });
    sil.checked = p.silent;
    box.replaceChildren(
      h('p', { class: 'mut' }, `${list.length} printer terdeteksi di Windows (USB, jaringan, PDF, dye-sub seperti DNP / Canon Selphy / Mitsubishi). Pasang driver printer lebih dulu agar muncul di sini.`),
      h('label', {}, 'Printer', prn),
      h('div', { class: 'pfg' }, h('label', {}, 'Kertas bawaan', paper), h('label', {}, 'Salinan', cop)),
      h('div', { class: 'pfg' }, num('stripW', 'Lebar strip (mm)'), num('stripH', 'Tinggi strip (mm)')),
      h('label', { class: 'pfck' }, sil, ' Cetak langsung tanpa dialog Windows (cocok untuk mesin photobooth). Matikan untuk memilih printer dan kertas lewat dialog Windows.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn s g', onclick: () => tabPrinter(box) }, 'Muat ulang daftar'),
        h('button', { class: 'btn s', onclick: async (e) => { e.target.disabled = true; try { await N.print.test({ printer: prn.value, paper: paper.value, silent: sil.checked }); toast('Halaman tes dikirim', ''); } catch (er) { toast('Gagal mencetak tes', errText(er), 8000); } e.target.disabled = false; } }, 'Cetak halaman tes')),
      h('p', { class: 'mut' }, 'Tips: untuk hasil pas di printer foto, pilih ukuran kertas dan "tanpa tepi" di Preferensi printer Windows (Printing Preferences) sekali saja. Kalau driver tidak mendukung ukuran 5 x 15 cm, pakai 4R: dua strip dicetak berdampingan lalu digunting.'));
  }

  function tabCamera(box) {
    const web = h('div', {}), dslr = h('div', {});
    box.replaceChildren(
      h('p', { class: 'mut' }, 'Semua kamera yang dikenali Windows (webcam, kamera USB, capture card, kamera virtual) muncul di daftar kamera pada halaman foto. Pengaturan di bawah disimpan per kamera dan dipakai lagi otomatis.'),
      h('div', { class: 'row' }, h('button', { class: 'btn s g', onclick: async () => { await refreshDevices(); buildWebcam(web); buildDslr(dslr); } }, 'Muat ulang daftar kamera')),
      section('Kamera yang sedang aktif (webcam / USB)', web),
      section('DSLR / Mirrorless (ISO, aperture, shutter, dll)', dslr));
    buildWebcam(web); buildDslr(dslr);
  }

  async function tabApp(box) {
    const a = await N.app().catch(() => ({}));
    const acct = h('select', { onchange: async () => { await save({ account: acct.value }); toast('Mode akun diganti', 'Memuat ulang...', 1500); setTimeout(() => location.reload(), 900); } },
      new Option('Lokal: tanpa akun, file di komputer ini (disarankan untuk mesin photobooth)', 'local'),
      new Option('Online: akun Supabase + galeri online (file tetap disalin ke komputer ini)', 'online'));
    acct.value = SET.account;
    const fs = h('input', { type: 'checkbox', onchange: () => N.setFullscreen(fs.checked) });
    fs.checked = !!SET.fullscreen;
    box.replaceChildren(
      h('label', {}, 'Mode akun', acct),
      h('label', { class: 'pfck' }, fs, ' Mulai dalam layar penuh (F11 untuk bolak-balik)'),
      section('Tentang', h('p', { class: 'mut' }, `PhotoFest Desktop ${a.version || ''} · Electron ${a.electron || ''} · ${a.platform || ''}`), h('p', { class: 'mut' }, 'Data pengaturan: ', h('code', {}, a.userData || '-')),
        h('p', { class: 'mut' }, 'TheFest Media Production')));
  }

  async function refreshSet() { SET = await N.patchSettings({}); }
  const TAB_FN = { sim: tabStorage, prn: tabPrinter, cam: tabCamera, app: tabApp };
  async function showTab(k) {
    curTab = k;
    [...$('.tabs', dlg).children].forEach((b) => b.setAttribute('aria-selected', b.dataset.k === k));
    const box = $('#pfdBody', dlg);
    box.replaceChildren(h('p', { class: 'mut' }, 'Memuat...'));
    try { await TAB_FN[k](box); } catch (e) { box.replaceChildren(h('p', { class: 'mut' }, 'Gagal memuat: ' + errText(e))); }
  }
  function openSettings(tab) {
    if (!dlg) {
      dlg = h('dialog', { id: 'pfd' }, h('div', { class: 'dc' }, h('h2', {}, 'Pengaturan PhotoFest'),
        h('div', { class: 'tabs' }, ...TABS.map(([k, l]) => h('button', { class: 'tab', 'data-k': k, onclick: () => showTab(k) }, l))),
        h('div', { id: 'pfdBody' }), h('div', { class: 'row', style: 'margin-top:16px' }, h('button', { class: 'btn', onclick: () => dlg.close() }, 'Tutup'))));
      document.body.append(dlg);
    }
    if (!dlg.open) dlg.showModal();
    showTab(tab || curTab);
  }

  /* ================= pasang ke halaman ================= */
  window.PFDesktop = {
    local: LOCAL, native: N, assetUrl, printSheet, openSettings,
    makeClient: (create) => (LOCAL ? localClient() : mirrorClient(create())),
  };
  N.onOpenSettings(() => openSettings());
  N.onDownloaded((d) => toast('File tersimpan', d.name + ' ada di folder Download'));
  document.head.append(h('style', {}, css));
  const boot = () => {
    const gear = h('button', { class: 'hud', id: 'pfBtn', 'aria-label': 'Pengaturan PhotoFest (Ctrl+,)', title: 'Pengaturan (Ctrl+,)', onclick: () => openSettings() }, h('span', { class: 'lv' }, '⚙'));
    document.body.append(gear);
    enhancePrintDialog();
    refreshDevices();
    const dev = $('#dev');
    if (dev) dev.addEventListener('change', () => { const s = { ...camSaved(), __last: dev.value }; save({ camera: { saved: s } }); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
