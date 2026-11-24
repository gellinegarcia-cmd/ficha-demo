// Avisos push con Firebase Cloud Messaging (FCM), enviados desde Apps Script. Costo cero.
// La app (GitHub Pages) registra el celular y guarda su token en la hoja PUSH; acá se manda el aviso.
// El aviso lleva solo datos: el service worker de la app arma la notificación con sus botones.
// Un botón que no necesita elegir nada ([La hice], [Sí], [No]) confirma sin abrir la app: el service
// worker manda la "firma" del botón al servidor (accionAviso_). Los demás abren la pantalla de confirmar.
//
// Configuración (Script Properties): FCM_SA = el JSON de la cuenta de servicio de Firebase
// (menú Fichá → "2. Configurar avisos push").

const FCM_TTL_SEG = 86400;
const HORAS_FIRMA_ACCION = 72;
// Acciones que se pueden ejecutar desde la notificación, sin abrir la app.
const ACCIONES_PUSH = { H: 1, S: 1, N: 1, CS: 1, Y: 1 };

function cuentaFcm_() {
  const t = propiedad_('FCM_SA');
  if (!t) return null;
  try {
    const j = JSON.parse(t);
    return j.client_email && j.private_key && j.project_id ? j : null;
  } catch (e) { return null; }
}
function pushConfigurado_() { return !!cuentaFcm_(); }

function base64Url_(texto) {
  return Utilities.base64EncodeWebSafe(Utilities.newBlob(texto).getBytes()).replace(/=+$/, '');
}

// Token de acceso de la cuenta de servicio (JWT firmado con RS256), guardado 50 minutos.
function tokenAccesoFcm_() {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get('fcm_token');
  if (guardado) return guardado;
  const sa = cuentaFcm_();
  const ahora = Math.floor(ahora_().getTime() / 1000);
  const cabecera = base64Url_(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const cuerpo = base64Url_(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600
  }));
  const firma = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(cabecera + '.' + cuerpo, sa.private_key)).replace(/=+$/, '');
  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: cabecera + '.' + cuerpo + '.' + firma }
  });
  if (r.getResponseCode() !== 200) throw new Error('Firebase no aceptó la cuenta de servicio (' + r.getResponseCode() + ')');
  const token = JSON.parse(r.getContentText()).access_token;
  cache.put('fcm_token', token, 3000);
  return token;
}

// --- Suscripciones (un médico puede tener varios celulares) ---

function pushesDe_(medicoId) {
  return filas_('PUSH').filter(function (p) { return p.medico_id === String(medicoId) && p.estado === 'activa'; });
}
function pushActivo_(m) { return pushConfigurado_() && pushesDe_(m.id).length > 0; }

function guardarPush_(m, token, plataforma) {
  token = String(token || '').trim();
  if (token.length < 20 || token.length > 4096) throw new ErrorUsuario('No se pudo activar los avisos en este celular. Probá de nuevo.');
  const plat = ['android', 'ios', 'otro'].indexOf(plataforma) >= 0 ? plataforma : 'otro';
  // El mismo celular pudo estar a nombre de otro médico (se pasaron el teléfono): queda solo para este.
  filas_('PUSH').filter(function (p) { return p.token === token && p.estado === 'activa'; }).forEach(function (p) {
    p.estado = p.medico_id === m.id ? 'reemplazada' : 'otro_medico';
    guardar_('PUSH', p);
  });
  insertar_('PUSH', { id: siguienteId_('PUSH'), medico_id: m.id, token: token, plataforma: plat, creado_en: marcaTiempo_(), ultimo_ok: '', estado: 'activa' });
  registrar_(m.nombre_apellido, 'push_activado', plat);
}

function quitarPush_(m) {
  pushesDe_(m.id).forEach(function (p) { p.estado = 'desactivada'; guardar_('PUSH', p); });
  registrar_(m.nombre_apellido, 'push_desactivado', '');
}

function pushPrueba_(m) {
  if (!pushActivo_(m)) throw new ErrorUsuario('Primero activá los avisos en este celular.');
  const ok = enviarPushA_(m, 'Fichá', 'Aviso de prueba: si lo ves, los avisos funcionan. ✅', null);
  if (!ok) throw new ErrorUsuario('El aviso de prueba no salió. Probá activar los avisos de nuevo.');
  registrar_(m.nombre_apellido, 'push_prueba', '');
  return { ok: true };
}

// --- Botones: firma que permite ejecutar la acción sin sesión, solo para ese médico y esa guardia ---

function firmarAccion_(medicoId, data) {
  const exp = ahora_().getTime() + HORAS_FIRMA_ACCION * 3600000;
  const base = medicoId + '|' + data + '|' + exp;
  const mac = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature('push|' + base, propiedad_('SECRETO'))).replace(/=+$/, '');
  return base64Url_(base) + '.' + mac;
}

function leerFirmaAccion_(firma) {
  const p = String(firma || '').split('.');
  if (p.length !== 2) return null;
  let base;
  try { base = Utilities.newBlob(Utilities.base64DecodeWebSafe(p[0] + '==='.slice((p[0].length + 3) % 4))).getDataAsString(); } catch (e) { return null; }
  const mac = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature('push|' + base, propiedad_('SECRETO'))).replace(/=+$/, '');
  if (mac !== p[1]) return null;
  const partes = base.split('|');
  if (partes.length !== 3 || Number(partes[2]) < ahora_().getTime()) return null;
  return { medicoId: partes[0], data: partes[1] };
}

// Lo que se toca en la notificación. Devuelve el texto de la notificación que la reemplaza.
function accionAviso_(firma) {
  reiniciarEstado_();
  const a = leerFirmaAccion_(firma);
  if (!a) return { ok: false, error: 'Ese botón venció. Abrí la app para confirmar.' };
  const m = buscarPorId_('MEDICOS', a.medicoId);
  if (!m || !esSi_(m.activo) || !registroCompleto_(m)) return { ok: false, error: 'Abrí la app para confirmar.' };
  const p = a.data.split(':');
  if (!ACCIONES_PUSH[p[0]]) return { ok: false, error: 'Abrí la app para confirmar.' };
  fijarActor_(m.nombre_apellido);
  try {
    const texto = conLock_(function () { return ejecutarAccionPush_(m, p[0], p[1]); });
    registrar_(m.nombre_apellido, 'accion_push', a.data);
    return { ok: true, texto: texto };
  } catch (e) {
    if (!(e instanceof ErrorUsuario)) console.error(e);
    return { ok: false, error: e instanceof ErrorUsuario ? e.message : 'Hubo un error. Abrí la app para confirmar.' };
  }
}

function ejecutarAccionPush_(m, accion, id) {
  if (accion === 'H') {
    const g = hagoYo_(m, id);
    return (g.estado === ESTADO.ANTICIPADA ? 'Confirmada por adelantado: ' : 'Confirmada: ') + textoGuardia_(g) + '. ✅ Podés deshacerlo en la app durante 10 minutos.';
  }
  if (accion === 'CS') {
    const g = responderControl_(m, id, CONTROL.SI);
    return 'Anotado: hiciste la guardia del ' + fechaCorta_(g.fecha) + '. ✅';
  }
  if (accion === 'S' || accion === 'N') {
    const g = responderCobertura_(m, id, accion === 'S');
    if (accion === 'N') return 'Anotado. Le avisé a la otra persona para que lo resuelvan entre ustedes.';
    return estaConfirmada_(g) ? 'Confirmada: ' + textoGuardia_(g) + '. ✅' : 'Anotado. Falta que confirme la otra persona.';
  }
  if (accion === 'Y') {
    recibiPago_(m, id);
    return 'Anotado: pago recibido. ✅ Podés deshacerlo en la app durante 10 minutos.';
  }
  throw new ErrorUsuario('Abrí la app para confirmar.');
}

// --- Envío ---

// Devuelve true si llegó a por lo menos un celular. Los celulares que FCM da por perdidos se desactivan.
function enviarPushA_(m, titulo, texto, botones) {
  const destinos = pushesDe_(m.id);
  if (!destinos.length || !pushConfigurado_()) return false;
  const acciones = [];
  // Tocar la notificación abre la pantalla del primer botón (la guardia a confirmar), o Mi mes.
  const conVista = [].concat.apply([], botones || []).filter(function (b) { return b.vista; })[0];
  const url = (conVista ? urlDeVista_(conVista.vista, conVista.g) : urlDeVista_('mes')) || urlApp_() || '';
  (botones || []).forEach(function (fila) {
    fila.forEach(function (b) {
      if (acciones.length >= 2) return; // Android muestra hasta 2 botones
      const codigo = String(b.data || '').split(':')[0];
      acciones.push(ACCIONES_PUSH[codigo]
        ? { accion: 'a' + acciones.length, titulo: b.textoPush || b.texto, firma: firmarAccion_(m.id, b.data) }
        : { accion: 'a' + acciones.length, titulo: b.textoPush || b.texto, url: urlDeVista_(b.vista, b.g) || url });
    });
  });
  const sa = cuentaFcm_();
  const token = tokenAccesoFcm_();
  let algun = false;
  destinos.forEach(function (p) {
    const mensaje = { message: {
      token: p.token,
      data: { titulo: String(titulo), cuerpo: String(texto), url: url, acciones: JSON.stringify(acciones), etiqueta: 'g' + Date.now() },
      webpush: { headers: { Urgency: 'high', TTL: String(FCM_TTL_SEG) } }
    } };
    const r = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + sa.project_id + '/messages:send', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify(mensaje)
    });
    const codigo = r.getResponseCode();
    if (codigo === 200) {
      algun = true;
      p.ultimo_ok = marcaTiempo_();
      guardar_('PUSH', p);
    } else if (codigo === 404 || (codigo === 400 && /UNREGISTERED|INVALID_ARGUMENT|registration-token/i.test(r.getContentText()))) {
      p.estado = 'vencida';
      guardar_('PUSH', p);
      registrar_('sistema', 'push_vencido', m.nombre_apellido);
    } else {
      registrar_('sistema', 'error_push', m.nombre_apellido + ': ' + codigo);
    }
  });
  return algun;
}

// Cómo le llegan los avisos: lo ve el jefe en Médicos.
function canalAvisos_(m) {
  if (pushActivo_(m)) return 'Push';
  if (m.email) return 'Solo mail';
  return 'Ninguno';
}

// Menú: pegar el JSON de la cuenta de servicio de Firebase.
function configurarPush() {
  const quien = soloDueno_();
  reiniciarEstado_();
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Configurar avisos push', 'Pegá acá TODO el contenido del archivo .json de la cuenta de servicio de Firebase:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  let j;
  try { j = JSON.parse(r.getResponseText()); } catch (e) { ui.alert('Eso no es el archivo .json completo. Probá de nuevo.'); return; }
  if (!j.client_email || !j.private_key || !j.project_id) { ui.alert('Falta información en ese archivo. Bajalo de nuevo desde Firebase.'); return; }
  setPropiedad_('FCM_SA', JSON.stringify({ project_id: j.project_id, client_email: j.client_email, private_key: j.private_key }));
  CacheService.getScriptCache().put('fcm_token', '', 1);
  try {
    tokenAccesoFcm_();
    registrar_(quien, 'configurar_push', j.project_id);
    ui.alert('Listo. Los avisos push quedaron conectados con Firebase (' + j.project_id + ').');
  } catch (e) {
    ui.alert('Firebase no aceptó esa cuenta de servicio: ' + e.message);
  }
}
