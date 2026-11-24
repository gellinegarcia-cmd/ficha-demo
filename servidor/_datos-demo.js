// Datos de ejemplo de la demo: noviembre 2026, médicos inventados. Todos con PIN 1111.
// JAVIER GARCIA es el administrador ("jefe"). PAULA RIOS todavía no hizo el registro (se ve el flujo completo).
// SOFIA LUNA ya se registró como SOLO_REEMPLAZO, con un reemplazo fijo semanal.
// Avisos: casi todos tienen los avisos push activos (simulados); NICOLAS QUIROGA solo mail.
// Ausencia: NICOLAS QUIROGA, licencia del 21 al 30/11: dos guardias libres, una ya tomada por DIEGO FERREYRA.
// Corre dentro de servidor.html, después de simulador.js y de los archivos de src/.
(function (w) {
  'use strict';
  const RELOJ = '2026-11-20T10:00:00-03:00';
  w.ahora_ = () => new Date(RELOJ);
  reiniciarEstado_();
  crearHojas_();
  cargarDatosIniciales_();
  setCfg_('codigo_servicio', 'DEMO24');
  setCfg_('codigo_jefe', 'JEFE24');
  setPropiedad_('codigo_jefe_habilitado', 'JEFE24'); // en la demo se puede probar "Soy el jefe del servicio"
  // Firebase simulado: los avisos no salen a ningún lado, se ven en la página.
  setPropiedad_('FCM_SA', JSON.stringify({ project_id: 'guardias-demo', client_email: 'demo@guardias-demo.iam.gserviceaccount.com', private_key: 'DEMO' }));

  const M = {};
  const alta = (clave, nombre, extra) => {
    reiniciarEstado_();
    M[clave] = insertar_('MEDICOS', Object.assign({ id: siguienteId_('MEDICOS'), nombre_apellido: nombre, pin: '1111', email: nombre.split(' ')[0].toLowerCase() + '@demo.invalid', telegram_chat_id: '',
      activo: true, es_admin: false, contrato_revisado: true, pin_propio: true, vinculo: 'CONTRATO' }, extra || {}));
  };
  alta('javier', 'JAVIER GARCIA', { es_admin: true });
  alta('martin', 'MARTIN SOSA');
  alta('laura', 'LAURA BENITEZ');
  alta('diego', 'DIEGO FERREYRA');
  alta('nico', 'NICOLAS QUIROGA');
  alta('paula', 'PAULA RIOS', { contrato_revisado: false, pin_propio: false, vinculo: '', email: '' });
  alta('sofia', 'SOFIA LUNA', { vinculo: 'SOLO_REEMPLAZO' });

  ['javier', 'martin', 'laura', 'diego', 'sofia'].forEach((k) => { reiniciarEstado_(); guardarPush_(buscarPorId_('MEDICOS', M[k].id), 'demo-celular-' + k + '-' + 'x'.repeat(24), 'android'); });
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
  // Bolsa de guardias libres: NICOLAS QUIROGA se ausenta (licencia) del 21 al 30/11. Sus lunes 23 y 30
  // quedan libres; la del 23 ya la tomó DIEGO FERREYRA. Los compañeros no ven quién se ausenta.
  agregarVacaciones_(med('nico'), { desde: '2026-11-21', hasta: '2026-11-30', tipo: 'licencia' });
  reiniciarEstado_();
  tomarGuardia_(med('diego'), guardia('2026-11-23', 'nico').id);
  refrescarMesesSucios_();

  // Lo que se hace en la demo se guarda solo en esta pestaña y se repite al recargar la página.
  const CLAVE = 'guardias-demo-llamadas';
  const PERMITIDAS = ['api', 'login', 'medicosPublico', 'autoRegistro'];
  let llamadas = [];
  try { llamadas = JSON.parse(sessionStorage.getItem(CLAVE) || '[]'); } catch (e) { llamadas = []; }
  // Además de las llamadas de la app, se repiten los botones tocados en un aviso y el recordatorio simulado.
  const repetir = (c) => {
    if (c.f === '__accion') return accionAviso_(c.args[0]);
    if (c.f === '__recordatorio') { reiniciarEstado_(); return tareaRecordatorioDiario_(hoy_()); }
    return w[c.f].apply(null, c.args);
  };
  const anotar = (c) => { llamadas.push(c); try { sessionStorage.setItem(CLAVE, JSON.stringify(llamadas)); } catch (e) { /* sin guardar */ } };
  llamadas.forEach((c) => { try { repetir(c); } catch (e) { /* lo mismo que la primera vez */ } });
  w.demoAccion = function (firma) { const r = accionAviso_(firma); anotar({ f: '__accion', args: [firma] }); return JSON.parse(JSON.stringify(r)); };
  w.demoRecordatorio = function () { reiniciarEstado_(); tareaRecordatorioDiario_(hoy_()); anotar({ f: '__recordatorio', args: [] }); };

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
  // Avisos push "enviados" (a quién, texto y botones) y mails de respaldo.
  const vistaPush = (p, i) => {
    reiniciarEstado_();
    const fila = filas_('PUSH').find((x) => x.token === p.token);
    return { n: i, medico_id: fila ? fila.medico_id : '', a: fila ? nombreDe_(fila.medico_id) : '', titulo: p.data.titulo, cuerpo: p.data.cuerpo,
      url: p.data.url, acciones: JSON.parse(p.data.acciones || '[]') };
  };
  w.demoPush = function (desde) { return w.__simulador.push.map(vistaPush).slice(desde || 0); };
  w.demoMensajes = function () {
    return { push: w.demoPush(0), mails: w.__simulador.mails.map((m) => ({ a: m.to, asunto: m.subject, cuerpo: m.body || '' })) };
  };
  w.demoListo = true;
})(window);
