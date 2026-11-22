// Creación de la Sheet y menú. Las funciones sin "_" son las que corren desde el menú de la
// planilla; como Apps Script las expone, verifican primero que quien llama sea el dueño.

const CONFIG_INICIAL = [
  ['hora_recordatorio', '08:00', 'Hora del recordatorio diario.'],
  ['dia_corte', '25', 'Día en que se cierra el mes, a las 00:00 (de 1 a 28).'],
  ['hora_excel', '08:00', 'Hora en que llega el Excel el día de corte.'],
  ['valor_guardia_12', '', 'Opcional: valor de la guardia de 12 h.'],
  ['valor_guardia_24', '', 'Opcional: valor de la guardia de 24 h.'],
  ['url_app', '', 'Dirección de la app. Se completa sola; se puede corregir a mano.']
];

const FERIADOS_INICIALES = [
  ['2026-01-01', 'Año Nuevo', 'inamovible'],
  ['2026-02-16', 'Carnaval', 'inamovible'],
  ['2026-02-17', 'Carnaval', 'inamovible'],
  ['2026-03-23', 'Día no laborable con fines turísticos', 'no laborable'],
  ['2026-03-24', 'Día de la Memoria', 'inamovible'],
  ['2026-04-02', 'Malvinas / Jueves Santo', 'inamovible'],
  ['2026-04-03', 'Viernes Santo', 'inamovible'],
  ['2026-05-01', 'Día del Trabajador', 'inamovible'],
  ['2026-05-25', 'Revolución de Mayo', 'inamovible'],
  ['2026-06-15', 'Paso a la Inmortalidad de Güemes (trasladado del 17/6)', 'trasladable'],
  ['2026-06-20', 'Paso a la Inmortalidad de Belgrano', 'inamovible'],
  ['2026-07-09', 'Día de la Independencia', 'inamovible'],
  ['2026-07-10', 'Día no laborable con fines turísticos', 'no laborable'],
  ['2026-08-17', 'Paso a la Inmortalidad de San Martín', 'trasladable'],
  ['2026-10-12', 'Día del Respeto a la Diversidad Cultural', 'trasladable'],
  ['2026-11-23', 'Día de la Soberanía Nacional (trasladado del 20/11)', 'trasladable'],
  ['2026-12-07', 'Día no laborable con fines turísticos', 'no laborable'],
  ['2026-12-08', 'Inmaculada Concepción', 'inamovible'],
  ['2026-12-25', 'Navidad', 'inamovible'],
  ['2027-01-01', 'Año Nuevo', 'inamovible'],
  ['2027-02-08', 'Carnaval', 'inamovible'],
  ['2027-02-09', 'Carnaval', 'inamovible'],
  ['2027-03-24', 'Día de la Memoria', 'inamovible'],
  ['2027-03-25', 'Jueves Santo', 'no laborable'],
  ['2027-03-26', 'Viernes Santo', 'inamovible'],
  ['2027-04-02', 'Día de Malvinas', 'inamovible'],
  ['2027-05-01', 'Día del Trabajador', 'inamovible'],
  ['2027-05-25', 'Revolución de Mayo', 'inamovible'],
  ['2027-06-20', 'Paso a la Inmortalidad de Belgrano', 'inamovible'],
  ['2027-06-21', 'Güemes (PROVISORIO: calculado por ley, revisar)', 'trasladable'],
  ['2027-07-09', 'Día de la Independencia', 'inamovible'],
  ['2027-08-16', 'San Martín (PROVISORIO: calculado por ley, revisar)', 'trasladable'],
  ['2027-10-11', 'Diversidad Cultural (PROVISORIO: calculado por ley, revisar)', 'trasladable'],
  ['2027-11-20', 'Soberanía Nacional (PROVISORIO: puede trasladarse, revisar)', 'trasladable'],
  ['2027-12-08', 'Inmaculada Concepción', 'inamovible'],
  ['2027-12-25', 'Navidad', 'inamovible']
];

// Los médicos de prueba empiezan con "PRUEBA " para poder borrarlos de una sola vez.
const MEDICOS_PRUEBA = [
  { nombre: 'PRUEBA JEFE', admin: true, fija: [['lunes', '24H', 'CONTRATO']] },
  { nombre: 'PRUEBA GOMEZ', fija: [['martes', '24H', 'CONTRATO']] },
  { nombre: 'PRUEBA PEREZ', fija: [['miercoles', '12H_DIA', 'CONTRATO'], ['viernes', '12H_NOCHE', 'CONTRATO']] },
  { nombre: 'PRUEBA DIAZ', fija: [['jueves', '24H', 'CONTRATO'], ['sabado', '24H', 'REEMPLAZO_HOSPITAL']] },
  { nombre: 'PRUEBA LOPEZ', fija: [['domingo', '24H', 'CONTRATO']] }
];

function crearHojas_() {
  const ss = libro_();
  Object.keys(ESQUEMA).forEach(function (nombre) {
    let h = ss.getSheetByName(nombre);
    const cols = ESQUEMA[nombre];
    if (!h) {
      h = ss.insertSheet(nombre);
      h.getRange(1, 1, h.getMaxRows(), Math.max(cols.length, 1)).setNumberFormat('@');
      h.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#9FC5E8');
      h.setFrozenRows(1);
    } else {
      // Una instalación anterior: se agregan al final las columnas que falten.
      const actuales = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(textoCelda_);
      cols.filter(function (c) { return actuales.indexOf(c) < 0; }).forEach(function (c, i) {
        h.getRange(1, actuales.length + i + 1).setValue(c);
      });
    }
  });
  const sobrante = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (sobrante && sobrante.getLastRow() === 0) ss.deleteSheet(sobrante);
  _cacheTablas = {};
}

function cargarDatosIniciales_() {
  const claves = filas_('CONFIG').map(function (c) { return c.clave; });
  CONFIG_INICIAL.forEach(function (c) {
    if (claves.indexOf(c[0]) < 0) insertar_('CONFIG', { clave: c[0], valor: c[1], para_que_sirve: c[2] });
  });
  const fechas = filas_('FERIADOS').map(function (f) { return f.fecha; });
  FERIADOS_INICIALES.forEach(function (f) {
    if (fechas.indexOf(f[0]) < 0) insertar_('FERIADOS', { fecha: f[0], nombre: f[1], tipo: f[2], estado: 'vigente' });
  });
  if (!propiedad_('SECRETO')) setPropiedad_('SECRETO', Utilities.getUuid() + Utilities.getUuid());
}

function cargarMedicosPrueba_() {
  if (filas_('MEDICOS').length) return;
  MEDICOS_PRUEBA.forEach(function (p) {
    const pin = String(1000 + Math.floor(Math.random() * 9000));
    const m = insertar_('MEDICOS', {
      id: siguienteId_('MEDICOS'), nombre_apellido: p.nombre, pin: pin, email: '', telegram_chat_id: '',
      activo: true, es_admin: !!p.admin
    });
    p.fija.forEach(function (f) {
      insertar_('GUARDIA_FIJA', { medico_id: m.id, dia_semana: f[0], turno: f[1], tipo: f[2], vigente: true });
    });
  });
}

function instalarTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(15).create();
}

function soloDueno_() {
  const dueno = propiedad_('DUENO');
  const quien = Session.getActiveUser().getEmail();
  // Un visitante anónimo de la web app tiene mail vacío: nunca pasa.
  if (!quien || (dueno && quien !== dueno)) throw new Error('Solo el dueño de la planilla puede hacer esto.');
  return quien;
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Guardias UPA')
    .addItem('1. Instalar', 'instalar')
    .addItem('2. Configurar avisos push', 'configurarPush')
    .addSeparator()
    .addItem('Ver dirección de la app', 'verDireccionApp')
    .addItem('Probar: mandarme el Excel de este mes', 'probarExcelDelMes')
    .addItem('Borrar médicos de prueba', 'borrarPrueba')
    .addToUi();
}

function instalar() {
  const quien = soloDueno_();
  reiniciarEstado_();
  if (!propiedad_('SHEET_ID')) setPropiedad_('SHEET_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
  if (quien && !propiedad_('DUENO')) setPropiedad_('DUENO', quien);
  crearHojas_();
  cargarDatosIniciales_();
  cargarMedicosPrueba_();
  prepararRegistroPropio_(); // una sola vez: cada médico carga su guardia fija en el registro
  instalarTriggers_();
  registrar_(quien, 'instalar', '');
  SpreadsheetApp.getUi().alert('Listo. Se crearon las hojas y se activaron los automatismos.\n\n' +
    'Los PIN de los médicos de prueba están en la hoja MEDICOS. Cuando alguien entra por primera vez, ' +
    'su PIN se guarda cifrado y deja de leerse en la hoja.');
}

function verDireccionApp() {
  soloDueno_();
  reiniciarEstado_();
  SpreadsheetApp.getUi().alert('Dirección de la app:\n\n' + (urlApp_() || 'Todavía no está publicada.'));
}

// Para verificar Drive y mail sin esperar al día de corte. No cierra el mes ni avisa a los médicos.
function probarExcelDelMes() {
  const quien = soloDueno_();
  reiniciarEstado_();
  fijarActor_(quien);
  const mes = mesDe_(hoy_());
  const archivo = entregarExcel_(mes, { prefijoAsunto: 'PRUEBA: ', nombre: nombreArchivoExcel_(mes).replace('.xlsx', '_PRUEBA.xlsx') });
  SpreadsheetApp.getUi().alert('Listo. Se guardó en Drive y se mandó a ' + MAIL_REVISION + '.\n\n' + archivo.webViewLink);
}

// Única excepción a "nada se borra": datos inventados de prueba, a pedido del dueño y con confirmación.
function borrarPrueba() {
  const quien = soloDueno_();
  reiniciarEstado_();
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('¿Borrar los médicos de prueba y sus guardias?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const n = borrarDatosPrueba_();
  registrar_(quien, 'borrar_prueba', n + ' médicos');
  ui.alert('Se borraron ' + n + ' médicos de prueba.');
}

function borrarDatosPrueba_() {
  const ids = {};
  filas_('MEDICOS').forEach(function (m) { if (m.nombre_apellido.indexOf('PRUEBA ') === 0) ids[m.id] = m; });
  const limpiar = function (tabla, cols) {
    filas_(tabla).filter(function (f) { return cols.some(function (c) { return ids[f[c]]; }); })
      .sort(function (a, b) { return b._f - a._f; })
      .forEach(function (f) { hoja_(tabla).deleteRow(f._f); });
    delete _cacheTablas[tabla];
  };
  limpiar('DEUDAS', ['deudor_id', 'acreedor_id']);
  limpiar('GUARDIAS', ['medico_que_hizo_id', 'medico_titular_id']);
  limpiar('VACACIONES', ['medico_id']);
  limpiar('GUARDIA_FIJA', ['medico_id']);
  limpiar('MEDICOS', ['id']);
  return Object.keys(ids).length;
}
