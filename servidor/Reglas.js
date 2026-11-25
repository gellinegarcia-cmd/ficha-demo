// Reglas de negocio puras (sección 4 del documento).

function conjuntoFeriados_() {
  const s = {};
  filas_('FERIADOS').forEach(function (f) { if (f.fecha && f.estado !== 'borrado') s[f.fecha] = true; });
  return s;
}

// La categoría se define por la fecha de inicio de la guardia.
function categoriaDe_(fecha) {
  const d = diaSemana_(fecha);
  return d === 0 || d === 6 || conjuntoFeriados_()[fecha] ? 'NO_HABIL' : 'HABIL';
}

// Segundo día hábil del mes M+2 (sin sábados, domingos ni FERIADOS).
function fechaCobro_(mesTrabajado) {
  const feriados = conjuntoFeriados_();
  let contados = 0;
  for (let f = sumarMeses_(mesTrabajado, 2) + '-01'; ; f = sumarDias_(f, 1)) {
    const d = diaSemana_(f);
    if (d !== 0 && d !== 6 && !feriados[f] && ++contados === 2) return f;
  }
}

// Supuesto: día 08-20, noche 20-08, 24 h 08-08. Por eso solo se pisan guardias de la misma fecha.
function turnosSePisan_(a, b) { return a === b || a === '24H' || b === '24H'; }

// Ausencia de ese día: 'TODO' (el día entero), '12H_DIA' o '12H_NOCHE' (un solo turno), o '' si no está ausente.
function ausenciaDelDia_(medicoId, fecha) {
  let parte = '';
  filas_('VACACIONES').forEach(function (v) {
    if (v.estado === 'cancelada' || v.medico_id !== String(medicoId) || !(v.desde <= fecha && fecha <= v.hasta)) return;
    const t = v.turno === '12H_DIA' || v.turno === '12H_NOCHE' ? v.turno : 'TODO';
    parte = parte === 'TODO' || t === 'TODO' || (parte && parte !== t) ? 'TODO' : t;
  });
  return parte;
}
// Sin turno: si ese día tiene alguna ausencia. Con turno: si ese turno se pisa con la ausencia.
function estaDeVacaciones_(medicoId, fecha, turno) {
  const parte = ausenciaDelDia_(medicoId, fecha);
  if (!parte) return false;
  if (!turno || parte === 'TODO') return true;
  return turnosSePisan_(parte, turno);
}

// Vacaciones o licencia -> paga el hospital. Cambio personal -> paga el compañero. Sin titular -> hospital.
function sugerirTipo_(titularId, fecha) {
  if (!titularId) return TIPO.HOSPITAL;
  return estaDeVacaciones_(titularId, fecha) ? TIPO.HOSPITAL : TIPO.COMPANERO;
}

function guardiasActivas_(mes) {
  return filas_('GUARDIAS').filter(function (g) {
    return g.estado !== ESTADO.ANULADA && (!mes || mesDe_(g.fecha) === mes || g.mes_facturacion === mes);
  });
}

// Mismo puesto reclamado por dos médicos. La UTI tiene varios médicos por turno, así que
// "misma fecha y turno" solo es conflicto si es el mismo puesto (mismo titular).
function puestosEnDoble_(guardias) {
  const porPuesto = {};
  guardias.forEach(function (g) {
    if (!g.medico_titular_id || g.estado === ESTADO.ANULADA || controlAdverso_(g)) return;
    const k = g.fecha + '|' + g.turno + '|' + g.medico_titular_id;
    (porPuesto[k] = porPuesto[k] || []).push(g);
  });
  return Object.keys(porPuesto).map(function (k) { return porPuesto[k]; }).filter(function (gs) {
    const quienes = {};
    gs.forEach(function (g) { if (g.medico_que_hizo_id) quienes[g.medico_que_hizo_id] = 1; });
    return gs.length > 1 && Object.keys(quienes).length > 1;
  });
}

function idsEnDoble_() {
  const ids = {};
  puestosEnDoble_(filas_('GUARDIAS')).forEach(function (gs) { gs.forEach(function (g) { ids[g.id] = true; }); });
  return ids;
}

// Conflictos de la sección 4. Se calculan siempre sobre los datos, no se guardan.
function detectarConflictos_(mes) {
  const hoyStr = hoy_();
  const guardias = guardiasActivas_(mes).filter(function (g) { return mesDe_(g.fecha) === mes; });
  const lista = [];
  const add = function (tipo, texto, gs) {
    lista.push({ tipo: tipo, texto: texto, guardias: gs.map(function (g) { return g.id; }) });
  };

  puestosEnDoble_(guardias).forEach(function (gs) {
    const quienes = {};
    gs.forEach(function (g) { quienes[g.medico_que_hizo_id] = 1; });
    add('DOBLE', 'Dos médicos en el mismo puesto el ' + fechaCorta_(gs[0].fecha) + ': ' +
      Object.keys(quienes).filter(Boolean).map(nombreDe_).join(' y '), gs);
  });

  guardias.forEach(function (g) {
    if (g.estado === ESTADO.PREVISTA && !g.medico_que_hizo_id) {
      add('SIN_CUBRIR', 'Guardia de ' + nombreDe_(g.medico_titular_id) + ' del ' + fechaCorta_(g.fecha) + ' sin cubrir', [g]);
    } else if (g.estado === ESTADO.PREVISTA && g.fecha < hoyStr) {
      add('SIN_CONFIRMAR', 'Guardia de ' + nombreDe_(g.medico_titular_id) + ' del ' + fechaCorta_(g.fecha) + ' sin confirmar', [g]);
    } else if (g.estado === ESTADO.ESPERANDO) {
      const falta = !g.medico_que_hizo_id ? 'falta saber quién la hizo'
        : !esSi_(g.confirmado_por_quien_hizo) ? 'falta confirmar ' + nombreDe_(g.medico_que_hizo_id)
          : 'falta confirmar ' + nombreDe_(g.medico_titular_id);
      add('UNA_PARTE', 'Cobertura del ' + fechaCorta_(g.fecha) + ' confirmada por una sola parte: ' + falta, [g]);
    } else if (g.estado === ESTADO.CONFLICTO) {
      add('RECHAZADA', 'Cobertura del ' + fechaCorta_(g.fecha) + ' rechazada: ' + nombreDe_(g.medico_titular_id) +
        ' dice que la hizo ' + nombreDe_(g.medico_que_hizo_id), [g]);
    }
  });

  const porMedico = {};
  guardias.forEach(function (g) {
    if (!g.medico_que_hizo_id) return;
    const k = g.medico_que_hizo_id + '|' + g.fecha;
    (porMedico[k] = porMedico[k] || []).push(g);
  });
  Object.keys(porMedico).forEach(function (k) {
    const gs = porMedico[k];
    for (let i = 0; i < gs.length; i++) {
      for (let j = i + 1; j < gs.length; j++) {
        if (turnosSePisan_(gs[i].turno, gs[j].turno)) {
          add('SUPERPUESTA', nombreDe_(gs[i].medico_que_hizo_id) + ' tiene dos guardias superpuestas el ' + fechaCorta_(gs[i].fecha), [gs[i], gs[j]]);
        }
      }
    }
  });
  return lista;
}
