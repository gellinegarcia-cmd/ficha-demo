// Guarda el Excel en Drive con DriveApp (servicio integrado de Apps Script).
// Antes se usaba la API REST de Drive con el permiso drive.file, pero esa API tiene que estar habilitada en el
// proyecto interno de Apps Script, al que la dueña no tiene acceso. DriveApp no necesita habilitar nada.
// Contrapartida: el permiso es "todo el Drive". DriveApp se usa solo en este archivo y solo para crear la carpeta
// y guardar (o quitar) el Excel; ninguna acción permite leer otros archivos.

const CARPETA_DRIVE = 'Reemplazos Guardias UPA';

// La carpeta se crea una vez. Si alguien la manda a la papelera, se crea de nuevo.
function carpetaDrive_() {
  const guardada = propiedad_('DRIVE_CARPETA');
  if (guardada) {
    try {
      const f = DriveApp.getFolderById(guardada);
      if (!f.isTrashed()) return f;
    } catch (e) {
      console.error(e);
    }
  }
  const nueva = DriveApp.createFolder(CARPETA_DRIVE);
  setPropiedad_('DRIVE_CARPETA', nueva.getId());
  return nueva;
}

function guardarEnDrive_(blob) {
  const archivo = carpetaDrive_().createFile(blob);
  return { id: archivo.getId(), webViewLink: archivo.getUrl() };
}

function borrarDeDrive_(id) {
  DriveApp.getFileById(id).setTrashed(true);
}

// Explica en palabras simples un error de Google (permisos, servicios deshabilitados, cuotas), con qué hacer.
function explicarError_(e) {
  const m = String((e && e.message) || e || '');
  if (/has not been used in project|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(m)) {
    return 'Un servicio de Google que usa la app está deshabilitado. Avisale a Claude Code con este mensaje: se resuelve en el código, sin que tengas que entrar a Google Cloud.';
  }
  if (/authoriz|autoriz|permission|permiso|PERMISSION_DENIED|insufficient/i.test(m)) {
    return 'Faltan permisos. Abrí la planilla, tocá Fichá → 1. Instalar y aceptá los permisos que pide Google (si dice "Google no verificó esta app": Configuración avanzada → Ir a Fichá).';
  }
  if (/quota|cuota|Service invoked too many times|Rate Limit/i.test(m)) {
    return 'Se alcanzó un límite diario de Google. Se reintenta solo más tarde; si mañana sigue, avisale a Claude Code.';
  }
  return 'Error inesperado. Avisale a Claude Code con este mensaje.';
}
