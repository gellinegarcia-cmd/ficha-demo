// Mensajes a los médicos: aviso push si lo activó, y mail como respaldo (si el push falla o no lo activó).
// Un botón puede tener "data" (acción que se ejecuta desde la notificación) y/o "vista" (abre esa pantalla de la app).

function urlApp_() {
  const c = cfg_('url_app');
  if (c) return c;
  if (typeof URL_PUBLICADA !== 'undefined' && URL_PUBLICADA) return URL_PUBLICADA;
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

function botonVista_(texto, vista, g) { return { texto: texto, vista: vista, g: g }; }

function urlDeVista_(vista, g) {
  const base = urlApp_();
  if (!base) return '';
  return base + '?v=' + vista + (g ? '&g=' + g : '');
}

// Los recordatorios llevan siempre la regla de oro, salvo que se pida lo contrario.
function avisar_(medico, texto, botones, op) {
  op = op || {};
  const completo = op.sinRegla ? texto : texto + '\n\n' + REGLA_ORO;
  let entregado = false;
  if (pushActivo_(medico)) {
    try {
      entregado = enviarPushA_(medico, op.asunto || 'Fichá', texto, botones);
    } catch (e) {
      registrar_('sistema', 'error_push', medico.nombre_apellido + ': ' + e.message);
    }
  }
  if (!entregado && medico.email) {
    try {
      enviarMailAviso_(medico.email, op.asunto || 'Fichá', completo, botones);
      entregado = true;
    } catch (e) {
      registrar_('sistema', 'error_mail', medico.nombre_apellido + ': ' + e.message);
    }
  }
  if (!entregado) registrar_('sistema', 'sin_contacto', medico.nombre_apellido + ': ' + texto.slice(0, 80));
  return entregado;
}

// En el mail, los botones abren la app y la acción se confirma con un toque ahí: los filtros
// de correo visitan los enlaces solos y no deben poder confirmar una guardia.
function enviarMailAviso_(para, asunto, texto, botones) {
  let html = '<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5">' +
    escaparXml_(texto).replace(/\n/g, '<br>') + '<br><br>';
  const vistos = {};
  (botones || []).forEach(function (fila) {
    fila.forEach(function (b) {
      const url = b.url || (b.vista ? urlDeVista_(b.vista, b.g) : '');
      if (!url || vistos[url]) return;
      vistos[url] = true;
      html += '<a href="' + escaparXml_(url) + '" style="display:inline-block;background:#1a56a8;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;margin:0 8px 8px 0">' +
        escaparXml_(b.textoMail || b.texto) + '</a>';
    });
  });
  MailApp.sendEmail({ to: para, subject: asunto, body: texto, htmlBody: html + '</div>', name: 'Fichá' });
}

// [La hice] confirma desde la notificación; [Me cubrieron] abre la guardia para elegir quién.
function botonesConfirmar_(g) {
  return [
    [{ texto: 'La hice', data: 'H:' + g.id, vista: 'confirmar', g: g.id, textoMail: 'Responder en la app' }],
    [{ texto: 'Me cubrieron', vista: 'confirmar', g: g.id }]
  ];
}

// Médico de reemplazos: nadie lo cubre. Si no lo hace, lo anula desde la app.
function botonesReemplazoSolo_(g) {
  return [
    [{ texto: 'La hice', data: 'H:' + g.id, vista: 'confirmar', g: g.id, textoMail: 'Responder en la app' }],
    [{ texto: 'No la hago', vista: 'confirmar', g: g.id }]
  ];
}

function botonesSiNo_(g) {
  return [[
    { texto: 'Sí', data: 'S:' + g.id, vista: 'confirmar', g: g.id, textoMail: 'Responder en la app' },
    { texto: 'No', data: 'N:' + g.id, vista: 'confirmar', g: g.id }
  ]];
}

function botonesControl_(g) {
  return [
    [{ texto: 'Sí', data: 'CS:' + g.id, vista: 'confirmar', g: g.id, textoMail: 'Responder en la app' }],
    [{ texto: 'No, me cubrió alguien', data: 'CC:' + g.id, vista: 'confirmar', g: g.id }],
    [{ texto: 'No se hizo', data: 'CN:' + g.id, vista: 'confirmar', g: g.id }]
  ];
}

function pedirConfirmacionAlQueCubrio_(g, cubridor, titular) {
  const paga = g.tipo === TIPO.HOSPITAL ? 'el hospital' : titular.nombre_apellido;
  avisar_(cubridor, '¿Confirmás que cubriste a ' + titular.nombre_apellido + ' el ' + fechaCorta_(g.fecha) + ', ' +
    TURNOS[g.turno].nombre + '? Paga: ' + paga + '.', botonesSiNo_(g), { asunto: 'Confirmá una cobertura' });
}

function pedirConfirmacionAlTitular_(g, quienHizo) {
  const titular = buscarPorId_('MEDICOS', g.medico_titular_id);
  if (!titular) return;
  const paga = g.tipo === TIPO.HOSPITAL ? 'el hospital' : titular.nombre_apellido;
  avisar_(titular, quienHizo.nombre_apellido + (g.fecha > hoy_() ? ' dice que te va a cubrir el ' : ' dice que te cubrió el ') + fechaCorta_(g.fecha) + ', ' + TURNOS[g.turno].nombre +
    '. Paga: ' + paga + '. ¿Es correcto?', botonesSiNo_(g), { asunto: 'Confirmá una cobertura' });
}

// Una cobertura rechazada se la avisa a la otra parte. Se resuelve entre ellos; el jefe no interviene.
function avisarConflicto_(g, quien) {
  const otroId = quien.id === g.medico_titular_id ? g.medico_que_hizo_id : g.medico_titular_id;
  const otro = otroId ? buscarPorId_('MEDICOS', otroId) : null;
  g.ultimo_aviso_conflicto = hoy_();
  guardar_('GUARDIAS', g);
  if (otro) {
    avisar_(otro, quien.nombre_apellido + ' rechazó la cobertura del ' + textoGuardia_(g) + '. Resolvanlo entre ustedes: hasta entonces no entra al Excel.',
      [[botonVista_('Ver la guardia', 'confirmar', g.id)]], { asunto: 'Cobertura rechazada' });
  }
}

function avisarModificacion_(g, autor, otro) {
  avisar_(otro, autor.nombre_apellido + ' modificó la cobertura del ' + fechaCorta_(g.fecha) + '. ¿Confirmás?',
    botonesSiNo_(g), { asunto: 'Cobertura modificada' });
}
