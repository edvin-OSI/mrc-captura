// DIG-MRC-23 prototype: proves install, offline survival, queued sending and auth on the field phone.
// Throwaway by design (digitalizacion-08 §4). Test posts only: no project data is ever bundled here.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const APP_VERSION = 'dig-mrc-23.1';
  const EVENT_ID = 'ENSAYO-PWA-01';
  const POSTS = Array.from({ length: 20 }, (_, i) => 'P' + String(i + 1).padStart(2, '0'));
  const PLUMB = Array.from({ length: 21 }, (_, i) => (i / 10).toFixed(1));
  const CONFIG_KEY = 'mrc-compuerta-config';
  const DEVICE_KEY = 'mrc-compuerta-dispositivo';

  // ---------- configuration (arrives once through a #c= link, never bundled) ----------
  function loadConfig() {
    const m = location.hash.match(/^#c=([A-Za-z0-9_-]+)$/);
    if (m) {
      try {
        const json = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
        localStorage.setItem(CONFIG_KEY, json);
      } catch (e) { /* a bad link leaves the old config */ }
      history.replaceState(null, '', location.pathname);
    }
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {}; } catch (e) { return {}; }
  }
  const CFG = loadConfig();
  const DEVICE = (() => {
    let d = null;
    try { d = localStorage.getItem(DEVICE_KEY); } catch (e) { /* ignore */ }
    if (!d) {
      d = 'tel-' + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem(DEVICE_KEY, d); } catch (e) { /* ignore */ }
    }
    return d;
  })();

  // ---------- IndexedDB ----------
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('mrc-compuerta', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('postes', { keyPath: 'id_fila' });
        d.createObjectStore('fotos', { keyPath: 'id_medio' });
        d.createObjectStore('registro', { keyPath: 'n', autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  const all = (store) => tx(store, 'readonly', (s) => s.getAll());
  const put = (store, value) => tx(store, 'readwrite', (s) => s.put(value));

  async function seed() {
    const existing = await all('postes');
    if (existing.length) return;
    for (const p of POSTS) {
      await put('postes', { id_fila: EVENT_ID + '|' + p, id_evento: EVENT_ID, id_elemento: p,
        data: null, version: 0, enviado: 0 });
    }
  }

  // ---------- log ----------
  function stamp() {
    const d = new Date(), z = (x) => String(x).padStart(2, '0');
    const off = -d.getTimezoneOffset() / 60;
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())} (UTC${off >= 0 ? '+' : ''}${off})`;
  }
  async function record(prueba, ok, detalle) {
    await put('registro', { hora: stamp(), prueba, resultado: ok ? 'ok' : 'falla', detalle: String(detalle || ''),
      instalada: isInstalled(), con_senal: navigator.onLine, version: APP_VERSION, dispositivo: DEVICE });
    renderLog();
  }
  async function renderLog() {
    const rows = (await all('registro')).reverse();
    const ol = $('log');
    ol.textContent = '';
    rows.slice(0, 60).forEach((r) => {
      const li = document.createElement('li');
      const t = document.createElement('span'); t.className = 't'; t.textContent = r.hora + ' · ';
      const res = document.createElement('span'); res.className = r.resultado === 'ok' ? 'r-ok' : 'r-falla';
      res.textContent = r.resultado === 'ok' ? 'OK ' : 'FALLA ';
      li.append(t, res, document.createTextNode(r.prueba + (r.detalle ? ': ' + r.detalle : '')));
      ol.append(li);
    });
  }

  // ---------- status ----------
  const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function chip(id, text, tone) { const c = $(id); c.textContent = text; c.dataset.tone = tone; }
  async function renderStatus() {
    chip('c-install', isInstalled() ? 'Instalada' : 'En el navegador', isInstalled() ? 'ok' : 'warn');
    chip('c-net', navigator.onLine ? 'Con señal' : 'Sin señal', navigator.onLine ? 'ok' : 'warn');
    chip('c-sw', navigator.serviceWorker && navigator.serviceWorker.controller ? 'Funciona sin señal' : 'Aún no funciona sin señal',
      navigator.serviceWorker && navigator.serviceWorker.controller ? 'ok' : 'warn');
    let persisted = false;
    try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch (e) { /* ignore */ }
    chip('c-persist', persisted ? 'Almacenamiento persistente' : 'Almacenamiento no persistente', persisted ? 'ok' : 'warn');
    try {
      const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
      $('m-bytes').textContent = est ? (est.usage / 1048576).toFixed(1).replace('.', ',') + ' MB' : '—';
    } catch (e) { $('m-bytes').textContent = '—'; }
    $('cfg-note').hidden = Boolean(CFG.a);
  }

  // ---------- capture ----------
  let current = null;
  let draft = null;
  async function renderPosts() {
    const posts = await all('postes');
    const photos = await all('fotos');
    const box = $('posts');
    box.textContent = '';
    posts.sort((a, b) => a.id_elemento.localeCompare(b.id_elemento)).forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      const state = !p.data ? 'vacio' : p.enviado >= p.version ? 'enviado' : 'guardado';
      b.dataset.state = state;
      b.setAttribute('aria-pressed', String(current === p.id_fila));
      const label = { vacio: 'sin captura', guardado: 'por enviar', enviado: 'enviado' }[state];
      b.innerHTML = '';
      b.append(document.createTextNode(p.id_elemento));
      const s = document.createElement('small'); s.textContent = label; b.append(s);
      b.addEventListener('click', () => openEditor(p));
      box.append(b);
    });
    $('m-saved').textContent = posts.filter((p) => p.data).length;
    $('m-rows').textContent = posts.filter((p) => p.data && p.enviado < p.version).length;
    $('m-photos').textContent = photos.filter((f) => !f.enviada).length;
  }
  function plumbGrid(id, field) {
    const g = $(id);
    g.textContent = '';
    PLUMB.forEach((v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = v.replace('.', ',');
      b.setAttribute('aria-pressed', String(draft[field] === v));
      b.addEventListener('click', () => { draft[field] = v; plumbGrid(id, field); });
      g.append(b);
    });
  }
  function openEditor(p) {
    current = p.id_fila;
    draft = Object.assign({ plomo_e_o: '', plomo_n_s: '', observaciones: '' }, p.data || {});
    $('editor').hidden = false;
    $('ed-title').textContent = 'Poste ' + p.id_elemento;
    $('ed-obs').value = draft.observaciones || '';
    $('ed-thumb').hidden = true;
    plumbGrid('ed-eo', 'plomo_e_o');
    plumbGrid('ed-ns', 'plomo_n_s');
    renderPosts();
  }
  async function savePost() {
    if (!current) return;
    if (!draft.plomo_e_o || !draft.plomo_n_s) { note('send-note', 'Elige los dos plomos antes de guardar.', 'warn'); return; }
    const posts = await all('postes');
    const p = posts.find((x) => x.id_fila === current);
    p.data = { plomo_e_o: draft.plomo_e_o, plomo_n_s: draft.plomo_n_s, observaciones: $('ed-obs').value.trim(), capturado_en: stamp() };
    p.version = Date.now();
    await put('postes', p);
    await askPersistence(false);
    await record('Guardar ' + p.id_elemento, true, `E-O ${p.data.plomo_e_o} · N-S ${p.data.plomo_n_s}`);
    $('editor').hidden = true;
    current = null;
    await renderPosts();
    if (navigator.onLine) sendAll(false);
  }
  // Re-encodes through a canvas: smaller, and the EXIF block (with any GPS position) does not survive.
  async function takePhoto(file) {
    if (!file || !current) return;
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
    const id = current + '|F' + Date.now();
    await put('fotos', { id_medio: id, id_fila: current, mime: 'image/jpeg', blob, enviada: false, bytes: blob.size });
    $('ed-thumb').src = URL.createObjectURL(blob);
    $('ed-thumb').hidden = false;
    await record('Foto ' + current.split('|')[1], true, `${c.width}×${c.height}, ${Math.round(blob.size / 1024)} KB`);
    await renderPosts();
  }

  // ---------- identity ----------
  let idToken = null;
  function tokenExp(t) {
    try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch (e) { return 0; }
  }
  function tokenEmail(t) {
    try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email; } catch (e) { return ''; }
  }
  function currentToken() {
    if (CFG.tokenPrueba) return CFG.tokenPrueba;
    if (idToken && tokenExp(idToken) - Date.now() > 60000) return idToken;
    return null;
  }
  function renderWho() {
    const t = currentToken();
    if (CFG.tokenPrueba) { $('who').textContent = 'Modo de prueba local.'; return; }
    if (!t) { $('who').textContent = idToken ? 'La sesión venció: vuelve a identificarte.' : 'Sin identificar.'; return; }
    const mins = Math.round((tokenExp(t) - Date.now()) / 60000);
    $('who').textContent = `Identificado como ${tokenEmail(t)}. La sesión vence en ${mins} min.`;
  }
  function initIdentity(attempt = 0) {
    if (!CFG.clientId || CFG.tokenPrueba) { renderWho(); return; }
    if (!window.google || !google.accounts || !google.accounts.id) {
      if (attempt < 20) setTimeout(() => initIdentity(attempt + 1), 500);
      else $('who').textContent = 'No cargó el inicio de sesión de Google (¿sin señal?).';
      return;
    }
    google.accounts.id.initialize({
      client_id: CFG.clientId,
      callback: (res) => {
        idToken = res.credential;
        try { sessionStorage.setItem('mrc-compuerta-token', idToken); } catch (e) { /* ignore */ }
        record('Identificarse', true, tokenEmail(idToken));
        renderWho();
        if (navigator.onLine) sendAll(false);
      },
      auto_select: true,
    });
    google.accounts.id.renderButton($('gis'), { theme: 'outline', size: 'large', text: 'signin_with', locale: 'es' });
    try { idToken = sessionStorage.getItem('mrc-compuerta-token'); } catch (e) { idToken = null; }
    renderWho();
  }

  // ---------- gateway ----------
  async function call(url, body) {
    const started = performance.now();
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ id_token: currentToken(), dispositivo: DEVICE }, body)), redirect: 'follow' });
    } catch (e) {
      return { ok: false, error: 'red_o_cors', detalle: e.message, ms: Math.round(performance.now() - started) };
    }
    const text = await res.text();
    const ms = Math.round(performance.now() - started);
    try { return Object.assign(JSON.parse(text), { ms }); } catch (e) {
      return { ok: false, error: 'respuesta_no_json', detalle: `HTTP ${res.status}; probablemente pide iniciar sesión`, ms };
    }
  }
  async function testGateway(which) {
    const url = CFG[which];
    const name = which === 'a' ? 'Prueba A (cualquiera)' : 'Prueba B (solo OSI)';
    if (!url) { await record(name, false, 'sin URL en la configuración'); return; }
    if (!currentToken()) { await record(name, false, 'identifícate primero'); return; }
    const r = await call(url, { op: 'ping' });
    await record(name, r.ok, r.ok ? `${r.usuario}, ${r.ms} ms` : `${r.error}${r.detalle ? ' (' + r.detalle + ')' : ''}`);
  }
  async function testSheetsApi() {
    const name = 'Prueba C (API de Sheets)';
    if (!CFG.clientId || !CFG.sheetId) { await record(name, false, 'faltan clientId o sheetId en la configuración'); return; }
    if (!window.google || !google.accounts || !google.accounts.oauth2) { await record(name, false, 'no cargó la librería de Google'); return; }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CFG.clientId,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      callback: async (resp) => {
        if (resp.error) { await record(name, false, 'permiso: ' + resp.error); return; }
        const started = performance.now();
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(CFG.sheetId)}/values/via_c!A1:append?valueInputOption=RAW`;
        try {
          const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + resp.access_token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [[stamp(), DEVICE, 'prueba C']] }) });
          const ms = Math.round(performance.now() - started);
          await record(name, r.ok, r.ok ? `fila escrita, ${ms} ms; el token dura ${Math.round(resp.expires_in / 60)} min` : `HTTP ${r.status}`);
        } catch (e) { await record(name, false, 'red: ' + e.message); }
      },
    });
    client.requestAccessToken();
  }

  // ---------- sending ----------
  let sending = false;
  async function sendAll(manual) {
    if (sending) return;
    if (!CFG.a) { if (manual) note('send-note', 'Falta la configuración de la pasarela.', 'warn'); return; }
    if (!navigator.onLine) { if (manual) note('send-note', 'Sin señal: queda guardado y se envía al volver la señal.', 'warn'); return; }
    if (!currentToken()) { if (manual) note('send-note', 'Identifícate para enviar. Nada se pierde mientras tanto.', 'warn'); return; }
    sending = true;
    try {
      const posts = (await all('postes')).filter((p) => p.data && p.enviado < p.version);
      if (posts.length) {
        const r = await call(CFG.a, { op: 'filas', filas: posts.map(wire) });
        if (r.ok) {
          const byKey = Object.fromEntries(r.resultados.map((x) => [x.id_fila, x.action]));
          for (const p of posts) {
            if (['insertada', 'actualizada', 'igual', 'obsoleta'].includes(byKey[p.id_fila])) { p.enviado = p.version; await put('postes', p); }
          }
          const tally = countBy(r.resultados.map((x) => x.action));
          await record('Enviar postes', true, `${fmtTally(tally)}; ${r.ms} ms`);
        } else {
          await record('Enviar postes', false, r.error + (r.detalle ? ' (' + r.detalle + ')' : ''));
        }
      }
      for (const f of (await all('fotos')).filter((x) => !x.enviada)) {
        const b64 = await toBase64(f.blob);
        const r = await call(CFG.a, { op: 'foto', foto: { id_medio: f.id_medio, id_fila: f.id_fila, mime: f.mime, b64 } });
        if (r.ok) { f.enviada = true; await put('fotos', f); }
        await record('Enviar foto', r.ok, r.ok ? `${r.accion}, ${Math.round(f.bytes / 1024)} KB, ${r.ms} ms` : r.error);
      }
      if (manual && !posts.length) note('send-note', 'No había nada por enviar.', 'ok');
    } finally {
      sending = false;
      renderPosts();
    }
  }
  const wire = (p) => ({ id_fila: p.id_fila, id_evento: p.id_evento, id_elemento: p.id_elemento, version: p.version, data: p.data });
  const countBy = (xs) => xs.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
  const fmtTally = (t) => Object.entries(t).map(([k, v]) => `${v} ${k}`).join(', ');
  function toBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  async function resendAll() {
    const posts = (await all('postes')).filter((p) => p.data);
    if (!posts.length) { note('send-note', 'Guarda algún poste primero.', 'warn'); return; }
    const r = await call(CFG.a, { op: 'filas', filas: posts.map(wire) });
    const tally = r.ok ? countBy(r.resultados.map((x) => x.action)) : null;
    const clean = r.ok && !tally.insertada && !tally.actualizada;
    await record('Reenviar todo', clean, r.ok ? fmtTally(tally) + (clean ? '' : ' (esperado: todo «igual»)') : r.error);
  }
  async function burst() {
    const posts = (await all('postes')).filter((p) => p.data);
    if (!posts.length) { note('send-note', 'Guarda algún poste primero.', 'warn'); return; }
    note('send-note', 'Enviando 20 lotes a la vez…', 'ok');
    const answers = await Promise.all(Array.from({ length: 20 }, () => call(CFG.a, { op: 'filas', filas: posts.map(wire) })));
    const failed = answers.filter((a) => !a.ok);
    const tally = countBy(answers.filter((a) => a.ok).flatMap((a) => a.resultados.map((x) => x.action)));
    const c = await call(CFG.a, { op: 'conteo' });
    const ok = !failed.length && c.ok && c.filas === c.claves_distintas;
    await record('Ráfaga de 20', ok, `${20 - failed.length}/20 respondieron (${fmtTally(tally)}); libro: ${c.filas} filas, ${c.claves_distintas} claves` +
      (failed.length ? '; fallas: ' + fmtTally(countBy(failed.map((a) => a.error))) : ''));
    note('send-note', ok ? 'Sin duplicados.' : 'Revisa el registro.', ok ? 'ok' : 'bad');
  }
  async function countRows() {
    const c = await call(CFG.a, { op: 'conteo' });
    await record('Contar filas', c.ok && c.filas === c.claves_distintas, c.ok ? `${c.filas} filas, ${c.claves_distintas} claves distintas` : c.error);
  }

  // ---------- evidence ----------
  async function exportEvidence() {
    const payload = { app: APP_VERSION, dispositivo: DEVICE, navegador: navigator.userAgent, exportado: stamp(),
      instalada: isInstalled(), registro: await all('registro'),
      postes: (await all('postes')).map((p) => ({ id_fila: p.id_fila, data: p.data, version: p.version, enviado: p.enviado })),
      fotos: (await all('fotos')).map((f) => ({ id_medio: f.id_medio, bytes: f.bytes, enviada: f.enviada })) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' }));
    a.download = 'compuerta-evidencia-' + stamp().slice(0, 16).replace(/[ :]/g, '-') + '.json';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function askPersistence(manual) {
    if (!navigator.storage || !navigator.storage.persist) { if (manual) record('Almacenamiento persistente', false, 'el navegador no lo ofrece'); return; }
    const already = await navigator.storage.persisted();
    if (already && !manual) return;
    const granted = await navigator.storage.persist();
    if (manual || granted) await record('Almacenamiento persistente', granted, granted ? 'concedido' : 'negado por el navegador');
    renderStatus();
  }
  function note(id, text, tone) { const n = $(id); n.textContent = text; n.dataset.tone = tone; n.hidden = false; }

  // ---------- install ----------
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('install').hidden = false; });
  $('install').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    await record('Instalar', choice.outcome === 'accepted', choice.outcome);
    deferredPrompt = null; $('install').hidden = true;
  });

  // ---------- wiring ----------
  $('ed-save').addEventListener('click', savePost);
  $('ed-photo').addEventListener('change', (e) => { takePhoto(e.target.files[0]); e.target.value = ''; });
  $('t-a').addEventListener('click', () => testGateway('a'));
  $('t-b').addEventListener('click', () => testGateway('b'));
  $('t-c').addEventListener('click', testSheetsApi);
  $('send').addEventListener('click', () => sendAll(true));
  $('resend').addEventListener('click', resendAll);
  $('burst').addEventListener('click', burst);
  $('count').addEventListener('click', countRows);
  $('export').addEventListener('click', exportEvidence);
  $('persist').addEventListener('click', () => askPersistence(true));
  // A configuration link opened over an already-open page only changes the hash: load it and restart.
  window.addEventListener('hashchange', () => { if (/^#c=/.test(location.hash)) { loadConfig(); location.reload(); } });
  window.addEventListener('online', () => { renderStatus(); record('Volvió la señal', true, ''); sendAll(false); });
  window.addEventListener('offline', () => { renderStatus(); record('Se fue la señal', true, ''); });

  (async () => {
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('sw.js'); } catch (e) { record('Service worker', false, e.message); }
      navigator.serviceWorker.addEventListener('controllerchange', renderStatus);
    }
    await seed();
    await renderPosts();
    await renderLog();
    await renderStatus();
    const opened = (await all('registro')).length;
    await record('Abrir', true, `${navigator.onLine ? 'con' : 'sin'} señal, ${isInstalled() ? 'instalada' : 'en el navegador'}${opened ? '' : ', primera vez'}`);
    initIdentity();
    if (navigator.onLine) sendAll(false);
  })();
})();
