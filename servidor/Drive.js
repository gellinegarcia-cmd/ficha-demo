// Guarda el Excel en Drive. Se usa el permiso drive.file (solo ve lo que crea la app) y no
// DriveApp, que exigiría acceso a todo el Drive desde una web app pública.

const CARPETA_DRIVE = 'Reemplazos Guardias UPA';
const API_DRIVE = 'https://www.googleapis.com/drive/v3/files';
const API_DRIVE_SUBIDA = 'https://www.googleapis.com/upload/drive/v3/files';

function llamarDrive_(url, op) {
  const r = UrlFetchApp.fetch(url, Object.assign({
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  }, op || {}));
  const codigo = r.getResponseCode();
  if (codigo >= 300) throw new Error('Drive ' + codigo + ': ' + r.getContentText().slice(0, 200));
  const texto = r.getContentText();
  return texto ? JSON.parse(texto) : {};
}

// La carpeta se crea una vez. Si alguien la manda a la papelera, se crea de nuevo.
function carpetaDrive_() {
  const guardada = propiedad_('DRIVE_CARPETA');
  if (guardada) {
    try {
      if (!llamarDrive_(API_DRIVE + '/' + guardada + '?fields=id,trashed').trashed) return guardada;
    } catch (e) {
      console.error(e);
    }
  }
  const nueva = llamarDrive_(API_DRIVE + '?fields=id', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ name: CARPETA_DRIVE, mimeType: 'application/vnd.google-apps.folder' })
  });
  setPropiedad_('DRIVE_CARPETA', nueva.id);
  return nueva.id;
}

function guardarEnDrive_(blob) {
  const limite = 'guardias_upa_limite';
  const datos = JSON.stringify({ name: blob.getName(), parents: [carpetaDrive_()] });
  const cuerpo = '--' + limite + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + datos +
    '\r\n--' + limite + '\r\nContent-Type: ' + MIME_XLSX + '\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
    Utilities.base64Encode(blob.getBytes()) + '\r\n--' + limite + '--';
  return llamarDrive_(API_DRIVE_SUBIDA + '?uploadType=multipart&fields=id,webViewLink', {
    method: 'post',
    contentType: 'multipart/related; boundary=' + limite,
    payload: cuerpo
  });
}

function borrarDeDrive_(id) {
  llamarDrive_(API_DRIVE + '/' + id, { method: 'delete' });
}
