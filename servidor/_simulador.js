// Simulador de Google Apps Script para el NAVEGADOR (versión demo en GitHub Pages).
// Es el mismo simulador de test/harness.js, sin Node: no hay planilla, ni mails, ni Telegram de verdad.
// Se carga en servidor.html (un iframe aparte) antes de los archivos de src/.
(function (w) {
  'use strict';

  // ---------- SHA-256 y HMAC sincrónicos (Apps Script es sincrónico; Web Crypto no) ----------
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256(bytes) {
    const l = bytes.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n);
    m.set(bytes); m[l] = 0x80;
    const bits = l * 8; m[n - 4] = bits >>> 24; m[n - 3] = bits >>> 16; m[n - 2] = bits >>> 8; m[n - 1] = bits;
    m[n - 8] = Math.floor(bits / 0x100000000);
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], W = new Array(64);
    const r = (x, k) => (x >>> k) | (x << (32 - k));
    for (let i = 0; i < n; i += 64) {
      for (let t = 0; t < 16; t++) W[t] = (m[i + 4 * t] << 24) | (m[i + 4 * t + 1] << 16) | (m[i + 4 * t + 2] << 8) | m[i + 4 * t + 3];
      for (let t = 16; t < 64; t++) {
        const s0 = r(W[t - 15], 7) ^ r(W[t - 15], 18) ^ (W[t - 15] >>> 3), s1 = r(W[t - 2], 17) ^ r(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + W[t]) | 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    const out = [];
    H.forEach((x) => out.push((x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255));
    return out;
  }
  const utf8 = (s) => Array.from(new TextEncoder().encode(String(s)));
  function hmac(valor, clave) {
    let k = utf8(clave);
    if (k.length > 64) k = sha256(k);
    while (k.length < 64) k.push(0);
    const ip = k.map((x) => x ^ 0x36), op = k.map((x) => x ^ 0x5c);
    return sha256(op.concat(sha256(ip.concat(utf8(valor)))));
  }
  const sinSigno = (b) => Array.from(b, (x) => (x < 0 ? x + 256 : x));
  function base64(b) {
    const u = sinSigno(b); let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.slice(i, i + 0x8000));
    return btoa(s);
  }

  // ---------- Hojas (igual que test/harness.js) ----------
  class Rango {
    constructor(hoja, f, c, nf, nc) { Object.assign(this, { hoja, f, c, nf, nc }); }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nf; i++) {
        const fila = this.hoja.datos[this.f - 1 + i] || [];
        const r = [];
        for (let j = 0; j < this.nc; j++) { const v = fila[this.c - 1 + j]; r.push(v === undefined ? '' : v); }
        out.push(r);
      }
      return out;
    }
    setValue(v) { return this.setValues([[v]]); }
    setValues(v) {
      if (this.f + v.length - 1 > this.hoja.filasMax) throw new Error('Rango fuera de la hoja');
      v.forEach((fila, i) => {
        while (this.hoja.datos.length < this.f + i) this.hoja.datos.push([]);
        fila.forEach((x, j) => { this.hoja.datos[this.f - 1 + i][this.c - 1 + j] = x; });
      });
      return this;
    }
  }
  const rangoProxy = (r) => new Proxy(r, {
    get(t, k) {
      if (k in t) { const v = t[k]; return typeof v === 'function' ? (...a) => { const s = v.apply(t, a); return s === t ? rangoProxy(t) : s; } : v; }
      if (typeof k === 'string' && k.startsWith('set')) return () => rangoProxy(t);
      return undefined;
    }
  });
  class Hoja {
    constructor(n) { this.nombre = n; this.datos = []; this.filasMax = 1000; }
    getName() { return this.nombre; }
    getRange(f, c, nf = 1, nc = 1) { return rangoProxy(new Rango(this, f, c, nf, nc)); }
    getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
    getLastRow() { for (let i = this.datos.length; i > 0; i--) if ((this.datos[i - 1] || []).some((v) => v !== '' && v !== undefined)) return i; return 0; }
    getLastColumn() { return this.datos.reduce((m, f) => Math.max(m, f.length), 0); }
    getMaxRows() { return this.filasMax; }
    insertRowsAfter(_, n) { this.filasMax += n; }
    deleteRow(f) { this.datos.splice(f - 1, 1); }
    setFrozenRows() {}
    setColumnWidth() {}
    setRowHeight() {}
    clear() { this.datos = []; }
  }

  // ---------- Servicios de Google simulados ----------
  const hojas = new Map(), props = new Map(), cache = new Map();
  const mails = [], push = [], triggers = [], drive = { archivos: [], carpetas: [] };
  let uuid = 0; // determinístico: la demo se reconstruye repitiendo lo que se hizo
  const libro = {
    getId: () => 'LIBRO_DEMO', getSheetByName: (n) => hojas.get(n) || null,
    insertSheet: (n) => { const h = new Hoja(n); hojas.set(n, h); return h; },
    deleteSheet: (h) => hojas.delete(h.nombre), getSheets: () => [...hojas.values()]
  };
  function simularDrive(url, op = {}) {
    const responder = (codigo, cuerpo) => ({ getResponseCode: () => codigo, getContentText: () => (cuerpo ? JSON.stringify(cuerpo) : '') });
    if (op.method === 'delete') return responder(204);
    if (url.includes('/upload/')) {
      const id = 'archivo' + (drive.archivos.length + 1);
      drive.archivos.push({ id });
      return responder(200, { id, webViewLink: '#drive-simulado' });
    }
    if (op.method === 'post') {
      const id = 'carpeta' + (drive.carpetas.length + 1);
      drive.carpetas.push({ id, ...JSON.parse(op.payload) });
      return responder(200, { id });
    }
    const carpeta = drive.carpetas.find((c) => url.includes(c.id));
    return carpeta ? responder(200, { id: carpeta.id, trashed: false }) : responder(404, { error: 'no existe' });
  }
  Object.assign(w, {
    SpreadsheetApp: {
      openById: () => libro, getActiveSpreadsheet: () => libro, flush() {},
      BorderStyle: { SOLID: 'S', SOLID_MEDIUM: 'M' },
      getUi: () => ({ alert: () => 'YES', Button: { YES: 'YES' }, ButtonSet: {}, createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }), prompt: () => ({ getSelectedButton: () => 'OK', getResponseText: () => '' }) })
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => { props.set(k, String(v)); },
      deleteProperty: (k) => props.delete(k)
    }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => { cache.set(k, v); }, remove: (k) => { cache.delete(k); } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    Session: { getActiveUser: () => ({ getEmail: () => 'demo@demo' }) },
    Logger: { log() {} },
    Utilities: {
      formatDate(d, tz, f) {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
        return f.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
      },
      getUuid: () => { uuid++; return '00000000-0000-4000-8000-' + String(uuid).padStart(12, '0'); },
      sleep() {},
      newBlob: (datos, mime, nombre) => {
        const bytes = typeof datos === 'string' ? utf8(datos) : datos;
        return { mime, nombre, getBytes() { return bytes; }, getName: () => nombre,
          getDataAsString: () => new TextDecoder().decode(new Uint8Array(sinSigno(bytes))) };
      },
      base64DecodeWebSafe: (t) => {
        const b = atob(String(t).replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '') + '==='.slice((String(t).replace(/=+$/, '').length + 3) % 4));
        return Array.from(b, (c) => c.charCodeAt(0));
      },
      computeRsaSha256Signature: (v) => sha256(utf8('demo|' + v)), // en la demo no hay Firebase de verdad
      base64Encode: (b) => base64(b),
      base64EncodeWebSafe: (b) => base64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '=',
      computeHmacSha256Signature: (v, k) => hmac(v, k),
      computeDigest: (_, v) => sha256(utf8(v)),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }
    },
    MailApp: { sendEmail: (o) => { mails.push(o); }, getRemainingDailyQuota: () => 100 },
    UrlFetchApp: { fetch(url, op) {
      const responder = (codigo, cuerpo) => ({ getResponseCode: () => codigo, getContentText: () => JSON.stringify(cuerpo) });
      if (url === 'https://oauth2.googleapis.com/token') return responder(200, { access_token: 'DEMO', expires_in: 3600 });
      if (url.indexOf('https://fcm.googleapis.com/') === 0) {
        const m = JSON.parse(op.payload).message;
        push.push({ token: m.token, data: m.data });
        return responder(200, { name: 'demo/' + push.length });
      }
      if (url.includes('googleapis.com')) return simularDrive(url, op);
      throw new Error('La demo no se conecta a ' + url);
    } },
    ContentService: { createTextOutput: (t) => ({ contenido: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    HtmlService: {
      createHtmlOutput: (t) => ({ contenido: t }),
      createTemplateFromFile: (n) => ({ evaluate: () => { const o = { archivo: n, addMetaTag() { return o; }, setTitle() { return o; }, setXFrameOptionsMode() { return o; } }; return o; } }),
      XFrameOptionsMode: { DEFAULT: 'DEFAULT' }
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.map((t) => ({ getHandlerFunction: () => t.fn, _t: t })),
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t._t), 1),
      newTrigger: (fn) => { const b = { timeBased: () => b, everyMinutes: (n) => { b.n = n; return b; }, create: () => { triggers.push({ fn, n: b.n }); } }; return b; },
      getOAuthToken: () => 'TOKEN',
      getService: () => ({ getUrl: () => w.parent.location.href.split('?')[0].split('#')[0] })
    },
    __simulador: { hojas, props, mails, push }
  });
})(window);
