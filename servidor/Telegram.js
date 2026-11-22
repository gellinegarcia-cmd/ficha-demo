// Bot de Telegram. Dos modos: webhook (respuesta inmediata) y sondeo cada minuto (de respaldo,
// porque Apps Script a veces responde con redirección y Telegram lo toma como error).
// Si el webhook falla, la app pasa sola al sondeo.

function tokenTelegram_() { return propiedad_('TELEGRAM_TOKEN'); }

function llamarTelegram_(metodo, cuerpo) {
  const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + tokenTelegram_() + '/' + metodo, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(cuerpo || {}), muteHttpExceptions: true
  });
  const j = JSON.parse(r.getContentText());
  if (!j.ok) throw new Error('Telegram ' + metodo + ': ' + j.description);
  return j.result;
}

function tecladoTelegram_(botones) {
  const filas = [];
  (botones || []).forEach(function (fila) {
    const celdas = [];
    fila.forEach(function (b) {
      if (b.data) celdas.push({ text: b.texto, callback_data: b.data });
      else {
        const url = b.url || urlDeVista_(b.vista, b.g);
        if (url) celdas.push({ text: b.texto, url: url });
      }
    });
    if (celdas.length) filas.push(celdas);
  });
  return filas.length ? { inline_keyboard: filas } : undefined;
}

function enviarTelegram_(chatId, texto, botones) {
  const cuerpo = { chat_id: chatId, text: texto };
  const teclado = tecladoTelegram_(botones);
  if (teclado) cuerpo.reply_markup = teclado;
  return llamarTelegram_('sendMessage', cuerpo);
}

// Enlace para vincular: t.me/<bot>?start=<id>-<firma>
function codigoVinculo_(medicoId) {
  const firma = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature('tg|' + medicoId, propiedad_('SECRETO')));
  return medicoId + '-' + firma.replace(/=+$/, '').slice(0, 16);
}

function enlaceVinculo_(medicoId) {
  const bot = propiedad_('TELEGRAM_BOT');
  return bot ? 'https://t.me/' + bot + '?start=' + codigoVinculo_(medicoId) : '';
}

function doPost(e) {
  try {
    const secreto = propiedad_('TELEGRAM_SECRETO');
    if (secreto && e && e.parameter && e.parameter.tg === secreto && e.postData) {
      reiniciarEstado_();
      procesarUpdate_(JSON.parse(e.postData.contents));
    }
  } catch (err) {
    console.error(err);
  }
  // HtmlService responde 200 sin redirección; siempre se contesta OK para que Telegram no reintente.
  return HtmlService.createHtmlOutput('OK');
}

// Telegram puede repetir un mensaje: cada update se procesa una sola vez.
function procesarUpdate_(u) {
  const cache = CacheService.getScriptCache();
  const clave = 'upd_' + u.update_id;
  if (cache.get(clave)) return;
  cache.put(clave, '1', 21600);
  if (u.callback_query) procesarBoton_(u.callback_query);
  else if (u.message && u.message.text) procesarTexto_(u.message);
}

function medicoPorChat_(chatId) {
  return medicos_().find(function (m) { return m.telegram_chat_id && m.telegram_chat_id === String(chatId); }) || null;
}

function procesarTexto_(msg) {
  const chat = String(msg.chat.id);
  const inicio = msg.text.match(/^\/start\s+(\S+)/);
  if (inicio) return vincularChat_(chat, inicio[1]);
  const m = medicoPorChat_(chat);
  if (!m) return enviarTelegram_(chat, 'Este chat no está vinculado. Entrá a la app, abrí "Mi perfil" y tocá "Vincular Telegram".');
  enviarTelegram_(chat, 'Te aviso cuando tengas algo para confirmar. Para ver tu mes o cargar un reemplazo:\n\n' + REGLA_ORO,
    [[botonVista_('Abrir la app', 'mes')], [botonVista_('+ Cargar guardia', 'cargar')]]);
}

function vincularChat_(chat, codigo) {
  const id = codigo.split('-')[0];
  const m = buscarPorId_('MEDICOS', id);
  if (!m || codigoVinculo_(id) !== codigo) return enviarTelegram_(chat, 'Ese enlace no es válido. Pedí uno nuevo desde la app.');
  conLock_(function () {
    filas_('MEDICOS').filter(function (o) { return o.telegram_chat_id === chat && o.id !== m.id; }).forEach(function (o) {
      o.telegram_chat_id = '';
      guardar_('MEDICOS', o);
    });
    m.telegram_chat_id = chat;
    guardar_('MEDICOS', m);
    registrar_(m.nombre_apellido, 'vinculo_telegram', '');
  });
  enviarTelegram_(chat, 'Listo, ' + m.nombre_apellido + '. Desde ahora te aviso por acá.\n\n' + REGLA_ORO);
  // La guardia fija se carga en el registro. Solo se pregunta acá si ya se registró con contrato y le falta.
  const tiene = fijasVigentes_().some(function (f) { return f.medico_id === m.id; });
  if (!tiene && registroCompleto_(m) && !esSoloReemplazo_(m)) enviarTelegram_(chat, '¿Cuál es tu guardia de contrato?', tecladoContratoInicial_());
}

const DIAS_CORTOS = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 0: 'Dom' };

function tecladoContratoInicial_() {
  return [[{ texto: '24 h un día', data: 'K:24' }, { texto: '12 h + 12 h', data: 'K:12' }]];
}

function tecladoDias24_() {
  return [1, 2, 3, 4, 5, 6, 0].map(function (d) { return [{ texto: DIAS[d], data: 'K24:' + d }]; });
}

// Catorce botones: día + turno. El prefijo guarda lo elegido antes, porque el bot no tiene memoria.
function tecladoDias12_(prefijo) {
  return [1, 2, 3, 4, 5, 6, 0].map(function (d) {
    return ['D', 'N'].map(function (t) {
      return { texto: DIAS_CORTOS[d] + (t === 'D' ? ' día' : ' noche'), data: prefijo + d + t };
    });
  });
}

function filaContrato12_(codigo) {
  return { dia_semana: DIAS[Number(codigo[0])], turno: codigo[1] === 'D' ? '12H_DIA' : '12H_NOCHE' };
}

function procesarBoton_(q) {
  const chat = String(q.message.chat.id);
  const m = medicoPorChat_(chat);
  const cerrarSpinner = function (texto) {
    try { llamarTelegram_('answerCallbackQuery', { callback_query_id: q.id, text: texto || '' }); } catch (e) { console.error(e); }
  };
  if (!m) { cerrarSpinner('Este chat no está vinculado.'); return; }
  fijarActor_(m.nombre_apellido);
  let r;
  try {
    r = conLock_(function () { return ejecutarBoton_(m, q.data); });
  } catch (e) {
    if (!(e instanceof ErrorUsuario)) console.error(e);
    r = { texto: e instanceof ErrorUsuario ? e.message : 'Hubo un error. Probá de nuevo desde la app.' };
  }
  cerrarSpinner();
  // Se reemplaza el mensaje original para que no queden botones viejos para tocar.
  const cuerpo = { chat_id: chat, message_id: q.message.message_id, text: r.texto };
  const teclado = tecladoTelegram_(r.botones);
  if (teclado) cuerpo.reply_markup = teclado;
  try { llamarTelegram_('editMessageText', cuerpo); } catch (e) { enviarTelegram_(chat, r.texto, r.botones); }
}

function ejecutarBoton_(m, data) {
  const p = String(data).split(':');
  const accion = p[0];
  if (accion === 'H') {
    const g = hagoYo_(m, p[1]);
    return conDeshacer_((g.estado === ESTADO.ANTICIPADA ? 'Confirmada por adelantado: ' : 'Confirmada: ') + textoGuardia_(g) + '. ✅', g.id);
  }
  if (accion === 'CS') {
    const g = responderControl_(m, p[1], CONTROL.SI);
    return conDeshacer_('Anotado: hiciste la guardia del ' + fechaCorta_(g.fecha) + '. ✅', g.id);
  }
  if (accion === 'CN') {
    const g = responderControl_(m, p[1], CONTROL.NO_SE_HIZO);
    return conDeshacer_('Anotado: no se hizo. Queda el ajuste para el mes siguiente.', g.id);
  }
  if (accion === 'CC') {
    const g = guardiaDe_(p[1]);
    const botones = medicos_().filter(function (o) { return o.id !== m.id; }).map(function (o) { return [{ texto: o.nombre_apellido, data: 'A:' + g.id + ':' + o.id }]; });
    return { texto: '¿Quién te cubrió el ' + fechaCorta_(g.fecha) + '?', botones: botones };
  }
  if (accion === 'A') {
    const g = responderControl_(m, p[1], CONTROL.CUBIERTA, { cubridor: p[2] });
    return conDeshacer_('Listo. Le pedí a ' + nombreDe_(p[2]) + ' que confirme: la cobertura entra en el mes siguiente.', g.id);
  }
  if (accion === 'U') {
    const g = deshacer_(m, p[1]);
    return { texto: 'Deshecho: guardia del ' + fechaCorta_(g.fecha) + '.', botones: g.estado === ESTADO.PREVISTA && g.medico_titular_id === m.id ? botonesConfirmar_(g) : null };
  }
  if (accion === 'UP') {
    deshacerPago_(m, p[1]);
    return { texto: 'Deshecho: el pago volvió a pendiente.' };
  }
  if (accion === 'C' || accion === 'R') {
    const g = guardiaDe_(p[1]);
    exigirEditable_(g);
    const companeros = medicos_().filter(function (o) { return o.id !== m.id; });
    const botones = companeros.map(function (o) { return [{ texto: o.nombre_apellido, data: (accion === 'C' ? 'P:' : 'Q:') + g.id + ':' + o.id }]; });
    if (accion === 'R') botones.push([{ texto: 'Todavía no sé quién', data: 'Q:' + g.id + ':0' }]);
    botones.push([{ texto: 'Volver', data: 'V:' + g.id }]);
    return { texto: '¿Quién te cubre el ' + textoGuardia_(g) + '?', botones: botones };
  }
  if (accion === 'V') {
    const g = guardiaDe_(p[1]);
    return { texto: 'Guardia del ' + textoGuardia_(g) + '.', botones: botonesConfirmar_(g) };
  }
  if (accion === 'P' || accion === 'Q') {
    const tipo = accion === 'P' ? TIPO.COMPANERO : TIPO.HOSPITAL;
    const cubridor = p[2] === '0' ? '' : p[2];
    const g = meCubre_(m, p[1], tipo, cubridor);
    return conDeshacer_(cubridor ? 'Listo. Le pedí a ' + nombreDe_(cubridor) + ' que confirme. Paga: ' + (tipo === TIPO.HOSPITAL ? 'el hospital' : 'vos') + '.'
      : 'Listo. Cuando alguien cargue el reemplazo del ' + fechaCorta_(g.fecha) + ' queda confirmado.', g.id);
  }
  if (accion === 'S' || accion === 'N') {
    const g = responderCobertura_(m, p[1], accion === 'S');
    if (accion === 'N') return conDeshacer_('Anotado. Le avisé a la otra persona para que lo resuelvan entre ustedes.', g.id);
    return conDeshacer_(estaConfirmada_(g) ? 'Confirmada: ' + textoGuardia_(g) + '. ✅' : 'Anotado. Falta que confirme la otra persona.', g.id);
  }
  if (accion === 'Y') {
    const d = recibiPago_(m, p[1]);
    return { texto: 'Anotado: pago recibido. ✅ Tenés 10 minutos para deshacerlo.', botones: [[{ texto: 'Deshacer', data: 'UP:' + d.id }]] };
  }
  if (accion === 'K') {
    if (p[1] === '24') return { texto: '¿Qué día es tu guardia de 24 h?', botones: tecladoDias24_() };
    return { texto: 'Elegí tu primera guardia de 12 h:', botones: tecladoDias12_('K1:') };
  }
  if (accion === 'K24') {
    cambiarContrato_(m, [{ dia_semana: DIAS[Number(p[1])], turno: '24H' }]);
    return { texto: 'Listo, tu guardia de contrato quedó cargada. ✅' };
  }
  if (accion === 'K1') return { texto: 'Elegí tu segunda guardia de 12 h:', botones: tecladoDias12_('K2:' + p[1] + ':') };
  if (accion === 'K2') {
    cambiarContrato_(m, [filaContrato12_(p[1]), filaContrato12_(p[2])]);
    return { texto: 'Listo, tu guardia de contrato quedó cargada. ✅' };
  }
  throw new ErrorUsuario('No entendí ese botón.');
}

function conDeshacer_(texto, guardiaId) {
  return { texto: texto + '\nTenés 10 minutos para deshacerlo.', botones: [[{ texto: 'Deshacer', data: 'U:' + guardiaId }]] };
}

// --- Conexión con el bot ---

function conectarTelegram() {
  const quien = soloDueno_();
  reiniciarEstado_();
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Conectar Telegram', 'Pegá acá el token que te dio BotFather:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const token = r.getResponseText().trim();
  if (!/^\d+:[\w-]+$/.test(token)) { ui.alert('Eso no parece un token de BotFather. Copialo de nuevo.'); return; }
  setPropiedad_('TELEGRAM_TOKEN', token);
  const bot = llamarTelegram_('getMe');
  setPropiedad_('TELEGRAM_BOT', bot.username);
  activarWebhook_();
  registrar_(quien, 'conectar_telegram', bot.username);
  ui.alert('Listo. Bot conectado: @' + bot.username);
}

function activarWebhook_() {
  const url = urlApp_();
  if (!url) throw new ErrorUsuario('Primero hay que publicar la app.');
  if (!propiedad_('TELEGRAM_SECRETO')) setPropiedad_('TELEGRAM_SECRETO', Utilities.getUuid().replace(/-/g, ''));
  quitarDisparadorSondeo_();
  llamarTelegram_('setWebhook', {
    url: url + '?tg=' + propiedad_('TELEGRAM_SECRETO'), allowed_updates: ['message', 'callback_query'], drop_pending_updates: false
  });
  setPropiedad_('TELEGRAM_MODO', 'webhook');
}

// Telegram informa el último error. Si es una redirección, el webhook no sirve en esta cuenta.
function revisarWebhook_() {
  if (propiedad_('TELEGRAM_MODO') !== 'webhook') return 'sondeo';
  const info = llamarTelegram_('getWebhookInfo');
  if (info.last_error_message && /30\d|moved|redirect/i.test(info.last_error_message)) {
    activarSondeo_();
    registrar_('sistema', 'telegram_a_sondeo', info.last_error_message);
    return 'sondeo';
  }
  return 'webhook';
}

function activarSondeo_() {
  llamarTelegram_('deleteWebhook', { drop_pending_updates: false });
  setPropiedad_('TELEGRAM_MODO', 'sondeo');
  quitarDisparadorSondeo_();
  ScriptApp.newTrigger('sondearTelegram').timeBased().everyMinutes(1).create();
}

function quitarDisparadorSondeo_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sondearTelegram') ScriptApp.deleteTrigger(t);
  });
}

function sondearTelegram() {
  if (!tokenTelegram_() || propiedad_('TELEGRAM_MODO') !== 'sondeo') return;
  reiniciarEstado_();
  const offset = Number(propiedad_('TELEGRAM_OFFSET') || 0);
  const updates = llamarTelegram_('getUpdates', { offset: offset, timeout: 0, allowed_updates: ['message', 'callback_query'] });
  updates.forEach(function (u) {
    setPropiedad_('TELEGRAM_OFFSET', u.update_id + 1);
    try { procesarUpdate_(u); } catch (e) { console.error(e); }
  });
}

function revisarTelegram() {
  soloDueno_();
  reiniciarEstado_();
  const ui = SpreadsheetApp.getUi();
  if (!tokenTelegram_()) { ui.alert('Telegram todavía no está conectado.'); return; }
  const modo = revisarWebhook_();
  const vinculados = medicos_().filter(function (m) { return m.telegram_chat_id; }).length;
  ui.alert('Bot: @' + propiedad_('TELEGRAM_BOT') + '\nModo: ' + modo + '\nMédicos vinculados: ' + vinculados + ' de ' + medicos_().length);
}
