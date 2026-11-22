// Excel de RRHH. Reproduce la estructura de RESPALDOGUARDIAS2026.xlsx usando sus mismos
// estilos (PlantillaExcel.js). El archivo se arma byte a byte, sin depender de Drive.

const COLUMNA_X = { HABIL_12: 'D', HABIL_24: 'E', NO_HABIL_12: 'F', NO_HABIL_24: 'G' };
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Solo REEMPLAZO_HOSPITAL en CONFIRMADA facturados en ese mes. Dos médicos en el mismo puesto
// no entran hasta que lo resuelvan.
function filasExcel_(mes) {
  const enDoble = idsEnDoble_();
  return filas_('GUARDIAS').filter(function (g) {
    return g.tipo === TIPO.HOSPITAL && estaConfirmada_(g) && g.mes_facturacion === mes && !enDoble[g.id];
  }).map(function (g) {
    return {
      guardia_id: g.id,
      fecha: g.fecha,
      nombre: nombreDe_(g.medico_que_hizo_id).toUpperCase(),
      horas: Number(g.horas),
      columna: COLUMNA_X[categoriaDe_(g.fecha) + '_' + g.horas],
      reclamo: g.observacion === MARCA_RECLAMO
    };
  }).sort(ordenFilas_);
}

// Fecha, primero las de 24 h y luego por nombre: es el orden de la planilla original.
function ordenFilas_(a, b) {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  if (a.horas !== b.horas) return b.horas - a.horas;
  return a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0;
}

function tituloExcel_(mes) { return 'REEMPLAZOS DE GUARDIAS MES DE ' + nombreMesAnio_(mes); }
function nombreArchivoExcel_(mes) { return 'Reemplazos_Guardias_' + capital_(nombreMes_(mes)) + '_' + mes.slice(0, 4) + '.xlsx'; }
// Pestaña como en el respaldo: oct2026, sep2026...
function nombrePestana_(mes) { return MESES_CORTOS[Number(mes.slice(5)) - 1] + mes.slice(0, 4); }
function serialExcel_(fecha) { return Math.round((aUTC_(fecha) - Date.UTC(1899, 11, 30)) / 86400000); }

function escaparXml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// XML de una pestaña. Los números s="..." son los mismos estilos de la planilla original.
function hojaXml_(mes, filas, cadenas, seleccionada) {
  const cad = function (texto) {
    let i = cadenas.indexOf(texto);
    if (i < 0) { cadenas.push(texto); i = cadenas.length - 1; }
    return i;
  };
  const texto = function (ref, s, valor) { return '<c r="' + ref + '" s="' + s + '" t="s"><v>' + cad(valor) + '</v></c>'; };
  const vacia = function (ref, s) { return '<c r="' + ref + '" s="' + s + '"/>'; };

  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<dimension ref="A1:G' + Math.max(3 + filas.length, 3) + '"/>' +
    '<sheetViews><sheetView ' + (seleccionada ? 'tabSelected="1" ' : '') + 'zoomScale="86" zoomScaleNormal="86" workbookViewId="0"/></sheetViews>' +
    '<sheetFormatPr baseColWidth="10" defaultRowHeight="15"/>' +
    '<cols><col min="1" max="1" width="13.85546875" customWidth="1"/><col min="2" max="2" width="22.7109375" customWidth="1"/>' +
    '<col min="4" max="4" width="14.85546875" customWidth="1"/><col min="5" max="5" width="14.28515625" customWidth="1"/>' +
    '<col min="6" max="6" width="13.5703125" customWidth="1"/><col min="7" max="7" width="28.5703125" customWidth="1"/></cols><sheetData>';

  x += '<row r="1" spans="1:7" ht="18.75" customHeight="1" thickBot="1">' + vacia('A1', 1) + vacia('B1', 2) + texto('C1', 3, tituloExcel_(mes)) +
    vacia('D1', 2) + vacia('E1', 2) + vacia('F1', 2) + vacia('G1', 4) + '</row>';
  x += '<row r="2" spans="1:7" ht="27" customHeight="1" thickBot="1">' + vacia('A2', 5) + vacia('B2', 5) + vacia('C2', 6) + texto('D2', 7, 'HABILES') +
    vacia('E2', 6) + texto('F2', 7, 'NO HABILES') + vacia('G2', 6) + '</row>';
  x += '<row r="3" spans="1:7" ht="26.25" customHeight="1">' + texto('A3', 14, 'FECHA') + texto('B3', 15, 'NOMBRE Y APELLIDO') + vacia('C3', 16) +
    texto('D3', 17, '12 HS') + texto('E3', 17, '24 HS') + texto('F3', 17, '12 HS') + texto('G3', 17, '24 HS') + '</row>';

  filas.forEach(function (f, i) {
    const n = 4 + i;
    x += '<row r="' + n + '" spans="1:7"><c r="A' + n + '" s="28"><v>' + serialExcel_(f.fecha) + '</v></c>' + texto('B' + n, 23, f.nombre);
    ['C', 'D', 'E', 'F', 'G'].forEach(function (col) {
      x += col === f.columna ? texto(col + n, 24, 'X') : vacia(col + n, 24);
    });
    x += '</row>';
  });
  return x + '</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
}

// Arma un .xlsx con una pestaña por mes. Devuelve un arreglo de bytes (0-255).
function construirXlsx_(meses) {
  const cadenas = [];
  const hojas = meses.map(function (mes, i) {
    return { nombre: nombrePestana_(mes), xml: hojaXml_(mes, filasExcel_(mes), cadenas, i === meses.length - 1) };
  });
  const cabecera = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const archivos = [
    ['[Content_Types].xml', cabecera + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      hojas.map(function (h, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join('') +
      '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'],
    ['_rels/.rels', cabecera + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', cabecera + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<bookViews><workbookView activeTab="' + (hojas.length - 1) + '"/></bookViews><sheets>' +
      hojas.map(function (h, i) { return '<sheet name="' + h.nombre + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') +
      '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', cabecera + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      hojas.map(function (h, i) {
        return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      }).join('') +
      '<Relationship Id="rId91" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
      '<Relationship Id="rId92" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId93" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'],
    ['xl/theme/theme1.xml', PLANTILLA_TEMA],
    ['xl/styles.xml', PLANTILLA_ESTILOS]
  ];
  hojas.forEach(function (h, i) { archivos.push(['xl/worksheets/sheet' + (i + 1) + '.xml', h.xml]); });
  archivos.push(['xl/sharedStrings.xml', cabecera + '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" uniqueCount="' + cadenas.length + '">' +
    cadenas.map(function (c) { return '<si><t>' + escaparXml_(c) + '</t></si>'; }).join('') + '</sst>']);
  return zipSinComprimir_(archivos);
}

function blobExcel_(mes, nombre) {
  return Utilities.newBlob(bytesConSigno_(construirXlsx_([mes])), MIME_XLSX, nombre || nombreArchivoExcel_(mes));
}

// Todos los meses que tienen reemplazos, una pestaña por mes, como el respaldo.
function mesesConReemplazos_() {
  const meses = {};
  filas_('GUARDIAS').forEach(function (g) {
    if (g.tipo === TIPO.HOSPITAL && estaConfirmada_(g) && g.mes_facturacion) meses[g.mes_facturacion] = 1;
  });
  return Object.keys(meses).sort();
}

function bytesConSigno_(bytes) { return bytes.map(function (b) { return b > 127 ? b - 256 : b; }); }

function utf8_(s) {
  const out = [];
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xC0 | c >> 6, 0x80 | c & 63);
    else if (c < 0x10000) out.push(0xE0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    else out.push(0xF0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
  }
  return out;
}

function crc32_(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = crc >>> 1 ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}

// ZIP mínimo (método "guardado"): es lo único que necesita un .xlsx.
function zipSinComprimir_(archivos) {
  const le16 = function (n) { return [n & 255, n >>> 8 & 255]; };
  const le32 = function (n) { return [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255]; };
  const fijo = [].concat(le16(20), le16(0x0800), le16(0), le16(0), le16(0x5021)); // versión, UTF-8, sin comprimir, hora y fecha fijas
  const salida = [];
  const central = [];
  const agregar = function (dest, arr) { for (let i = 0; i < arr.length; i++) dest.push(arr[i]); };

  archivos.forEach(function (a) {
    const nombre = utf8_(a[0]);
    const datos = utf8_(a[1]);
    const tam = le32(datos.length);
    const firma = [].concat(le32(crc32_(datos)), tam, tam, le16(nombre.length), le16(0));
    const pos = salida.length;
    agregar(salida, [0x50, 0x4B, 3, 4]);
    agregar(salida, fijo);
    agregar(salida, firma);
    agregar(salida, nombre);
    agregar(salida, datos);
    agregar(central, [0x50, 0x4B, 1, 2]);
    agregar(central, le16(20));
    agregar(central, fijo);
    agregar(central, firma);
    agregar(central, [].concat(le16(0), le16(0), le16(0), le32(0), le32(pos)));
    agregar(central, nombre);
  });
  const inicio = salida.length;
  agregar(salida, central);
  agregar(salida, [0x50, 0x4B, 5, 6, 0, 0, 0, 0]);
  agregar(salida, [].concat(le16(archivos.length), le16(archivos.length), le32(central.length), le32(inicio), le16(0)));
  return salida;
}

// Pestaña viva dentro de la Google Sheet (oct2026, nov2026...), que se va cargando sola a
// medida que se confirman los reemplazos. Misma estructura que la planilla de RRHH.
function marcarMesSucio_(mes) { if (mes) _mesesSucios[mes] = true; }

function refrescarMesesSucios_() {
  Object.keys(_mesesSucios).forEach(refrescarPestanaMes_);
  _mesesSucios = {};
}

function refrescarPestanaMes_(mes) {
  const ss = libro_();
  const nombre = nombrePestana_(mes);
  const filas = filasExcel_(mes);
  let h = ss.getSheetByName(nombre);
  if (!h && !filas.length) return;
  if (!h) h = ss.insertSheet(nombre);
  h.clear();
  const total = 3 + filas.length;
  if (h.getMaxRows() < total) h.insertRowsAfter(h.getMaxRows(), total - h.getMaxRows());

  const vals = [
    ['', '', tituloExcel_(mes), '', '', '', ''],
    ['', '', '', 'HABILES', '', 'NO HABILES', ''],
    ['FECHA', 'NOMBRE Y APELLIDO', '', '12 HS', '24 HS', '12 HS', '24 HS']
  ];
  filas.forEach(function (f) {
    const fila = [serialExcel_(f.fecha), f.nombre, '', '', '', '', ''];
    fila['ABCDEFG'.indexOf(f.columna)] = 'X';
    vals.push(fila);
  });
  h.getRange(1, 1, vals.length, 7).setValues(vals);

  [13.86, 22.71, 10.71, 14.86, 14.29, 13.57, 28.57].forEach(function (ancho, i) { h.setColumnWidth(i + 1, Math.round(ancho * 7 + 5)); });
  h.setRowHeight(1, 25);
  h.setRowHeight(2, 36);
  h.setRowHeight(3, 35);
  h.getRange(1, 1, 1, 7).setBackground('#6D9EEB').setFontFamily('Arial');
  h.getRange(1, 3).setFontSize(14).setFontWeight('bold');
  h.getRange(2, 1, 2, 7).setBackground('#9FC5E8').setFontFamily('Arial').setFontSize(10).setFontWeight('bold').setWrap(true);
  h.getRange(1, 1, 3, 7).setBorder(true, true, true, true, true, true, '#CCCCCC', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  if (filas.length) {
    h.getRange(4, 1, filas.length, 1).setNumberFormat('dd/MM/yyyy');
    h.getRange(4, 2, filas.length, 1).setFontFamily('Arial').setFontSize(10).setHorizontalAlignment('center');
    h.getRange(4, 3, filas.length, 5).setHorizontalAlignment('center');
    h.getRange(4, 1, filas.length, 7).setBorder(true, true, true, true, true, true, '#000000', SpreadsheetApp.BorderStyle.SOLID);
  }
}
