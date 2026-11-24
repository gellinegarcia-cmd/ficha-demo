// Automatismos. Un único disparador corre tick() cada 15 minutos: mira la hora y ejecuta lo que
// corresponde. Cada tarea recuerda cuándo se hizo, así no se repite, y si Google no corrió el
// disparador a horario se hace en la pasada siguiente. Nada de esto requiere la intervención del jefe.

// CONFIG.primer_mes (ej. 2026-12): los meses anteriores no se cierran ni generan Excel solos (se hicieron a mano).
function mesAutomatico_(m) { const p = cfg_('primer_mes'); return !p || m >= p; }

function yaHecho_(clave, valor) { return propiedad_('job_' + clave) === valor; }
function marcarHecho_(clave, valor) { setPropiedad_('job_' + clave, valor); }

function tick() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    reiniciarEstado_();
    correrTareas_();
    try { refrescarMesesSucios_(); } catch (e) { console.error(e); }
  } finally {
    lock.releaseLock();
  }
}

function correrTareas_() {
  const fecha = hoy_();
  const hora = horaActual_();
  const mes = mesDe_(fecha);
  const previo = sumarMeses_(mes, -1);
  const tareas = [
    function () {
      // A las 00:00 del corte el mes ya está cerrado por fecha: acá se hace el pase al mes siguiente.
      [previo, mes].forEach(function (m) {
        const c = filaCierre_(m);
        if (c && c.estado === 'ABIERTO' && mesCerrado_(m) && mesAutomatico_(m)) cerrarMes_(m);
      });
    },
    function () {
      if (hora >= '00:05' && !yaHecho_('abrir', mes) && !mesCerrado_(mes)) { tareaAbrirMes_(mes); marcarHecho_('abrir', mes); }
    },
    function () {
      // El día de corte a las 08:00 llega el Excel, solo. Si falla, se reintenta en la pasada siguiente.
      [previo, mes].forEach(function (m) {
        const c = filaCierre_(m);
        if (c && c.estado === 'CERRADO' && mesAutomatico_(m) && (fecha > fechaCorte_(m) || hora >= cfg_('hora_excel', '08:00'))) entregarExcelMensual_(m);
      });
    },
    function () {
      if (hora >= cfg_('hora_recordatorio', '08:00') && !yaHecho_('diario', fecha)) { tareaRecordatorioDiario_(fecha); marcarHecho_('diario', fecha); }
    },
    function () {
      if (hora >= cfg_('hora_recordatorio', '08:00') && !yaHecho_('libres', fecha)) { tareaLibresSinTomar_(fecha); marcarHecho_('libres', fecha); }
    },
    function () {
      if (hora >= cfg_('hora_recordatorio', '08:00') && !yaHecho_('conflictos', fecha)) { tareaAvisarConflictos_(fecha); marcarHecho_('conflictos', fecha); }
    },
    function () {
      // Recordatorios de la ventana de cierre: 7 días antes y 1 día antes del corte.
      if (hora < cfg_('hora_recordatorio', '08:00')) return;
      [mes, sumarMeses_(mes, 1)].forEach(function (m) {
        const corte = fechaCorte_(m);
        if (!mesAutomatico_(m)) return;
        if (fecha === sumarDias_(corte, -7) && !yaHecho_('ventana', m)) { tareaAbrirVentana_(m); marcarHecho_('ventana', m); }
        if (fecha === sumarDias_(corte, -1) && !yaHecho_('aviso', m)) { tareaAvisoPrevio_(m); marcarHecho_('aviso', m); }
      });
    },
    function () {
      if (hora >= cfg_('hora_recordatorio', '08:00') && fecha === fechaCobro_(sumarMeses_(mes, -2)) && !yaHecho_('cobro', fecha)) {
        tareaDiaDeCobro_(fecha);
        marcarHecho_('cobro', fecha);
      }
    },
    function () {
      filas_('CIERRES').filter(function (c) { return c.regeneracion_pendiente && mesAutomatico_(c.mes); }).forEach(function (c) {
        enviarCorregido_(c.mes, c.regeneracion_pendiente);
      });
    }
  ];
  // Si una tarea falla, las otras igual corren; la fallida se reintenta en 15 minutos.
  tareas.forEach(function (t) {
    try { t(); } catch (e) { registrar_('sistema', 'error_tarea', e.message); }
  });
}

function tareaAbrirVentana_(mes) {
  const dia = Number(fechaCorte_(mes).slice(8));
  const texto = 'El ' + dia + ' se cierra el mes. Confirmá desde ahora tus guardias del ' + dia + ' al ' + Number(ultimoDia_(mes).slice(8)) + '.';
  medicos_().forEach(function (m) {
    // Un médico de reemplazos solo recibe el aviso si tiene algo previsto entre el corte y fin de mes.
    if (esSoloReemplazo_(m) && !filas_('GUARDIAS').some(function (g) {
      return g.medico_que_hizo_id === m.id && g.estado === ESTADO.PREVISTA && mesDe_(g.fecha) === mes && esAnticipable_(g.fecha);
    })) return;
    avisar_(m, texto, [[botonVista_('Ver mis guardias', 'mes')]], { asunto: 'Cierre de ' + nombreMes_(mes) });
  });
}

function tareaAbrirMes_(mes) {
  abrirMes_(mes);
  const texto = 'Se abrió ' + nombreMes_(mes) + '. Revisá tus guardias y cargá tus vacaciones.';
  medicos_().forEach(function (m) {
    if (esSoloReemplazo_(m) && !tieneGuardiasEnMes_(m, mes)) return;
    avisar_(m, texto, [[botonVista_('Ver mi mes', 'mes')]], { asunto: 'Se abrió ' + nombreMes_(mes) });
  });
}

function tieneGuardiasEnMes_(m, mes) {
  return filas_('GUARDIAS').some(function (g) {
    return g.estado !== ESTADO.ANULADA && mesDe_(g.fecha) === mes && (g.medico_que_hizo_id === m.id || g.medico_titular_id === m.id);
  });
}

// A quien hace la guardia ese día: el titular, o quien cargó que lo va a cubrir.
// Una guardia confirmada por adelantado se controla ese día.
function tareaRecordatorioDiario_(fecha) {
  filas_('GUARDIAS').filter(function (g) {
    return g.fecha === fecha && g.medico_que_hizo_id && (g.estado === ESTADO.PREVISTA || controlPendiente_(g));
  }).forEach(function (g) {
    const m = buscarPorId_('MEDICOS', g.medico_que_hizo_id);
    if (!m || !esSi_(m.activo)) return;
    if (g.estado === ESTADO.ANTICIPADA) {
      avisar_(m, '¿Hiciste la guardia de hoy?', botonesControl_(g), { asunto: '¿Hiciste la guardia de hoy?' });
      return;
    }
    const texto = 'Hoy tenés ' + (esSoloReemplazo_(m) ? 'reemplazo' : 'guardia') + ' de ' + TURNOS[g.turno].nombre + ' (' + (g.categoria === 'NO_HABIL' ? 'no hábil' : 'hábil') + ')';
    if (g.medico_que_hizo_id === g.medico_titular_id) {
      avisar_(m, texto + '.', esSoloReemplazo_(m) ? botonesReemplazoSolo_(g) : botonesConfirmar_(g), { asunto: 'Hoy tenés guardia' });
    } else {
      const titular = g.origen === ORIGEN.AUSENCIA ? ': la guardia libre que tomaste' : g.medico_titular_id ? ': cubrís a ' + nombreDe_(g.medico_titular_id) : ': puesto vacante';
      avisar_(m, texto + titular + '. ¿La hacés?', botonesSiNo_(g), { asunto: 'Hoy tenés guardia' });
    }
  });
}

// Guardias que todavía esperan una respuesta de ese médico, incluidas las que pasaron como reclamo.
function pendientesDe_(m, mes) {
  const hoyStr = hoy_();
  return filas_('GUARDIAS').filter(function (g) {
    const esHizo = g.medico_que_hizo_id === m.id;
    if (esHizo && controlPendiente_(g)) return true;
    if (mesDe_(g.fecha) !== mes && g.mes_facturacion !== mes) return false;
    if (g.estado === ESTADO.ANULADA || estaConfirmada_(g)) return false;
    const esTitular = g.medico_titular_id === m.id;
    if (g.estado === ESTADO.PREVISTA) {
      if (esHizo) return g.fecha <= hoyStr;
      return esTitular && !!g.medico_que_hizo_id && !esSi_(g.confirmado_por_titular);
    }
    if (g.estado === ESTADO.ESPERANDO) {
      return (esHizo && !esSi_(g.confirmado_por_quien_hizo)) || (esTitular && !esSi_(g.confirmado_por_titular));
    }
    return esHizo || esTitular; // en conflicto
  });
}

function tareaAvisoPrevio_(mes) {
  medicos_().forEach(function (m) {
    const n = pendientesDe_(m, mes).length + filas_('GUARDIAS').filter(function (g) {
      return g.estado === ESTADO.PREVISTA && g.medico_que_hizo_id === m.id && esAnticipable_(g.fecha);
    }).length;
    if (!n) return;
    avisar_(m, 'Te ' + (n === 1 ? 'queda 1 guardia' : 'quedan ' + n + ' guardias') + ' sin confirmar. Lo que no confirmes antes del cierre se cobra recién el mes siguiente.',
      [[botonVista_('Ver mi mes', 'mes')]], { asunto: 'Guardias sin confirmar' });
  });
}

// Dos en el mismo puesto o cobertura rechazada: aviso a los dos cada 48 h hasta que lo resuelvan.
function tareaAvisarConflictos_(fecha) {
  const meses = {};
  filas_('GUARDIAS').forEach(function (g) {
    if (g.estado !== ESTADO.ANULADA && !mesCerrado_(g.mes_facturacion)) meses[mesDe_(g.fecha)] = true;
  });
  Object.keys(meses).forEach(function (mes) {
    detectarConflictos_(mes).filter(function (c) { return c.tipo === 'DOBLE' || c.tipo === 'RECHAZADA'; }).forEach(function (c) {
      const gs = c.guardias.map(function (id) { return buscarPorId_('GUARDIAS', id); });
      const ultimo = gs.map(function (g) { return g.ultimo_aviso_conflicto; }).filter(Boolean).sort().pop();
      if (ultimo && aUTC_(fecha) - aUTC_(ultimo) < 2 * 86400000) return;
      const involucrados = {};
      gs.forEach(function (g) {
        if (g.medico_que_hizo_id) involucrados[g.medico_que_hizo_id] = true;
        if (c.tipo === 'RECHAZADA' && g.medico_titular_id) involucrados[g.medico_titular_id] = true;
      });
      Object.keys(involucrados).forEach(function (id) {
        const m = buscarPorId_('MEDICOS', id);
        if (m) {
          avisar_(m, 'Conflicto sin resolver. ' + c.texto + '. Resolvanlo entre ustedes: el que no corresponda, editá o anulá. Hasta entonces no entra al Excel.',
            [[botonVista_('Ver la guardia', 'confirmar', gs[0].id)]], { asunto: 'Conflicto de guardia sin resolver' });
        }
      });
      gs.forEach(function (g) { g.ultimo_aviso_conflicto = fecha; guardar_('GUARDIAS', g); });
    });
  });
}

function tareaDiaDeCobro_(fecha) {
  filas_('DEUDAS').filter(function (d) { return d.estado === 'pendiente' && d.fecha_pago_sugerida <= fecha; }).forEach(function (d) {
    const g = buscarPorId_('GUARDIAS', d.guardia_id);
    const deudor = buscarPorId_('MEDICOS', d.deudor_id);
    const acreedor = buscarPorId_('MEDICOS', d.acreedor_id);
    if (!g || !deudor || !acreedor) return;
    avisar_(deudor, 'Hoy cobrás. Le debés a ' + acreedor.nombre_apellido + ' la guardia del ' + fechaCorta_(g.fecha) + '.',
      [[botonVista_('Ver deudas', 'deudas')]], { asunto: 'Hoy cobrás: deuda con un compañero', sinRegla: true });
    avisar_(acreedor, 'Hoy cobra ' + deudor.nombre_apellido + ' y te debe la guardia del ' + fechaCorta_(g.fecha) + '.',
      [[{ texto: 'Recibí el pago', data: 'Y:' + d.id, vista: 'deudas' }]], { asunto: 'Te tienen que pagar una guardia', sinRegla: true });
  });
}

// Lo que no llegó confirmado por ambas partes no entra y pasa al mes siguiente como reclamo.
// Las guardias de contrato sin confirmar no se pagan, así que no hay nada que reclamar.
function cerrarMes_(mes) {
  let c = filaCierre_(mes);
  if (!c) c = insertar_('CIERRES', { mes: mes, estado: 'ABIERTO' });
  if (c.estado !== 'ABIERTO') return c;
  c.estado = 'CERRADO';
  c.cerrado_en = marcaTiempo_();
  guardar_('CIERRES', c);

  const siguiente = sumarMeses_(mes, 1);
  const enDoble = idsEnDoble_();
  const pasaron = {};
  filas_('GUARDIAS').filter(function (g) { return g.mes_facturacion === mes && g.estado !== ESTADO.ANULADA; }).forEach(function (g) {
    // Por si cambiaron los FERIADOS.
    g.categoria = categoriaDe_(g.fecha);
    g.fecha_cobro = fechaCobro_(mes);
    const reclamada = g.medico_que_hizo_id || esSi_(g.confirmado_por_titular);
    if (g.tipo !== TIPO.CONTRATO && reclamada && (!estaConfirmada_(g) || enDoble[g.id])) {
      g.mes_facturacion = siguiente;
      g.fecha_cobro = fechaCobro_(siguiente);
      g.observacion = MARCA_RECLAMO;
      [g.medico_que_hizo_id, g.medico_titular_id].forEach(function (id) {
        if (id) pasaron[id] = (pasaron[id] || 0) + 1;
      });
    }
    guardar_('GUARDIAS', g);
    sincronizarDeuda_(g);
  });
  marcarMesSucio_(mes);
  marcarMesSucio_(siguiente);
  registrar_('sistema', 'cerrar_mes', mes);
  Object.keys(pasaron).forEach(function (id) {
    const m = buscarPorId_('MEDICOS', id);
    if (m) {
      avisar_(m, 'Cerró ' + nombreMes_(mes) + '. ' + (pasaron[id] === 1 ? '1 guardia sin resolver pasó' : pasaron[id] + ' guardias sin resolver pasaron') +
        ' a ' + nombreMes_(siguiente) + ' como "reclamo mes anterior".', [[botonVista_('Ver mi mes', 'mes')]], { asunto: 'Guardias que pasaron a ' + nombreMes_(siguiente), sinRegla: true });
    }
  });
  return c;
}

// La lista corta del mail. Los reemplazos fijos no figuran: se repiten todos los meses.
function paraMirar_(mes) {
  const guardias = filas_('GUARDIAS');
  const lineas = [];
  filasExcel_(mes).forEach(function (f) {
    const g = buscarPorId_('GUARDIAS', f.guardia_id);
    const prefijo = fechaCorta_(f.fecha) + ', ' + f.nombre + ': ';
    if (!g.medico_titular_id) lineas.push(prefijo + 'puesto vacante, sin contraparte que lo confirme.');
    if (f.reclamo) lineas.push(prefijo + 'reclamo mes anterior.');
    if (estaDeVacaciones_(g.medico_que_hizo_id, f.fecha)) lineas.push(prefijo + 'posible error de fecha: ese día figura de vacaciones o licencia.');
    guardias.forEach(function (o) {
      if (o.id === g.id || o.estado === ESTADO.ANULADA || o.medico_que_hizo_id !== g.medico_que_hizo_id) return;
      if (o.fecha === g.fecha && turnosSePisan_(o.turno, g.turno)) lineas.push(prefijo + 'posible error de fecha: otra guardia superpuesta ese día.');
      // Ej.: una guardia fija del domingo sin confirmar y un reemplazo igual cargado el lunes.
      const contigua = o.fecha === sumarDias_(g.fecha, -1) || o.fecha === sumarDias_(g.fecha, 1);
      if (contigua && o.estado === ESTADO.PREVISTA && o.horas === g.horas) {
        lineas.push(prefijo + 'posible error de fecha: tiene sin confirmar una guardia igual el ' + fechaCorta_(o.fecha) + '.');
      }
    });
  });
  filas_('AJUSTES').filter(function (a) { return a.mes_aviso === mes && a.estado === 'activo'; }).forEach(function (a) {
    lineas.push('Ajuste mes anterior: ' + fechaCorta_(a.fecha_guardia) + ', ' + nombreDe_(a.medico_id) + ' (Excel de ' + nombreMes_(a.mes_origen) + '). ' + a.motivo);
  });
  // Solo las que salieron en el Excel: las de contrato no tienen fila que descontar.
  const anterior = guardias.filter(function (g) {
    return g.estado === ESTADO.ANTICIPADA && g.tipo === TIPO.HOSPITAL && g.mes_facturacion === sumarMeses_(mes, -1);
  });
  if (anterior.length) {
    const conAjuste = anterior.filter(controlAdverso_).length;
    const sinResponder = anterior.filter(function (g) { return !g.control_anticipada; }).length;
    lineas.push('Anticipadas del mes anterior: ' + (anterior.length - conAjuste) + ' confirmadas, ' + conAjuste + ' con ajuste' +
      (sinResponder ? ' (' + sinResponder + ' sin responder)' : '') + '.');
  }
  return lineas;
}

// Dos partes y nada más: el Excel con su link, y "Para mirar".
function cuerpoMailExcel_(lineas, archivo, encabezado) {
  const texto = (encabezado ? encabezado + '\n\n' : '') + 'Excel adjunto y en Drive: ' + archivo.webViewLink + '\n\nPara mirar:\n' +
    (lineas.length ? lineas.map(function (l) { return '- ' + l; }).join('\n') : 'Sin observaciones.');
  const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">' +
    (encabezado ? '<p><b>' + escaparXml_(encabezado) + '</b></p>' : '') +
    '<p>Excel adjunto y en <a href="' + escaparXml_(archivo.webViewLink) + '">Drive</a>.</p><p><b>Para mirar:</b></p>' +
    (lineas.length ? '<ul>' + lineas.map(function (l) { return '<li>' + escaparXml_(l) + '</li>'; }).join('') + '</ul>' : '<p>Sin observaciones.</p>') +
    '</div>';
  return { texto: texto, html: html };
}

// Guarda en Drive y manda el mail. Si el mail falla, quita el archivo para no dejar copias al reintentar.
function entregarExcel_(mes, op) {
  op = op || {};
  const blob = blobExcel_(mes, op.nombre);
  const archivo = guardarEnDrive_(blob);
  const cuerpo = cuerpoMailExcel_(paraMirar_(mes), archivo, op.encabezado);
  try {
    MailApp.sendEmail({
      to: MAIL_REVISION,
      subject: (op.prefijoAsunto || '') + 'Reemplazos ' + nombreMesAnio_(mes) + ' listos para revisar',
      body: cuerpo.texto,
      htmlBody: cuerpo.html,
      attachments: [blob],
      name: 'Fichá'
    });
  } catch (e) {
    try { borrarDeDrive_(archivo.id); } catch (e2) { console.error(e2); }
    throw e;
  }
  return archivo;
}

function entregarExcelMensual_(mes) {
  const c = filaCierre_(mes);
  const filas = filasExcel_(mes);
  const archivo = entregarExcel_(mes);
  c.estado = 'ENTREGADO';
  c.entregado_en = marcaTiempo_();
  c.filas_excel = filas.length;
  c.archivo_url = archivo.webViewLink;
  guardar_('CIERRES', c);
  registrar_('sistema', 'entregar_excel', mes + ': ' + filas.length + ' filas');

  const avisados = {};
  filas.forEach(function (f) {
    const id = buscarPorId_('GUARDIAS', f.guardia_id).medico_que_hizo_id;
    if (avisados[id]) return;
    avisados[id] = true;
    const m = buscarPorId_('MEDICOS', id);
    if (m) {
      avisar_(m, 'Tus reemplazos de ' + nombreMes_(mes) + ' fueron enviados al jefe de servicio para su revisión.', null,
        { asunto: 'Reemplazos de ' + nombreMes_(mes), sinRegla: true });
    }
  });
}

// Si el jefe edita un mes ya entregado, llega el Excel de nuevo. La versión anterior queda en Drive.
function enviarCorregido_(mes, detalle) {
  const c = filaCierre_(mes);
  const n = (Number(c.correcciones) || 0) + 1;
  const archivo = entregarExcel_(mes, {
    prefijoAsunto: 'CORREGIDO: ',
    nombre: nombreArchivoExcel_(mes).replace('.xlsx', '_CORREGIDO_' + n + '.xlsx'),
    encabezado: 'Corregido: ' + detalle
  });
  c.correcciones = n;
  c.archivo_url = archivo.webViewLink;
  c.filas_excel = filasExcel_(mes).length;
  c.regeneracion_pendiente = '';
  guardar_('CIERRES', c);
  registrar_('sistema', 'excel_corregido', mes + ' versión ' + n);
}
