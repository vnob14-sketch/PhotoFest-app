'use strict';
// Jembatan aman antara tampilan PhotoFest (renderer) dan proses utama. Tidak ada akses Node di halaman.
const { contextBridge, ipcRenderer } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch) => (cb) => {
  const f = (_e, d) => cb(d);
  ipcRenderer.on(ch, f);
  return () => ipcRenderer.removeListener(ch, f);
};

contextBridge.exposeInMainWorld('PFNative', {
  settings: ipcRenderer.sendSync('pf:settings:sync'), // salinan awal (sinkron) supaya mode akun diketahui sebelum aplikasi mulai
  patchSettings: inv('pf:settings:patch'),
  app: inv('pf:app:info'),
  setFullscreen: inv('pf:app:fullscreen'),
  storage: {
    info: inv('pf:storage:info'),
    pick: inv('pf:storage:pick'),
    use: inv('pf:storage:use'),
    clouds: inv('pf:storage:clouds'),
    test: inv('pf:storage:test'),
    open: inv('pf:storage:open'),
  },
  take: {
    begin: inv('pf:take:begin'),
    put: inv('pf:take:put'),
    finish: inv('pf:take:finish'),
    list: inv('pf:take:list'),
    remove: inv('pf:take:remove'),
    quota: inv('pf:take:quota'),
  },
  gdrive: { status: inv('pf:gdrive:status'), connect: inv('pf:gdrive:connect'), disconnect: inv('pf:gdrive:disconnect') },
  print: { list: inv('pf:print:list'), sheet: inv('pf:print:sheet'), test: inv('pf:print:test') },
  dslr: {
    status: inv('pf:dslr:status'), options: inv('pf:dslr:options'), set: inv('pf:dslr:set'),
    liveStart: inv('pf:dslr:liveStart'), liveStop: inv('pf:dslr:liveStop'), frame: inv('pf:dslr:frame'), capture: inv('pf:dslr:capture'),
  },
  onSettings: on('pf:settings'),
  onGdrive: on('pf:gdrive'),
  onOpenSettings: on('pf:open-settings'),
  onDownloaded: on('pf:downloaded'),
});
