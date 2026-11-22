// Operaciones del médico sobre guardias, vacaciones, guardia fija y deudas.

const MINUTOS_DESHACER = 10;
const CAMPOS_DESHACER = ['medico_que_hizo_id', 'tipo', 'estado', 'confirmado_por_quien_hizo', 'confirmado_por_titular', 'mes_facturacion', 'fecha_cobro', 'observacion'];
const SIN_CUBRIR = 'sin cubrir';
const MENSAJE_MES_CERRADO = 'Ese mes ya cerró. Cargala en el mes actual como reclamo';

function filaCierre_(mes) { return filas_('CIERRES').find(function (c) { return c.mes === mes; }) || null; }

function estaConfirmada_(g) { return g.estado === ESTADO.CONFIRMADA || g.estado === ESTADO.ANTICIPADA; }
function controlAdverso_(g) { return g.control_anticipada === CONTROL.CUBIERTA || g.control_anticipada === CONTROL.NO_SE_HIZO; }

function diaCorte_() {
  const n = Number(cfg_('dia_corte', '25'));
  return n >= 1 && n <= 28 ? n : 25;
}
function fechaCorte_(mes) { return mes + '-' + ('0' + diaCorte_()).slice(-2); }

// Ventana de cierre: los 7 días previos al corte. Se pueden confirmar por adelantado las guardias
// de ese mes que caen entre el corte y fin de mes.
function esAnticipable_(fecha) {
  const corte = fechaCorte_(mesDe_(fecha));
  const h = hoy_();
  return fecha > h && fecha >= corte && h < corte && h >= sumarDias_(corte, -7);
}

// Un mes queda cerrado a las 00:00 del día de corte, aunque el disparador todavía no haya corrido.
function mesCerrado_(mes) {
  const h = hoy_();
  if (mes < mesDe_(h) || (mes === mesDe_(h) && h >= fechaCorte_(mes))) return true;
  const c = filaCierre_(mes);
  return !!c && c.estado !== 'ABIERTO';
}
function mesEntregado_(mes) {
  const c = filaCierre_(mes);
  return !!c && c.estado === 'ENTREGADO';
}

// Lo que se resuelve después del cierre se factura en el primer mes abierto.
function mesParaFacturar_(fecha) {
  let m = mesDe_(fecha);
  while (mesCerrado_(m)) m = sumarMeses_(m, 1);
  return m;
}

function crearGuardia_(d) {
  const mes = mesParaFacturar_(d.fecha);
  return insertar_('GUARDIAS', {
    id: siguienteId_('GUARDIAS'),
    fecha: d.fecha,
    turno: d.turno,
    horas: TURNOS[d.turno].horas,
    medico_que_hizo_id: d.hizo || '',
    medico_titular_id: d.titular || '',
    tipo: d.tipo,
    categoria: categoriaDe_(d.fecha),
    estado: d.estado || ESTADO.PREVISTA,
    confirmado_por_quien_hizo: !!d.confHizo,
    confirmado_por_titular: !!d.confTitular,
    mes_facturacion: mes,
    fecha_cobro: fechaCobro_(mes),
    creado_en: marcaTiempo_(),
    observacion: d.observacion || (mes !== mesDe_(d.fecha) ? MARCA_RECLAMO : '')
  });
}

function guardiaDe_(id) {
  const g = buscarPorId_('GUARDIAS', id);
  if (!g) throw new ErrorUsuario('No encontré esa guardia.');
  return g;
}

function nombreTipo_(t) {
  return t === TIPO.HOSPITAL ? 'paga el hospital' : t === TIPO.COMPANERO ? 'paga el compañero' : 'contrato';
}
function textoGuardia_(g) {
  return fechaCorta_(g.fecha) + ', ' + TURNOS[g.turno].nombre + ' (' + (g.categoria === 'NO_HABIL' ? 'no hábil' : 'hábil') + ')';
}

// Confirmar tarde se puede; tocar lo que ya salió en el Excel de un mes cerrado, no.
function exigirEditable_(g) {
  if (g.estado === ESTADO.ANULADA) throw new ErrorUsuario('Esa guardia está anulada.');
  if (estaConfirmada_(g) && mesCerrado_(g.mes_facturacion)) {
    throw new ErrorUsuario('Esa guardia ya está confirmada y el mes de ' + nombreMes_(g.mes_facturacion) + ' cerró.');
  }
}

// Editar, desmarcar y anular solo mientras el mes en que se factura siga abierto.
function exigirMesAbierto_(g) {
  if (g.estado === ESTADO.ANULADA) throw new ErrorUsuario('Esa guardia está anulada.');
  if (mesCerrado_(g.mes_facturacion)) throw new ErrorUsuario(MENSAJE_MES_CERRADO);
}

function exigirParticipante_(g, m) {
  if (g.medico_titular_id !== m.id && g.medico_que_hizo_id !== m.id) throw new ErrorUsuario('Esa guardia no es tuya.');
}

function exigirNoConfirmadaPorOtro_(g, m) {
  if (estaConfirmada_(g) && g.medico_que_hizo_id !== m.id) {
    throw new ErrorUsuario('Esa guardia ya está confirmada a nombre de ' + nombreDe_(g.medico_que_hizo_id) + '. Para cambiarla, elegí "Me cubre…" o "Desmarcar".');
  }
}

function exigirSinSuperponer_(medicoId, fecha, turno, salvoId) {
  const pisa = filas_('GUARDIAS').some(function (g) {
    return g.id !== salvoId && g.estado !== ESTADO.ANULADA && g.medico_que_hizo_id === medicoId && g.fecha === fecha && turnosSePisan_(g.turno, turno);
  });
  if (pisa) throw new ErrorUsuario('Ya tenés una guardia que se superpone ese día.');
}

function tipoBase_(g) {
  const fija = fijasVigentes_().find(function (f) {
    return f.medico_id === g.medico_titular_id && f.turno === g.turno && normalizarDia_(f.dia_semana) === DIAS[diaSemana_(g.fecha)];
  });
  return fija && fija.tipo === TIPO.HOSPITAL ? TIPO.HOSPITAL : TIPO.CONTRATO;
}

// La otra parte de una cobertura, si la hay.
function otraParte_(g, m) {
  if (!g.medico_titular_id || !g.medico_que_hizo_id || g.medico_titular_id === g.medico_que_hizo_id) return null;
  const id = m.id === g.medico_titular_id ? g.medico_que_hizo_id : g.medico_titular_id;
  return buscarPorId_('MEDICOS', id);
}

// Decide el estado según quién confirmó. Hace falta el titular solo si lo hizo otro médico.
// Una guardia futura queda PREVISTA y se confirma el día que se hace, salvo en la ventana de cierre.
function reevaluar_(g) {
  const hizo = g.medico_que_hizo_id;
  const hacenFaltaDos = g.medico_titular_id && hizo !== g.medico_titular_id;
  const completa = hizo && esSi_(g.confirmado_por_quien_hizo) && (!hacenFaltaDos || esSi_(g.confirmado_por_titular));
  const anterior = g.mes_facturacion;
  const facturar = function () {
    const mes = mesParaFacturar_(g.fecha);
    g.mes_facturacion = mes;
    g.fecha_cobro = fechaCobro_(mes);
    if (mes !== mesDe_(g.fecha)) g.observacion = MARCA_RECLAMO;
    else if (g.observacion === MARCA_RECLAMO) g.observacion = '';
  };
  const futura = g.fecha > hoy_();
  if (futura && !esAnticipable_(g.fecha)) {
    g.estado = ESTADO.PREVISTA;
  } else if (completa) {
    g.estado = futura ? ESTADO.ANTICIPADA : ESTADO.CONFIRMADA;
    facturar();
  } else if (esSi_(g.confirmado_por_quien_hizo) || esSi_(g.confirmado_por_titular) || (hacenFaltaDos && hizo)) {
    g.estado = ESTADO.ESPERANDO;
    facturar();
  } else {
    g.estado = ESTADO.PREVISTA;
  }
  guardar_('GUARDIAS', g);
  sincronizarDeuda_(g);
  marcarMesSucio_(anterior);
  marcarMesSucio_(g.mes_facturacion);
  return g;
}

function sincronizarDeuda_(g) {
  const deuda = filas_('DEUDAS').find(function (d) { return d.guardia_id === g.id && d.estado !== 'anulada'; });
  const corresponde = estaConfirmada_(g) && !controlAdverso_(g) && g.tipo === TIPO.COMPANERO && g.medico_titular_id && g.medico_que_hizo_id !== g.medico_titular_id;
  if (corresponde && !deuda) {
    insertar_('DEUDAS', {
      id: siguienteId_('DEUDAS'), guardia_id: g.id, deudor_id: g.medico_titular_id, acreedor_id: g.medico_que_hizo_id,
      fecha_pago_sugerida: g.fecha_cobro, estado: 'pendiente', confirmado_por_acreedor: false
    });
  } else if (corresponde && deuda && deuda.estado === 'pendiente') {
    deuda.deudor_id = g.medico_titular_id;
    deuda.acreedor_id = g.medico_que_hizo_id;
    deuda.fecha_pago_sugerida = g.fecha_cobro;
    guardar_('DEUDAS', deuda);
  } else if (!corresponde && deuda && deuda.estado === 'pendiente') {
    deuda.estado = 'anulada';
    guardar_('DEUDAS', deuda);
  }
}

// --- Deshacer: solo la última confirmación de esa guardia, y solo quien la hizo ---

function fotoGuardia_(g) {
  const f = {};
  CAMPOS_DESHACER.forEach(function (c) { f[c] = g[c]; });
  return f;
}

function habilitarDeshacer_(g, foto, m) {
  g.deshacer = JSON.stringify({ foto: foto, por: m.id, hasta: ahora_().getTime() + MINUTOS_DESHACER * 60000 });
  guardar_('GUARDIAS', g);
}

function datosDeshacer_(g) {
  if (!g.deshacer) return null;
  try { return JSON.parse(g.deshacer); } catch (e) { return null; }
}

function minutosParaDeshacer_(g, m) {
  const d = datosDeshacer_(g);
  if (!d || d.por !== m.id || (!d.control && mesCerrado_(g.mes_facturacion))) return 0;
  const resto = d.hasta - ahora_().getTime();
  return resto > 0 ? Math.ceil(resto / 60000) : 0;
}

function deshacer_(m, gId) {
  const g = guardiaDe_(gId);
  const d = datosDeshacer_(g);
  if (!d || d.por !== m.id) throw new ErrorUsuario('Eso ya no se puede deshacer.');
  if (ahora_().getTime() >= d.hasta) throw new ErrorUsuario('Pasaron los ' + MINUTOS_DESHACER + ' minutos. Ahora usá Editar o Desmarcar.');
  if (d.control) return deshacerControl_(m, g, d);
  if (mesCerrado_(g.mes_facturacion)) throw new ErrorUsuario('Ese mes ya cerró.');
  const involucrados = {};
  [g.medico_titular_id, g.medico_que_hizo_id, d.foto ? d.foto.medico_que_hizo_id : ''].forEach(function (id) {
    if (id && id !== m.id) involucrados[id] = true;
  });
  const mesAntes = g.mes_facturacion;
  if (d.foto) Object.keys(d.foto).forEach(function (c) { g[c] = d.foto[c]; });
  else g.estado = ESTADO.ANULADA; // era una guardia cargada recién
  g.deshacer = '';
  guardar_('GUARDIAS', g);
  sincronizarDeuda_(g);
  marcarMesSucio_(mesAntes);
  marcarMesSucio_(g.mes_facturacion);
  registrar_(m.nombre_apellido, 'deshacer', 'guardia ' + g.id);
  Object.keys(involucrados).forEach(function (id) {
    const otro = buscarPorId_('MEDICOS', id);
    if (otro) avisar_(otro, m.nombre_apellido + ' deshizo lo que había confirmado de la guardia del ' + fechaCorta_(g.fecha) + '.', null, { sinRegla: true });
  });
  return g;
}

// --- Confirmaciones ---

// [La hago yo]
function hagoYo_(m, gId) {
  const g = guardiaDe_(gId);
  exigirEditable_(g);
  exigirParticipante_(g, m);
  if (g.medico_titular_id && g.medico_titular_id !== m.id) throw new ErrorUsuario('Respondé si cubriste esa guardia con Sí o No.');
  if (g.fecha > hoy_() && !esAnticipable_(g.fecha)) throw new ErrorUsuario('Esa guardia se confirma el día que la hacés. Si te van a cubrir, elegí "Me cubre…".');
  exigirNoConfirmadaPorOtro_(g, m);
  const foto = fotoGuardia_(g);
  const anterior = g.medico_que_hizo_id;
  g.medico_que_hizo_id = m.id;
  g.confirmado_por_quien_hizo = true;
  g.confirmado_por_titular = true;
  if (g.medico_titular_id) g.tipo = tipoBase_(g);
  if (g.observacion === SIN_CUBRIR) g.observacion = '';
  reevaluar_(g);
  habilitarDeshacer_(g, foto, m);
  registrar_(m.nombre_apellido, 'la_hago_yo', 'guardia ' + g.id);
  if (anterior && anterior !== m.id) avisarCoberturaCancelada_(g, m, anterior);
  return g;
}

function avisarCoberturaCancelada_(g, autor, medicoId) {
  const otro = buscarPorId_('MEDICOS', medicoId);
  if (otro) avisar_(otro, autor.nombre_apellido + ' canceló tu cobertura del ' + fechaCorta_(g.fecha) + '.', null, { sinRegla: true, asunto: 'Cobertura cancelada' });
}

// [Me cubre…]: elige al compañero y quién paga. Sin compañero: paga el hospital y todavía no se sabe quién.
function meCubre_(m, gId, tipo, cubridorId) {
  const g = guardiaDe_(gId);
  exigirEditable_(g);
  if (g.medico_titular_id !== m.id) throw new ErrorUsuario('Solo el titular puede decir quién lo cubre.');
  if (tipo !== TIPO.HOSPITAL && tipo !== TIPO.COMPANERO) throw new ErrorUsuario('Elegí quién paga.');
  if (String(cubridorId) === m.id) throw new ErrorUsuario('Elegí a otro médico.');
  if (!cubridorId && tipo === TIPO.COMPANERO) throw new ErrorUsuario('Elegí qué compañero te cubre.');
  const cubridor = cubridorId ? buscarPorId_('MEDICOS', cubridorId) : null;
  if (cubridorId && !cubridor) throw new ErrorUsuario('No encontré a ese médico.');

  const foto = fotoGuardia_(g);
  const anterior = g.medico_que_hizo_id;
  g.medico_que_hizo_id = cubridor ? cubridor.id : '';
  g.tipo = tipo;
  g.confirmado_por_titular = true;
  g.confirmado_por_quien_hizo = false;
  if (g.observacion === SIN_CUBRIR) g.observacion = '';
  reevaluar_(g);
  habilitarDeshacer_(g, foto, m);
  registrar_(m.nombre_apellido, 'me_cubre', 'guardia ' + g.id + ' ' + tipo + ' ' + (cubridor ? cubridor.nombre_apellido : 'sin nombre'));
  if (cubridor && anterior === cubridor.id) avisarModificacion_(g, m, cubridor);
  else if (cubridor) pedirConfirmacionAlQueCubrio_(g, cubridor, m);
  if (anterior && anterior !== m.id && (!cubridor || anterior !== cubridor.id)) avisarCoberturaCancelada_(g, m, anterior);
  return g;
}

// [Sí] / [No] de cualquiera de las dos partes.
function responderCobertura_(m, gId, si) {
  const g = guardiaDe_(gId);
  exigirEditable_(g);
  const esHizo = g.medico_que_hizo_id === m.id;
  const esTitular = g.medico_titular_id === m.id;
  exigirParticipante_(g, m);
  const foto = fotoGuardia_(g);
  if (si) {
    if (esHizo) g.confirmado_por_quien_hizo = true;
    if (esTitular) g.confirmado_por_titular = true;
    reevaluar_(g);
  } else if (!g.medico_titular_id) {
    // Puesto vacante que cargó y no hizo: no hay otra parte con quien discutirlo.
    g.estado = ESTADO.ANULADA;
    guardar_('GUARDIAS', g);
    marcarMesSucio_(g.mes_facturacion);
  } else {
    if (esHizo) g.confirmado_por_quien_hizo = false;
    if (esTitular) g.confirmado_por_titular = false;
    g.estado = ESTADO.CONFLICTO;
    guardar_('GUARDIAS', g);
    sincronizarDeuda_(g);
    marcarMesSucio_(g.mes_facturacion);
    avisarConflicto_(g, m);
  }
  habilitarDeshacer_(g, foto, m);
  registrar_(m.nombre_apellido, si ? 'confirmo_cobertura' : 'rechazo_cobertura', 'guardia ' + g.id);
  const otro = otraParte_(g, m);
  if (otro && estaConfirmada_(g)) {
    avisar_(otro, m.nombre_apellido + ' confirmó la guardia del ' + textoGuardia_(g) + '. Quedó confirmada.');
  }
  return g;
}

// [+ Cargar guardia]. Sin titular: puesto vacante. Si el puesto está libre usa su fila, no duplica;
// si otro ya lo tiene, crea otra y queda como conflicto entre los dos.
function cargarGuardia_(m, datos) {
  const fecha = String(datos.fecha || '');
  const turno = String(datos.turno || '');
  const titularId = String(datos.titular_id || '');
  if (!esFechaValida_(fecha)) throw new ErrorUsuario('Elegí la fecha.');
  if (!TURNOS[turno]) throw new ErrorUsuario('Elegí el turno.');
  if (mesCerrado_(mesDe_(fecha)) && datos.reclamo !== true) throw new ErrorUsuario(MENSAJE_MES_CERRADO);
  if (titularId === m.id) throw new ErrorUsuario('Esa guardia es tuya: confirmala desde Mi mes.');
  if (titularId && !buscarPorId_('MEDICOS', titularId)) throw new ErrorUsuario('No encontré a ese médico.');
  const tipo = datos.tipo || sugerirTipo_(titularId, fecha);
  if (tipo !== TIPO.HOSPITAL && tipo !== TIPO.COMPANERO) throw new ErrorUsuario('Elegí quién paga.');
  if (!titularId && tipo === TIPO.COMPANERO) throw new ErrorUsuario('Si no hay titular, lo paga el hospital.');
  exigirSinSuperponer_(m.id, fecha, turno);

  const puesto = titularId ? filas_('GUARDIAS').find(function (g) {
    return g.medico_titular_id === titularId && g.fecha === fecha && g.turno === turno && g.estado !== ESTADO.ANULADA &&
      !estaConfirmada_(g) && g.estado !== ESTADO.CONFLICTO && (!g.medico_que_hizo_id || g.medico_que_hizo_id === titularId);
  }) : null;

  // A futuro todavía no la hizo: se confirma ese día, salvo en la ventana de cierre.
  const yaLaHizo = fecha <= hoy_() || esAnticipable_(fecha);
  let g;
  let foto = null;
  if (puesto) {
    g = puesto;
    foto = fotoGuardia_(g);
    g.medico_que_hizo_id = m.id;
    g.tipo = tipo;
    g.confirmado_por_quien_hizo = yaLaHizo;
    if (g.observacion === SIN_CUBRIR) g.observacion = '';
  } else {
    g = crearGuardia_({ fecha: fecha, turno: turno, hizo: m.id, titular: titularId, tipo: tipo, confHizo: yaLaHizo });
  }
  reevaluar_(g);
  habilitarDeshacer_(g, foto, m);
  registrar_(m.nombre_apellido, 'cargo_guardia', 'guardia ' + g.id + ' ' + fecha + ' ' + turno + ' ' + tipo);
  if (titularId && !estaConfirmada_(g)) pedirConfirmacionAlTitular_(g, m);
  return g;
}

// --- Control de las anticipadas: el día de la guardia ---

function controlPendiente_(g) {
  return g.estado === ESTADO.ANTICIPADA && !g.control_anticipada && g.fecha <= hoy_();
}

// [Sí] [No, me cubrió alguien] [No se hizo]. Lo que ya salió en el Excel no se toca: si esa fila
// no corresponde, queda un ajuste para "Para mirar" del Excel siguiente.
function responderControl_(m, gId, respuesta, d) {
  d = d || {};
  const g = guardiaDe_(gId);
  if (g.medico_que_hizo_id !== m.id) throw new ErrorUsuario('Esa guardia no es tuya.');
  if (g.estado !== ESTADO.ANTICIPADA) throw new ErrorUsuario('Esa guardia no está confirmada por adelantado.');
  if (g.fecha > hoy_()) throw new ErrorUsuario('Te lo preguntamos el día de la guardia.');
  if (g.control_anticipada) throw new ErrorUsuario('Esa guardia ya está respondida.');
  if ([CONTROL.SI, CONTROL.CUBIERTA, CONTROL.NO_SE_HIZO].indexOf(respuesta) < 0) throw new ErrorUsuario('Elegí una respuesta.');
  const cubridor = respuesta === CONTROL.CUBIERTA ? buscarPorId_('MEDICOS', d.cubridor) : null;
  if (respuesta === CONTROL.CUBIERTA && (!cubridor || cubridor.id === m.id)) throw new ErrorUsuario('Elegí quién te cubrió.');

  g.control_anticipada = respuesta;
  guardar_('GUARDIAS', g);
  sincronizarDeuda_(g);
  let ajusteId = '';
  if (respuesta !== CONTROL.SI && g.tipo === TIPO.HOSPITAL) {
    const motivo = respuesta === CONTROL.NO_SE_HIZO ? 'No se hizo: hay que descontar esa fila.'
      : 'La cubrió ' + cubridor.nombre_apellido + ': hay que descontar esa fila.';
    ajusteId = insertar_('AJUSTES', {
      id: siguienteId_('AJUSTES'), guardia_id: g.id, medico_id: m.id, fecha_guardia: g.fecha, mes_origen: g.mes_facturacion,
      mes_aviso: mesParaFacturar_(hoy_()), motivo: motivo, estado: 'activo', creado_en: marcaTiempo_()
    }).id;
  }
  let nuevaId = '';
  if (cubridor) {
    // La cobertura se carga normalmente: entra en el mes siguiente, con su doble confirmación.
    const titularId = g.medico_titular_id || m.id;
    const tipo = d.tipo === TIPO.COMPANERO || d.tipo === TIPO.HOSPITAL ? d.tipo : (g.tipo === TIPO.HOSPITAL ? TIPO.HOSPITAL : sugerirTipo_(titularId, g.fecha));
    const nueva = crearGuardia_({ fecha: g.fecha, turno: g.turno, hizo: cubridor.id, titular: titularId, tipo: tipo, confTitular: titularId === m.id });
    reevaluar_(nueva);
    nuevaId = nueva.id;
    pedirConfirmacionAlQueCubrio_(nueva, cubridor, buscarPorId_('MEDICOS', titularId));
  }
  g.deshacer = JSON.stringify({ control: true, por: m.id, hasta: ahora_().getTime() + MINUTOS_DESHACER * 60000, ajuste: ajusteId, nueva: nuevaId });
  guardar_('GUARDIAS', g);
  registrar_(m.nombre_apellido, 'control_anticipada', 'guardia ' + g.id + ' ' + respuesta);
  return g;
}

function deshacerControl_(m, g, d) {
  g.control_anticipada = '';
  g.deshacer = '';
  guardar_('GUARDIAS', g);
  sincronizarDeuda_(g);
  const ajuste = d.ajuste ? buscarPorId_('AJUSTES', d.ajuste) : null;
  if (ajuste) {
    ajuste.estado = 'anulado';
    guardar_('AJUSTES', ajuste);
  }
  const nueva = d.nueva ? buscarPorId_('GUARDIAS', d.nueva) : null;
  if (nueva) {
    nueva.estado = ESTADO.ANULADA;
    guardar_('GUARDIAS', nueva);
    sincronizarDeuda_(nueva);
    marcarMesSucio_(nueva.mes_facturacion);
    const cubridor = buscarPorId_('MEDICOS', nueva.medico_que_hizo_id);
    if (cubridor) avisarCoberturaCancelada_(nueva, m, cubridor.id);
  }
  registrar_(m.nombre_apellido, 'deshacer', 'control de guardia ' + g.id);
  return g;
}

// --- Edición, hasta el cierre ---

function aplicarFechaTurno_(g, fecha, turno) {
  g.fecha = fecha;
  g.turno = turno;
  g.horas = TURNOS[turno].horas;
  g.categoria = categoriaDe_(fecha);
  const mes = mesParaFacturar_(fecha);
  g.mes_facturacion = mes;
  g.fecha_cobro = fechaCobro_(mes);
  if (mes !== mesDe_(fecha)) g.observacion = MARCA_RECLAMO;
  else if (g.observacion === MARCA_RECLAMO) g.observacion = '';
}

function editarGuardia_(m, gId, d) {
  const g = guardiaDe_(gId);
  exigirParticipante_(g, m);
  exigirMesAbierto_(g);
  const fecha = String(d.fecha || g.fecha);
  const turno = String(d.turno || g.turno);
  const tipo = String(d.tipo || g.tipo);
  if (!esFechaValida_(fecha)) throw new ErrorUsuario('Revisá la fecha.');
  if (!TURNOS[turno]) throw new ErrorUsuario('Revisá el turno.');
  if (mesCerrado_(mesDe_(fecha)) && mesDe_(fecha) !== mesDe_(g.fecha)) throw new ErrorUsuario(MENSAJE_MES_CERRADO);
  if ([TIPO.CONTRATO, TIPO.HOSPITAL, TIPO.COMPANERO].indexOf(tipo) < 0) throw new ErrorUsuario('Revisá quién paga.');
  const propia = g.medico_titular_id === g.medico_que_hizo_id;
  if (tipo === TIPO.COMPANERO && (!g.medico_titular_id || !g.medico_que_hizo_id || propia)) throw new ErrorUsuario('Solo una cobertura la paga un compañero.');
  if (tipo === TIPO.CONTRATO && !(g.medico_titular_id && propia)) throw new ErrorUsuario('Contrato es solo una guardia propia.');
  if (fecha === g.fecha && turno === g.turno && tipo === g.tipo) return g;
  if (g.medico_que_hizo_id) exigirSinSuperponer_(g.medico_que_hizo_id, fecha, turno, g.id);

  const mesAntes = g.mes_facturacion;
  aplicarFechaTurno_(g, fecha, turno);
  g.tipo = tipo;
  g.deshacer = '';
  const otro = otraParte_(g, m);
  if (otro) {
    // Rearma las confirmaciones: el otro tiene que volver a decir que sí.
    if (m.id === g.medico_titular_id) {
      g.confirmado_por_titular = true;
      g.confirmado_por_quien_hizo = false;
    } else {
      g.confirmado_por_quien_hizo = fecha <= hoy_() || esAnticipable_(fecha);
      g.confirmado_por_titular = false;
    }
  } else if (fecha > hoy_() && !esAnticipable_(fecha)) {
    g.confirmado_por_quien_hizo = false;
    g.confirmado_por_titular = false;
  }
  reevaluar_(g);
  marcarMesSucio_(mesAntes);
  registrar_(m.nombre_apellido, 'editar_guardia', 'guardia ' + g.id);
  if (otro) avisarModificacion_(g, m, otro);
  return g;
}

// Sin otro médico vuelve a PREVISTA. Con otro médico, los dos tienen que volver a confirmar.
function desmarcar_(m, gId) {
  const g = guardiaDe_(gId);
  exigirParticipante_(g, m);
  exigirMesAbierto_(g);
  if (g.estado === ESTADO.PREVISTA) throw new ErrorUsuario('Esa guardia no está confirmada.');
  const otro = otraParte_(g, m);
  g.confirmado_por_quien_hizo = false;
  g.confirmado_por_titular = false;
  g.deshacer = '';
  if (!g.medico_que_hizo_id) {
    g.medico_que_hizo_id = g.medico_titular_id;
    g.tipo = tipoBase_(g);
  }
  reevaluar_(g);
  registrar_(m.nombre_apellido, 'desmarcar', 'guardia ' + g.id);
  if (otro) avisarModificacion_(g, m, otro);
  return g;
}

function esAnulable_(g, m) {
  if (g.medico_que_hizo_id !== m.id) return false;
  return g.medico_titular_id !== m.id || g.tipo === TIPO.HOSPITAL;
}

// Pasa a ANULADA y queda en la hoja. Si cubría un puesto fijo, el titular vuelve a tenerlo.
function anularGuardia_(m, gId) {
  const g = guardiaDe_(gId);
  exigirParticipante_(g, m);
  exigirMesAbierto_(g);
  if (!esAnulable_(g, m)) throw new ErrorUsuario('Solo podés anular un reemplazo que cargaste. Si no la hacés, elegí "Me cubre…".');
  const otro = otraParte_(g, m);
  g.estado = ESTADO.ANULADA;
  g.deshacer = '';
  guardar_('GUARDIAS', g);
  sincronizarDeuda_(g);
  marcarMesSucio_(g.mes_facturacion);
  registrar_(m.nombre_apellido, 'anular_guardia', 'guardia ' + g.id);
  if (otro) {
    reponerPuesto_(g, otro);
    avisar_(otro, m.nombre_apellido + ' anuló la cobertura del ' + fechaCorta_(g.fecha) + '. La guardia volvió a estar a tu nombre.', null, { asunto: 'Cobertura anulada' });
  }
  return g;
}

function reponerPuesto_(g, titular) {
  const ocupado = filas_('GUARDIAS').some(function (o) {
    return o.id !== g.id && o.estado !== ESTADO.ANULADA && o.fecha === g.fecha && o.turno === g.turno && o.medico_titular_id === titular.id;
  });
  const esFija = fijasVigentes_().some(function (f) {
    return f.medico_id === titular.id && f.turno === g.turno && normalizarDia_(f.dia_semana) === DIAS[diaSemana_(g.fecha)];
  });
  if (ocupado || !esFija) return;
  const vac = estaDeVacaciones_(titular.id, g.fecha);
  crearGuardia_({
    fecha: g.fecha, turno: g.turno, titular: titular.id, hizo: vac ? '' : titular.id,
    tipo: vac ? TIPO.HOSPITAL : tipoBase_({ medico_titular_id: titular.id, turno: g.turno, fecha: g.fecha }),
    observacion: vac ? SIN_CUBRIR : ''
  });
}

// Qué ofrece el menú de cada guardia en Mi mes.
function accionesDe_(g, m) {
  if (g.estado === ESTADO.ANULADA || mesCerrado_(g.mes_facturacion)) return [];
  if (g.medico_titular_id !== m.id && g.medico_que_hizo_id !== m.id) return [];
  const acciones = ['editar'];
  if (g.estado !== ESTADO.PREVISTA) acciones.push('desmarcar');
  if (esAnulable_(g, m)) acciones.push('anular');
  return acciones;
}

// --- Vacaciones ---

function recalcularVacaciones_(medicoId) {
  filas_('GUARDIAS').filter(function (g) {
    return g.medico_titular_id === medicoId && g.estado === ESTADO.PREVISTA && !mesCerrado_(mesDe_(g.fecha));
  }).forEach(function (g) {
    const enVacaciones = estaDeVacaciones_(medicoId, g.fecha);
    if (enVacaciones && g.medico_que_hizo_id === medicoId) {
      g.medico_que_hizo_id = '';
      g.tipo = TIPO.HOSPITAL;
      g.observacion = SIN_CUBRIR;
      guardar_('GUARDIAS', g);
    } else if (!enVacaciones && g.observacion === SIN_CUBRIR && !g.medico_que_hizo_id) {
      g.medico_que_hizo_id = medicoId;
      g.observacion = '';
      g.tipo = tipoBase_(g);
      guardar_('GUARDIAS', g);
    }
  });
}

function validarVacaciones_(datos) {
  const desde = String(datos.desde || '');
  const hasta = String(datos.hasta || '');
  if (!esFechaValida_(desde) || !esFechaValida_(hasta)) throw new ErrorUsuario('Elegí las dos fechas.');
  if (desde > hasta) throw new ErrorUsuario('La fecha "desde" tiene que ser anterior a "hasta".');
  if (mesCerrado_(mesDe_(desde))) throw new ErrorUsuario('El mes de ' + nombreMes_(mesDe_(desde)) + ' ya cerró.');
  return { desde: desde, hasta: hasta, tipo: datos.tipo === 'licencia' ? 'licencia' : 'vacaciones' };
}

function agregarVacaciones_(m, datos) {
  const d = validarVacaciones_(datos);
  const v = insertar_('VACACIONES', { id: siguienteId_('VACACIONES'), medico_id: m.id, desde: d.desde, hasta: d.hasta, tipo: d.tipo, estado: 'activa' });
  recalcularVacaciones_(m.id);
  registrar_(m.nombre_apellido, 'cargo_vacaciones', d.desde + ' a ' + d.hasta);
  return v;
}

function vacacionesDe_(m, id) {
  const v = buscarPorId_('VACACIONES', id);
  if (!v || v.estado === 'cancelada' || (v.medico_id !== m.id && !esSi_(m.es_admin))) throw new ErrorUsuario('No encontré esas vacaciones.');
  if (mesCerrado_(mesDe_(v.desde))) throw new ErrorUsuario('El mes de ' + nombreMes_(mesDe_(v.desde)) + ' ya cerró.');
  return v;
}

function editarVacaciones_(m, id, datos) {
  const v = vacacionesDe_(m, id);
  const d = validarVacaciones_(datos);
  v.desde = d.desde;
  v.hasta = d.hasta;
  v.tipo = d.tipo;
  guardar_('VACACIONES', v);
  recalcularVacaciones_(v.medico_id);
  registrar_(m.nombre_apellido, 'editar_vacaciones', d.desde + ' a ' + d.hasta);
  return v;
}

// No se borra: queda cancelada.
function cancelarVacaciones_(m, id) {
  const v = vacacionesDe_(m, id);
  v.estado = 'cancelada';
  guardar_('VACACIONES', v);
  recalcularVacaciones_(v.medico_id);
  registrar_(m.nombre_apellido, 'cancelar_vacaciones', v.desde + ' a ' + v.hasta);
  return v;
}

// --- Apertura del mes y guardia fija ---

// Crea las guardias PREVISTAS del mes con la guardia fija. No duplica si se corre dos veces.
function sembrarGuardias_(mes, desdeFecha, soloMedicoId) {
  let creadas = 0;
  const existentes = {};
  filas_('GUARDIAS').forEach(function (g) {
    if (g.estado !== ESTADO.ANULADA) existentes[g.fecha + '|' + g.turno + '|' + g.medico_titular_id] = true;
  });
  const fijas = fijasVigentes_();
  medicos_().filter(function (m) { return !soloMedicoId || m.id === String(soloMedicoId); }).forEach(function (m) {
    fijas.filter(function (f) { return f.medico_id === m.id; }).forEach(function (f) {
      const dia = normalizarDia_(f.dia_semana);
      diasDelMes_(mes).forEach(function (fecha) {
        if (DIAS[diaSemana_(fecha)] !== dia || (desdeFecha && fecha < desdeFecha)) return;
        if (existentes[fecha + '|' + f.turno + '|' + m.id] || !TURNOS[f.turno]) return;
        const vac = estaDeVacaciones_(m.id, fecha);
        existentes[fecha + '|' + f.turno + '|' + m.id] = true;
        crearGuardia_({
          fecha: fecha, turno: f.turno, titular: m.id, hizo: vac ? '' : m.id,
          tipo: vac || f.tipo === TIPO.HOSPITAL ? TIPO.HOSPITAL : TIPO.CONTRATO,
          observacion: vac ? SIN_CUBRIR : ''
        });
        creadas++;
      });
    });
  });
  return creadas;
}

function abrirMes_(mes) {
  if (!filaCierre_(mes)) insertar_('CIERRES', { mes: mes, estado: 'ABIERTO' });
  const creadas = sembrarGuardias_(mes);
  registrar_('sistema', 'abrir_mes', mes + ': ' + creadas + ' guardias');
  return creadas;
}

function validarFija_(filas) {
  if (!Array.isArray(filas)) throw new ErrorUsuario('Revisá tu guardia fija.');
  const limpias = filas.map(function (f) {
    const dia = normalizarDia_(f.dia_semana);
    if (DIAS.indexOf(dia) < 0 || !TURNOS[f.turno]) throw new ErrorUsuario('Revisá el día y el turno.');
    return { dia_semana: dia, turno: f.turno, tipo: f.tipo === TIPO.HOSPITAL ? TIPO.HOSPITAL : TIPO.CONTRATO };
  });
  const vistas = {};
  limpias.forEach(function (f) {
    const clave = f.dia_semana + f.turno;
    if (vistas[clave]) throw new ErrorUsuario('Elegiste dos veces el mismo turno.');
    vistas[clave] = true;
  });
  const horas = limpias.filter(function (f) { return f.tipo === TIPO.CONTRATO; }).reduce(function (s, f) { return s + TURNOS[f.turno].horas; }, 0);
  if (horas !== 0 && horas !== 24) throw new ErrorUsuario('El contrato tiene que sumar 24 h por semana.');
  return limpias;
}

// Reemplaza la guardia fija, sin aprobación de nadie. Lo anterior queda como no vigente.
function guardarFija_(medicoId, filas) {
  const limpias = validarFija_(filas);
  filas_('GUARDIA_FIJA').filter(function (f) { return f.medico_id === medicoId && f.vigente !== 'FALSE'; }).forEach(function (f) {
    f.vigente = false;
    guardar_('GUARDIA_FIJA', f);
  });
  limpias.forEach(function (f) {
    insertar_('GUARDIA_FIJA', { medico_id: medicoId, dia_semana: f.dia_semana, turno: f.turno, tipo: f.tipo, vigente: true });
  });
  // Las futuras todavía sin tocar se anulan y se rehacen con la guardia nueva. Las de un mes ya
  // cerrado no se tocan: ese mes no se vuelve a sembrar y se perderían.
  const hoyStr = hoy_();
  filas_('GUARDIAS').filter(function (g) {
    return g.medico_titular_id === medicoId && g.estado === ESTADO.PREVISTA && g.fecha >= hoyStr &&
      !mesCerrado_(mesDe_(g.fecha)) && (g.medico_que_hizo_id === medicoId || !g.medico_que_hizo_id);
  }).forEach(function (g) { g.estado = ESTADO.ANULADA; guardar_('GUARDIAS', g); });
  const mes = mesDe_(hoyStr);
  sembrarDesdeHoy_(medicoId);
  return limpias;
}

// Solo las de ese médico: a los demás no se les puede rehacer una guardia que anularon.
function sembrarDesdeHoy_(medicoId) {
  const hoyStr = hoy_();
  const mes = mesDe_(hoyStr);
  if (filaCierre_(mes) && !mesCerrado_(mes)) sembrarGuardias_(mes, hoyStr, medicoId);
}

// Primer ingreso: el médico revisa la guardia fija que se le cargó.
function confirmarContrato_(m) {
  if (esSi_(m.contrato_revisado)) return;
  m.contrato_revisado = true;
  guardar_('MEDICOS', m);
  sembrarDesdeHoy_(m.id);
  registrar_(m.nombre_apellido, 'contrato_revisado', '');
}

// Desde Telegram solo se elige el contrato: los reemplazos fijos se mantienen.
function cambiarContrato_(m, filas) {
  const fijos = fijasVigentes_().filter(function (f) { return f.medico_id === m.id && f.tipo === TIPO.HOSPITAL; })
    .map(function (f) { return { dia_semana: f.dia_semana, turno: f.turno, tipo: TIPO.HOSPITAL }; });
  guardarFija_(m.id, fijos.concat(filas.map(function (f) { return { dia_semana: f.dia_semana, turno: f.turno, tipo: TIPO.CONTRATO }; })));
  registrar_(m.nombre_apellido, 'guardar_fija', textoContrato_(filas));
}

function textoContrato_(filas) {
  return filas.map(function (f) { return f.dia_semana + ' ' + TURNOS[f.turno].nombre; }).join(' + ');
}

// --- Deudas ---

function recibiPago_(m, deudaId) {
  const d = buscarPorId_('DEUDAS', deudaId);
  if (!d) throw new ErrorUsuario('No encontré esa deuda.');
  if (d.acreedor_id !== m.id) throw new ErrorUsuario('Solo quien cubrió la guardia puede marcar el pago.');
  d.estado = 'pagada';
  d.confirmado_por_acreedor = true;
  d.deshacer_hasta = ahora_().getTime() + MINUTOS_DESHACER * 60000;
  guardar_('DEUDAS', d);
  registrar_(m.nombre_apellido, 'recibi_pago', 'deuda ' + d.id);
  const deudor = buscarPorId_('MEDICOS', d.deudor_id);
  if (deudor) avisar_(deudor, m.nombre_apellido + ' confirmó que recibió el pago. Deuda saldada.', null, { sinRegla: true });
  return d;
}

function deshacerPago_(m, deudaId) {
  const d = buscarPorId_('DEUDAS', deudaId);
  if (!d || d.acreedor_id !== m.id || d.estado !== 'pagada') throw new ErrorUsuario('Eso ya no se puede deshacer.');
  if (!(Number(d.deshacer_hasta) > ahora_().getTime())) throw new ErrorUsuario('Pasaron los ' + MINUTOS_DESHACER + ' minutos.');
  d.estado = 'pendiente';
  d.confirmado_por_acreedor = false;
  d.deshacer_hasta = '';
  guardar_('DEUDAS', d);
  registrar_(m.nombre_apellido, 'deshacer_pago', 'deuda ' + d.id);
  const deudor = buscarPorId_('MEDICOS', d.deudor_id);
  if (deudor) avisar_(deudor, m.nombre_apellido + ' deshizo la confirmación del pago. La deuda sigue pendiente.', null, { sinRegla: true });
  return d;
}
