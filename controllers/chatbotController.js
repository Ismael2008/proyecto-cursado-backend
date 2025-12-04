const db = require('../database'); // Importamos la conexión desde database.js (el pool)

/**
 * Muestra las carreras disponibles para el menú principal (Nivel 0).
 * Tablas: carrera (id_carrera, nombre_carrera, estado)
 * Ruta: GET /api/chatbot/carreras
 */
exports.getCarreras = async (req, res) => {
    try {
        // [CAMBIO CLAVE]: Filtramos solo por carreras con estado 'activa'
        const [rows] = await db.query("SELECT id_carrera, nombre_carrera FROM carrera WHERE estado = 'activa' ORDER BY nombre_carrera");
        
        // Devuelve [ { id_carrera: 1, nombre_carrera: "Profesorado en Educación Secundaria en Informática" }, ... ]
        res.json(rows);
    } catch (error) {
        console.error('Error al obtener carreras:', error);
        res.status(500).json({ error: 'Error al conectar con la base de datos o al obtener carreras.' });
    }
};

/**
 * Obtiene todas las materias de una carrera (para menú de Años/Materias - Nivel 2 y 3).
 * Tablas: materia (id_materia, nombre_materia, año, estado)
 * Ruta: GET /api/chatbot/materias/:carreraId
 */
exports.getMateriasPorCarrera = async (req, res) => {
    const { carreraId } = req.params;
    try {
        const sql = `
            SELECT id_materia, nombre_materia, año
            FROM materia 
            WHERE id_carrera = ? AND estado = 'activa' /* [CAMBIO CLAVE]: Filtramos por materias activas */
            ORDER BY año, nombre_materia
        `;
        const [rows] = await db.query(sql, [carreraId]);
        
        // Devuelve [ { id_materia: 101, nombre_materia: "...", año: 1 }, ... ]
        res.json(rows);
    } catch (error) {
        console.error(`Error al obtener materias para carrera ${carreraId}:`, error);
        res.status(500).json({ error: 'Error al obtener las materias.' });
    }
};


/**
 * Manejador principal para solicitudes de información detallada (Nivel 1 y 4).
 * Ruta: GET /api/chatbot/info?action=...&id=...
 */
exports.getInfo = async (req, res) => {
    const { action, id } = req.query; // id puede ser id_carrera o id_materia

    if (!action || !id) {
        return res.status(400).json({ message: 'Parámetros "action" e "id" son requeridos.' });
    }

    try {
        let message = '';
        let queryResult;

        switch (action) {
            
            // --- Nivel 1: Opciones de Carrera (ID es id_carrera) ---

            case 'get_carrera_details':
                // Tablas: carrera (nombre_carrera, duracion, modalidad, año_aprobacion, estado)
                // [CAMBIO CLAVE]: Filtramos solo por carrera con estado 'activa'
                [queryResult] = await db.query(
                    "SELECT nombre_carrera, duracion, modalidad, año_aprobacion FROM carrera WHERE id_carrera = ? AND estado = 'activa'",
                    [id]
                );
                
                if (queryResult.length > 0) {
                    const d = queryResult[0];
                    message = `ℹ️ **Detalles de ${d.nombre_carrera}**:\n`;
                    message += `* Año de duración: ${d.duracion}\n`;
                    message += `* Modalidad: ${d.modalidad}\n`;
                    message += `* Año de Aprobación del Plan: ${d.año_aprobacion}`;
                } else {
                    // El mensaje ahora cubre tanto la no existencia como la eliminación lógica
                    message = '⚠️ No se encontraron detalles para esta carrera (puede haber sido desactivada).'; 
                }
                break;

            case 'get_coordinador_info':
                // Tablas: administrador, admin_carrera. Unimos a carrera para verificar que esté activa.
                [queryResult] = await db.query(`
                    SELECT 
                        a.nombre_administrador, a.email, a.telefono 
                    FROM administrador a
                    JOIN admin_carrera ac ON a.id_administrador = ac.id_administrador
                    JOIN carrera c ON ac.id_carrera = c.id_carrera /* Necesario para verificar estado de la carrera */
                    WHERE ac.id_carrera = ?
                    AND a.rol = 'Coordinador'
                    AND c.estado = 'activa' /* [CAMBIO CLAVE]: Filtramos por carrera activa */
                    /* NOTA: Es una buena práctica filtrar también 'a.estado = 'activo'' en la tabla administrador, 
                    pero solo aplicamos los cambios solicitados para las tablas mencionadas. */
                `, [id]);
                
                if (queryResult.length > 0) {
                    const c = queryResult[0];
                    message = `👤 **Información del Coordinador/a**:\n`;
                    message += `* Nombre: ${c.nombre_administrador}\n`;
                    message += `* Email: ${c.email}\n`;
                    message += `* Teléfono: ${c.telefono || 'No especificado'}`;
                } else {
                    message = '⚠️ No se encontró un coordinador asignado a esta carrera activa. Contacta con la secretaría.';
                }
                break;
            
            // --- Nivel 4: Opciones de Materia (ID es id_materia) ---
            
            case 'get_materia_details': // Obtiene todos los detalles de la tabla materia.
                // [CAMBIO CLAVE]: Filtramos solo por materia con estado 'activa'
                [queryResult] = await db.query(
                    `SELECT nombre_materia, año, campo_formacion, modalidad, formato, horas_semanales, total_horas_anuales, acreditacion
                    FROM materia 
                    WHERE id_materia = ? AND estado = 'activa'`,
                    [id]
                );
                
                if (queryResult.length > 0) {
                    const m = queryResult[0];
                    message = `ℹ️ **Detalles de ${m.nombre_materia}**:\n`; // El nombre de la materia se pierde en el switch, lo añado aquí.
                    message += `* Año de cursado: ${m.año}\n`;
                    message += `* Campo de Formación: ${m.campo_formacion}\n`;
                    message += `* Modalidad: ${m.modalidad}\n`;
                    message += `* Formato: ${m.formato}\n`;
                    message += `* Horas Semanales: ${m.horas_semanales}\n`;
                    message += `* Horas Anuales: ${m.total_horas_anuales}\n`;
                    message += `* Acreditación: ${m.acreditacion}`;
                } else {
                    message = '⚠️ No se encontraron detalles para esta materia (puede haber sido desactivada).';
                }
                break;

            case 'get_horarios':
                // Tablas: horario (dia_semana, hora_inicio, hora_fin, estado)
                // [CAMBIO CLAVE]: Filtramos solo por horarios con estado 'activa'
                [queryResult] = await db.query(`
                    SELECT dia_semana, DATE_FORMAT(hora_inicio, '%H:%i') AS hora_inicio, DATE_FORMAT(hora_fin, '%H:%i') AS hora_fin
                    FROM horario 
                    WHERE id_materia = ? AND estado = 'activa' 
                    ORDER BY FIELD(dia_semana, 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado')
                `, [id]);

                if (queryResult.length > 0) {
                    message = '🕒 **Horarios de Cursado**:\n';
                    queryResult.forEach(h => {
                        message += `* ${h.dia_semana}: ${h.hora_inicio} a ${h.hora_fin}\n`;
                    });
                } else {
                    message = '⚠️ No hay horarios de cursado activos registrados para esta materia.';
                }
                break;

            case 'get_correlativas':
                // Implementación mejorada para mostrar Requisitos y Dependientes.

                // 1. Obtener el nombre de la materia consultada (debe estar activa)
                // [CAMBIO CLAVE]: Filtramos solo por materia con estado 'activa'
                const [materiaNameResult] = await db.query(
                    "SELECT nombre_materia FROM materia WHERE id_materia = ? AND estado = 'activa'",
                    [id]
                );
                const nombreMateria = materiaNameResult.length > 0 ? materiaNameResult[0].nombre_materia : null;

                if (!nombreMateria) {
                    message = '⚠️ No se encontró la materia para el ID proporcionado o no está activa.';
                    break;
                }
                
                // 2. Obtener Requisitos (Materias que esta materia REQUIERE)
                // [CAMBIO CLAVE]: Filtramos por correlatividad activa (c.estado) y materia requisito activa (m2.estado)
                const [prereqResult] = await db.query(`
                    SELECT 
                        m2.nombre_materia AS materia, 
                        c.tipo, 
                        c.estado_requisito
                    FROM correlatividad c
                    JOIN materia m2 ON c.id_materia_requisito = m2.id_materia
                    WHERE c.id_materia_principal = ?
                    AND c.estado = 'activa'
                    AND m2.estado = 'activa'
                    ORDER BY m2.nombre_materia
                `, [id]);

                // 3. Obtener Dependientes (Materias que REQUIEREN a esta materia como requisito)
                // [CAMBIO CLAVE]: Filtramos por correlatividad activa (c.estado) y materia principal activa (m1.estado)
                const [dependentResult] = await db.query(`
                    SELECT 
                        m1.nombre_materia AS materia, 
                        c.tipo, 
                        c.estado_requisito
                    FROM correlatividad c
                    JOIN materia m1 ON c.id_materia_principal = m1.id_materia
                    WHERE c.id_materia_requisito = ?
                    AND c.estado = 'activa'
                    AND m1.estado = 'activa'
                    ORDER BY m1.nombre_materia
                `, [id]);
                
                // 4. Formatear el mensaje combinado
                if (prereqResult.length > 0 || dependentResult.length > 0) {
                    message = `🔗 **Correlativas de ${nombreMateria}**:\n`;

                    if (prereqResult.length > 0) {
                        message += '\n**➡️ Requisitos (lo que esta materia necesita):**\n';
                        prereqResult.forEach(c => {
                            message += `* Requiere **${c.materia}** (${c.estado_requisito} - Tipo: ${c.tipo})\n`;
                        });
                    }

                    if (dependentResult.length > 0) {
                        if (prereqResult.length > 0) {
                            message += '\n------------------------------\n'; // Separador
                        }
                        message += '**⬅️ Dependientes (lo que necesita a esta materia):**\n';
                        dependentResult.forEach(c => {
                            message += `* Es requisito de **"${c.materia}"** (${c.estado_requisito} - Tipo: ${c.tipo})\n`;
                        });
                    }
                } else {
                    message = `✅ La materia **${nombreMateria}** no tiene correlativas activas registradas (ni requisitos, ni materias dependientes).`;
                }
                
                break;

            default:
                message = `❌ Acción desconocida: ${action}.`;
        }

        // Devolvemos el mensaje formateado al frontend
        res.json({ message: message.trim() });

    } catch (error) {
        console.error(`Error en la acción ${action} para ID ${id}:`, error);
        res.status(500).json({ message: 'Error interno del servidor al procesar la información.' });
    }
};