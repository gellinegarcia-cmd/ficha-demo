// Pantallas de administrador. El jefe puede editar si alguna vez quiere, pero el sistema nunca se lo pide.

function mesPedido_(a) { return esMesValido_(String(a[0])) ? a[0] : mesDe_(hoy_()); }

function apiTablero_(jefe, a) {
  const mes = mesPedido_(a);
  const conflictos = {};
  detectarConflictos_(mes).forEach(function (c) { c.guardias.forEach(function (id) { conflictos[id] = true; }); });
  const hoyStr = hoy_();
  const guardias = filas_('GUARDIAS').filter(function (g) { return mesDe_(g.fecha) === mes && g.estado !== ESTADO.ANULADA; });
  const medicos = medicos_(true).filter(function (m) {
    return esSi_(m.activo) || guardias.some(function (g) { return g.medico_que_hizo_id === m.id || g.medico_titular_id === m.id; });
  }).sort(function (x, y) { return x.nombre_apellido < y.nombre_apellido ? -1 : 1; });
  return {
    mes: mes,
    titulo: capital_(nombreMesAnio_(mes)),
    estado: (filaCierre_(mes) || { estado: 'SIN ABRIR' }).estado,
    dias: diasDelMes_(mes).map(function (f) { return { fecha: f, no_habil: categoriaDe_(f) === 'NO_HABIL' }; }),
    medicos: medicos.map(function (m) {
      const celdas = {};
      guardias.filter(function (g) { return (g.medico_que_hizo_id || g.medico_titular_id) === m.id; }).forEach(function (g) {
        const rojo = conflictos[g.id] && g.estado !== ESTADO.ESPERANDO;
        const amarillo = g.estado === ESTADO.ESPERANDO || (g.estado === ESTADO.PREVISTA && g.fecha <= hoyStr);
        const color = rojo ? 'conflicto' : amarillo ? 'espera' : g.estado === ESTADO.PREVISTA ? 'prevista' : g.tipo === TIPO.HOSPITAL ? 'reemplazo' : g.tipo === TIPO.COMPANERO ? 'cubierta' : 'confirmada';
        const previa = celdas[g.fecha];
        celdas[g.fecha] = { texto: (previa ? previa.texto + '+' : '') + g.horas, color: previa && previa.color === 'conflicto' ? 'conflicto' : color, id: previa ? previa.id : g.id };
      });
      return { id: m.id, nombre: m.nombre_apellido, celdas: celdas };
    })
  };
}

function apiConflictos_(jefe, a) {
  const mes = mesPedido_(a);
  return {
    mes: mes,
    titulo: capital_(nombreMesAnio_(mes)),
    conflictos: detectarConflictos_(mes).map(function (x) {
      return {
        tipo: x.tipo,
        texto: x.texto,
        guardias: x.guardias.map(function (id) {
          const g = buscarPorId_('GUARDIAS', id);
          return { id: g.id, fecha: g.fecha, turno: TURNOS[g.turno].nombre, estado: g.estado };
        })
      };
    })
  };
}

function apiGuardiaJefe_(jefe, a) {
  const g = guardiaDe_(a[0]);
  return {
    id: g.id, fecha: g.fecha, turno: g.turno, tipo: g.tipo, estado: g.estado, hizo_id: g.medico_que_hizo_id,
    titular: g.medico_titular_id ? nombreDe_(g.medico_titular_id) : '',
    entregado: mesEntregado_(g.mes_facturacion),
    medicos: medicos_().map(function (m) { return { id: m.id, nombre: m.nombre_apellido }; }),
    turnos: Object.keys(TURNOS).map(function (k) { return { id: k, nombre: TURNOS[k].nombre }; })
  };
}

// El jefe puede cambiar cualquier guardia en cualquier momento, sin pedirle confirmación a nadie.
function apiCorregirGuardia_(jefe, a) {
  const g = guardiaDe_(a[0]);
  const accion = a[1];
  const valor = a[2];
  const mesAntes = g.mes_facturacion;
  let detalle;
  if (accion === 'confirmar') {
    if (!g.medico_que_hizo_id) throw new ErrorUsuario('Primero elegí quién hizo la guardia.');
    g.confirmado_por_quien_hizo = true;
    g.confirmado_por_titular = true;
    g.estado = ESTADO.CONFIRMADA;
    if (g.observacion !== MARCA_RECLAMO) {
      g.mes_facturacion = mesDe_(g.fecha);
      g.fecha_cobro = fechaCobro_(g.mes_facturacion);
    }
    detalle = 'se confirmó';
  } else if (accion === 'anular') {
    g.estado = ESTADO.ANULADA;
    detalle = 'se anuló';
  } else if (accion === 'desmarcar') {
    g.confirmado_por_quien_hizo = false;
    g.confirmado_por_titular = false;
    g.estado = g.medico_titular_id && g.medico_que_hizo_id && g.medico_titular_id !== g.medico_que_hizo_id ? ESTADO.ESPERANDO : ESTADO.PREVISTA;
    detalle = 'se desmarcó';
  } else if (accion === 'editar') {
    const d = valor || {};
    const fecha = String(d.fecha || g.fecha);
    const turno = String(d.turno || g.turno);
    const tipo = String(d.tipo || g.tipo);
    if (!esFechaValida_(fecha)) throw new ErrorUsuario('Revisá la fecha.');
    if (!TURNOS[turno]) throw new ErrorUsuario('Revisá el turno.');
    if ([TIPO.CONTRATO, TIPO.HOSPITAL, TIPO.COMPANERO].indexOf(tipo) < 0) throw new ErrorUsuario('Tipo inválido.');
    if (d.hizo && !buscarPorId_('MEDICOS', d.hizo)) throw new ErrorUsuario('No encontré a ese médico.');
    g.fecha = fecha;
    g.turno = turno;
    g.horas = TURNOS[turno].horas;
    g.categoria = categoriaDe_(fecha);
    g.tipo = tipo;
    if (d.hizo) {
      g.medico_que_hizo_id = String(d.hizo);
      if (g.observacion === SIN_CUBRIR) g.observacion = '';
    }
    if (g.observacion !== MARCA_RECLAMO) {
      g.mes_facturacion = mesDe_(fecha);
      g.fecha_cobro = fechaCobro_(g.mes_facturacion);
    }
    detalle = 'se editó';
  } else {
    throw new ErrorUsuario('Acción desconocida.');
  }
  g.deshacer = '';
  guardar_('GUARDIAS', g);
  sincronizarDeuda_(g);
  marcarMesSucio_(mesAntes);
  marcarMesSucio_(g.mes_facturacion);
  registrar_(jefe.nombre_apellido, 'corregir_guardia', g.id + ' ' + accion);

  const texto = 'guardia del ' + fechaCorta_(g.fecha) + ' de ' + nombreDe_(g.medico_que_hizo_id || g.medico_titular_id) + ': ' + detalle + '.';
  const corregidos = {};
  [mesAntes, g.mes_facturacion].forEach(function (mes) { if (mesEntregado_(mes)) corregidos[mes] = true; });
  Object.keys(corregidos).forEach(function (mes) {
    try {
      enviarCorregido_(mes, texto);
    } catch (e) {
      // La edición ya quedó hecha: el Excel se reintenta en la próxima pasada de los automatismos.
      const c = filaCierre_(mes);
      c.regeneracion_pendiente = texto;
      guardar_('CIERRES', c);
      registrar_('sistema', 'error_corregido', e.message);
    }
  });
  [g.medico_que_hizo_id, g.medico_titular_id].forEach(function (id, i, lista) {
    if (!id || lista.indexOf(id) !== i || id === jefe.id) return;
    const m = buscarPorId_('MEDICOS', id);
    if (m) avisar_(m, 'Se corrigió tu ' + texto, null, { sinRegla: true, asunto: 'Guardia corregida' });
  });
  return { corregidos: Object.keys(corregidos) };
}

function apiVistaExcel_(jefe, a) {
  const mes = mesPedido_(a);
  return {
    mes: mes,
    titulo: tituloExcel_(mes),
    titulo_mes: capital_(nombreMesAnio_(mes)),
    estado: (filaCierre_(mes) || { estado: 'SIN ABRIR' }).estado,
    corte: fechaCorte_(mes),
    filas: filasExcel_(mes),
    para_mirar: paraMirar_(mes),
    archivo_url: (filaCierre_(mes) || {}).archivo_url || '',
    archivo: nombreArchivoExcel_(mes),
    cobro: fechaCobroCorta_(fechaCobro_(mes))
  };
}

function apiDescargarExcel_(jefe, a) {
  const mes = mesPedido_(a);
  return { nombre: nombreArchivoExcel_(mes), base64: Utilities.base64Encode(bytesConSigno_(construirXlsx_([mes]))) };
}

function apiDescargarAcumulado_() {
  const meses = mesesConReemplazos_();
  if (!meses.length) throw new ErrorUsuario('Todavía no hay reemplazos confirmados.');
  return { nombre: 'Reemplazos_Guardias_Acumulado.xlsx', base64: Utilities.base64Encode(bytesConSigno_(construirXlsx_(meses))) };
}

function apiMedicos_() {
  const fijas = fijasVigentes_();
  return {
    medicos: medicos_(true).map(function (m) {
      return {
        id: m.id, nombre: m.nombre_apellido, email: m.email, activo: esSi_(m.activo), baja: m.activo === ESTADO_BAJA, admin: esSi_(m.es_admin),
        telegram: !!m.telegram_chat_id, pin_pendiente: /^\d{4}$/.test(m.pin),
        vinculo: vinculoDe_(m), registro_completo: registroCompleto_(m) && tienePinPropio_(m),
        fijas: fijas.filter(function (f) { return f.medico_id === m.id; }).map(function (f) {
          return { dia_semana: normalizarDia_(f.dia_semana), turno: f.turno, tipo: f.tipo || TIPO.CONTRATO };
        })
      };
    }).sort(function (a, b) {
      if (a.baja !== b.baja) return a.baja ? 1 : -1;
      return a.nombre < b.nombre ? -1 : 1;
    }),
    dias: DIAS.slice(1).concat(DIAS[0]),
    turnos: Object.keys(TURNOS).map(function (k) { return { id: k, nombre: TURNOS[k].nombre }; })
  };
}

// Alta o edición. El nombre va en mayúsculas porque sale así en el Excel.
function apiGuardarMedico_(jefe, a) {
  const d = a[0] || {};
  const nombre = String(d.nombre || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (nombre.length < 3) throw new ErrorUsuario('Escribí nombre y apellido.');
  if (d.pin && !/^\d{4}$/.test(String(d.pin))) throw new ErrorUsuario('El PIN tiene que tener 4 números.');
  if (d.email && !/^\S+@\S+\.\S+$/.test(String(d.email))) throw new ErrorUsuario('Revisá el mail.');
  const repetido = filas_('MEDICOS').find(function (m) { return m.nombre_apellido === nombre && m.id !== String(d.id || ''); });
  if (repetido) throw new ErrorUsuario('Ya hay un médico con ese nombre.');
  let m;
  if (d.id) {
    m = buscarPorId_('MEDICOS', d.id);
    if (!m) throw new ErrorUsuario('No encontré a ese médico.');
    if (m.id === jefe.id && (d.admin === false || d.activo === false)) throw new ErrorUsuario('No podés quitarte a vos mismo el acceso de administrador.');
    m.nombre_apellido = nombre;
    m.email = String(d.email || '');
    const estabaActivo = esSi_(m.activo);
    // Una baja sigue siendo baja si no se la reactiva a propósito.
    if (d.activo !== undefined) m.activo = d.activo ? true : (m.activo === ESTADO_BAJA ? ESTADO_BAJA : false);
    if (d.baja === true && m.id !== jefe.id) m.activo = ESTADO_BAJA;
    if (d.admin !== undefined) m.es_admin = !!d.admin;
    if (d.pin) {
      m.pin = hashPin_(m.id, String(d.pin));
      m.pin_propio = false; // al entrar tiene que elegir uno propio
      setPropiedad_('pin_' + m.id, '{}');
    }
    guardar_('MEDICOS', m);
    if (d.vinculo) cambiarVinculo_(m, d.vinculo, jefe.nombre_apellido);
    // Mientras estuvo inactivo no se le crearon guardias: al activarlo, desde hoy en adelante.
    if (!estabaActivo && esSi_(m.activo)) sembrarDesdeHoy_(m.id);
  } else {
    if (!d.pin) throw new ErrorUsuario('Poné un PIN de 4 números.');
    const id = siguienteId_('MEDICOS');
    m = insertar_('MEDICOS', {
      id: id, nombre_apellido: nombre, pin: hashPin_(id, String(d.pin)), email: String(d.email || ''),
      telegram_chat_id: '', activo: true, es_admin: !!d.admin, vinculo: d.vinculo === VINCULO.SOLO ? VINCULO.SOLO : VINCULO.CONTRATO,
      pin_propio: false, contrato_revisado: false
    });
  }
  registrar_(jefe.nombre_apellido, d.id ? 'editar_medico' : 'alta_medico', nombre);
  return { id: m.id };
}

function apiGuardarFijaDe_(jefe, a) {
  const medicoId = String(a[0]);
  if (!buscarPorId_('MEDICOS', medicoId)) throw new ErrorUsuario('No encontré a ese médico.');
  guardarFija_(medicoId, a[1] || []);
  registrar_(jefe.nombre_apellido, 'guardar_fija', nombreDe_(medicoId));
  return { ok: true };
}

const CONFIG_EDITABLE = ['hora_recordatorio', 'dia_corte', 'hora_excel', 'valor_guardia_12', 'valor_guardia_24', 'url_app'];

function apiAjustes_() {
  return {
    config: filas_('CONFIG').filter(function (c) { return CONFIG_EDITABLE.indexOf(c.clave) >= 0; })
      .map(function (c) { return { clave: c.clave, valor: c.valor, ayuda: c.para_que_sirve }; }),
    feriados: filas_('FERIADOS').filter(function (f) { return f.estado !== 'borrado'; })
      .map(function (f) { return { fecha: f.fecha, nombre: f.nombre, tipo: f.tipo }; })
      .sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; })
  };
}

function apiGuardarConfig_(jefe, a) {
  const clave = String(a[0]);
  const valor = String(a[1] === undefined ? '' : a[1]).trim();
  if (CONFIG_EDITABLE.indexOf(clave) < 0) throw new ErrorUsuario('Ese ajuste no se puede cambiar.');
  if (/^hora_/.test(clave) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(valor)) throw new ErrorUsuario('Escribí la hora como 08:00.');
  if (clave === 'dia_corte' && !/^([1-9]|1\d|2[0-8])$/.test(valor)) throw new ErrorUsuario('Elegí un día entre 1 y 28.');
  if (clave === 'url_app' && valor && !/^https:\/\//.test(valor)) throw new ErrorUsuario('La dirección tiene que empezar con https://');
  setCfg_(clave, valor);
  registrar_(jefe.nombre_apellido, 'config', clave + ' = ' + valor);
  return apiAjustes_();
}

function recalcularCategorias_() {
  filas_('GUARDIAS').filter(function (g) { return g.estado !== ESTADO.ANULADA && !mesEntregado_(g.mes_facturacion); }).forEach(function (g) {
    const cat = categoriaDe_(g.fecha);
    const cobro = fechaCobro_(g.mes_facturacion);
    if (cat !== g.categoria || cobro !== g.fecha_cobro) {
      g.categoria = cat;
      g.fecha_cobro = cobro;
      guardar_('GUARDIAS', g);
      sincronizarDeuda_(g);
      marcarMesSucio_(g.mes_facturacion);
    }
  });
}

function apiGuardarFeriado_(jefe, a) {
  const d = a[0] || {};
  if (!esFechaValida_(String(d.fecha))) throw new ErrorUsuario('Revisá la fecha.');
  if (!String(d.nombre || '').trim()) throw new ErrorUsuario('Escribí el nombre del feriado.');
  const tipo = ['inamovible', 'trasladable', 'no laborable'].indexOf(d.tipo) >= 0 ? d.tipo : 'inamovible';
  const f = filas_('FERIADOS').find(function (x) { return x.fecha === d.fecha; });
  if (f) {
    f.nombre = String(d.nombre).trim();
    f.tipo = tipo;
    f.estado = 'vigente';
    guardar_('FERIADOS', f);
  } else {
    insertar_('FERIADOS', { fecha: d.fecha, nombre: String(d.nombre).trim(), tipo: tipo, estado: 'vigente' });
  }
  recalcularCategorias_();
  registrar_(jefe.nombre_apellido, 'feriado', d.fecha + ' ' + d.nombre);
  return apiAjustes_();
}

function apiBorrarFeriado_(jefe, a) {
  const f = filas_('FERIADOS').find(function (x) { return x.fecha === String(a[0]) && x.estado !== 'borrado'; });
  if (!f) throw new ErrorUsuario('No encontré ese feriado.');
  f.estado = 'borrado';
  guardar_('FERIADOS', f);
  recalcularCategorias_();
  registrar_(jefe.nombre_apellido, 'borrar_feriado', String(a[0]));
  return apiAjustes_();
}
