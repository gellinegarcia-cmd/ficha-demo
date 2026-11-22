// Datos de ejemplo de la demo: noviembre 2026, médicos inventados. Todos con PIN 1111.
// JAVIER GARCIA es el administrador ("jefe"). PAULA RIOS todavía no hizo el registro (se ve el flujo completo).
// SOFIA LUNA ya se registró como SOLO_REEMPLAZO, con un reemplazo fijo semanal.
// Corre dentro de servidor.html, después de simulador.js y de los archivos de src/.
(function (w) {
  'use strict';
  const RELOJ = '2026-11-20T10:00:00-03:00';
  w.ahora_ = () => new Date(RELOJ);
  reiniciarEstado_();
  crearHojas_();
  cargarDatosIniciales_();
  setPropiedad_('TELEGRAM_TOKEN', 'DEMO');
  setPropiedad_('TELEGRAM_BOT', 'guardias_upa_demo_bot'); // en la demo, "Vincular Telegram" se simula

  const M = {};
  let chat = 1000;
  const alta = (clave, nombre, extra) => {
    reiniciarEstado_();
    M[clave] = insertar_('MEDICOS', Object.assign({ id: siguienteId_('MEDICOS'), nombre_apellido: nombre, pin: '1111', email: '', telegram_chat_id: String(chat++),
      activo: true, es_admin: false, contrato_revisado: true, pin_propio: true, vinculo: 'CONTRATO' }, extra || {}));
  };
  alta('javier', 'JAVIER GARCIA', { es_admin: true });
  alta('martin', 'MARTIN SOSA');
  alta('laura', 'LAURA BENITEZ');
  alta('diego', 'DIEGO FERREYRA');
  alta('nico', 'NICOLAS QUIROGA');
  alta('paula', 'PAULA RIOS', { contrato_revisado: false, pin_propio: false, vinculo: '', telegram_chat_id: '' });
  alta('sofia', 'SOFIA LUNA', { vinculo: 'SOLO_REEMPLAZO' });

  const fija = (k, d, t, tipo) => insertar_('GUARDIA_FIJA', { medico_id: M[k].id, dia_semana: d, turno: t, tipo: tipo || 'CONTRATO', vigente: true });
  fija('javier', 'jueves', '24H');
  fija('javier', 'lunes', '24H', 'REEMPLAZO_HOSPITAL');
  fija('martin', 'martes', '24H');
  fija('laura', 'miercoles', '24H');
  fija('laura', 'sabado', '12H_DIA', 'REEMPLAZO_HOSPITAL');
  fija('diego', 'viernes', '24H');
  fija('nico', 'lunes', '12H_NOCHE');
  fija('sofia', 'sabado', '12H_NOCHE', 'REEMPLAZO_HOSPITAL');
  abrirMes_('2026-11');

  const med = (k) => buscarPorId_('MEDICOS', M[k].id);
  const guardia = (f, k) => filas_('GUARDIAS').find((x) => x.fecha === f && x.medico_titular_id === M[k].id && x.estado !== 'ANULADA');
  hagoYo_(med('javier'), guardia('2026-11-02', 'javier').id);
  hagoYo_(med('javier'), guardia('2026-11-05', 'javier').id);
  meCubre_(med('javier'), guardia('2026-11-09', 'javier').id, 'COBERTURA_COMPANERO', M.martin.id);
  responderCobertura_(med('martin'), guardia('2026-11-09', 'javier').id, true);
  cargarGuardia_(med('javier'), { fecha: '2026-11-11', turno: '24H', titular_id: M.laura.id });
  responderCobertura_(med('laura'), guardia('2026-11-11', 'laura').id, true);
  hagoYo_(med('javier'), guardia('2026-11-12', 'javier').id);
  cargarGuardia_(med('javier'), { fecha: '2026-11-14', turno: '12H_DIA', titular_id: '' });
  agregarVacaciones_(med('javier'), { desde: '2026-11-16', hasta: '2026-11-16', tipo: 'vacaciones' });
  agregarVacaciones_(med('javier'), { desde: '2026-12-21', hasta: '2026-12-31', tipo: 'vacaciones' });
  meCubre_(med('javier'), guardia('2026-11-19', 'javier').id, 'COBERTURA_COMPANERO', M.diego.id);
  hagoYo_(med('martin'), guardia('2026-11-03', 'martin').id);
  hagoYo_(med('martin'), guardia('2026-11-10', 'martin').id);
  hagoYo_(med('laura'), guardia('2026-11-04', 'laura').id);
  hagoYo_(med('diego'), guardia('2026-11-06', 'diego').id);
  hagoYo_(med('diego'), guardia('2026-11-13', 'diego').id);
  meCubre_(med('diego'), guardia('2026-11-20', 'diego').id, 'REEMPLAZO_HOSPITAL', M.nico.id);
  hagoYo_(med('sofia'), guardia('2026-11-07', 'sofia').id);
  hagoYo_(med('sofia'), guardia('2026-11-14', 'sofia').id);
  cargarGuardia_(med('sofia'), { fecha: '2026-11-17', turno: '24H', titular_id: M.martin.id, tipo: 'COBERTURA_COMPANERO' });
  responderCobertura_(med('martin'), guardia('2026-11-17', 'martin').id, true);
  refrescarMesesSucios_();

  // Lo que se hace en la demo se guarda solo en esta pestaña y se repite al recargar la página.
  const CLAVE = 'guardias-demo-llamadas';
  const PERMITIDAS = ['api', 'login', 'medicosPublico'];
  let llamadas = [];
  try { llamadas = JSON.parse(sessionStorage.getItem(CLAVE) || '[]'); } catch (e) { llamadas = []; }
  // "Vincular Telegram": en la demo no hay bot; se simula el /start que mandaría Telegram.
  const vincular = (codigo) => { reiniciarEstado_(); vincularChat_(String(9000 + Number(String(codigo).split('-')[0])), String(codigo)); };
  llamadas.forEach((c) => {
    try { if (c.f === '__vincular') vincular(c.args[0]); else w[c.f].apply(null, c.args); } catch (e) { /* lo mismo que la primera vez */ }
  });
  w.demoVincularTelegram = function (codigo) {
    vincular(codigo);
    llamadas.push({ f: '__vincular', args: [String(codigo)] });
    try { sessionStorage.setItem(CLAVE, JSON.stringify(llamadas)); } catch (e) { /* sin guardar */ }
  };

  w.demoLlamar = function (f, args) {
    if (!PERMITIDAS.includes(f)) throw new Error('No permitido en la demo: ' + f);
    const copia = JSON.parse(JSON.stringify(args));
    let r, error;
    try { r = w[f].apply(null, copia); } catch (e) { error = e; }
    llamadas.push({ f, args: JSON.parse(JSON.stringify(args)) });
    try { sessionStorage.setItem(CLAVE, JSON.stringify(llamadas)); } catch (e) { /* sin guardar */ }
    if (error) throw error;
    return JSON.parse(JSON.stringify(r === undefined ? null : r));
  };
  w.demoReiniciar = function () { try { sessionStorage.removeItem(CLAVE); } catch (e) { /* nada */ } };
  w.demoMensajes = function () {
    const s = w.__simulador;
    return {
      telegram: s.telegram.filter((t) => t.metodo === 'sendMessage').map((t) => {
        const m = filas_('MEDICOS').find((x) => String(x.telegram_chat_id) === String(t.chat_id));
        return { a: m ? m.nombre_apellido : t.chat_id, texto: t.text, botones: ((t.reply_markup && t.reply_markup.inline_keyboard) || []).map((f) => f.map((b) => b.text)) };
      }),
      mails: s.mails.map((m) => ({ a: m.to, asunto: m.subject, cuerpo: m.body || '' }))
    };
  };
  w.demoListo = true;
})(window);
