// Entrada de la web app: acceso con PIN y API que usan las pantallas.

const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 15;
const MAX_INTENTOS_DIA = 20;
const DIAS_SESION = 30;

function doGet(e) {
  const p = (e && e.parameter) || {};
  const t = HtmlService.createTemplateFromFile('Index');
  // Solo se pasan valores con forma conocida: esto se inyecta en la página.
  t.inicio = JSON.stringify({
    v: /^[a-z]{1,20}$/.test(p.v || '') ? p.v : '',
    g: /^\d{1,9}$/.test(p.g || '') ? p.g : ''
  });
  return t.evaluate()
    .setTitle('Fichá')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function hashPin_(id, pin) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, propiedad_('SECRETO') + '|' + id + '|' + pin, Utilities.Charset.UTF_8);
  return 'h:' + Utilities.base64Encode(d);
}

function firmaSesion_(id, exp, pinGuardado) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(id + '|' + exp + '|' + pinGuardado, propiedad_('SECRETO')));
}

// La sesión queda firmada con el PIN: si cambia el PIN, se invalidan las sesiones anteriores.
function crearSesion_(m) {
  const exp = ahora_().getTime() + DIAS_SESION * 86400000;
  return [m.id, exp, firmaSesion_(m.id, exp, m.pin)].join('.');
}

function medicoDeSesion_(token) {
  const p = String(token || '').split('.');
  if (p.length !== 3 || Number(p[1]) < ahora_().getTime()) return null;
  const m = buscarPorId_('MEDICOS', p[0]);
  if (!m || !esSi_(m.activo) || firmaSesion_(p[0], p[1], m.pin) !== p[2]) return null;
  return m;
}

function intentosDe_(id) {
  try { return JSON.parse(propiedad_('pin_' + id)) || {}; } catch (e) { return {}; }
}

function medicosPublico() {
  reiniciarEstado_();
  return medicos_().map(function (m) { return { id: m.id, nombre: m.nombre_apellido }; })
    .sort(function (a, b) { return a.nombre < b.nombre ? -1 : 1; });
}

function login(id, pin) {
  reiniciarEstado_();
  return conLock_(function () {
    const m = buscarPorId_('MEDICOS', id);
    if (!m || !esSi_(m.activo)) return { ok: false, error: 'No encontré a ese médico.' };
    const fecha = hoy_();
    const reg = intentosDe_(m.id);
    if (reg.dia !== fecha) { reg.dia = fecha; reg.hoy = 0; reg.seguidos = 0; reg.hasta = 0; }
    const ms = ahora_().getTime();
    if (reg.hoy >= MAX_INTENTOS_DIA) return { ok: false, error: 'Demasiados intentos hoy. Pedile al jefe que revise tu PIN.' };
    if (reg.hasta > ms) return { ok: false, error: 'Demasiados intentos. Probá de nuevo en ' + MINUTOS_BLOQUEO + ' minutos.' };

    const texto = String(pin || '');
    // Un PIN de 4 dígitos en la hoja es uno recién cargado a mano: se cifra al primer ingreso.
    const correcto = /^\d{4}$/.test(m.pin) ? m.pin === texto : !!m.pin && m.pin === hashPin_(m.id, texto);
    if (!correcto) {
      reg.hoy++;
      reg.seguidos++;
      if (reg.seguidos >= MAX_INTENTOS) { reg.hasta = ms + MINUTOS_BLOQUEO * 60000; reg.seguidos = 0; }
      setPropiedad_('pin_' + m.id, JSON.stringify(reg));
      registrar_(m.nombre_apellido, 'pin_incorrecto', '');
      return { ok: false, error: 'PIN incorrecto.' };
    }
    reg.seguidos = 0;
    setPropiedad_('pin_' + m.id, JSON.stringify(reg));
    if (/^\d{4}$/.test(m.pin)) {
      m.pin = hashPin_(m.id, texto);
      guardar_('MEDICOS', m);
    }
    return { ok: true, token: crearSesion_(m) };
  });
}

// Métodos disponibles desde las pantallas. "e" indica que escribe (usa el bloqueo).
function tablaApi_() {
  return {
    inicio: { registro: 1, f: apiInicio_ },
    paquete: { registro: 1, f: function (m, a) { return paquete_(m, a[0]); } },
    registroPin: { registro: 1, e: 1, f: function (m, a) { return crearPinPropio_(m, a[0]); } },
    registroGuardar: { registro: 1, e: 1, f: function (m, a) { if (!tienePinPropio_(m)) throw new ErrorUsuario('Primero creá tu PIN.'); return guardarBorrador_(m, a[0]); } },
    registroResumen: { registro: 1, f: function (m) { return { resumen: resumenRegistro_(m, limpiarBorrador_(borradorDe_(m))), push: pushActivo_(m) }; } },
    guardarPush: { registro: 1, e: 1, f: function (m, a) { guardarPush_(m, a[0], a[1]); return { push: true }; } },
    pushPrueba: { registro: 1, f: function (m) { return pushPrueba_(m); } },
    quitarPush: { e: 1, f: function (m) { quitarPush_(m); return { push: false }; } },
    registroConfirmar: { registro: 1, e: 1, f: function (m) { return confirmarRegistro_(m); } },
    miMes: { f: apiMiMes_ },
    guardia: { f: apiGuardia_ },
    hagoYo: { e: 1, f: function (m, a) { return vistaGuardia_(hagoYo_(m, a[0]), m); } },
    meCubre: { e: 1, f: function (m, a) { return vistaGuardia_(meCubre_(m, a[0], a[1], a[2]), m); } },
    responder: { e: 1, f: function (m, a) { return vistaGuardia_(responderCobertura_(m, a[0], a[1] === true), m); } },
    cargarGuardia: { e: 1, f: function (m, a) { return vistaGuardia_(cargarGuardia_(m, a[0] || {}), m); } },
    candidatos: { f: apiCandidatos_ },
    editarGuardia: { e: 1, f: function (m, a) { return vistaGuardia_(editarGuardia_(m, a[0], a[1] || {}), m); } },
    desmarcarGuardia: { e: 1, f: function (m, a) { return vistaGuardia_(desmarcar_(m, a[0]), m); } },
    anularGuardia: { e: 1, f: function (m, a) { return vistaGuardia_(anularGuardia_(m, a[0]), m); } },
    deshacer: { e: 1, f: function (m, a) { return vistaGuardia_(deshacer_(m, a[0]), m); } },
    responderControl: { e: 1, f: function (m, a) { return vistaGuardia_(responderControl_(m, a[0], a[1], a[2]), m); } },
    vacaciones: { f: apiVacaciones_ },
    libres: { f: apiLibres_ },
    tomarLibre: { e: 1, f: function (m, a) { const g = tomarGuardia_(m, a[0]); return { guardia: vistaGuardia_(g, m), libres: apiLibres_(m) }; } },
    liberarGuardia: { e: 1, f: function (m, a) { return vistaGuardia_(liberarGuardia_(m, a[0], a[1]), m); } },
    servicio: { admin: 1, f: apiServicio_ },
    regenerarCodigoJefe: { admin: 1, e: 1, f: function (m) { regenerarCodigoJefe_(m); return apiServicio_(); } },
    agregarVacaciones: { e: 1, f: function (m, a) { agregarVacaciones_(m, a[0] || {}); return apiVacaciones_(m); } },
    editarVacaciones: { e: 1, f: function (m, a) { editarVacaciones_(m, a[0], a[1] || {}); return apiVacaciones_(m); } },
    cancelarVacaciones: { e: 1, f: function (m, a) { cancelarVacaciones_(m, a[0]); return apiVacaciones_(m); } },
    deudas: { f: apiDeudas_ },
    recibiPago: { e: 1, f: function (m, a) { recibiPago_(m, a[0]); return apiDeudas_(m); } },
    deshacerPago: { e: 1, f: function (m, a) { deshacerPago_(m, a[0]); return apiDeudas_(m); } },
    contrato: { f: apiContrato_ },
    guardarMiFija: { e: 1, f: function (m, a) { guardarFija_(m.id, a[0]); confirmarContrato_(m); registrar_(m.nombre_apellido, 'guardar_fija', ''); return apiContrato_(m); } },
    cambiarMiVinculo: { e: 1, f: function (m, a) { cambiarVinculo_(m, a[0]); return apiContrato_(m); } },
    guardarMiEmail: { e: 1, f: function (m, a) { guardarMiEmail_(m, a[0]); return apiContrato_(m); } },
    cambiarMiPin: { e: 1, f: function (m, a) { return apiCambiarMiPin_(m, a[0], a[1]); } },

    // El jefe tiene acceso de administrador por si quiere editar. El sistema nunca se lo pide.
    tablero: { admin: 1, f: apiTablero_ },
    conflictos: { admin: 1, f: apiConflictos_ },
    guardiaJefe: { admin: 1, f: apiGuardiaJefe_ },
    corregirGuardia: { admin: 1, e: 1, f: apiCorregirGuardia_ },
    vistaExcel: { admin: 1, f: apiVistaExcel_ },
    descargarExcel: { admin: 1, f: apiDescargarExcel_ },
    descargarAcumulado: { admin: 1, f: apiDescargarAcumulado_ },
    medicos: { admin: 1, f: apiMedicos_ },
    guardarMedico: { admin: 1, e: 1, f: apiGuardarMedico_ },
    guardarFijaDe: { admin: 1, e: 1, f: apiGuardarFijaDe_ },
    ajustes: { admin: 1, f: apiAjustes_ },
    guardarConfig: { admin: 1, e: 1, f: apiGuardarConfig_ },
    guardarFeriado: { admin: 1, e: 1, f: apiGuardarFeriado_ },
    borrarFeriado: { admin: 1, e: 1, f: apiBorrarFeriado_ }
  };
}

// La app en GitHub Pages llama acá con POST (texto JSON: { f, args }). Responde JSON: { r }.
// Solo estas funciones; todo lo demás pasa por api(), que exige sesión.
function doPost(e) {
  let r;
  try {
    const p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const rutas = { api: api, login: login, medicosPublico: medicosPublico, autoRegistro: autoRegistro, accionAviso: accionAviso_, reportarError: reportarError };
    const a = Array.isArray(p.args) ? p.args : [];
    r = Object.prototype.hasOwnProperty.call(rutas, p.f) ? rutas[p.f].apply(null, a) : { ok: false, error: 'Pedido desconocido.' };
  } catch (err) {
    r = { ok: false, error: 'Pedido inválido.' };
  }
  return ContentService.createTextOutput(JSON.stringify({ r: r === undefined ? null : r })).setMimeType(ContentService.MimeType.JSON);
}

// Todo lo que muestra la app en una sola llamada: se guarda en el celular y las pantallas se arman desde ahí.
// mesVista: el mes que está mirando, si no es el actual ni el siguiente.
function paquete_(m, mesVista) {
  if (!tienePinPropio_(m) || !registroCompleto_(m)) return { inicio: apiInicio_(m) };
  const actual = mesDe_(hoy_());
  const meses = [actual, sumarMeses_(actual, 1)];
  if (esMesValido_(String(mesVista || '')) && meses.indexOf(mesVista) < 0) meses.push(mesVista);
  const p = { inicio: apiInicio_(m), meses: {}, libres: apiLibres_(m), vacaciones: apiVacaciones_(m), deudas: apiDeudas_(m), contrato: apiContrato_(m) };
  meses.forEach(function (mes) { p.meses[mes] = apiMiMes_(m, [mes]); });
  return JSON.parse(JSON.stringify(p));
}

// opciones.mes: el mes que está mirando. Las escrituras devuelven también el paquete actualizado.
// Pública: la pantalla avisa un error inesperado. Le llega un mail a la dueña, como mucho uno por hora
// (aunque lo llamen muchas veces). Nunca va con datos de salud: solo el mensaje técnico y la pantalla.
function reportarError(token, info) {
  reiniciarEstado_();
  try {
    const ahora = ahora_().getTime();
    if (ahora - Number(propiedad_('ultimo_error_mail') || 0) < 3600000) return { ok: true, enviado: false };
    setPropiedad_('ultimo_error_mail', ahora);
    const m = medicoDeSesion_(token);
    const i = info || {};
    const corto = function (v, n) { return String(v === undefined || v === null ? '' : v).slice(0, n); };
    const texto = ['Hubo un error en la app Fichá (te llega como mucho un aviso por hora).', '',
      'Quién: ' + (m ? m.nombre_apellido : 'sin sesión'), 'Pantalla: ' + corto(i.vista, 40), 'Dirección: ' + corto(i.direccion, 120),
      'Error: ' + corto(i.mensaje, 500), 'Dónde: ' + corto(i.pila, 1500), 'Navegador: ' + corto(i.navegador, 300), 'Cuándo: ' + marcaTiempo_()].join('\n');
    MailApp.sendEmail({ to: MAIL_REVISION, subject: 'Fichá: error en la app', body: texto, name: 'Fichá' });
    registrar_('sistema', 'error_pantalla', corto(i.mensaje, 120));
    return { ok: true, enviado: true };
  } catch (e) {
    return { ok: false };
  }
}

function api(token, metodo, args, opciones) {
  reiniciarEstado_();
  const inicioMs = Date.now();
  try {
    const m = medicoDeSesion_(token);
    if (!m) return { ok: false, sesion: true, error: 'Tu sesión venció. Entrá de nuevo.' };
    fijarActor_(m.nombre_apellido);
    const tabla = tablaApi_();
    if (!Object.prototype.hasOwnProperty.call(tabla, metodo)) return { ok: false, error: 'Acción desconocida.' };
    const def = tabla[metodo];
    if ((!tienePinPropio_(m) || !registroCompleto_(m)) && !def.registro) return { ok: false, registro: true, error: 'Primero completá tu registro.' };
    if (def.admin && !esSi_(m.es_admin)) return { ok: false, error: 'Solo el jefe puede hacer esto.' };
    const a = Array.isArray(args) ? args : [];
    const datos = def.e ? conLock_(function () { return def.f(m, a); }) : def.f(m, a);
    const r = { ok: true, datos: JSON.parse(JSON.stringify(datos === undefined ? null : datos)) };
    if (def.e) {
      const yo = buscarPorId_('MEDICOS', m.id) || m;
      if (registroCompleto_(yo) && tienePinPropio_(yo)) r.paquete = paquete_(yo, opciones && opciones.mes);
    }
    r.ms = Date.now() - inicioMs;
    return r;
  } catch (e) {
    if (e instanceof ErrorUsuario) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: 'Hubo un error. Probá de nuevo en un rato.' };
  }
}

function apiInicio_(m) {
  const hoyStr = hoy_();
  return {
    yo: { id: m.id, nombre: m.nombre_apellido, admin: esSi_(m.es_admin), push: pushActivo_(m), push_listo: pushConfigurado_(),
      vinculo: vinculoDe_(m), email: m.email || '' },
    hoy: hoyStr,
    primer_mes: cfg_('primer_mes'),
    registro: tienePinPropio_(m) && registroCompleto_(m) ? null : estadoRegistro_(m),
    recordar_avisos: registroCompleto_(m) && !pushActivo_(m) && !m.email,
    dias: DIAS.slice(1).concat(DIAS[0]),
    fijas: fijasVigentes_().filter(function (f) { return f.medico_id === m.id; }).map(function (f) {
      return { dia_semana: normalizarDia_(f.dia_semana), turno: TURNOS[f.turno] ? TURNOS[f.turno].nombre : f.turno, tipo: f.tipo || TIPO.CONTRATO };
    }),
    regla: REGLA_ORO,
    feriados: filas_('FERIADOS').map(function (f) { return f.fecha; }),
    companeros: medicos_().filter(function (o) { return o.id !== m.id; }).map(function (o) { return { id: o.id, nombre: o.nombre_apellido }; })
      .sort(function (a, b) { return a.nombre < b.nombre ? -1 : 1; }),
    turnos: Object.keys(TURNOS).map(function (k) { return { id: k, nombre: TURNOS[k].nombre }; })
  };
}

function vistaGuardia_(g, m) {
  const oculto = ocultaTitular_(g, m);
  const titular = g.medico_titular_id && !oculto ? nombreDe_(g.medico_titular_id) : '';
  const referencia = !mesAutomatico_(mesDe_(g.fecha));
  const hizo = g.medico_que_hizo_id ? nombreDe_(g.medico_que_hizo_id) : '';
  const esTitular = g.medico_titular_id === m.id;
  const esHizo = g.medico_que_hizo_id === m.id;
  const anulada = g.estado === ESTADO.ANULADA;
  const confirmada = estaConfirmada_(g);
  const cerrado = mesCerrado_(g.mes_facturacion);
  const deOtro = g.estado === ESTADO.PREVISTA && g.medico_que_hizo_id && g.medico_que_hizo_id !== g.medico_titular_id;
  const debeResponder = (g.estado === ESTADO.ESPERANDO &&
    ((esHizo && !esSi_(g.confirmado_por_quien_hizo)) || (esTitular && !esSi_(g.confirmado_por_titular)))) ||
    (g.estado === ESTADO.CONFLICTO && (esHizo || esTitular)) ||
    (deOtro && ((esHizo && (g.fecha <= hoy_() || (g.medico_titular_id && !esSi_(g.confirmado_por_quien_hizo)))) || (esTitular && !esSi_(g.confirmado_por_titular))));
  const propia = g.medico_titular_id && g.medico_titular_id === g.medico_que_hizo_id;
  const tipos = !g.medico_titular_id ? [TIPO.HOSPITAL] : propia ? [TIPO.CONTRATO, TIPO.HOSPITAL]
    : !g.medico_que_hizo_id ? [TIPO.HOSPITAL] : [TIPO.HOSPITAL, TIPO.COMPANERO];
  return {
    id: g.id, fecha: g.fecha, turno: g.turno, turno_nombre: TURNOS[g.turno].nombre, categoria: g.categoria,
    tipo: g.tipo, tipo_nombre: nombreTipo_(g.tipo), estado: g.estado, titular: titular, hizo: hizo,
    observacion: g.observacion, es_titular: esTitular, es_hizo: esHizo,
    debe_responder: debeResponder && !referencia,
    referencia: referencia,
    puede_hago_yo: !referencia && esTitular && !anulada && !(confirmada && (cerrado || !esHizo)) && (g.fecha <= hoy_() || esAnticipable_(g.fecha)),
    anticipable: esAnticipable_(g.fecha),
    control_pendiente: esHizo && controlPendiente_(g),
    control: g.control_anticipada,
    puede_cubrir: !referencia && esTitular && !anulada && !(confirmada && cerrado) && !esSoloReemplazo_(m),
    acciones: referencia ? [] : accionesDe_(g, m),
    deshacer_min: minutosParaDeshacer_(g, m),
    tipos_posibles: tipos,
    sugerido: sugerirTipo_(g.medico_titular_id, g.fecha),
    futura: g.fecha > hoy_(),
    cerrado: cerrado,
    reclamo: g.observacion === MARCA_RECLAMO,
    mes_facturacion: g.mes_facturacion,
    cobro: g.fecha_cobro,
    libre_ajena: oculto,
    en_bolsa: esLibre_(g),
    origen: g.origen || '',
    puede_liberar: !referencia && esTitular && esHizo && g.estado === ESTADO.PREVISTA && g.fecha >= hoy_() && !cerrado && !esSoloReemplazo_(m),
    puede_recuperar: esTitular && esLibre_(g) && g.origen === ORIGEN.LIBERADA
  };
}

function colorPara_(g, m) {
  if (!mesAutomatico_(mesDe_(g.fecha))) return 'referencia';
  if (g.estado === ESTADO.CONFLICTO) return 'conflicto';
  if (g.estado === ESTADO.ESPERANDO) return 'espera';
  if (g.medico_titular_id === m.id && g.medico_que_hizo_id && g.medico_que_hizo_id !== m.id) return 'cubierta';
  if (g.estado === ESTADO.PREVISTA && g.tipo === TIPO.CONTRATO && g.medico_titular_id === m.id && g.medico_que_hizo_id === m.id) return 'contrato';
  if (g.estado === ESTADO.PREVISTA) return 'prevista';
  if (g.estado === ESTADO.ANTICIPADA) return 'anticipada';
  if (g.tipo === TIPO.HOSPITAL) return 'reemplazo';
  if (g.tipo === TIPO.COMPANERO) return 'reemplazo';
  return 'confirmada';
}

function textoVentana_(mes) {
  const corte = fechaCorte_(mes);
  const h = hoy_();
  if (mesCerrado_(mes) || h < sumarDias_(corte, -7)) return '';
  return 'El ' + Number(corte.slice(8)) + ' se cierra el mes. Ya podés confirmar tus guardias del ' + Number(corte.slice(8)) + ' al ' + Number(ultimoDia_(mes).slice(8)) + '.';
}

function apiMiMes_(m, a) {
  const mes = esMesValido_(String(a[0])) ? a[0] : mesDe_(hoy_());
  const mias = filas_('GUARDIAS').filter(function (g) {
    return g.estado !== ESTADO.ANULADA && mesDe_(g.fecha) === mes && (g.medico_titular_id === m.id || g.medico_que_hizo_id === m.id);
  });
  const mesCobro = filas_('GUARDIAS').filter(function (g) {
    return g.tipo === TIPO.HOSPITAL && estaConfirmada_(g) && g.mes_facturacion === mes && g.medico_que_hizo_id === m.id;
  });
  const vacaciones = filas_('VACACIONES').filter(function (v) { return v.medico_id === m.id && v.estado !== 'cancelada'; });
  return {
    mes: mes,
    titulo: capital_(nombreMesAnio_(mes)),
    cerrado: mesCerrado_(mes),
    reemplazos: mesCobro.length,
    libres: libres_().filter(function (g) { return g.medico_titular_id !== m.id; }).length,
    cobro: fechaCobroCorta_(fechaCobro_(mes)),
    ventana: textoVentana_(mes),
    pendientes: pendientesDe_(m, mes).map(function (g) { return vistaGuardia_(g, m); }),
    guardias: mias.slice().sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0; })
      .map(function (g) { return vistaGuardia_(g, m); }),
    dias: diasDelMes_(mes).map(function (f) {
      const delDia = mias.filter(function (g) { return g.fecha === f; });
      return {
        fecha: f,
        no_habil: categoriaDe_(f) === 'NO_HABIL',
        vacaciones: vacaciones.some(function (v) { return v.desde <= f && f <= v.hasta; }),
        guardias: delDia.map(function (g) {
          return { id: g.id, color: colorPara_(g, m), texto: (g.tipo === TIPO.CONTRATO && g.medico_titular_id === m.id ? 'C ' : '') + g.horas + ' h' };
        }),
        // Turnos que ese día ya hace él: la pantalla no ofrece cargar algo que se superponga.
        ocupado: delDia.filter(function (g) { return g.medico_que_hizo_id === m.id; }).map(function (g) { return g.turno; }),
        ocupado_texto: (function () { const p = delDia.find(function (g) { return g.medico_que_hizo_id === m.id; }); return p ? textoSuperposicion_(p, m.id) : ''; })()
      };
    })
  };
}

function apiGuardia_(m, a) {
  const g = guardiaDe_(a[0]);
  if (g.medico_titular_id !== m.id && g.medico_que_hizo_id !== m.id && !esSi_(m.es_admin)) throw new ErrorUsuario('Esa guardia no es tuya.');
  return vistaGuardia_(g, m);
}

// Para la pantalla de carga: primero quienes tienen guardia PREVISTA ese día y ese turno.
function apiCandidatos_(m, a) {
  const fecha = String(a[0] || '');
  const turno = String(a[1] || '');
  if (!esFechaValida_(fecha)) throw new ErrorUsuario('Elegí la fecha.');
  const conGuardia = {};
  filas_('GUARDIAS').forEach(function (g) {
    if (g.fecha === fecha && g.turno === turno && g.estado === ESTADO.PREVISTA && g.medico_titular_id && g.medico_titular_id !== m.id &&
      (!g.medico_que_hizo_id || g.medico_que_hizo_id === g.medico_titular_id)) conGuardia[g.medico_titular_id] = true;
  });
  // Un médico de reemplazos no tiene guardias propias: no se lo puede elegir como titular.
  const lista = medicos_().filter(function (o) { return o.id !== m.id && !esSoloReemplazo_(o); }).map(function (o) {
    return { id: o.id, nombre: o.nombre_apellido, prevista: !!conGuardia[o.id], sugerido: sugerirTipo_(o.id, fecha) };
  }).sort(function (x, y) {
    if (x.prevista !== y.prevista) return x.prevista ? -1 : 1;
    return x.nombre < y.nombre ? -1 : 1;
  });
  return {
    candidatos: lista,
    categoria: categoriaDe_(fecha) === 'NO_HABIL' ? 'no hábil' : 'hábil',
    cerrado: mesCerrado_(mesDe_(fecha)),
    futura: fecha > hoy_(),
    anticipable: esAnticipable_(fecha),
    mensaje_cerrado: MENSAJE_MES_CERRADO
  };
}

function apiVacaciones_(m) {
  return filas_('VACACIONES').filter(function (v) { return v.medico_id === m.id && v.estado !== 'cancelada'; })
    .map(function (v) { return { id: v.id, desde: v.desde, hasta: v.hasta, tipo: v.tipo, cerrado: mesCerrado_(mesDe_(v.desde)) }; })
    .sort(function (a, b) { return a.desde < b.desde ? 1 : -1; });
}

function apiDeudas_(m) {
  const vista = function (d) {
    const g = buscarPorId_('GUARDIAS', d.guardia_id);
    return {
      id: d.id, deudor: nombreDe_(d.deudor_id), acreedor: nombreDe_(d.acreedor_id), fecha: g ? g.fecha : '',
      turno: g ? TURNOS[g.turno].nombre : '', pago: d.fecha_pago_sugerida, estado: d.estado,
      puede_deshacer: d.estado === 'pagada' && d.acreedor_id === m.id && Number(d.deshacer_hasta) > ahora_().getTime()
    };
  };
  const mias = filas_('DEUDAS');
  return {
    debo: mias.filter(function (d) { return d.deudor_id === m.id; }).map(vista),
    me_deben: mias.filter(function (d) { return d.acreedor_id === m.id; }).map(vista)
  };
}

function apiContrato_(m) {
  return {
    vinculo: vinculoDe_(m),
    email: m.email || '',
    push: pushActivo_(m),
    push_listo: pushConfigurado_(),
    filas: fijasVigentes_().filter(function (f) { return f.medico_id === m.id; }).map(function (f) {
      return { dia_semana: normalizarDia_(f.dia_semana), turno: f.turno, tipo: f.tipo || TIPO.CONTRATO };
    }),
    dias: DIAS.slice(1).concat(DIAS[0]),
    turnos: Object.keys(TURNOS).map(function (k) { return { id: k, nombre: TURNOS[k].nombre }; })
  };
}

function apiCambiarMiPin_(m, actual, nuevo) {
  const error = errorPinNuevo_(nuevo);
  if (error) throw new ErrorUsuario(error);
  if (m.pin !== hashPin_(m.id, String(actual))) throw new ErrorUsuario('El PIN actual no es correcto.');
  m.pin = hashPin_(m.id, String(nuevo));
  m.pin_propio = true;
  guardar_('MEDICOS', m);
  registrar_(m.nombre_apellido, 'cambio_pin', '');
  return { token: crearSesion_(m) };
}
