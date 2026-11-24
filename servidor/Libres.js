// Bolsa de guardias libres.
// - Ausencia (vacaciones o licencia): cada guardia fija del período queda libre y la paga el hospital.
// - Cambio personal: el titular libera una guardia suya y elige quién paga (el hospital o él).
// El primero que toca [La tomo] se la queda (con el bloqueo de Apps Script, no la pueden tomar dos).
// Los compañeros nunca ven quién se ausenta ni el tipo de ausencia: solo "guardia libre". El jefe sí.

const ORIGEN = { AUSENCIA: 'ausencia', LIBERADA: 'liberada' };
const DIAS_AVISO_LIBRE = 7;

// Libre = el titular no la hace, nadie la tomó todavía, y es de hoy en adelante.
function esLibre_(g) {
  return mesAutomatico_(mesDe_(g.fecha)) && g.estado === ESTADO.PREVISTA && !!g.medico_titular_id && !g.medico_que_hizo_id && g.observacion === SIN_CUBRIR &&
    g.fecha >= hoy_() && !mesCerrado_(g.mes_facturacion);
}
function libres_() {
  return filas_('GUARDIAS').filter(esLibre_).sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0; });
}
function jefes_() { return medicos_().filter(function (m) { return esSi_(m.es_admin); }); }

// Lo que ve un compañero: nunca el titular de una ausencia.
function ocultaTitular_(g, m) {
  return g.origen === ORIGEN.AUSENCIA && g.medico_titular_id !== m.id && !esSi_(m.es_admin);
}
function quienPagaLibre_(g) {
  return g.tipo === TIPO.HOSPITAL ? 'Paga el hospital' : 'Paga ' + nombreDe_(g.medico_titular_id) + ' (cambio personal)';
}
function diaYFecha_(fecha) { return DIAS_CON_TILDE[DIAS[diaSemana_(fecha)]] + ' ' + fechaCorta_(fecha); }
function textoLibre_(g) {
  return diaYFecha_(g.fecha) + ', ' + TURNOS[g.turno].nombre + ', ' + (categoriaDe_(g.fecha) === 'NO_HABIL' ? 'no hábil' : 'hábil') + '. ' + quienPagaLibre_(g) + '.';
}
// Para el jefe: de quién era y por qué quedó libre.
function motivoLibre_(g) {
  if (g.origen === ORIGEN.LIBERADA) return 'cambio personal';
  const v = filas_('VACACIONES').find(function (x) {
    return x.estado !== 'cancelada' && x.medico_id === g.medico_titular_id && x.desde <= g.fecha && g.fecha <= x.hasta;
  });
  return v ? v.tipo : 'ausencia';
}

function botonesLibre_(g) {
  return [
    [{ texto: 'La tomo', data: 'T:' + g.id, vista: 'libres', textoMail: 'Ver guardias libres' }],
    [{ texto: 'Ver', vista: 'libres' }]
  ];
}

// Deja la guardia en la bolsa (sin avisar: eso lo hace publicarLibres_).
function marcarLibre_(g, origen, tipo) {
  g.medico_que_hizo_id = '';
  g.tipo = tipo || TIPO.HOSPITAL;
  g.observacion = SIN_CUBRIR;
  g.origen = origen;
  g.libre_desde = hoy_();
  g.aviso_libre = '';
  g.confirmado_por_quien_hizo = false;
  g.confirmado_por_titular = true;
  g.estado = ESTADO.PREVISTA;
  guardar_('GUARDIAS', g);
  marcarMesSucio_(g.mes_facturacion);
}

// Aviso a todos los del servicio menos al titular. "repetir" = segundo aviso a 7 días.
function publicarLibres_(lista, repetir) {
  const hoyStr = hoy_();
  const vigentes = lista.filter(function (g) { return g.fecha >= hoyStr; });
  if (!vigentes.length) return;
  const todos = medicos_().filter(registroCompleto_);
  vigentes.forEach(function (g) {
    todos.filter(function (m) { return m.id !== g.medico_titular_id && !estaDeVacaciones_(m.id, g.fecha); }).forEach(function (m) {
      avisar_(m, (repetir ? 'Sigue libre: ' : 'Guardia libre: ') + textoLibre_(g), botonesLibre_(g), { asunto: 'Guardia libre', sinRegla: true });
    });
  });
}

// [La tomo]. El titular de una guardia que liberó él mismo la puede recuperar mientras nadie la tome.
function tomarGuardia_(m, gId) {
  const g = guardiaDe_(gId);
  if (!esLibre_(g)) {
    if (g.origen && g.medico_que_hizo_id && g.medico_que_hizo_id !== g.medico_titular_id) throw new ErrorUsuario('Esa guardia ya la tomó otro médico.');
    throw new ErrorUsuario('Esa guardia ya no está libre.');
  }
  if (g.medico_titular_id === m.id) {
    if (g.origen !== ORIGEN.LIBERADA) throw new ErrorUsuario('Ese día estás ausente: si volvés, cancelá la ausencia.');
    g.medico_que_hizo_id = m.id;
    g.observacion = '';
    g.origen = '';
    g.libre_desde = '';
    g.confirmado_por_quien_hizo = false;
    g.confirmado_por_titular = false;
    g.tipo = tipoBase_(g);
    reevaluar_(g);
    registrar_(m.nombre_apellido, 'recupero_guardia', 'guardia ' + g.id);
    return g;
  }
  exigirSinSuperponer_(m.id, g.fecha, g.turno);
  g.medico_que_hizo_id = m.id;
  g.observacion = '';
  g.confirmado_por_titular = true;
  g.confirmado_por_quien_hizo = false;
  reevaluar_(g);
  registrar_(m.nombre_apellido, 'tomo_guardia_libre', 'guardia ' + g.id);
  const titular = buscarPorId_('MEDICOS', g.medico_titular_id);
  if (titular && esSi_(titular.activo)) {
    avisar_(titular, 'Tu guardia del ' + fechaCorta_(g.fecha) + ' la cubre ' + m.nombre_apellido + '.', null, { asunto: 'Tu guardia libre ya tiene quién la cubra', sinRegla: true });
  }
  jefes_().filter(function (j) { return j.id !== g.medico_titular_id && j.id !== m.id; }).forEach(function (j) {
    avisar_(j, 'La guardia del ' + fechaCorta_(g.fecha) + ' de ' + nombreDe_(g.medico_titular_id) + ' (' + motivoLibre_(g) + ') la cubre ' + m.nombre_apellido + '.',
      null, { asunto: 'Guardia libre tomada', sinRegla: true });
  });
  return g;
}

// Cambio personal: el titular libera una guardia suya. tipo: REEMPLAZO_HOSPITAL o COBERTURA_COMPANERO (paga él).
function liberarGuardia_(m, gId, tipo) {
  const g = guardiaDe_(gId);
  exigirMesAbierto_(g);
  if (g.medico_titular_id !== m.id || g.medico_que_hizo_id !== m.id) throw new ErrorUsuario('Solo podés liberar una guardia tuya que hacés vos.');
  if (g.estado !== ESTADO.PREVISTA) throw new ErrorUsuario('Esa guardia ya está confirmada. Para liberarla, primero desmarcala.');
  if (g.fecha < hoy_()) throw new ErrorUsuario('Esa guardia ya pasó.');
  if (esSoloReemplazo_(m)) throw new ErrorUsuario('Como médico de reemplazos, si no vas a hacer este reemplazo tocá Anular.');
  if (tipo !== TIPO.HOSPITAL && tipo !== TIPO.COMPANERO) throw new ErrorUsuario('Elegí quién paga.');
  marcarLibre_(g, ORIGEN.LIBERADA, tipo);
  registrar_(m.nombre_apellido, 'libero_guardia', 'guardia ' + g.id + ' ' + tipo);
  publicarLibres_([g]);
  return g;
}

// Ausencia cancelada o acortada: la guardia vuelve al titular. Si alguien la había tomado, se le avisa.
function devolverAlTitular_(g) {
  const tomo = g.medico_que_hizo_id && g.medico_que_hizo_id !== g.medico_titular_id ? buscarPorId_('MEDICOS', g.medico_que_hizo_id) : null;
  g.medico_que_hizo_id = g.medico_titular_id;
  g.observacion = '';
  g.origen = '';
  g.libre_desde = '';
  g.aviso_libre = '';
  g.confirmado_por_quien_hizo = false;
  g.confirmado_por_titular = false;
  g.tipo = tipoBase_(g);
  g.estado = ESTADO.PREVISTA;
  guardar_('GUARDIAS', g);
  marcarMesSucio_(g.mes_facturacion);
  if (tomo) {
    registrar_('sistema', 'libre_devuelta', 'guardia ' + g.id + ': ya no la hace ' + tomo.nombre_apellido);
    avisar_(tomo, 'La guardia libre del ' + fechaCorta_(g.fecha) + ' (' + TURNOS[g.turno].nombre + ') que tomaste ya no está libre: volvió a su titular. No la tenés que hacer.',
      null, { asunto: 'Guardia libre cancelada', sinRegla: true });
  }
}

// Todos los días: si a 7 días nadie la tomó, aviso al jefe y segundo aviso a todos.
function tareaLibresSinTomar_(fecha) {
  const limite = sumarDias_(fecha, DIAS_AVISO_LIBRE);
  const pendientes = libres_().filter(function (g) {
    return g.fecha <= limite && !g.aviso_libre && (!g.libre_desde || g.libre_desde < fecha);
  });
  if (!pendientes.length) return;
  pendientes.forEach(function (g) {
    jefes_().forEach(function (j) {
      avisar_(j, 'Nadie tomó todavía la guardia libre del ' + diaYFecha_(g.fecha) + ', ' + TURNOS[g.turno].nombre + ' (' +
        nombreDe_(g.medico_titular_id) + ', ' + motivoLibre_(g) + ').', [[botonVista_('Ver Mi servicio', 'servicio')]], { asunto: 'Guardia libre sin tomar', sinRegla: true });
    });
    g.aviso_libre = fecha;
    guardar_('GUARDIAS', g);
  });
  publicarLibres_(pendientes, true);
}

// --- Para las pantallas ---

function apiLibres_(m) {
  return libres_().map(function (g) {
    const propia = g.medico_titular_id === m.id;
    const pisa = propia ? null : superposicion_(m.id, g.fecha, g.turno);
    const ausente = !propia && estaDeVacaciones_(m.id, g.fecha);
    return {
      turno_id: g.turno, horas: g.horas,
      no_puede: ausente ? 'Ese día estás ausente.' : pisa ? textoSuperposicion_(pisa, m.id) : '',
      id: g.id, fecha: g.fecha, dia: DIAS_CON_TILDE[DIAS[diaSemana_(g.fecha)]], turno: TURNOS[g.turno].nombre,
      categoria: categoriaDe_(g.fecha) === 'NO_HABIL' ? 'no hábil' : 'hábil', paga: quienPagaLibre_(g),
      mia: g.medico_titular_id === m.id,
      puede_tomar: (!propia && !pisa && !ausente) || (propia && g.origen === ORIGEN.LIBERADA)
    };
  });
}

// Pestaña "Mi servicio" del jefe: solo lectura. Nunca pide aprobaciones.
const CAMBIOS_SERVICIO = {
  me_cubre: 'Cobertura', desmarcar: 'Desmarcó una guardia', cargo_guardia: 'Cargó un reemplazo',
  tomo_guardia_libre: 'Tomó una guardia libre', libero_guardia: 'Liberó una guardia', recupero_guardia: 'Recuperó su guardia',
  cargo_vacaciones: 'Cargó una ausencia', editar_vacaciones: 'Cambió una ausencia', cancelar_vacaciones: 'Canceló una ausencia',
  anular_guardia: 'Anuló un reemplazo'
};
function apiServicio_() {
  const hoyStr = hoy_();
  const hasta = sumarDias_(hoyStr, 28);
  const desdeCambios = sumarDias_(hoyStr, -7);
  const ausencias = filas_('VACACIONES').filter(function (v) {
    return v.estado !== 'cancelada' && v.hasta >= hoyStr && v.desde <= hasta;
  }).sort(function (a, b) { return a.desde < b.desde ? -1 : 1; }).map(function (v) {
    return { nombre: nombreDe_(v.medico_id), desde: v.desde, hasta: v.hasta, tipo: v.tipo };
  });
  const libres = filas_('GUARDIAS').filter(function (g) {
    return g.origen && g.estado !== ESTADO.ANULADA && g.fecha >= hoyStr;
  }).sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; }).map(function (g) {
    const tomada = !!g.medico_que_hizo_id && g.medico_que_hizo_id !== g.medico_titular_id;
    return { id: g.id, fecha: g.fecha, turno: TURNOS[g.turno].nombre, titular: nombreDe_(g.medico_titular_id), motivo: motivoLibre_(g),
      paga: g.tipo === TIPO.HOSPITAL ? 'hospital' : 'titular', tomada: tomada, quien: tomada ? nombreDe_(g.medico_que_hizo_id) : '' };
  });
  const cambios = filas_('LOG').filter(function (l) {
    return CAMBIOS_SERVICIO[l.accion] && String(l.fecha_hora).slice(0, 10) >= desdeCambios;
  }).slice(-60).reverse().map(function (l) {
    const id = (String(l.detalle).match(/^guardia (\d+)/) || [])[1];
    const g = id ? buscarPorId_('GUARDIAS', id) : null;
    return { cuando: String(l.fecha_hora).slice(0, 16), quien: l.usuario, que: CAMBIOS_SERVICIO[l.accion],
      guardia: g ? fechaCorta_(g.fecha) + ' · ' + TURNOS[g.turno].nombre : (/vacaciones/.test(l.accion) ? String(l.detalle).replace(/\d{4}-\d{2}-\d{2}/g, fechaCorta_).replace(' a ', ' al ') : '') };
  });
  const cj = String(cfg_('codigo_jefe'));
  return { ausencias: ausencias, libres: libres, cambios: cambios, codigo: cfg_('codigo_servicio'), codigo_jefe: cj,
    codigo_jefe_activo: !!cj && propiedad_('codigo_jefe_habilitado') === cj.toUpperCase() };
}
