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
// Reglas de un PIN elegido por el médico. Devuelve el motivo en una línea, o '' si está bien.
function errorPinNuevo_(pin) {
  pin = String(pin || '');
  if (!/^\d{4}$/.test(pin)) return 'El PIN tiene que tener 4 números.';
  if (/^(\d)\1{3}$/.test(pin)) return 'Elegí un PIN que no sea 4 números iguales (como 1111).';
  const d = pin.split('').map(Number);
  const seguidos = function (paso) { return d.every(function (x, i) { return i === 0 || x === d[i - 1] + paso; }); };
  if (seguidos(1) || seguidos(-1)) return 'Elegí un PIN que no sea de números seguidos (como 1234 o 4321).';
  return '';
}

function crearPinPropio_(m, nuevo) {
  nuevo = String(nuevo || '');
  const error = errorPinNuevo_(nuevo);
  if (error) throw new ErrorUsuario(error);
  if (m.pin === nuevo || m.pin === hashPin_(m.id, nuevo)) throw new ErrorUsuario('Elegí un PIN distinto del que te dieron.');
  m.pin = hashPin_(m.id, nuevo);
  m.pin_propio = true;
  guardar_('MEDICOS', m);
  // Se vuelve a leer de la hoja: si no quedó guardado, que se vea el error y no vuelva en silencio al mismo paso.
  _cacheTablas = {};
  if (!tienePinPropio_(buscarPorId_('MEDICOS', m.id) || {})) throw new ErrorUsuario('No se pudo guardar tu PIN en la planilla. Probá de nuevo; si sigue igual, avisale al jefe del servicio.');
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
  if (pushActivo_(m)) return 'Te vamos a avisar con notificaciones en tu celular' + (email ? ', y por mail a ' + email + ' si fallan.' : '.');
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
  // Todo o nada: primero se valida y se arma todo lo que puede fallar; recién después se escribe.
  // (La planilla no deshace lo escrito si algo falla a la mitad.)
  const filas = validarBorrador_(b);
  validarFija_(filas, b.vinculo === VINCULO.SOLO);
  const anterior = vinculoDe_(m);
  const resumen = resumenRegistro_(Object.assign({}, m, { email: b.email || m.email }), b);
  m.vinculo = b.vinculo;
  if (b.email) m.email = b.email;
  guardar_('MEDICOS', m);
  guardarFija_(m.id, filas); // anula las futuras sin tocar y las vuelve a generar: repetirlo no duplica
  if (b.tiene_vacaciones && b.vacaciones && !filas_('VACACIONES').some(function (v) {
    return v.medico_id === m.id && v.estado !== 'cancelada' && v.desde === b.vacaciones.desde && v.hasta === b.vacaciones.hasta;
  })) agregarVacaciones_(m, b.vacaciones);
  m.contrato_revisado = true;
  m.registro = '';
  guardar_('MEDICOS', m);
  sembrarDesdeHoy_(m.id, true); // el mes abierto completo (para cargar lo pasado) y el siguiente
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

// ---------- Auto-registro: "No estoy en la lista → Registrarme" ----------
// Pide el código del servicio (CONFIG.codigo_servicio), nombre y apellido y un PIN propio. Queda activo sin
// aprobación y sigue con el registro de siempre (desde el paso 2). Si el código está vacío, el auto-registro está cerrado.
const MAX_FALLOS_CODIGO_DIA = 20;
const MAX_ALTAS_DIA = 15;
const LETRAS_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin I, L, O, 0 ni 1, que se confunden

function nuevoCodigoServicio_() {
  let s = '';
  for (let i = 0; i < 6; i++) s += LETRAS_CODIGO.charAt(Math.floor(Math.random() * LETRAS_CODIGO.length));
  return s;
}

// Como va al Excel: MAYÚSCULAS, sin tildes (la Ñ se conserva), un solo espacio entre palabras.
function normalizarNombre_(t) {
  return String(t || '').toUpperCase().replace(/Ñ/g, '\u0001').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\u0001/g, 'Ñ').replace(/[^A-ZÑ' -]/g, ' ').replace(/\s+/g, ' ').trim();
}

function distancia_(a, b) {
  const d = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

// ¿Puede ser la misma persona? Mismo nombre con otro orden, 2 palabras en común, un error de tipeo,
// o el mismo apellido con la misma inicial del nombre.
function seParece_(a, b) {
  const sinEnie = function (x) { return x.replace(/Ñ/g, 'N'); };
  a = sinEnie(a); b = sinEnie(b);
  if (a === b || distancia_(a, b) <= 2) return true;
  const pa = a.split(' '), pb = b.split(' ');
  if (pa.slice().sort().join(' ') === pb.slice().sort().join(' ')) return true;
  const comunes = pa.filter(function (p) { return p.length >= 3 && pb.indexOf(p) >= 0; });
  if (comunes.length >= 2) return true;
  return comunes.some(function (p) { return p.length >= 4 && p !== pa[0] && p !== pb[0]; }) && pa[0].charAt(0) === pb[0].charAt(0);
}

function cupoAutoRegistro_() {
  let c;
  try { c = JSON.parse(propiedad_('autoregistro') || '{}') || {}; } catch (e) { c = {}; }
  if (c.dia !== hoy_()) c = { dia: hoy_(), fallos: 0, altas: 0 };
  return c;
}

// Código de jefe ("Soy el jefe del servicio"): sirve si todavía no hay jefe, o si el jefe actual lo regeneró.
// Una vez usado deja de funcionar hasta que lo regeneren.
function codigoJefeValido_(codigo) {
  const esperado = String(cfg_('codigo_jefe')).toUpperCase().replace(/\s/g, '');
  const dado = String(codigo || '').toUpperCase().replace(/\s/g, '');
  if (!esperado || dado !== esperado || propiedad_('codigo_jefe_usado') === esperado) return false;
  return !medicos_().some(function (m) { return esSi_(m.es_admin); }) || propiedad_('codigo_jefe_habilitado') === esperado;
}

function regenerarCodigoJefe_(jefe) {
  const nuevo = nuevoCodigoServicio_();
  setCfg_('codigo_jefe', nuevo);
  setPropiedad_('codigo_jefe_habilitado', nuevo);
  registrar_(jefe.nombre_apellido, 'regenero_codigo_jefe', '');
  return nuevo;
}

// Pública (la llama la pantalla de ingreso, sin sesión). otraPersona = true cuando dijo "No, soy otra persona".
// codigoJefe: solo si tocó "Soy el jefe del servicio".
function autoRegistro(codigo, nombre, pin, otraPersona, codigoJefe) {
  reiniciarEstado_();
  return conLock_(function () {
    const cupo = cupoAutoRegistro_();
    const guardarCupo = function () { setPropiedad_('autoregistro', JSON.stringify(cupo)); };
    if (cupo.fallos >= MAX_FALLOS_CODIGO_DIA) return { ok: false, error: 'Demasiados intentos hoy. Probá mañana o pedile al jefe que te cargue.' };
    if (cupo.altas >= MAX_ALTAS_DIA) return { ok: false, error: 'Hoy ya se registraron muchos médicos. Probá mañana o pedile al jefe que te cargue.' };
    const esperado = String(cfg_('codigo_servicio')).toUpperCase().replace(/\s/g, '');
    if (!esperado) return { ok: false, error: 'El registro está cerrado. Pedile al jefe que te cargue.' };
    if (String(codigo || '').toUpperCase().replace(/\s/g, '') !== esperado) {
      cupo.fallos++;
      guardarCupo();
      registrar_('sistema', 'auto_registro_codigo_incorrecto', '');
      return { ok: false, error: 'El código del servicio no es correcto. Pedíselo a un compañero o al jefe.' };
    }
    const n = normalizarNombre_(nombre);
    if (n.split(' ').length < 2 || n.replace(/[^A-ZÑ]/g, '').length < 5 || n.length > 60) {
      return { ok: false, error: 'Escribí tu nombre y tu apellido.' };
    }
    const errorPin = errorPinNuevo_(pin);
    if (errorPin) return { ok: false, error: errorPin };
    const comoJefe = !!String(codigoJefe || '').trim();
    if (comoJefe && !codigoJefeValido_(codigoJefe)) {
      cupo.fallos++;
      guardarCupo();
      registrar_('sistema', 'codigo_jefe_incorrecto', '');
      return { ok: false, error: 'El código de jefe no es correcto o ya se usó. Si ya hay un jefe, él lo puede regenerar en Mi servicio.' };
    }

    const todos = medicos_(true);
    const igual = todos.find(function (m) { return normalizarNombre_(m.nombre_apellido).replace(/Ñ/g, 'N') === n.replace(/Ñ/g, 'N'); });
    const parecido = igual || (otraPersona ? null : todos.find(function (m) { return seParece_(n, normalizarNombre_(m.nombre_apellido)); }));
    if (parecido) {
      const activo = esSi_(parecido.activo);
      return {
        ok: false, parecido: parecido.nombre_apellido, activo: activo, puede_seguir: !igual,
        error: activo ? '¿Sos ' + parecido.nombre_apellido + '? Elegilo de la lista.'
          : 'Ya hay un médico cargado como ' + parecido.nombre_apellido + ', pero todavía no está habilitado. Si sos vos, pedile al jefe que te active.'
      };
    }

    const id = siguienteId_('MEDICOS');
    const m = insertar_('MEDICOS', {
      id: id, nombre_apellido: n, pin: hashPin_(id, String(pin)), email: '', telegram_chat_id: '', activo: true, es_admin: comoJefe,
      contrato_revisado: false, vinculo: '', pin_propio: true, registro: ''
    });
    cupo.altas++;
    guardarCupo();
    registrar_(n, 'auto_registro', 'se registró solo con el código del servicio' + (comoJefe ? ', como jefe' : ''));
    if (comoJefe) {
      setPropiedad_('codigo_jefe_usado', String(cfg_('codigo_jefe')).toUpperCase().replace(/\s/g, ''));
      setPropiedad_('codigo_jefe_habilitado', '');
    }
    return { ok: true, token: crearSesion_(m), nombre: n };
  });
}
