// Registro inicial hecho por el médico (5 pasos) y su vínculo con el servicio.
// Hasta completarlo, la app no permite nada más (ver api() en Web.js).
//   1. PIN propio  2. Vínculo  3. Guardia fija o reemplazos fijos, y vacaciones  4. Avisos  5. Resumen
// El borrador se guarda en MEDICOS.registro: si cierra a mitad de camino, al volver retoma donde dejó.

const VINCULO = { CONTRATO: 'CONTRATO', SOLO: 'SOLO_REEMPLAZO' };
const PASOS_REGISTRO = ['2', '3', '3v', '4', '5'];
const DIAS_CON_TILDE = { lunes: 'lunes', martes: 'martes', miercoles: 'miércoles', jueves: 'jueves', viernes: 'viernes', sabado: 'sábado', domingo: 'domingo' };

function esSoloReemplazo_(m) { return !!m && String(m.vinculo || '').trim().toUpperCase() === VINCULO.SOLO; }
function vinculoDe_(m) { return esSoloReemplazo_(m) ? VINCULO.SOLO : VINCULO.CONTRATO; }
function registroCompleto_(m) { return esSi_(m.contrato_revisado); }
function tienePinPropio_(m) { return esSi_(m.pin_propio); }

function borradorDe_(m) {
  try { return JSON.parse(m.registro || '{}') || {}; } catch (e) { return {}; }
}

function estadoRegistro_(m) {
  const b = borradorDe_(m);
  return {
    paso: !tienePinPropio_(m) ? '1' : (PASOS_REGISTRO.indexOf(b.paso) >= 0 ? b.paso : '2'),
    borrador: b
  };
}

// Solo se guardan los campos conocidos, con forma conocida.
function limpiarBorrador_(b) {
  b = b || {};
  const filas = function (lista) {
    return (Array.isArray(lista) ? lista : []).slice(0, 7).map(function (f) {
      return { dia_semana: normalizarDia_(f && f.dia_semana), turno: String((f && f.turno) || '') };
    }).filter(function (f) { return DIAS.indexOf(f.dia_semana) >= 0 && TURNOS[f.turno]; });
  };
  const vac = b.vacaciones && esFechaValida_(String(b.vacaciones.desde)) && esFechaValida_(String(b.vacaciones.hasta))
    ? { desde: String(b.vacaciones.desde), hasta: String(b.vacaciones.hasta) } : null;
  return {
    paso: PASOS_REGISTRO.indexOf(String(b.paso)) >= 0 ? String(b.paso) : '2',
    vinculo: b.vinculo === VINCULO.SOLO ? VINCULO.SOLO : b.vinculo === VINCULO.CONTRATO ? VINCULO.CONTRATO : '',
    modo: b.modo === '12' ? '12' : b.modo === '24' ? '24' : '',
    contrato: filas(b.contrato),
    tiene_fijos: b.tiene_fijos === true ? true : b.tiene_fijos === false ? false : null,
    reemplazos: filas(b.reemplazos),
    tiene_vacaciones: b.tiene_vacaciones === true ? true : b.tiene_vacaciones === false ? false : null,
    vacaciones: vac,
    email: String(b.email || '').trim().slice(0, 120)
  };
}

// Paso 1: el PIN que le cargaron no sirve para siempre; elige uno propio.
function crearPinPropio_(m, nuevo) {
  if (!/^\d{4}$/.test(String(nuevo))) throw new ErrorUsuario('El PIN tiene que tener 4 números.');
  m.pin = hashPin_(m.id, String(nuevo));
  m.pin_propio = true;
  guardar_('MEDICOS', m);
  registrar_(m.nombre_apellido, 'pin_propio', '');
  return { token: crearSesion_(m) };
}

function guardarBorrador_(m, b) {
  const limpio = limpiarBorrador_(b);
  m.registro = JSON.stringify(limpio);
  guardar_('MEDICOS', m);
  return estadoRegistro_(m);
}

function filasDelBorrador_(b) {
  if (b.vinculo === VINCULO.SOLO) {
    return b.tiene_fijos ? b.reemplazos.map(function (f) { return { dia_semana: f.dia_semana, turno: f.turno, tipo: TIPO.HOSPITAL }; }) : [];
  }
  return b.contrato.map(function (f) { return { dia_semana: f.dia_semana, turno: f.turno, tipo: TIPO.CONTRATO }; });
}

function textoFilas_(filas) {
  const partes = filas.map(function (f) { return (DIAS_CON_TILDE[f.dia_semana] || f.dia_semana) + ' ' + TURNOS[f.turno].nombre; });
  return partes.length > 1 ? partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1] : partes.join('');
}

function textoAvisos_(m, email) {
  if (m.telegram_chat_id) return 'Te vamos a avisar por Telegram.';
  if (email) return 'Te vamos a avisar por mail a ' + email + '.';
  return 'Por ahora no vas a recibir avisos: activalos desde Mi perfil.';
}

function resumenRegistro_(m, b) {
  const filas = filasDelBorrador_(b);
  let t = 'Sos ' + m.nombre_apellido + ', ';
  if (b.vinculo === VINCULO.SOLO) t += filas.length ? 'solo reemplazos, fijos: ' + textoFilas_(filas) + '.' : 'solo reemplazos (variables).';
  else t += 'contrato: ' + textoFilas_(filas) + '.';
  if (b.tiene_vacaciones && b.vacaciones) t += ' Vacaciones: del ' + fechaCorta_(b.vacaciones.desde) + ' al ' + fechaCorta_(b.vacaciones.hasta) + '.';
  return t + ' ' + textoAvisos_(m, b.email || m.email);
}

function validarBorrador_(b) {
  if (!b.vinculo) throw new ErrorUsuario('Elegí cómo trabajás en el servicio.');
  const filas = filasDelBorrador_(b);
  if (b.vinculo === VINCULO.CONTRATO) {
    const horas = filas.reduce(function (s, f) { return s + TURNOS[f.turno].horas; }, 0);
    if (horas !== 24) throw new ErrorUsuario('Elegí tu guardia de contrato: 24 h, o 12 h + 12 h.');
  } else if (b.tiene_fijos === null) {
    throw new ErrorUsuario('Contanos si tenés reemplazos fijos.');
  } else if (b.tiene_fijos && !filas.length) {
    throw new ErrorUsuario('Elegí el día y el turno de tus reemplazos fijos.');
  }
  validarFija_(filas, b.vinculo === VINCULO.SOLO);
  if (b.tiene_vacaciones && b.vacaciones) validarVacaciones_(b.vacaciones);
  if (b.email && !/^\S+@\S+\.\S+$/.test(b.email)) throw new ErrorUsuario('Revisá el mail.');
  return filas;
}

// Paso 5 → Confirmar: aplica todo junto y deja constancia en el LOG.
function confirmarRegistro_(m) {
  if (!tienePinPropio_(m)) throw new ErrorUsuario('Primero creá tu PIN.');
  const b = limpiarBorrador_(borradorDe_(m));
  const filas = validarBorrador_(b);
  const anterior = vinculoDe_(m);
  m.vinculo = b.vinculo;
  if (b.email) m.email = b.email;
  guardar_('MEDICOS', m);
  guardarFija_(m.id, filas);
  if (b.tiene_vacaciones && b.vacaciones) agregarVacaciones_(m, b.vacaciones);
  const resumen = resumenRegistro_(m, b);
  m.contrato_revisado = true;
  m.registro = '';
  guardar_('MEDICOS', m);
  sembrarDesdeHoy_(m.id);
  if (anterior !== m.vinculo) registrar_(m.nombre_apellido, 'cambio_vinculo', anterior + ' → ' + m.vinculo);
  registrar_(m.nombre_apellido, 'registro_completo', resumen);
  return { resumen: resumen };
}

// Desde Mi perfil o desde Vista jefe → Médicos. Pasar a SOLO_REEMPLAZO deja sin vigencia la guardia de
// contrato y anula las guardias de contrato futuras sin tocar; los reemplazos fijos se conservan.
function cambiarVinculo_(m, vinculo, autor) {
  const nuevo = vinculo === VINCULO.SOLO ? VINCULO.SOLO : vinculo === VINCULO.CONTRATO ? VINCULO.CONTRATO : null;
  if (!nuevo) throw new ErrorUsuario('Elegí el vínculo.');
  const anterior = vinculoDe_(m);
  if (anterior === nuevo) return;
  m.vinculo = nuevo;
  guardar_('MEDICOS', m);
  if (nuevo === VINCULO.SOLO) {
    const fijos = fijasVigentes_().filter(function (f) { return f.medico_id === m.id && f.tipo === TIPO.HOSPITAL; })
      .map(function (f) { return { dia_semana: f.dia_semana, turno: f.turno, tipo: TIPO.HOSPITAL }; });
    guardarFija_(m.id, fijos);
  }
  registrar_(autor || m.nombre_apellido, 'cambio_vinculo', m.nombre_apellido + ': ' + anterior + ' → ' + nuevo);
}

function guardarMiEmail_(m, email) {
  email = String(email || '').trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new ErrorUsuario('Revisá el mail.');
  m.email = email;
  guardar_('MEDICOS', m);
  registrar_(m.nombre_apellido, 'cambio_email', email ? 'cargó un mail' : 'borró el mail');
}

// Una sola vez, al pasar al registro propio: la guardia fija que se cargó desde la grilla deja de valer
// para los médicos reales que todavía no se registraron (queda en la hoja como no vigente; nada se borra).
// Las guardias PREVISTAS futuras que salieron de esa guardia fija y nadie tocó se anulan.
function prepararRegistroPropio_() {
  if (propiedad_('registro_propio_preparado')) return 0;
  const hoyStr = hoy_();
  const pendientes = {};
  filas_('MEDICOS').forEach(function (m) {
    if (!registroCompleto_(m) && m.nombre_apellido.indexOf('PRUEBA ') !== 0) pendientes[m.id] = m;
  });
  let n = 0;
  filas_('GUARDIA_FIJA').forEach(function (f) {
    if (pendientes[f.medico_id] && f.vigente !== 'FALSE') { f.vigente = false; guardar_('GUARDIA_FIJA', f); n++; }
  });
  filas_('GUARDIAS').forEach(function (g) {
    if (pendientes[g.medico_titular_id] && g.estado === ESTADO.PREVISTA && g.fecha >= hoyStr &&
      (!g.medico_que_hizo_id || g.medico_que_hizo_id === g.medico_titular_id)) {
      g.estado = ESTADO.ANULADA;
      guardar_('GUARDIAS', g);
    }
  });
  setPropiedad_('registro_propio_preparado', hoyStr);
  registrar_('sistema', 'registro_propio', n + ' filas de guardia fija cargadas desde la grilla quedaron sin vigencia');
  return n;
}
