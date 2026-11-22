// Constantes y utilidades de fecha. Las fechas se manejan siempre como texto 'aaaa-mm-dd'
// y los meses como 'aaaa-mm', para no depender de zonas horarias.
//
// IMPORTANTE: en Apps Script, toda función global cuyo nombre NO termina en "_" se puede
// llamar desde el navegador de cualquiera. Por eso todo lo interno termina en "_".
// test/seguridad.test.js verifica que no se escape ninguna.

const TZ = 'America/Argentina/Buenos_Aires';
const REGLA_ORO = 'Lo que no esté confirmado en la app al cierre del mes no va a RRHH este mes y se reclama en el cierre siguiente. Cargar es la forma de cobrar.';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

const TURNOS = {
  '24H': { horas: 24, nombre: '24 h' },
  '12H_DIA': { horas: 12, nombre: '12 h de día' },
  '12H_NOCHE': { horas: 12, nombre: '12 h de noche' }
};
const TIPO = { CONTRATO: 'CONTRATO', HOSPITAL: 'REEMPLAZO_HOSPITAL', COMPANERO: 'COBERTURA_COMPANERO' };
const ESTADO = {
  PREVISTA: 'PREVISTA',
  CONFIRMADA: 'CONFIRMADA',
  ANTICIPADA: 'CONFIRMADA_ANTICIPADA',
  ESPERANDO: 'ESPERANDO_CONFIRMACION_TITULAR',
  CONFLICTO: 'EN_CONFLICTO',
  ANULADA: 'ANULADA'
};
const MARCA_RECLAMO = 'reclamo mes anterior';
const ESTADO_BAJA = 'BAJA'; // en MEDICOS.activo: se fue del servicio, para siempre
const CONTROL = { SI: 'SI', CUBIERTA: 'CUBIERTA', NO_SE_HIZO: 'NO_SE_HIZO' };
// Único destino del Excel. La app nunca le manda nada a RRHH: el envío lo hace esta persona a mano.
const MAIL_REVISION = 'revision@demo.invalid'; // DEMO

// Error con un mensaje pensado para mostrarle al médico tal cual.
class ErrorUsuario extends Error {}

function ahora_() { return new Date(); }
function hoy_() { return Utilities.formatDate(ahora_(), TZ, 'yyyy-MM-dd'); }
function horaActual_() { return Utilities.formatDate(ahora_(), TZ, 'HH:mm'); }
function marcaTiempo_() { return Utilities.formatDate(ahora_(), TZ, 'yyyy-MM-dd HH:mm:ss'); }

function aUTC_(fecha) {
  const p = fecha.split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]);
}
function desdeUTC_(ms) { return new Date(ms).toISOString().slice(0, 10); }
function sumarDias_(fecha, n) { return desdeUTC_(aUTC_(fecha) + n * 86400000); }
function diaSemana_(fecha) { return new Date(aUTC_(fecha)).getUTCDay(); }
function mesDe_(fecha) { return fecha.slice(0, 7); }
function sumarMeses_(mes, n) {
  const p = mes.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
function ultimoDia_(mes) { return sumarDias_(sumarMeses_(mes, 1) + '-01', -1); }
function diasDelMes_(mes) {
  const salida = [];
  for (let f = mes + '-01'; mesDe_(f) === mes; f = sumarDias_(f, 1)) salida.push(f);
  return salida;
}
function esFechaValida_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && desdeUTC_(aUTC_(s)) === s;
}
function esMesValido_(s) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(s); }

// '2026-10-12' -> '12/10'
function fechaCorta_(fecha) {
  const p = fecha.split('-');
  return Number(p[2]) + '/' + p[1];
}
// '2026-12-02' -> '2/12' (como en los mensajes del documento)
function fechaCobroCorta_(fecha) {
  const p = fecha.split('-');
  return Number(p[2]) + '/' + Number(p[1]);
}
function nombreMes_(mes) { return MESES[Number(mes.slice(5)) - 1]; }
function nombreMesAnio_(mes) { return nombreMes_(mes) + ' ' + mes.slice(0, 4); }
function capital_(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Normaliza 'Miércoles ' -> 'miercoles'
function normalizarDia_(s) {
  return String(s).toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function esSi_(v) { return /^(true|si|sí|1|x|verdadero)$/i.test(String(v).trim()); }
