// backend/controllers/cursadoController.js

const pool = require('../database');
const PDFDocument = require('pdfkit'); // 1. IMPORTAR PDFKit
const { PassThrough } = require('stream'); // Para manejar el streaming al cliente

// ==========================================================
// 1. FUNCIONES PRINCIPALES PARA EL HORARIO (Mi Horario)
// ==========================================================

/**
 * Obtener todas las carreras (sólo ID y nombre para menús).
 */
exports.getCarreras = async (req, res) => {
    try {
        // 🔑 ACTUALIZACIÓN: Filtrar solo carreras activas
        const [rows] = await pool.execute('SELECT id_carrera, nombre_carrera FROM carrera WHERE estado = "activa" ORDER BY nombre_carrera');
        res.json(rows);
    } catch (error) {
        console.error('Error en getCarreras:', error);
        res.status(500).json({ error: 'Error interno del servidor al obtener carreras' });
    }
};

/**
 * Obtener los años (distintos) para una carrera. 🆕
 */
exports.getAniosByCarrera = async (req, res) => {
    const { id_carrera } = req.query; 

    if (!id_carrera) {
        return res.status(400).json({ error: 'Falta parámetro: id_carrera es requerido.' });
    }

    try {
        const sql = `
            SELECT DISTINCT año 
            FROM materia 
            WHERE id_carrera = ? AND estado = 'activa'  
            ORDER BY año
        `; // 🔑 ACTUALIZACIÓN: Filtrar solo materias activas
        const [rows] = await pool.execute(sql, [id_carrera]); 
        // Devuelve un array de objetos con el año: [{ año: 1 }, { año: 2 }, ...]
        res.json(rows.map(row => row.año)); // Devuelve solo los números de año para simplificar el frontend
    } catch (error) {
        console.error('Error en getAniosByCarrera:', error);
        res.status(500).json({ error: 'Error interno del servidor al obtener años.' });
    }
};

/**
 * Obtener materias por carrera y año.
 */
exports.getMaterias = async (req, res) => {
    const { id_carrera, año } = req.query; 

    if (!id_carrera || !año) {
        return res.status(400).json({ error: 'Faltan parámetros: id_carrera y año son requeridos.' });
    }

    try {
        const sql = `
            SELECT id_materia, nombre_materia
            FROM materia
            WHERE id_carrera = ? AND año = ? AND estado = 'activa' 
            ORDER BY nombre_materia
        `; // 🔑 ACTUALIZACIÓN: Filtrar solo materias activas
        const [rows] = await pool.execute(sql, [id_carrera, año]); 
        res.json(rows);
    } catch (error) {
        console.error('Error en getMaterias:', error);
        res.status(500).json({ error: 'Error interno del servidor al obtener materias.' });
    }
};

/**
 * Obtener horarios de bloques individuales para una materia específica.
 */
exports.getHorariosByMateria = async (req, res) => {
    const { id_materia } = req.query;

    if (!id_materia) {
        return res.status(400).json({ error: 'Falta parámetro: id_materia es requerido.' });
    }

    try {
        const sql = `
            SELECT dia_semana, hora_inicio, hora_fin 
            FROM horario 
            WHERE id_materia = ? AND estado = 'activa'
            ORDER BY FIELD(dia_semana, 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'), hora_inicio
        `; // 🔑 ACTUALIZACIÓN: Filtrar solo horarios activos
        const [rows] = await pool.execute(sql, [id_materia]);
        res.json(rows);
    } catch (error) {
        console.error('Error en getHorariosByMateria:', error);
        res.status(500).json({ error: 'Error interno del servidor al obtener horarios.' });
    }
};

// ==========================================================
// 2. FUNCIÓN PARA EL DETALLE DINÁMICO DE LA CARRERA (NUEVA)
// ==========================================================

/**
 * Obtener detalle completo de una carrera (información general y coordinador).
 */
exports.getCarreraDetalleById = async (req, res) => {
    const { id } = req.params; // id es id_carrera

    try {
        // Consulta 1: Obtener datos base de la carrera (filtrar por estado)
        const [carreraRows] = await pool.execute(
            'SELECT id_carrera, nombre_carrera, duracion, modalidad, año_aprobacion FROM carrera WHERE id_carrera = ? AND estado = "activa"', 
            [id]
        ); // 🔑 ACTUALIZACIÓN: Filtrar solo carreras activas

        if (carreraRows.length === 0) {
            return res.status(404).json({ error: 'Carrera no encontrada.' });
        }
        const carrera = carreraRows[0];
        
        // Consulta 2: Obtener el coordinador de la carrera (rol='Coordinador')
        const [coordinadorRows] = await pool.execute(
            `SELECT a.nombre_administrador, a.email, a.telefono
             FROM administrador a
             JOIN admin_carrera ac ON a.id_administrador = ac.id_administrador
             WHERE ac.id_carrera = ? AND a.rol = 'Coordinador' AND a.estado = 'activo'`, // Filtrar por el rol 'Coordinador' (Se asume que solo se quiere el coordinador activo, aunque no se pidió, es buena práctica)
            [id]
        );
        
        const coordinador = coordinadorRows.length > 0 ? coordinadorRows[0] : null;
        const respuesta = {
            ...carrera,
            coordinador: coordinador, // Si es null, el frontend lo maneja
        };

        res.json(respuesta);
    } catch (error) {
        console.error('Error al obtener el detalle de la carrera:', error);
        res.status(500).json({ error: 'Error interno del servidor al obtener el detalle de la carrera.' });
    }
};

// ==========================================================
// 3. OTRAS FUNCIONES (Manteniendo las existentes)
// ==========================================================

/**
 * Obtener detalle completo de una materia (correlativas y horarios).
 */
exports.getMateriaById = async (req, res) => {
    const { id } = req.params;
    try {
        // 🔑 ACTUALIZACIÓN: Filtrar solo materias activas
        const [materiaRows] = await pool.execute('SELECT * FROM materia WHERE id_materia = ? AND estado = "activa"', [id]);
        if (materiaRows.length === 0) {
            return res.status(404).json({ error: 'Materia no encontrada.' });
        }
        const materia = materiaRows[0];
        
        // 🔑 ACTUALIZACIÓN: Filtrar correlatividades activas Y que la materia requisito esté activa
        const [cursarRows] = await pool.execute(
             `SELECT m.nombre_materia, c.estado_requisito
              FROM correlatividad c
              JOIN materia m ON c.id_materia_requisito = m.id_materia
              WHERE c.id_materia_principal = ? 
                AND c.tipo = 'Cursar' 
                AND (c.estado_requisito = 'aprobada' OR c.estado_requisito = 'regular') 
                AND c.estado = 'activa' 
                AND m.estado = 'activa'`, [id]
        );
        const requisitosCursar = cursarRows.map(row => `${row.nombre_materia} - ${row.estado_requisito}`);

        // 🔑 ACTUALIZACIÓN: Filtrar correlatividades activas Y que la materia requisito esté activa
        const [rendirRows] = await pool.execute(
             `SELECT m.nombre_materia, c.estado_requisito
              FROM correlatividad c
              JOIN materia m ON c.id_materia_requisito = m.id_materia
              WHERE c.id_materia_principal = ? 
                AND c.tipo = 'Promoción/Rendir' 
                AND c.estado_requisito = 'aprobada' 
                AND c.estado = 'activa' 
                AND m.estado = 'activa'`, [id]
        );
        const requisitosRendir = rendirRows.map(row => `${row.nombre_materia} - ${row.estado_requisito}`);

        // 🔑 ACTUALIZACIÓN: Filtrar solo horarios activos
        const [horarioRows] = await pool.execute(`
            SELECT dia_semana, hora_inicio, hora_fin 
            FROM horario 
            WHERE id_materia = ? AND estado = 'activa' 
            ORDER BY FIELD(dia_semana, 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'), hora_inicio`, [id]
        );
        const horarios = horarioRows.map(h => `${h.dia_semana}, ${h.hora_inicio} - ${h.hora_fin}`);

        const respuesta = {
            ...materia,
            requisitos_cursar: requisitosCursar,
            requisitos_rendir: requisitosRendir,
            horarios: horarios
        };

        res.json(respuesta);
    } catch (error) {
        console.error('Error al obtener el detalle de la materia:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

/**
 * Obtener materias por año
 */
exports.getMateriasByAnioIncompleto = async (req, res) => {
    const { anio } = req.params;
    try {
        // 🔑 ACTUALIZACIÓN: Filtrar solo materias activas
        const [rows] = await pool.execute('SELECT * FROM materia WHERE año = ? AND estado = "activa"', [anio]);
        res.json(rows);
    } catch (error) {
        console.error('Error al obtener materias por año:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

/**
 * Buscar materias por nombre.
 */
exports.searchMaterias = async (req, res) => {
    const { nombre } = req.query;
    if (!nombre) {
        return res.status(400).json({ error: 'El parámetro de búsqueda "nombre" es requerido.' });
    }
    try {
        const searchTerm = `%${nombre}%`;
        // 🔑 ACTUALIZACIÓN: Filtrar solo materias activas
        const [rows] = await pool.execute('SELECT * FROM materia WHERE nombre_materia LIKE ? AND estado = "activa"', [searchTerm]);
        res.json(rows);
    } catch (error) {
        console.error('Error en la búsqueda de materias:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

/**
 * Función para registrar una vista (para materias destacadas).
 */
exports.registrarVista = async (req, res) => {
    const { id } = req.params;
    try {
        await pool.execute('UPDATE materia SET vistas = vistas + 1 WHERE id_materia = ?', [id]);
        res.status(200).send('Vista registrada correctamente.');
    } catch (error) {
        console.error('Error al registrar la vista:', error);
        res.status(500).send('Error al registrar la vista.');
    }
};

/**
 * Función para obtener las materias más vistas (destacadas) y sus horarios.
 */
exports.getMateriasDestacadas = async (req, res) => {
    try {
        // 🔑 ACTUALIZACIÓN: Filtrar solo materias activas
        const [materiasDestacadasRows] = await pool.execute(
            'SELECT id_materia, nombre_materia FROM materia WHERE estado = "activa" ORDER BY vistas DESC LIMIT 3'
        );

        if (materiasDestacadasRows.length === 0) {
            return res.json({ materias: [], horarios: [] });
        }
        
        const idsDestacadas = materiasDestacadasRows.map(m => m.id_materia);
        const placeholders = idsDestacadas.map(() => '?').join(',');

        // 🔑 ACTUALIZACIÓN: Filtrar solo horarios activos
        const [horariosDestacadosRows] = await pool.execute(
            `SELECT DISTINCT h.dia_semana, h.hora_inicio, h.hora_fin, m.nombre_materia
             FROM horario h
             JOIN materia m ON h.id_materia = m.id_materia
             WHERE h.id_materia IN (${placeholders}) AND h.estado = 'activa'`,
            idsDestacadas
        );

        res.json({
            materias: materiasDestacadasRows,
            horarios: horariosDestacadosRows
        });

    } catch (error) {
        console.error('Error al obtener materias destacadas:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

// ==========================================================
// NUEVA LÓGICA: Obtención de Datos Estructurados para el PDF
// ==========================================================
/**
 * Consulta la base de datos para obtener todos los datos necesarios para el Plan de Estudio,
 */
async function fetchPlanData(idCarrera) {
    // 1. Obtener detalles de la carrera (filtrar por estado)
    const [carreraRows] = await pool.execute(
        'SELECT id_carrera, nombre_carrera, duracion, modalidad, año_aprobacion FROM carrera WHERE id_carrera = ? AND estado = "activa"',
        [idCarrera] // 🔑 ACTUALIZACIÓN: Filtrar solo carreras activas
    );
    if (carreraRows.length === 0) return null;
    const carrera = carreraRows[0];
    
    // 2. Obtener todas las materias de la carrera (filtrar por estado)
    const [materiasRows] = await pool.execute(
        `SELECT 
            id_materia, nombre_materia, año, campo_formacion, modalidad, formato, 
            horas_semanales, 
            total_horas_anuales, 
            acreditacion
            FROM materia 
            WHERE id_carrera = ? AND estado = 'activa' 
            ORDER BY año, id_materia`, // 🔑 ACTUALIZACIÓN: Filtrar solo materias activas
        [idCarrera]
    );
    
    // 3. Obtener TODAS las correlatividades relevantes
    const idMaterias = materiasRows.map(m => m.id_materia);
    if (idMaterias.length === 0) {
        return { carrera, materiasPorAnio: {}, totalHorasAnuales: {}, totalHorasCarrera: 0 };
    }
    
    const placeholders = idMaterias.map(() => '?').join(',');

    // 🔑 ACTUALIZACIÓN: Filtrar solo correlatividades activas
    const [correlatividadRows] = await pool.execute(
        `SELECT 
            id_materia_principal, 
            id_materia_requisito, 
            tipo, 
            estado_requisito
            FROM correlatividad
            WHERE id_materia_principal IN (${placeholders}) AND estado = 'activa'`,
        idMaterias
    );

    // 4. Estructurar la información y calcular totales
    const materiasPorAnio = {};
    const totalHorasAnuales = {}; // Objeto para almacenar la suma de horas por año
    let totalHorasCarrera = 0;

    materiasRows.forEach(materia => {
        const anio = materia.año;
        // Convertir a número para la suma, si es null o string, se trata como 0
        const horasAnuales = materia.total_horas_anuales || 0;
        const horasAnualesNum = parseInt(horasAnuales, 10) || 0; 

        if (!materiasPorAnio[anio]) {
            materiasPorAnio[anio] = [];
            totalHorasAnuales[anio] = 0;
        }

        // Acumular totales
        totalHorasAnuales[anio] += horasAnualesNum;
        totalHorasCarrera += horasAnualesNum;
        
        // Estructurar correlatividades en el nuevo formato requerido
        const correlativas = correlatividadRows
            .filter(c => c.id_materia_principal === materia.id_materia)
            .reduce((acc, c) => {
                // Tipo "Cursar"
                if (c.tipo === 'Cursar') {
                    if (c.estado_requisito === 'Aprobada') {
                        acc.cursarAprobada.push(c.id_materia_requisito);
                    } else if (c.estado_requisito === 'Regular') {
                        acc.cursarRegular.push(c.id_materia_requisito);
                    }
                } 
                // Tipo "Promoción/Rendir"
                else if (c.tipo === 'Promoción/Rendir' && c.estado_requisito === 'Aprobada') {
                    acc.rendirAprobada.push(c.id_materia_requisito);
                }
                return acc;
            }, { 
                cursarAprobada: [], // Correlatividad para Cursar: Aprobada
                cursarRegular: [], // Correlatividad para Cursar: Regular
                rendirAprobada: []  // Correlatividad para Rendir/Promocionar: Aprobada
            });

        materiasPorAnio[anio].push({
            ...materia,
            correlativas
        });
    });

    return { carrera, materiasPorAnio, totalHorasAnuales, totalHorasCarrera };
}

// ==========================================================
// FUNCIONES AUXILIARES PARA DIBUJAR Y NOMBRES
// ==========================================================

/**
 * Convierte el número de año a su nombre completo.
 */
function getAnioText(anio) {
    switch(String(anio)) {
        case '1': return 'PRIMER AÑO';
        case '2': return 'SEGUNDO AÑO';
        case '3': return 'TERCER AÑO';
        case '4': return 'CUARTO AÑO';
        default: return `${anio}° AÑO`;
    }
}

// Anchos de columna actualizados para A4 Landscape (730 de ancho total)
// [ ID, CF, UNIDAD, FORMATO, MODALIDAD, HS_SEM, HS_ANU, ACREDITACIÓN, CORRELATIVIDADES (3 cols)]
const COL_WIDTHS = [30, 50, 160, 60, 60, 50, 60, 80, 80, 70, 90]; 
const TOTAL_TABLE_WIDTH = COL_WIDTHS.reduce((sum, w) => sum + w, 0); // Debería ser 730

/**
 * Dibuja la fila de cabecera con el texto del Año fusionado.
 */
function drawMergedAnioHeader(doc, y, x, anioText, headerHeight) {
    const cellPadding = 3;
    const totalWidth = TOTAL_TABLE_WIDTH;

    // 1. Dibujar el fondo y el borde de la celda fusionada
    doc.fillColor('#B0B0B0').rect(x, y, totalWidth, headerHeight).fill();
    doc.strokeColor('#000000').lineWidth(0.5).rect(x, y, totalWidth, headerHeight).stroke();

    // 2. Escribir el texto del Año centrado
    doc.fillColor('#000000').font('Helvetica-Bold')
        .fontSize(9) 
        .text(anioText, x + cellPadding, y + cellPadding + 3, { 
            width: totalWidth - (cellPadding * 2),
            align: 'center', 
            lineGap: 1
        });

    // Retorna la nueva posición Y
    return y + headerHeight; 
}


/**
 * Dibuja una fila de la tabla en el documento PDF.
 */
function drawTableRow(doc, y, x, heights, data, isHeader = false, isTotalRow = false) {
    const startX = x;
    const cellPadding = 3;
    
    // Usamos los anchos de columna definidos globalmente
    const colWidths = COL_WIDTHS; 
    let currentX = startX; 
    const rowHeight = isHeader ? 25 : heights; 
    doc.lineWidth(0.5); 
    data.forEach((text, colIndex) => {
        const width = colWidths[colIndex];
        // 1. Dibujar el fondo de la celda
        if (isTotalRow) {
            // Fila Total Anual o Total Carrera
            doc.fillColor('#F0F0F0').rect(currentX, y, width, rowHeight).fill(); 
            doc.strokeColor('#000000').lineWidth(0.5); 
        } else if (isHeader) {
             // Cabecera (la segunda fila de la cabecera)
             doc.fillColor('#CCCCCC').rect(currentX, y, width, rowHeight).fill();
             doc.strokeColor('#000000').lineWidth(0.5); 
        } else {
             // Fila de materia normal
             doc.strokeColor('#000000').lineWidth(0.5); 
        }
        // 2. Dibujar el borde de la celda
        doc.rect(currentX, y, width, rowHeight).stroke();
        // 3. Escribir el texto
        doc.fillColor('#000000');
        let fontStyle = 'Helvetica';
        let align = 'center';
        if (isHeader || isTotalRow) {
            fontStyle = 'Helvetica-Bold';
        } else if (colIndex === 2) { // Columna UNIDAD CURRICULAR (índice 2)
            align = 'left';
        }
        // Usamos font size 7 para todo el contenido de la tabla
        doc.font(fontStyle)
            .fontSize(7) 
            .text(String(text), currentX + cellPadding, y + cellPadding, { 
                width: width - (cellPadding * 2),
                align: align, 
                lineGap: 1
            });
        currentX += width;
    });
    return y + rowHeight; 
}
// ==========================================================
// FUNCIÓN PRINCIPAL: Descargar Plan de Estudio PDF (MODIFICADA)
// ==========================================================
exports.descargarPlanEstudioPDF = async (req, res) => {
    const { id } = req.params; 
    // Importaciones necesarias para el entorno real (asumiendo Node.js/Express)
    const PDFDocument = require('pdfkit'); // Asumiendo que PDFDocument está disponible
    const { PassThrough } = require('stream'); // Asumiendo 'stream' está disponible
    try {
        const result = await fetchPlanData(id);
        if (!result || !result.carrera) {
            return res.status(404).json({ error: 'Carrera no encontrada o sin datos para el Plan de Estudio.' });
        }
        const { carrera, materiasPorAnio, totalHorasAnuales, totalHorasCarrera } = result;
        // --- Configuración del Documento: A4 en modo Landscape ---
        const doc = new PDFDocument({ 
            margin: 30, 
            size: 'A4', // A4
            layout: 'landscape', // Horizontal
            info: {
                Title: `Plan de Estudio ${carrera.nombre_carrera}`,
                Author: 'IES N°6'
            }
        });
        const stream = new PassThrough();
        doc.pipe(stream);
        const nombreArchivo = `Plan_Estudio_${carrera.nombre_carrera.replace(/\s/g, '_').replace(/[^a-zA-Z0-9_]/g, '')}_IES6.pdf`;
        res.setHeader('Content-Type', 'application/pdf'); 
        res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
        stream.pipe(res); 
        // -----------------------------------------------------
        // INICIO DE LA GENERACIÓN DEL CONTENIDO PDF
        // -----------------------------------------------------
        const primaryColor = '#007bff';
        const h3Color = '#343a40';
        let currentY = 30;
        const startX = 30; 
        const pageW = doc.page.width - 60; // Ancho total disponible (730)
        const pageBottomMargin = 30; // Margen inferior
        // Títulos y metadatos
        doc.fillColor(primaryColor).fontSize(13).text(`PLAN DE ESTUDIO`, startX, currentY, { align: 'center', width: pageW });
        doc.moveDown(0.5);
        doc.fillColor(h3Color).fontSize(11).text(carrera.nombre_carrera, { align: 'center' });
        doc.moveDown(0.5);
        doc.fillColor('#000000').fontSize(10).text(`Duración: ${carrera.duracion} años | Modalidad General: ${carrera.modalidad} | Aprobación: ${carrera.año_aprobacion || 'N/D'}`, { align: 'center' });
        doc.moveDown(1.5);
        currentY = doc.y; // Primer punto de inicio después de los títulos
        // --- CABECERA DE LA TABLA (11 COLUMNAS, sin AÑO) ---
        const headerData = [
            'N°', 'CAMPO DE FORMACIÓN', 'UNIDAD CURRICULAR', 'FORMATO', 'MODALIDAD', 'HORAS SEMANAL', 'HORAS ANUAL', 'ACREDITACIÓN', 
            'REG. CORREL. CURS.(APROBADA)', 'REG. CORREL. CURS.(REGULAR)', 'REG. CORREL. RENDIR/PROMOC.(APROBADA)'
        ];
        const mergedAnioHeaderHeight = 20; // Altura para el título del Año fusionado
        const headerHeight = 30; // Altura para la cabecera de las columnas
        const anios = Object.keys(materiasPorAnio).sort();
        // Estimación de la altura del pequeño espacio (0.2 * línea actual de 10pt)
        const smallSpaceHeight = 2.2; 
        const totalRowHeight = 25; // Altura de la fila de totales anuales
        // -----------------------------------------------------
        // BUCLE POR AÑO (Cada año es una tabla separada)
        // -----------------------------------------------------
        for (const anio of anios) {
            const materias = materiasPorAnio[anio];
            const anioText = getAnioText(anio);
            
            // 1. Calcular altura total del bloque del año
            let materiasTotalHeight = 0;
            
            materias.forEach(materia => {
                    // **Cálculo de altura de fila:**
                    const textWidthMateria = COL_WIDTHS[2] - 6; 
                    // Establecer la fuente y tamaño antes de calcular la altura (tamaño de fuente 7)
                    doc.font('Helvetica').fontSize(7); 
                    const textHeight = doc.heightOfString(materia.nombre_materia, { 
                        width: textWidthMateria, 
                        lineGap: 1 
                    });
                    // Correlatividades.
                    const allCorrelativas = [
                        materia.correlativas.cursarAprobada.join(', '), 
                        materia.correlativas.cursarRegular.join(', '), 
                        materia.correlativas.rendirAprobada.join(', ')
                    ];
                    let maxCorrHeight = 0;
                    allCorrelativas.forEach((corrText, i) => {
                        const colWidth = [COL_WIDTHS[8], COL_WIDTHS[9], COL_WIDTHS[10]][i]; 
                        const corrTextHeight = doc.heightOfString(corrText, {
                            width: colWidth - 6,
                            lineGap: 1
                        });
                        maxCorrHeight = Math.max(maxCorrHeight, corrTextHeight);
                    });    
                    const minRowHeight = 18; 
                    const rowHeight = Math.max(minRowHeight, textHeight + 6, maxCorrHeight + 6);
                    materiasTotalHeight += rowHeight;
            });
            // Altura total del bloque: Fila de Año + Fila de Cabecera + Filas de Materia + Fila de Total Anual
            const blockHeight = mergedAnioHeaderHeight + headerHeight + materiasTotalHeight + totalRowHeight;
            const spaceAfterBlock = 15; // Espacio después del bloque
            // Altura total necesaria, incluyendo el pequeño espacio ANTES del título del año (smallSpaceHeight)
            const totalSpaceNeeded = smallSpaceHeight + blockHeight + spaceAfterBlock;
            // 2. Manejo de salto de página
            if (currentY + totalSpaceNeeded > doc.page.height - pageBottomMargin) {
                doc.addPage({ margin: 30, size: 'A4', layout: 'landscape' });
                currentY = 30; // Posición inicial en la nueva página
            }
            // 3. DIBUJAR TÍTULO DEL AÑO FUSIONADO
            doc.moveDown(0.2); // Pequeño espacio ANTES del título
            currentY = doc.y; // Sincronizar Y
            currentY = drawMergedAnioHeader(doc, currentY, startX, anioText, mergedAnioHeaderHeight);
            // 4. DIBUJAR CABECERA DE LA TABLA (La segunda fila)
            currentY = drawTableRow(doc, currentY, startX, headerHeight, headerData, true, false);
            // 5. DIBUJAR FILAS DE MATERIAS
            materias.forEach(materia => {
                // Recálculo de rowHeight para el dibujo (usando el mismo logic de la estimación)
                doc.font('Helvetica').fontSize(7); 
                const textWidthMateria = COL_WIDTHS[2] - 6;
                const textHeight = doc.heightOfString(materia.nombre_materia, { width: textWidthMateria, lineGap: 1 });
                const allCorrelativas = [
                    materia.correlativas.cursarAprobada.join(', '), 
                    materia.correlativas.cursarRegular.join(', '), 
                    materia.correlativas.rendirAprobada.join(', ')
                ];
                let maxCorrHeight = 0;
                allCorrelativas.forEach((corrText, i) => {
                    const colWidth = [COL_WIDTHS[8], COL_WIDTHS[9], COL_WIDTHS[10]][i];
                    const corrTextHeight = doc.heightOfString(corrText, { width: colWidth - 6, lineGap: 1 });
                    maxCorrHeight = Math.max(maxCorrHeight, corrTextHeight);
                });
                const minRowHeight = 18;
                const rowHeight = Math.max(minRowHeight, textHeight + 6, maxCorrHeight + 6);
                const rowData = [
                    materia.id_materia, // ID 
                    materia.campo_formacion || 'N/D', // C.F.
                    materia.nombre_materia,
                    materia.formato || 'N/D',
                    materia.modalidad || 'N/D',
                    materia.horas_semanales || 'N/D',
                    materia.total_horas_anuales || 'N/D',
                    materia.acreditacion || 'N/D',
                    materia.correlativas.cursarAprobada.join(', ') || '', 
                    materia.correlativas.cursarRegular.join(', ') || '', 
                    materia.correlativas.rendirAprobada.join(', ') || ''
                ];
                currentY = drawTableRow(doc, currentY, startX, rowHeight, rowData, false, false);
            });
            // 6. FILA DE SUMA ANUAL
            const totalRowY = currentY;
            // Unir las primeras 6 columnas (ID a HS/SEM)
            const totalMergedWidth = COL_WIDTHS[0] + COL_WIDTHS[1] + COL_WIDTHS[2] + COL_WIDTHS[3] + COL_WIDTHS[4] + COL_WIDTHS[5]; 
            // Dibujar el fondo de la celda unida (TOTAL - HS/SEM)
            doc.fillColor('#F0F0F0').rect(startX, totalRowY, totalMergedWidth, totalRowHeight).fill();
            doc.strokeColor('#000000').lineWidth(0.5).rect(startX, totalRowY, totalMergedWidth, totalRowHeight).stroke();
            // Escribir el texto de la columna unida
            doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8);
            doc.text(`TOTAL HORAS ${anioText}`, startX + 3, totalRowY + 7, {
                width: totalMergedWidth - 6,
                align: 'center'
            });
            // Dibujar las columnas restantes (empezando por HS/ANUAL, índice 6)
            let currentX = startX + totalMergedWidth;
            const remainingData = [
                totalHorasAnuales[anio], // HS/ANUAL 
                '', // ACREDITACIÓN
                '', // CURSAR (A)
                '', // CURSAR (R)
                ''  // RENDIR (A)
            ];
            // Anchos de las columnas restantes (desde el índice 6 hasta el 10)
            const remainingWidths = [COL_WIDTHS[6], COL_WIDTHS[7], COL_WIDTHS[8], COL_WIDTHS[9], COL_WIDTHS[10]]; 
            remainingData.forEach((text, i) => {
                const width = remainingWidths[i];
                // Dibujar fondo, borde y texto para el resto de las celdas
                doc.fillColor('#F0F0F0').rect(currentX, totalRowY, width, totalRowHeight).fill();
                doc.strokeColor('#000000').lineWidth(0.5).rect(currentX, totalRowY, width, totalRowHeight).stroke();
                doc.fillColor('#000000').font('Helvetica-Bold').fontSize(7);
                doc.text(String(text), currentX + 3, totalRowY + 9, { 
                    width: width - 6,
                    align: 'center', 
                    lineGap: 1
                });
                currentX += width;
            });
            currentY = totalRowY + totalRowHeight;
            // Espacio entre tablas de años
            doc.moveDown(1);
            currentY = doc.y; // Sincroniza la posición Y para el chequeo de la siguiente iteración
        } // Fin del bucle for (anios)
        // -----------------------------------------------------
        // FILA DE SUMA TOTAL DE LA CARRERA (Una sola fila)
        // -----------------------------------------------------
        const finalTotalRowHeight = 25; 
        const spaceForFinalTotal = finalTotalRowHeight + 10;
        // Verificar si la fila de total final cabe en la página
        if (currentY + spaceForFinalTotal > doc.page.height - pageBottomMargin) {
            doc.addPage({ margin: 30, size: 'A4', layout: 'landscape' });
            currentY = 30; 
        }
        const totalRowY = currentY;
        // Unir las primeras 6 columnas (ID a HS/SEM)
        const totalMergedWidth = COL_WIDTHS[0] + COL_WIDTHS[1] + COL_WIDTHS[2] + COL_WIDTHS[3] + COL_WIDTHS[4] + COL_WIDTHS[5]; 
        // 1. Dibujar el fondo y borde de las primeras 6 columnas unidas
        doc.fillColor('#C0C0C0').rect(startX, totalRowY, totalMergedWidth, finalTotalRowHeight).fill();
        doc.strokeColor('#000000').lineWidth(0.5).rect(startX, totalRowY, totalMergedWidth, finalTotalRowHeight).stroke();
        // 2. Escribir el texto de la columna unida (TOTAL HORAS DE LA CARRERA)
        doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8);
        doc.text('TOTAL HORAS DE LA CARRERA', startX + 3, totalRowY + 7, {
            width: totalMergedWidth - 6,
            align: 'center'
        });
        // 3. Dibujar las columnas restantes (empezando por HS/ANUAL)
        let currentX = startX + totalMergedWidth;
        const remainingData = [
            totalHorasCarrera, // HS/ANUAL 
            '', 
            '', 
            '', 
            '' 
        ];
        // Anchos de las columnas restantes (desde el índice 6 hasta el 10)
        const remainingWidths = [COL_WIDTHS[6], COL_WIDTHS[7], COL_WIDTHS[8], COL_WIDTHS[9], COL_WIDTHS[10]]; 
        remainingData.forEach((text, i) => {
            const width = remainingWidths[i];
            // Dibujar fondo, borde y texto para el resto de las celdas
            doc.fillColor('#C0C0C0').rect(currentX, totalRowY, width, finalTotalRowHeight).fill();
            doc.strokeColor('#000000').lineWidth(0.5).rect(currentX, totalRowY, width, finalTotalRowHeight).stroke();
            doc.fillColor('#000000').font('Helvetica-Bold').fontSize(7);
            doc.text(String(text), currentX + 3, totalRowY + 9, { 
                width: width - 6,
                align: 'center', 
                lineGap: 1
            });
            currentX += width;
        });
        currentY = totalRowY + finalTotalRowHeight;
        // -----------------------------------------------------
        // FIN DE LA GENERACIÓN DEL CONTENIDO PDF
        // -----------------------------------------------------
        doc.end();
    } catch (error) {
        console.error('Error al generar o descargar el Plan de Estudio PDF:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error interno del servidor al procesar la descarga del PDF.' });
        }
    }
};