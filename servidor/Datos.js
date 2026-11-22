// Acceso a la Google Sheet: cada hoja es una tabla. Todo se guarda como texto para que
// Sheets no convierta fechas ni PINs (ej.: un PIN 0123 quedaría 123).

// MEDICOS.telegram_chat_id quedó sin uso (los avisos son push + mail): no se borra para no mover columnas.
const ESQUEMA = {
  MEDICOS: ['id', 'nombre_apellido', 'pin', 'email', 'telegram_chat_id', 'activo', 'es_admin', 'contrato_revisado', 'vinculo', 'pin_propio', 'registro'],
  GUARDIA_FIJA: ['medico_id', 'dia_semana', 'turno', 'tipo', 'vigente'],
  VACACIONES: ['id', 'medico_id', 'desde', 'hasta', 'tipo', 'estado'],
  GUARDIAS: ['id', 'fecha', 'turno', 'horas', 'medico_que_hizo_id', 'medico_titular_id', 'tipo', 'categoria', 'estado',
    'confirmado_por_quien_hizo', 'confirmado_por_titular', 'mes_facturacion', 'fecha_cobro', 'creado_en', 'observacion',
    'deshacer', 'ultimo_aviso_conflicto', 'control_anticipada'],
  DEUDAS: ['id', 'guardia_id', 'deudor_id', 'acreedor_id', 'fecha_pago_sugerida', 'estado', 'confirmado_por_acreedor', 'deshacer_hasta'],
  FERIADOS: ['fecha', 'nombre', 'tipo', 'estado'],
  CONFIG: ['clave', 'valor', 'para_que_sirve'],
  AJUSTES: ['id', 'guardia_id', 'medico_id', 'fecha_guardia', 'mes_origen', 'mes_aviso', 'motivo', 'estado', 'creado_en'],
  CIERRES: ['mes', 'estado', 'cerrado_en', 'entregado_en', 'filas_excel', 'archivo_url', 'correcciones', 'regeneracion_pendiente'],
  PUSH: ['id', 'medico_id', 'token', 'plataforma', 'creado_en', 'ultimo_ok', 'estado'],
  LOG: ['fecha_hora', 'usuario', 'accion', 'detalle', 'tabla', 'registro', 'valor_anterior', 'valor_nuevo']
};

// Columnas técnicas que no aportan a la auditoría.
const SIN_AUDITORIA = ['deshacer', 'deshacer_hasta', 'ultimo_aviso_conflicto', 'registro'];

let _cacheTablas = {};
let _cacheLibro = null;
let _mesesSucios = {};
let _actor = 'sistema';

function reiniciarEstado_() {
  _cacheTablas = {};
  _cacheLibro = null;
  _mesesSucios = {};
  _actor = 'sistema';
}

// Quién figura en el LOG como autor de los cambios de esta ejecución.
function fijarActor_(nombre) { _actor = nombre; }

function libro_() {
  if (!_cacheLibro) {
    const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    _cacheLibro = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  }
  return _cacheLibro;
}

function hoja_(nombre) {
  const h = libro_().getSheetByName(nombre);
  if (!h) throw new Error('Falta la hoja ' + nombre + '. Ejecutá "Instalar" desde el menú Guardias UPA.');
  return h;
}

function textoCelda_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v).trim();
}

// Devuelve las filas como objetos. _f es el número de fila en la hoja.
function filas_(nombre) {
  if (_cacheTablas[nombre]) return _cacheTablas[nombre];
  const valores = hoja_(nombre).getDataRange().getValues();
  const cab = (valores[0] || []).map(textoCelda_);
  const salida = [];
  for (let i = 1; i < valores.length; i++) {
    const obj = { _f: i + 1 };
    let vacia = true;
    cab.forEach(function (col, j) {
      obj[col] = textoCelda_(valores[i][j]);
      if (obj[col] !== '') vacia = false;
    });
    if (!vacia) {
      fijarOriginal_(obj);
      salida.push(obj);
    }
  }
  _cacheTablas[nombre] = salida;
  return salida;
}

function buscarPorId_(nombre, id) {
  return filas_(nombre).find(function (x) { return x.id === String(id); }) || null;
}

function siguienteId_(nombre) {
  return String(filas_(nombre).reduce(function (m, x) { return Math.max(m, Number(x.id) || 0); }, 0) + 1);
}

function aFilaHoja_(nombre, obj) {
  const hoja = hoja_(nombre);
  const cab = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(textoCelda_);
  return cab.map(function (c) {
    const v = obj[c];
    if (v === true) return 'TRUE';
    if (v === false) return 'FALSE';
    return v === undefined || v === null ? '' : String(v);
  });
}

// Copia de los valores tal como están en la hoja, para saber qué cambió al guardar.
function fijarOriginal_(obj) {
  const copia = {};
  Object.keys(obj).forEach(function (k) { if (k !== '_f') copia[k] = obj[k]; });
  Object.defineProperty(obj, '_orig', { value: copia, writable: true, enumerable: false, configurable: true });
}

function textoFila_(v) {
  if (v === true) return 'TRUE';
  if (v === false) return 'FALSE';
  return v === undefined || v === null ? '' : String(v);
}

function escribirFilaNueva_(nombre, obj) {
  const hoja = hoja_(nombre);
  const fila = aFilaHoja_(nombre, obj);
  const n = hoja.getLastRow() + 1;
  if (n > hoja.getMaxRows()) hoja.insertRowsAfter(hoja.getMaxRows(), 50);
  hoja.getRange(n, 1, 1, fila.length).setNumberFormat('@').setValues([fila]);
  return n;
}

function claveDeRegistro_(obj) {
  return obj.id || obj.mes || obj.clave || obj.fecha || obj.medico_id || '';
}

function auditar_(nombre, accion, obj, antes, despues) {
  const limpiar = function (d) {
    const r = {};
    Object.keys(d).forEach(function (k) {
      if (SIN_AUDITORIA.indexOf(k) >= 0) return;
      r[k] = k === 'pin' ? '***' : d[k];
    });
    return r;
  };
  const a = limpiar(antes);
  const b = limpiar(despues);
  if (!Object.keys(a).length && !Object.keys(b).length) return;
  escribirFilaNueva_('LOG', {
    fecha_hora: marcaTiempo_(), usuario: _actor, accion: accion, detalle: '', tabla: nombre, registro: claveDeRegistro_(obj),
    valor_anterior: JSON.stringify(a), valor_nuevo: JSON.stringify(b)
  });
  delete _cacheTablas.LOG;
}

function insertar_(nombre, obj) {
  // La lista se lee antes de escribir: si no, la fila nueva quedaría dos veces.
  const lista = filas_(nombre);
  const n = escribirFilaNueva_(nombre, obj);
  const copia = Object.assign({}, obj, { _f: n });
  Object.keys(copia).forEach(function (k) { if (k !== '_f') copia[k] = textoFila_(copia[k]); });
  fijarOriginal_(copia);
  lista.push(copia);
  const nuevo = Object.assign({}, copia);
  delete nuevo._f;
  auditar_(nombre, 'alta', copia, {}, nuevo);
  return copia;
}

// Solo escribe si algo cambió, y deja en LOG el valor anterior y el nuevo.
function guardar_(nombre, obj) {
  Object.keys(obj).forEach(function (k) { if (k !== '_f') obj[k] = textoFila_(obj[k]); });
  const original = obj._orig || {};
  const antes = {};
  const despues = {};
  Object.keys(obj).forEach(function (k) {
    if (k === '_f') return;
    const previo = original[k] === undefined ? '' : original[k];
    if (previo !== obj[k]) {
      antes[k] = previo;
      despues[k] = obj[k];
    }
  });
  if (!Object.keys(despues).length) return obj;
  const fila = aFilaHoja_(nombre, obj);
  hoja_(nombre).getRange(obj._f, 1, 1, fila.length).setNumberFormat('@').setValues([fila]);
  fijarOriginal_(obj);
  auditar_(nombre, 'cambio', obj, antes, despues);
  return obj;
}

function cfg_(clave, porDefecto) {
  const f = filas_('CONFIG').find(function (x) { return x.clave === clave; });
  return f && f.valor !== '' ? f.valor : (porDefecto === undefined ? '' : porDefecto);
}

function setCfg_(clave, valor) {
  const f = filas_('CONFIG').find(function (x) { return x.clave === clave; });
  if (f) { f.valor = valor; guardar_('CONFIG', f); } else insertar_('CONFIG', { clave: clave, valor: valor, para_que_sirve: '' });
}

function registrar_(usuario, accion, detalle) {
  escribirFilaNueva_('LOG', { fecha_hora: marcaTiempo_(), usuario: usuario || 'sistema', accion: accion, detalle: detalle || '' });
  delete _cacheTablas.LOG;
}

function fijasVigentes_() {
  return filas_('GUARDIA_FIJA').filter(function (f) { return f.vigente !== 'FALSE'; });
}

function propiedad_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function setPropiedad_(k, v) { PropertiesService.getScriptProperties().setProperty(k, String(v)); }

function medicos_(incluirInactivos) {
  return filas_('MEDICOS').filter(function (m) { return incluirInactivos || esSi_(m.activo); });
}
function nombreDe_(id) {
  const m = buscarPorId_('MEDICOS', id);
  return m ? m.nombre_apellido : '';
}

// Ejecuta una función con exclusión mutua para que dos médicos no escriban a la vez.
function conLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const r = fn();
    SpreadsheetApp.flush();
    try { refrescarMesesSucios_(); } catch (e) { console.error(e); }
    return r;
  } finally {
    lock.releaseLock();
  }
}
