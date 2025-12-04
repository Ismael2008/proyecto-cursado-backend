const pool = require ('../database');
const bcrypt = require('bcrypt'); 

// Función de utilidad para manejar errores 400 (Bad Request)
const validateRequiredFields = (fields, req, res) => {
    for (const field of fields) {
        if (!req.body[field]) {
            res.status(400).json({ 
                message: `Error de validación: El campo '${field}' es obligatorio.`,
                error: `Missing required field: ${field}`
            });
            return false;
        }
    }
    return true;
};

/**
 * Verifica si la materia pertenece a las carreras coordinadas por el usuario logueado.
 * Solo se ejecuta si el rol es 'Coordinador'.
 */
const checkMateriaAccess = async (idMateria, idAdministrador) => {
    const [rows] = await pool.query(`
SELECT COUNT(m.id_materia) AS count
FROM materia m
INNER JOIN admin_carrera ac ON m.id_carrera = ac.id_carrera
INNER JOIN administrador a ON ac.id_administrador = a.id_administrador
WHERE m.id_materia = ? 
AND ac.id_administrador = ?
AND m.estado = 'activo'
AND a.estado IN ('activo', 'suspendido') /* El coordinador debe estar activo o suspendido */
`, [idMateria, idAdministrador]);

    return rows[0].count > 0;
};

/**
 * 🟢 FUNCIÓN DE UTILIDAD: Valida que la contraseña cumpla con los requisitos de seguridad.
 */
const validatePasswordRules = (password) => {
    if (password.length < 8) {
        return "La contraseña debe tener al menos 8 caracteres.";
    }
    if (!/[A-Z]/.test(password)) {
        return "La contraseña debe contener al menos una letra mayúscula.";
    }
    if (!/[a-z]/.test(password)) {
        return "La contraseña debe contener al menos una letra minúscula.";
    }
    if (!/[0-9]/.test(password)) {
        return "La contraseña debe contener al menos un número.";
    }
    // Asume que el usuario acepta la mayoría de los caracteres no alfanuméricos como especiales
    if (!/[^a-zA-Z0-9\s]/.test(password)) { 
        return "La contraseña debe contener al menos un carácter especial (ej: !@#$).";
    }
    return null; // Contraseña válida
};

// =========================================================
// UTILIDAD: LISTADO DE COORDINADORES 
// =========================================================

// @desc    Obtener la lista de administradores con rol 'Coordinador' (SOLO ACTIVOS para poder asignar)
exports.listCoordinadores = async (req, res) => {
    try {
        const sql = `SELECT 
id_administrador, 
nombre_administrador,
CONCAT(COALESCE(nombre_administrador, 'ID: '), id_administrador) AS usuario_display 
FROM 
administrador
WHERE 
rol = 'Coordinador'
AND estado = 'activo' 
ORDER BY 
nombre_administrador`; 

        const [coordinadores] = await pool.query(sql);
        res.json(coordinadores);

    } catch (error) {
        console.error('Error al obtener lista de coordinadores:', error);
        res.status(500).json({ message: 'Error interno del servidor al obtener coordinadores.' });
    }
};


// =========================================================
// ADMINISTRADOR CRUD (ACCESO SÓLO PARA RECTOR) 🔐
// =========================================================

// @desc    Listar todos los usuarios (Muestra activo y suspendido, oculta inactivo/eliminado lógicamente)
// @access  Private/Rector
exports.listUsers = async (req, res) => {
    try {
        const [users] = await pool.query(`SELECT 
id_administrador, 
nombre_administrador, 
email, dni, 
telefono, 
rol, 
fecha_creacion,
estado
FROM 
administrador
WHERE 
estado IN ('activo', 'suspendido') 
ORDER BY 
nombre_administrador
`); 
        res.json(users);
    } catch (error) {
        console.error('Error al listar administradores (Admin):', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
};

// @desc    Obtener un administrador por ID (Admin)
// ... (Sin cambios)
exports.getUserById = async (req, res) => {
    const { id } = req.params; 
    try {
        const [users] = await pool.query(
            `SELECT 
id_administrador, 
nombre_administrador, 
email, 
dni, 
telefono, 
rol, 
fecha_creacion,
estado
FROM 
administrador 
WHERE 
id_administrador = ? 
`, 
            [id]
        );
        const user = users[0];

        if (!user) {
            return res.status(404).json({ message: 'Administrador no encontrado.' });
        }
        res.json(user);
    } catch (error) {
        console.error('Error al obtener administrador por ID (Admin):', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
};

// @desc    Crear un nuevo administrador
// ... (Sin cambios)
exports.createUserByAdmin = async (req, res) => {
    const requiredFields = ['nombre_administrador', 'contraseña', 'rol'];
    if (!validateRequiredFields(requiredFields, req, res)) return;

    const { nombre_administrador, email, contraseña, dni, telefono, rol } = req.body; 

    const validationError = validatePasswordRules(contraseña);
    if (validationError) {
        return res.status(400).json({ message: `Error de validación: ${validationError}` });
    }

    try {
        const salt = await bcrypt.genSalt(10);
        const contraseña_hash = await bcrypt.hash(contraseña, salt);

        const [result] = await pool.query(
            'INSERT INTO administrador (nombre_administrador, email, contraseña, dni, telefono, rol) VALUES (?, ?, ?, ?, ?, ?)',
            [nombre_administrador, email || null, contraseña_hash, dni || null, telefono || null, rol]
        );

        res.status(201).json({ 
            id_administrador: result.insertId, 
            nombre_administrador, 
            rol, 
            message: 'Administrador creado exitosamente.' 
        });

    } catch (error) {
        console.error('Error al crear administrador (Admin):', error); 
        
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'El nombre de administrador, email o DNI ya está registrado.' });
        }
        res.status(500).json({ message: 'Error al crear el administrador.', error: error.message });
    }
};


// @desc    Actualizar datos de administrador (incluye rol, contraseña opcional y ESTADO)
// @access  Private/Rector
exports.updateUserByAdmin = async (req, res) => {
    const { id } = req.params;
    const { nombre_administrador, email, newContraseña, dni, telefono, rol, estado } = req.body; 
    
    const adminLogueadoId = req.user.id;
    const adminLogueadoRol = req.user.rol;
    const idAdminAEditar = id; 
    
    let connection;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Obtener datos actuales del administrador a editar
        const [currentAdminRows] = await connection.query(
            'SELECT rol, estado FROM administrador WHERE id_administrador = ?', [idAdminAEditar]
        );
        
        if (currentAdminRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Administrador no encontrado.' });
        }
        
        const currentAdmin = currentAdminRows[0];
        const currentRol = currentAdmin.rol;
        const currentEstado = currentAdmin.estado;

        // 2. CONTROL DE ACCESO BASADO EN ROL

        // A. Restricción principal para Coordinador: Solo puede editarse a sí mismo.
        if (adminLogueadoRol === 'Coordinador' && String(adminLogueadoId) !== String(idAdminAEditar)) {
            await connection.rollback();
            return res.status(403).json({ message: 'Acceso denegado: Un Coordinador solo puede editar sus propios datos.' });
        }
        
        // B. Restricción para Coordinador: NO puede modificar su rol o estado.
        if (adminLogueadoRol === 'Coordinador') {
            if (rol !== undefined || estado !== undefined) {
                 await connection.rollback();
                return res.status(403).json({ message: 'Acceso denegado: Un Coordinador no puede modificar su rol o estado.' });
            }
        }
        
        // C. Control de Seguridad 1: No permitir la auto-suspensión/inactivación.
        // Si el Rector edita, se usa el `estado` del body. Si el Coordinador edita, se usa el `currentEstado`.
        const estadoAUsar = estado || currentEstado; 
        
        if (String(adminLogueadoId) === String(idAdminAEditar) && 
            (estadoAUsar === 'suspendido' || estadoAUsar === 'inactivo')) 
        {
            if (estadoAUsar !== currentEstado) { // Solo si realmente se está intentando cambiar
                await connection.rollback();
                return res.status(403).json({ message: 'Prohibido: Un administrador no puede suspender o inactivar su propia cuenta.' });
            }
        }

        // 3. LÓGICA DE DESASIGNACIÓN DE CARRERA (Si el rol es Coordinador y el estado final es suspendido/inactivo)
        const rolAUsar = rol || currentRol;
        const estadoFinal = estadoAUsar;

        if (rolAUsar === 'Coordinador' && (estadoFinal === 'suspendido' || estadoFinal === 'inactivo')) {
            const [assignmentsResult] = await connection.query(
                'DELETE FROM admin_carrera WHERE id_administrador = ?', 
                [idAdminAEditar]
            );
            console.log(`[INFO] Eliminadas ${assignmentsResult.affectedRows} asignaciones de carrera al suspender/inactivar a Admin ID: ${idAdminAEditar}`);
        }

        // 4. CONSTRUCCIÓN DINÁMICA DEL SQL

        let sqlParts = [];
        let params = [];

        // Campos Personales (Permitidos para Rector y Coordinador)
        if (nombre_administrador !== undefined) {
            sqlParts.push('nombre_administrador = ?');
            params.push(nombre_administrador);
        }
        if (email !== undefined) {
            sqlParts.push('email = ?');
            params.push(email || null);
        }
        if (dni !== undefined) {
            sqlParts.push('dni = ?');
            params.push(dni || null);
        }
        if (telefono !== undefined) {
            sqlParts.push('telefono = ?');
            params.push(telefono || null);
        }

        // Campos Protegidos (Solo permitidos para el Rector, si se proporcionan en el body)
        if (adminLogueadoRol === 'Rector') {
            if (rol !== undefined) {
                sqlParts.push('rol = ?');
                params.push(rol);
            }
            
            // Estado y Campos de Auditoría (Implementa la lógica del turno anterior + 'suspendido')
            if (estado !== undefined) {
                sqlParts.push('estado = ?');
                params.push(estado);
                
                if (estado === 'suspendido' || estado === 'inactivo') {
                    // Auditoría para suspensión/inactivación
                    sqlParts.push('fecha_eliminacion = NOW()');
                    sqlParts.push('id_administrador_eliminacion = ?');
                    params.push(adminLogueadoId);
                } else if (estado === 'activo') {
                    // Limpiar auditoría al reactivar
                    sqlParts.push('fecha_eliminacion = NULL');
                    sqlParts.push('id_administrador_eliminacion = NULL');
                }
            }
        }

        // 5. Manejo de la CONTRASEÑA (Permitido para ambos, si se proporciona)
        const trimmedNewContraseña = newContraseña ? String(newContraseña).trim() : '';

        if (trimmedNewContraseña.length > 0) {
            const validationError = validatePasswordRules(trimmedNewContraseña);
            if (validationError) {
                await connection.rollback(); 
                return res.status(400).json({ message: `Error de validación: ${validationError}` });
            }
            
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(trimmedNewContraseña, salt);
            sqlParts.push('contraseña = ?');
            params.push(hashedPassword);
        }
        
        // 6. Ejecución de la consulta
        if (sqlParts.length === 0) {
            await connection.rollback();
            return res.status(400).json({ message: 'No se proporcionaron campos válidos para actualizar.' });
        }

        let sql = `UPDATE administrador SET ${sqlParts.join(', ')} WHERE id_administrador = ?`;
        params.push(idAdminAEditar);

        const [result] = await connection.query(sql, params); 

        if (result.affectedRows === 0) {
            // Si el administrador existe, pero no hubo cambios en los valores.
             await connection.commit(); 
             return res.json({ message: 'Administrador actualizado con éxito (no se realizaron cambios en los valores existentes).' });
        }
        
        await connection.commit(); 

        res.json({ message: 'Administrador actualizado con éxito.' });

    } catch (error) {
        if (connection) {
            await connection.rollback(); 
        }
        console.error('Error al actualizar administrador (Admin):', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'El nombre de administrador, email o DNI ya está registrado por otro usuario.' });
        }
        res.status(500).json({ message: 'Error al actualizar el administrador.' });
    } finally {
        if (connection) {
            connection.release(); 
        }
    }
};

// @desc    Eliminar un administrador (Eliminación Lógica/Soft Delete)
// @access  Private/Rector (Necesita el ID del Rector logueado en req.user.id)
exports.deleteUserByAdmin = async (req, res) => {
    const { id } = req.params;
    // Utilizamos req.user.id que ya fue normalizado en el authMiddleware
    const idAdministradorLogueado = req.user.id; 
    let connection; // Para gestionar la conexión y la transacción

    // ⛔ VERIFICACIÓN DE AUTORIZACIÓN 
    if (!idAdministradorLogueado) {
        return res.status(401).json({ message: 'No autorizado: Falta ID del administrador logueado.' });
    }
    
    // 🟢 CONTROL DE SEGURIDAD 2: No permitir la auto-eliminación
    if (String(id) === String(idAdministradorLogueado)) {
        return res.status(403).json({ message: 'Prohibido: Un administrador no puede eliminarse a sí mismo.' });
    }

    try {
        connection = await pool.getConnection(); // Obtener una conexión del pool
        await connection.beginTransaction(); // Iniciar la transacción

        // 1. Verificar si existe y obtener el rol/estado
        const [adminRows] = await connection.query(
            'SELECT rol, estado FROM administrador WHERE id_administrador = ?', [id]
        );
        const admin = adminRows[0];

        if (!admin) {
            await connection.rollback();
            return res.status(404).json({ message: 'Administrador no encontrado.' });
        }
        
        if (admin.estado === 'inactivo') {
            await connection.rollback();
            return res.status(404).json({ message: 'Administrador no encontrado o ya estaba inactivo.' });
        }

        // 2. Si es 'Coordinador', ELIMINAR FÍSICAMENTE sus asignaciones de carrera.
        if (admin.rol === 'Coordinador') {
            const [assignmentsResult] = await connection.query(
                `DELETE FROM admin_carrera 
WHERE id_administrador = ?`,
                [id]
            );
            console.log(`[INFO] Eliminadas ${assignmentsResult.affectedRows} asignaciones de carrera para Admin ID: ${id}`);
        }

        // 3. Eliminar Lógicamente (Soft Delete) el registro del administrador
        const [result] = await connection.query(
            `UPDATE administrador 
SET 
estado = 'inactivo', 
fecha_eliminacion = NOW(), 
id_administrador_eliminacion = ? 
WHERE 
id_administrador = ?`,
            [idAdministradorLogueado, id]
        );

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Administrador no encontrado o no se pudo marcar como inactivo.' });
        }

        await connection.commit(); // Confirmar la transacción
        
        res.json({ 
            message: 'Administrador y sus asignaciones de Coordinador marcados como inactivos (eliminación lógica) con éxito.',
            id_administrador_eliminado: id
        });
    } catch (error) {
        if (connection) {
            await connection.rollback(); // Deshacer en caso de error
        }
        console.error('Error al procesar la eliminación lógica del administrador (Admin):', error);
        res.status(500).json({ 
            message: 'Error grave al procesar la eliminación lógica del administrador. Se revirtieron los cambios.',
            error: error.message 
        });
    } finally {
        if (connection) {
            connection.release(); // Liberar la conexión al pool
        }
    }
};

// =========================================================
// CARRERAS CRUD (Lógica Granular Rector/Coordinador)
// =========================================================

// @desc    Obtener todas las carreras (Incluye nombre de Coordinador, filtrado por Rol y Eliminación Lógica)
exports.getCarreras = async (req, res) => {
    const { id_administrador, rol } = req.user; 

    try {
        let params = [];
        
        // 🟢 MODIFICACIÓN CLAVE: Determinar el filtro de estado dinámicamente
        // Rector: ve 'activa' y 'cerrada'.
        // Coordinador: solo ve 'activa'.
        const estadoFilter = rol === 'Coordinador' 
            ? "c.estado = 'activa'" 
            : "c.estado IN ('activa', 'cerrada')";

        let sql = `SELECT DISTINCT
c.*, 
a.nombre_administrador AS nombre_coordinador
FROM 
carrera c
LEFT JOIN 
admin_carrera ac ON c.id_carrera = ac.id_carrera
LEFT JOIN 
administrador a ON ac.id_administrador = a.id_administrador AND a.rol = 'Coordinador'
WHERE 
${estadoFilter} `; // <-- Aplicamos el filtro de estado dinámico
        
        // Aplicar lógica de permisos basada en el rol
        if (rol === 'Coordinador') {
            // Un Coordinador solo ve las carreras activas a las que está asignado.
            // Mantenemos la corrección de indentación para evitar errores de sintaxis.
            sql += `
AND c.id_carrera IN (
SELECT id_carrera 
FROM admin_carrera 
WHERE id_administrador = ?
)
`;
            params.push(id_administrador);
            
        } else if (rol !== 'Rector') {
             return res.status(403).json({ message: 'Permisos insuficientes para esta operación.' });
        }
        
        sql += ' ORDER BY c.nombre_carrera';

        const [carreras] = await pool.query(sql, params); 
        res.json(carreras);

    } catch (error) {
        console.error('Error al obtener carreras (con filtrado y coordinador):', error);
        res.status(500).json({ message: 'Error interno del servidor al obtener carreras.' });
    }
};

// @desc Obtener una carrera por ID (Incluye id_coordinador para edición y Verificación por Rol)
exports.getCarreraById = async (req, res) => {
    const { id: id_carrera } = req.params;
    const { id_administrador, rol } = req.user; 

    try {
        // 1. Obtener datos de la carrera y el ID del coordinador
        // 🟢 CORRECCIÓN: Eliminación de la indentación inicial en la plantilla literal
        const [carreras] = await pool.query(`
SELECT 
c.*, 
ac.id_administrador AS id_coordinador 
FROM carrera c
LEFT JOIN admin_carrera ac ON c.id_carrera = ac.id_carrera
LEFT JOIN administrador a ON ac.id_administrador = a.id_administrador AND a.rol = 'Coordinador'
WHERE c.id_carrera = ?
`, [id_carrera]);
        
        const carrera = carreras[0];

        if (!carrera) {
            return res.status(404).json({ message: 'Carrera no encontrada.' });
        }

        // 2. Verificación de Permisos (solo para Coordinador)
        if (rol === 'Coordinador') {
            // Un Coordinador solo puede ver la carrera si está asignado a ella
            const [relaciones] = await pool.query(
                'SELECT 1 FROM admin_carrera WHERE id_administrador = ? AND id_carrera = ?', 
                [id_administrador, id_carrera]
            );

            if (relaciones.length === 0) {
                return res.status(403).json({ message: 'Acceso denegado. No tiene permisos sobre esta carrera.' });
            }
        }
        
        res.json(carrera); 
    } catch (error) {
        console.error('Error al obtener carrera por ID:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
};

// @desc    Crear una nueva carrera (Transaccional: Carrera + Asignación de Coordinador)
exports.createCarrera = async (req, res) => {
    const { rol } = req.user;

    // 1. Restringir a Rector
    if (rol !== 'Rector') { 
        return res.status(403).json({ message: 'Acceso denegado. Solo el Rector puede crear nuevas carreras.' });
    }
    
    const { nombre_carrera, duracion, modalidad, año_aprobacion, id_coordinador } = req.body;

    if (!nombre_carrera || !duracion || !modalidad || !año_aprobacion || !id_coordinador) {
        return res.status(400).json({ message: 'Error de validación: Faltan campos obligatorios, incluyendo la asignación del Coordinador.' });
    }
    
    let connection;
    try {
        // INICIO DE LA TRANSACCIÓN
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 2. Insertar la nueva carrera
        // Se inicializa el estado como 'activa'
        const [carreraResult] = await connection.query(
            'INSERT INTO carrera (nombre_carrera, duracion, modalidad, año_aprobacion, estado) VALUES (?, ?, ?, ?, ?)',
            [nombre_carrera, duracion, modalidad, año_aprobacion, 'activa'] 
        );
        
        const newCarreraId = carreraResult.insertId;

        // 3. Insertar la asignación del coordinador en admin_carrera
        await connection.query(
            'INSERT INTO admin_carrera (id_administrador, id_carrera) VALUES (?, ?)',
            [id_coordinador, newCarreraId]
        );

        // COMMIT DE LA TRANSACCIÓN
        await connection.commit();

        res.status(201).json({ 
            id_carrera: newCarreraId, 
            ...req.body, 
            estado: 'activa', // Devolver el estado
            message: 'Carrera creada y Coordinador asignado con éxito.' 
        });

    } catch (error) {
        // ROLLBACK EN CASO DE ERROR
        if (connection) await connection.rollback();
        console.error('Error al crear carrera y asignar coordinador:', error);
        res.status(500).json({ message: 'Error interno del servidor al crear carrera y asignar coordinador.' });
    } finally {
        if (connection) connection.release();
    }
};

// @desc    Actualizar una carrera (Transaccional: Carrera + Asignación de Coordinador + Estado)
exports.updateCarrera = async (req, res) => {
    const { id: id_carrera } = req.params;
    const { id_administrador, rol } = req.user; 
    
    // 🟢 MODIFICACIÓN 1: Incluir 'estado' en la desestructuración
    const { 
        nombre_carrera, 
        duracion, 
        modalidad, 
        año_aprobacion, 
        id_coordinador,
        estado // <-- Nuevo campo capturado
    } = req.body;

    // Validación de campos básicos de la carrera
    if (!nombre_carrera || !duracion || !modalidad || !año_aprobacion) {
        return res.status(400).json({ message: 'Error de validación: Faltan campos de carrera obligatorios para la actualización.' });
    }

    // 🟢 MODIFICACIÓN 2: Restricción de permisos para el cambio de estado
    if (estado) {
        if (estado !== 'activa' && estado !== 'cerrada' && estado !== 'inactiva') {
            return res.status(400).json({ message: 'Error de validación: El estado de la carrera solo puede ser "activa", "cerrada" o "inactiva".' });
        }
        
        // Los cambios de estado críticos ('cerrada' o 'inactiva') solo pueden ser hechos por el Rector
        if ((estado === 'cerrada' || estado === 'inactiva') && rol !== 'Rector') {
            return res.status(403).json({ message: 'Acceso denegado: Solo el Rector puede cerrar o inactivar una carrera.' });
        }
    }
    
    let connection;
    try {
        // 1. Verificación de Permisos (Coordinador) sobre los datos de la carrera (no sobre el estado)
        if (rol === 'Coordinador') {
            const [relaciones] = await pool.query(
                'SELECT 1 FROM admin_carrera WHERE id_administrador = ? AND id_carrera = ?', 
                [id_administrador, id_carrera]
            );
            if (relaciones.length === 0) {
                return res.status(403).json({ message: 'Acceso denegado. Solo puede actualizar carreras que le han sido asignadas.' });
            }
        }

        // INICIO DE LA TRANSACCIÓN
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 🟢 MODIFICACIÓN 3: Construcción dinámica del SQL
        let sql = 'UPDATE carrera SET nombre_carrera = ?, duracion = ?, modalidad = ?, año_aprobacion = ?';
        const params = [nombre_carrera, duracion, modalidad, año_aprobacion];

        // Lógica para el ESTADO (inspirada en updateUserByAdmin)
        if (estado) {
            sql += ', estado = ?';
            params.push(estado);
            
            if (estado === 'cerrada' || estado === 'inactiva') {
                // Registro de auditoría para estados de finalización/eliminación
                sql += ', fecha_eliminacion = NOW(), id_administrador_eliminacion = ?';
                params.push(id_administrador); // ID del administrador logueado
            } else if (estado === 'activa') {
                // Limpiar campos de auditoría si se reactiva
                sql += ', fecha_eliminacion = NULL, id_administrador_eliminacion = NULL';
            }
        }
        
        // Finalizar la consulta de actualización de la carrera
        sql += ' WHERE id_carrera = ?';
        params.push(id_carrera);

        // 2. Ejecutar la actualización de la tabla 'carrera'
        const [result] = await connection.query(sql, params);
        
        // 3. Actualizar asignación del coordinador en admin_carrera (DELETE/INSERT) (Lógica sin cambios)
        
        // Eliminar asignaciones anteriores
        await connection.query('DELETE FROM admin_carrera WHERE id_carrera = ?', [id_carrera]);
        
        // Insertar la nueva asignación, solo si se proporcionó un id_coordinador
        if (id_coordinador) {
            await connection.query(
                'INSERT INTO admin_carrera (id_administrador, id_carrera) VALUES (?, ?)',
                [id_coordinador, id_carrera]
            );
        }

        // COMMIT DE LA TRANSACCIÓN
        await connection.commit();
        
        if (result.affectedRows === 0) {
            await connection.rollback(); 
            // Podría ser que no se hicieran cambios, pero la carrera exista. 
            // Para simplificar, asumimos que debe haber un cambio o es un 404.
            const [check] = await pool.query('SELECT 1 FROM carrera WHERE id_carrera = ?', [id_carrera]);
            if (check.length === 0) {
                return res.status(404).json({ message: 'Carrera no encontrada.' });
            }
            return res.json({ message: 'Carrera y asignación de Coordinador actualizadas con éxito (no hubo cambios en los campos).' });
        }

        res.json({ message: 'Carrera y asignación de Coordinador actualizadas con éxito.' });
    } catch (error) {
        // ROLLBACK EN CASO DE ERROR
        if (connection) await connection.rollback();
        console.error('Error al actualizar carrera y coordinador:', error);
        res.status(500).json({ message: 'Error interno del servidor al actualizar carrera.' });
    } finally {
        if (connection) connection.release();
    }
};

// @desc    Eliminar una carrera (Acceso SÓLO Rector - IMPLEMENTACIÓN DE ELIMINACIÓN LÓGICA)
exports.deleteCarrera = async (req, res) => {
    const { id: id_carrera } = req.params;
    const { rol, id_administrador } = req.user; // Necesitamos id_administrador para auditoría
    
    let connection;

    try {
        // 1. Restringir a Rector
        if (rol !== 'Rector') {
            return res.status(403).json({ message: 'Acceso denegado. Solo el Rector puede eliminar carreras.' });
        }
        
        // INICIO DE LA TRANSACCIÓN
        connection = await pool.getConnection();
        await connection.beginTransaction();
        
        // 2. Ejecutar la ELIMINACIÓN LÓGICA (UPDATE)
        // 🟢 CORRECCIÓN: Eliminación de la indentación inicial en la plantilla literal
        // Se registra la fecha y el administrador que realiza la eliminación lógica
        const [result] = await connection.query(`
UPDATE carrera 
SET 
estado = 'inactiva', -- Estado de eliminación lógica
fecha_eliminacion = NOW(), 
id_administrador_eliminacion = ?
WHERE id_carrera = ? AND estado != 'inactiva' -- Solo si no está ya inactiva
`, [id_administrador, id_carrera]); // Se usa id_administrador para auditoría
        
        if (result.affectedRows === 0) {
            await connection.rollback();
            // Verifica si la carrera no fue encontrada o si ya estaba inactiva
            const [check] = await pool.query('SELECT 1 FROM carrera WHERE id_carrera = ?', [id_carrera]);
            if (check.length === 0) {
                return res.status(404).json({ message: 'Carrera no encontrada.' });
            }
             // Si existe pero affectedRows es 0, ya estaba inactiva.
             return res.status(400).json({ message: 'La carrera ya estaba marcada como inactiva.' });
        }
        
        // 3. DESVINCULAR COORDINADOR: Eliminar la asignación de coordinador (dentro de la transacción)
        const [assignmentsResult] = await connection.query(
            'DELETE FROM admin_carrera WHERE id_carrera = ?', 
            [id_carrera]
        );
        console.log(`[INFO] Eliminadas ${assignmentsResult.affectedRows} asignaciones de coordinador para Carrera ID: ${id_carrera} (Desvinculación por eliminación lógica).`);

        await connection.commit();
        
        res.json({ message: 'Carrera eliminada lógicamente (estado: inactiva), se registró la auditoría y se eliminó la asignación de coordinador con éxito.' });
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Error al realizar la eliminación lógica de carrera:', error);
        res.status(500).json({ message: 'Error interno del servidor al eliminar lógicamente la carrera.' });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// =========================================================
// MATERIAS CRUD (CON FILTRO DE CARRERA CORREGIDO PARA COORDINADOR)
// =========================================================

// @desc 	Obtener listado de materias. FILTRA por las carreras asignadas al Coordinador, por el id_carrera opcional Y por ESTADO ACTIVO.
exports.getMateriasAll = async (req, res) => {
    const user = req.user;
    let params = [];
    let whereClauses = []; // Usaremos un array para construir la cláusula WHERE
    
    // Obtener el filtro opcional de carrera del frontend
    const id_carrera_query = req.query.id_carrera; 
    
    // 1. Lógica de filtrado por Rol
    if (user.rol === 'Coordinador') {
        const carrerasIds = user.carreras_a_cargo_ids;
        
        if (!carrerasIds || carrerasIds.length === 0) {
            return res.json([]); 
        }
        
        // Condición base: el Coordinador solo puede ver materias de sus carreras
        const placeholders = carrerasIds.map(() => '?').join(', ');
        whereClauses.push(`m.id_carrera IN (${placeholders})`);
        params.push(...carrerasIds); 
        
        // Aplicar el filtro adicional por id_carrera (del frontend)
        if (id_carrera_query) {
            whereClauses.push(`m.id_carrera = ?`);
            params.push(id_carrera_query);
        }

    } else if (user.rol === 'Rector') {
        // El Rector ve todas, pero puede filtrar opcionalmente por id_carrera
        if (id_carrera_query) {
            whereClauses.push(`m.id_carrera = ?`);
            params.push(id_carrera_query);
        }
        
    } else {
        return res.status(403).json({ message: 'Acceso denegado. Rol no autorizado.' });
    }
    
    // FILTRO DE ESTADO para Eliminación Lógica
    whereClauses.push(`m.estado = 'activa'`);

    let whereClause = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : '';

    // 🚨 CORRECCIÓN APLICADA: Se limpió la plantilla literal de la consulta
    // eliminando la indentación y los espacios en blanco no estándar al final
    // de la lista de columnas que causaban el error de sintaxis.
    let query = `SELECT
        m.id_materia,
        m.nombre_materia,
        m.año,
        m.campo_formacion,
        m.modalidad,
        m.formato,
        m.horas_semanales,
        m.total_horas_anuales,
        m.acreditacion,
        m.id_carrera,
        m.estado
    FROM materia m
    ${whereClause} 
    ORDER BY m.año ASC, m.nombre_materia ASC`;

    try {
        const [materias] = await pool.query(query, params); 
        res.json(materias);
    } catch (error) {
        console.error('Error al obtener el listado de materias:', error);
        res.status(500).json({ message: 'Error interno del servidor al obtener el listado de materias.' });
    }
};

// @desc 	Obtener una materia por ID (con control de acceso)
exports.getMateriaById = async (req, res) => {
    const { id } = req.params;
    const user = req.user;
    
    // Añadir filtro de estado para que solo devuelva materias activas
    let query = "SELECT * FROM materia WHERE id_materia = ? AND estado = 'activa'";
    let params = [id];
    
    if (user.rol === 'Coordinador') {
        const carrerasIds = user.carreras_a_cargo_ids;

        if (!carrerasIds || carrerasIds.length === 0) {
            return res.status(403).json({ message: 'Materia no encontrada o acceso denegado (Coordinador sin carreras asignadas).' });
        }
        
        const placeholders = carrerasIds.map(() => '?').join(', ');
        query += ` AND id_carrera IN (${placeholders})`;
        params.push(...carrerasIds); 
    }

    try {
        const [materia] = await pool.query(query, params);
        if (materia.length === 0) {
            return res.status(404).json({ message: 'Materia no encontrada o acceso denegado.' });
        }
        res.json(materia[0]);
    } catch (error) {
        console.error('Error al obtener materia por ID:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
};

// @desc 	Crear una nueva materia (Rector: todo, Coordinador: solo sus carreras)
exports.createMateria = async (req, res) => {
    const user = req.user;
    
    const { 
        nombre_materia, id_carrera, año, campo_formacion, 
        modalidad, formato, horas_semanales, total_horas_anuales, acreditacion
    } = req.body; 

    // 1. Lógica de Permisos para Coordinador
    if (user.rol === 'Coordinador') {
        const carreraIdToCreate = parseInt(id_carrera);
        // Convertir IDs a números para una comparación segura
        const carrerasAsignadas = user.carreras_a_cargo_ids.map(id => parseInt(id)); 

        if (!carrerasAsignadas.includes(carreraIdToCreate)) {
            return res.status(403).json({ message: 'Acceso denegado. Solo puede crear materias para las carreras que coordina.' });
        }
    } else if (user.rol !== 'Rector') {
        return res.status(403).json({ message: 'Acceso denegado. Rol no autorizado.' });
    }
    
    try {
        const [result] = await pool.query(
            `INSERT INTO materia (nombre_materia, id_carrera, año, campo_formacion, modalidad, formato, horas_semanales, total_horas_anuales, acreditacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [nombre_materia, id_carrera, año, campo_formacion, modalidad, formato, horas_semanales, total_horas_anuales, acreditacion]
        );
        res.status(201).json({ id_materia: result.insertId, ...req.body, message: 'Materia creada con éxito.' });
    } catch (error) {
        console.error('Error al crear materia:', error);
        if (error.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(400).json({ message: 'Error al crear materia: La carrera seleccionada no existe.', error: error.message });
        }
        res.status(500).json({ message: 'Error interno del servidor al crear materia.' });
    }
};

// @desc 	Actualizar una materia (Rector: todo, Coordinador: solo sus carreras)
exports.updateMateria = async (req, res) => {
    const { id } = req.params;
    const user = req.user;
    
    const { 
        nombre_materia, id_carrera, año, campo_formacion, 
        modalidad, formato, horas_semanales, total_horas_anuales, acreditacion
    } = req.body; 
    
    let updateWhereClause = 'id_materia = ?';
    let params = [nombre_materia, id_carrera, año, campo_formacion, modalidad, formato, horas_semanales, total_horas_anuales, acreditacion, id];
    
    // Lógica de Permisos para Coordinador (Correcto)
    if (user.rol === 'Coordinador') {
        const carrerasIds = user.carreras_a_cargo_ids;
        
        if (!carrerasIds || carrerasIds.length === 0) {
            return res.status(403).json({ message: 'Acceso denegado. No tiene carreras asignadas.' });
        }
        
        // 1. Impedir que el coordinador cambie la materia a una carrera que NO es la suya (Seguridad)
        const idCarreraBody = parseInt(id_carrera);
        if (id_carrera && !carrerasIds.map(id => parseInt(id)).includes(idCarreraBody)) {
            return res.status(403).json({ message: 'Acceso denegado. No puede reasignar la materia a una carrera que no coordina.' });
        }
        
        // 2. Añadir una condición WHERE para asegurar que la materia a actualizar pertenezca a una de sus carreras
        const placeholders = carrerasIds.map(() => '?').join(', ');
        updateWhereClause += ` AND id_carrera IN (${placeholders})`;
        params.push(...carrerasIds.map(id => parseInt(id)));
    } else if (user.rol !== 'Rector') {
        return res.status(403).json({ message: 'Acceso denegado. Rol no autorizado.' });
    }
    
    // IMPORTANTE: También se añade `AND estado = 'activa'` para evitar actualizar materias dadas de baja.
    updateWhereClause += ` AND estado = 'activa'`;
    
    try {
        const [result] = await pool.query(
            `UPDATE materia SET nombre_materia = ?, id_carrera = ?, año = ?, campo_formacion = ?, modalidad = ?, formato = ?, horas_semanales = ?, total_horas_anuales = ?, acreditacion = ? WHERE ${updateWhereClause}`,
            params
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Materia no encontrada, acceso denegado o ya está inactiva.' });
        }

        res.json({ message: 'Materia actualizada con éxito.' });
    } catch (error) {
        console.error('Error al actualizar materia:', error);
        if (error.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(400).json({ message: 'Error al actualizar materia: La carrera seleccionada no existe (Verifique el id_carrera).', error: error.message });
        }
        res.status(500).json({ message: 'Error interno del servidor al actualizar materia.' });
    }
};

// @desc    Dar de baja (Eliminación Lógica) una materia (Rector: todo, Coordinador: solo sus carreras)
exports.deleteMateria = async (req, res) => {
    const { id: id_materia } = req.params;
    const user = req.user;
    
    // 💡 CLAVE: Obtener el ID del administrador logueado.
    const id_administrador_eliminacion = user.id_administrador;

    try {
        // 1. Obtener id_carrera y estado de la materia
        const [materias] = await pool.query('SELECT id_carrera, estado FROM materia WHERE id_materia = ?', [id_materia]);

        if (materias.length === 0) {
            return res.status(404).json({ message: 'Materia no encontrada.' });
        }
        
        const { id_carrera, estado } = materias[0];
        
        // Chequeo adicional: si ya está inactiva
        if (estado === 'inactiva') {
            return res.status(400).json({ message: 'La materia ya se encuentra inactiva.' });
        }

        // 2. Lógica de Permisos para Coordinador (No se modifica)
        if (user.rol === 'Coordinador') {
            const carreraIdToDelete = parseInt(id_carrera);
            const carrerasAsignadas = user.carreras_a_cargo_ids.map(id => parseInt(id)); 
            
            if (!carrerasAsignadas.includes(carreraIdToDelete)) {
                return res.status(403).json({ message: 'Acceso denegado. Solo puede dar de baja materias de las carreras que coordina.' });
            }
        } else if (user.rol !== 'Rector') {
            return res.status(403).json({ message: 'Acceso denegado. Rol no autorizado.' });
        }
        
        // 3. Ejecutar la ELIMINACIÓN LÓGICA (Actualizar estado, fecha y administrador de baja/eliminación)
        const [result] = await pool.query(
            `UPDATE materia 
             SET estado = ?, fecha_eliminacion = NOW(), id_administrador_eliminacion = ? 
             WHERE id_materia = ?`, 
            ['inactiva', id_administrador_eliminacion, id_materia] // Usa tus campos 'fecha_eliminacion' e 'id_administrador_eliminacion'
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Materia no encontrada para dar de baja.' }); 
        }
        
        // MENSAJE DE ÉXITO DE ELIMINACIÓN LÓGICA
        res.json({ message: 'Materia dada de baja (inactiva) con éxito. Se registró la fecha y el administrador de la eliminación.' });
    } catch (error) {
        console.error('Error al dar de baja la materia:', error);
        res.status(500).json({ message: 'Error interno del servidor al dar de baja la materia.', error: error.message });
    }
};

// =========================================================
// HORARIOS CRUD (CON FILTRO Y CONTROL DE ROLES)
// =========================================================
// @desc    Obtener horarios filtrados por ID de materia (ENDPOINT DE FILTRO). SOLO ACTIVOS.
exports.getHorariosPorMateria = async (req, res) => {
    // Extraer datos del token
    const { id_administrador, rol } = req.user; 
    
    // Utilizamos req.query.id_materia
    const idMateria = req.query.id_materia; 
    
    if (!idMateria) {
        // Si no hay idMateria, se devuelve un array vacío (útil para cuando la pantalla carga sin selección)
        return res.status(200).json([]);
    }

    try {
        // 🚨 ACTUALIZACIÓN: Incluir h.estado en SELECT
        let sql = `
            SELECT 
                h.id_horario,
                m.nombre_materia, 
                h.id_materia, 
                h.dia_semana, 
                TIME_FORMAT(h.hora_inicio, '%H:%i') AS hora_inicio, 
                TIME_FORMAT(h.hora_fin, '%H:%i') AS hora_fin,
                h.estado
            FROM horario h
            INNER JOIN materia m ON h.id_materia = m.id_materia
            INNER JOIN carrera c ON m.id_carrera = c.id_carrera
        `;
        let params = [idMateria];
        
        let whereClauses = ['h.id_materia = ?'];

        // 🚨 IMPLEMENTACIÓN: Filtrar solo horarios activos
        whereClauses.push('h.estado = "activa"'); 

        // APLICAR FILTRO DE ROL PARA COORDINADOR
        if (rol === 'Coordinador') {
            whereClauses.push(`c.id_carrera IN (
                SELECT id_carrera 
                FROM admin_carrera 
                WHERE id_administrador = ?
            )`);
            params.push(id_administrador);
        } else if (rol !== 'Rector') {
             return res.status(403).json({ message: 'Permisos insuficientes para ver horarios.' });
        }
        
        sql += ' WHERE ' + whereClauses.join(' AND ');
        sql += ' ORDER BY FIELD(h.dia_semana, \'Lunes\', \'Martes\', \'Miércoles\', \'Jueves\', \'Viernes\', \'Sábado\'), h.hora_inicio ASC';

        const [horarios] = await pool.query(sql, params);
        
        res.json(horarios);
    } catch (error) {
        console.error('Error al obtener horarios por materia (Admin):', error);
        res.status(500).json({ message: 'Error al filtrar horarios por materia.' });
    }
};

// @desc    Obtener un horario por ID. SOLO ACTIVO.
exports.getHorarioById = async (req, res) => {
    const { id } = req.params;
    try {
        // 🚨 ACTUALIZACIÓN: Filtrar por estado = 'activa' y seleccionar el estado
        const [horario] = await pool.query(
            'SELECT id_horario, id_materia, dia_semana, hora_inicio, hora_fin, estado FROM horario WHERE id_horario = ? AND estado = "activa"', 
            [id]
        );
        if (horario.length === 0) {
            return res.status(404).json({ message: 'Horario no encontrado o inactiva.' });
        }
        res.json(horario[0]);
    } catch (error) {
        console.error('Error al obtener horario por ID:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
};

// @desc    Crear un nuevo horario
exports.createHorario = async (req, res) => {
    // Extraer datos del token
    const { id_administrador, rol } = req.user; 
    
    if (!validateRequiredFields(['id_materia', 'dia_semana', 'hora_inicio', 'hora_fin'], req, res)) return;
    
    const { id_materia, dia_semana, hora_inicio, hora_fin } = req.body;
    
    // CONTROL DE ACCESO PARA COORDINADOR (POST)
    if (rol === 'Coordinador') {
        const hasAccess = await checkMateriaAccess(id_materia, id_administrador);
        if (!hasAccess) {
            return res.status(403).json({ message: 'Acceso denegado. No coordina la carrera de esta materia.' });
        }
    } else if (rol !== 'Rector') {
         return res.status(403).json({ message: 'Permisos insuficientes para crear horarios.' });
    }
    
    try {
        // 🚨 IMPLEMENTACIÓN: Añadir 'estado' con valor 'activo'
        const [result] = await pool.query(
            'INSERT INTO horario (id_materia, dia_semana, hora_inicio, hora_fin, estado) VALUES (?, ?, ?, ?, ?)',
            [id_materia, dia_semana, hora_inicio, hora_fin, 'activa']
        );
        res.status(201).json({ id_horario: result.insertId, ...req.body, message: 'Horario creado con éxito.' });
    } catch (error) {
        console.error('Error al crear horario:', error);
        res.status(500).json({ message: 'Error interno del servidor al crear horario.' });
    }
};

// @desc    Actualizar un horario. SOLO ACTIVO.
exports.updateHorario = async (req, res) => {
    const { id } = req.params;
    const { id_administrador, rol } = req.user; 
    
    if (!validateRequiredFields(['id_materia', 'dia_semana', 'hora_inicio', 'hora_fin'], req, res)) return;

    const { id_materia, dia_semana, hora_inicio, hora_fin } = req.body;

    // CONTROL DE ACCESO PARA COORDINADOR (PUT)
    if (rol === 'Coordinador') {
        const hasAccess = await checkMateriaAccess(id_materia, id_administrador);
        if (!hasAccess) {
            return res.status(403).json({ message: 'Acceso denegado. No coordina la carrera de esta materia.' });
        }
    } else if (rol !== 'Rector') {
         return res.status(403).json({ message: 'Permisos insuficientes para actualizar horarios.' });
    }

    try {
        // 🚨 IMPLEMENTACIÓN: Añadir AND estado = 'activo' al WHERE
        const [result] = await pool.query(
            'UPDATE horario SET id_materia = ?, dia_semana = ?, hora_inicio = ?, hora_fin = ? WHERE id_horario = ? AND estado = ?',
            [id_materia, dia_semana, hora_inicio, hora_fin, id, 'activa']
        );
         if (result.affectedRows === 0) {
             return res.status(404).json({ message: 'Horario no encontrado o ya está inactivo.' });
         }
        res.json({ message: 'Horario actualizado con éxito.' });
    } catch (error) {
        console.error('Error al actualizar horario:', error);
        res.status(500).json({ message: 'Error interno del servidor al actualizar horario.' });
    }
};

// @desc    Dar de baja (Eliminación Lógica) un horario
exports.deleteHorario = async (req, res) => {
    const { id } = req.params; // id_horario
    const { id_administrador, rol } = req.user; 
    
    // 💡 ID del administrador para la trazabilidad
    const id_administrador_eliminacion = id_administrador;

    try {
        // 1. Obtener id_materia y estado para validar el acceso y el estado actual
        const [horario] = await pool.query('SELECT id_materia, estado FROM horario WHERE id_horario = ?', [id]); 
        
        if (horario.length === 0) {
            return res.status(404).json({ message: 'Horario no encontrado.' });
        }

        const { id_materia, estado } = horario[0];

        // 🚨 Chequeo adicional: si ya está inactivo
        if (estado === 'inactiva') {
            return res.status(400).json({ message: 'El horario ya se encuentra inactivo.' });
        }

        // 2. Control de Acceso para Coordinador
        if (rol === 'Coordinador') {
            const hasAccess = await checkMateriaAccess(id_materia, id_administrador);
            if (!hasAccess) {
                return res.status(403).json({ message: 'Acceso denegado. No coordina la carrera de esta materia.' });
            }
        } else if (rol !== 'Rector') {
             return res.status(403).json({ message: 'Permisos insuficientes para dar de baja horarios.' });
        }
        
        // 3. Ejecutar la ELIMINACIÓN LÓGICA (Actualiza estado, fecha_eliminacion, y id_administrador_eliminacion)
        // 🛠️ CORRECCIÓN CLAVE: Cambiado de 'inactiva' a 'inactivo'
        const [result] = await pool.query(
            `UPDATE horario 
             SET estado = ?, fecha_eliminacion = NOW(), id_administrador_eliminacion = ? 
             WHERE id_horario = ? AND estado = 'activa'`, 
            ['inactiva', id_administrador_eliminacion, id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Horario no encontrado para dar de baja.' }); 
        }

        res.json({ message: 'Horario dado de baja (inactivo) con éxito. Se registraron los datos de la eliminación.' });
    } catch (error) {
        console.error('Error al dar de baja el horario:', error);
        res.status(500).json({ message: 'Error interno del servidor al dar de baja el horario.' });
    }
};

// =========================================================
// CORRELATIVIDADES CRUD (CON FILTRO Y CONTROL DE ROLES)
// =========================================================

// @desc    Obtener correlatividades filtradas por ID de materia principal (id). SOLO ACTIVAS.
exports.getCorrelatividadesPorMateria = async (req, res) => {
    const { id: id_materia_principal } = req.params; 
    const { id_administrador, rol } = req.user;

    // 1. Verificación de ID de materia
    if (!id_materia_principal) {
        return res.status(400).json({ message: 'El ID de la materia principal es obligatorio.' });
    }

    try {
        let sql = `
            SELECT 
                c.id_correlatividad, 
                c.id_materia_principal, 
                c.id_materia_requisito, 
                c.tipo, 
                c.estado_requisito,
                c.estado, 
                mp.nombre_materia AS nombre_materia_principal,
                mr.nombre_materia AS nombre_materia_requisito
            FROM correlatividad c
            JOIN materia mp ON c.id_materia_principal = mp.id_materia
            JOIN materia mr ON c.id_materia_requisito = mr.id_materia
        `;
        let params = [id_materia_principal];
        let whereClauses = ['c.id_materia_principal = ?'];

        // 🚨 Filtro de Eliminación Lógica: SOLO ACTIVAS
        whereClauses.push('c.estado = "activa"'); 

        // 2. Control de Acceso para Coordinador
        if (rol === 'Coordinador') {
            // El coordinador solo puede ver correlatividades de materias que coordina.
            whereClauses.push(`mp.id_carrera IN (
                SELECT id_carrera 
                FROM admin_carrera 
                WHERE id_administrador = ?
            )`);
            params.push(id_administrador);
        } else if (rol !== 'Rector') {
             return res.status(403).json({ message: 'Permisos insuficientes para ver correlatividades.' });
        }
        
        sql += ' WHERE ' + whereClauses.join(' AND ');
        sql += ' ORDER BY mr.nombre_materia ASC';

        const [correlatividades] = await pool.query(sql, params);
        
        res.json(correlatividades);
    } catch (error) {
        console.error('Error al obtener correlatividades por materia (Admin):', error);
        res.status(500).json({ message: 'Error al filtrar correlatividades.' });
    }
};

// -------------------------------------------------------------------------

// @desc    Obtener una correlatividad por ID. SOLO ACTIVA.
exports.getCorrelatividadById = async (req, res) => {
    const { id: id_correlatividad } = req.params;
    const { id_administrador, rol } = req.user;
    
    try {
        // 1. Obtener la correlatividad y su materia principal
        const [correlatividades] = await pool.query(`
            SELECT c.*, mp.id_materia AS id_materia_principal
            FROM correlatividad c
            JOIN materia mp ON c.id_materia_principal = mp.id_materia
            WHERE c.id_correlatividad = ? AND c.estado = 'activa'
        `, [id_correlatividad]);
        
        const correlatividad = correlatividades[0];

        if (!correlatividad) {
            return res.status(404).json({ message: 'Correlatividad no encontrada o inactiva.' });
        }
        
        // 2. Control de Acceso para Coordinador
        if (rol === 'Coordinador') {
            const hasAccess = await checkMateriaAccess(correlatividad.id_materia_principal, id_administrador);
            if (!hasAccess) {
                return res.status(403).json({ message: 'Acceso denegado. No coordina la carrera de la materia principal.' });
            }
        } else if (rol !== 'Rector') {
             return res.status(403).json({ message: 'Permisos insuficientes para ver esta correlatividad.' });
        }
        
        res.json(correlatividad);
    } catch (error) {
        console.error('Error al obtener correlatividad por ID:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
};

// -------------------------------------------------------------------------

// @desc    Crear una nueva correlatividad
exports.createCorrelatividad = async (req, res) => {
    const { id_administrador, rol } = req.user;
    
    const { id_materia_principal, id_materia_requisito, tipo, estado_requisito } = req.body;
    
    // Validación de que no se correlacione una materia consigo misma
    if (id_materia_principal === id_materia_requisito) {
        return res.status(400).json({ message: 'Error: Una materia no puede ser correlativa de sí misma.' });
    }
    
    // CONTROL DE ACCESO PARA COORDINADOR (POST)
    if (rol === 'Coordinador') {
        // El coordinador solo puede crear correlatividades para materias que coordina (id_materia_principal).
        const hasAccess = await checkMateriaAccess(id_materia_principal, id_administrador);
        if (!hasAccess) {
            return res.status(403).json({ message: 'Acceso denegado. No coordina la carrera de la materia principal.' });
        }
    } else if (rol !== 'Rector') {
         return res.status(403).json({ message: 'Permisos insuficientes para crear correlatividades.' });
    }

    try {
        // 🚨 Se añade el campo 'estado' con valor 'activa'
        const [result] = await pool.query(
            'INSERT INTO correlatividad (id_materia_principal, id_materia_requisito, tipo, estado_requisito, estado) VALUES (?, ?, ?, ?, ?)',
            [id_materia_principal, id_materia_requisito, tipo, estado_requisito, 'activa']
        );
        res.status(201).json({ id_correlatividad: result.insertId, ...req.body, message: 'Correlatividad creada con éxito.' });
    } catch (error) {
        console.error('Error al crear correlatividad:', error);
        // Manejo de error de Foreign Key (si una de las materias no existe)
        if (error.code === 'ER_NO_REFERENCED_ROW_2') {
             return res.status(400).json({ message: 'Error al crear correlatividad: Una o ambas materias no existen.', error: error.message });
        }
        // Manejo de error de duplicado (si ya existe la correlatividad)
        if (error.code === 'ER_DUP_ENTRY') {
             return res.status(400).json({ message: 'Error: Esta correlatividad ya existe.', error: error.message });
        }
        res.status(500).json({ message: 'Error interno del servidor al crear correlatividad.' });
    }
};

// -------------------------------------------------------------------------

// @desc    Actualizar una correlatividad. SOLO si está ACTIVA.
exports.updateCorrelatividad = async (req, res) => {
    const { id: id_correlatividad } = req.params;
    const { id_administrador, rol } = req.user; 

    const { id_materia_principal, id_materia_requisito, tipo, estado_requisito } = req.body;
    
    // Validación de que no se correlacione una materia consigo misma
    if (id_materia_principal === id_materia_requisito) {
        return res.status(400).json({ message: 'Error: Una materia no puede ser correlativa de sí misma.' });
    }
    
    // CONTROL DE ACCESO PARA COORDINADOR (PUT)
    if (rol === 'Coordinador') {
        // Aseguramos que la *nueva* materia principal esté en la carrera del coordinador
        const hasAccess = await checkMateriaAccess(id_materia_principal, id_administrador);
        if (!hasAccess) {
            return res.status(403).json({ message: 'Acceso denegado. No coordina la carrera de la materia principal a actualizar.' });
        }
        
    } else if (rol !== 'Rector') {
         return res.status(403).json({ message: 'Permisos insuficientes para actualizar correlatividades.' });
    }
    
    try {
        // 🚨 Se añade AND estado = 'activa' para evitar modificar correlatividades dadas de baja
        const [result] = await pool.query(
            'UPDATE correlatividad SET id_materia_principal = ?, id_materia_requisito = ?, tipo = ?, estado_requisito = ? WHERE id_correlatividad = ? AND estado = ?',
            [id_materia_principal, id_materia_requisito, tipo, estado_requisito, id_correlatividad, 'activa']
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Correlatividad no encontrada o ya está inactiva.' });
        }
        res.json({ message: 'Correlatividad actualizada con éxito.' });
    } catch (error) {
        console.error('Error al actualizar correlatividad:', error);
        // Manejo de error de Foreign Key (si una de las materias no existe)
        if (error.code === 'ER_NO_REFERENCED_ROW_2') {
             return res.status(400).json({ message: 'Error al actualizar correlatividad: Una o ambas materias no existen.', error: error.message });
        }
        // Manejo de error de duplicado
        if (error.code === 'ER_DUP_ENTRY') {
             return res.status(400).json({ message: 'Error: Esta correlatividad ya existe.', error: error.message });
        }
        res.status(500).json({ message: 'Error interno del servidor al actualizar correlatividad.' });
    }
};

// -------------------------------------------------------------------------

// @desc    Dar de baja (Eliminación Lógica) una correlatividad
exports.deleteCorrelatividad = async (req, res) => {
    const { id: id_correlatividad } = req.params;
    const { id_administrador, rol } = req.user; 

    // 💡 ID del administrador para la trazabilidad
    const id_administrador_eliminacion = id_administrador;

    try {
        // 1. Obtener id_materia_principal y estado para validar el acceso y el estado actual
        const [correlatividad] = await pool.query('SELECT id_materia_principal, estado FROM correlatividad WHERE id_correlatividad = ?', [id_correlatividad]); 
        
        if (correlatividad.length === 0) {
             return res.status(404).json({ message: 'Correlatividad no encontrada.' });
        }

        const { id_materia_principal, estado } = correlatividad[0];

        // 🚨 Chequeo adicional: si ya está inactiva
        if (estado === 'inactiva') {
            return res.status(400).json({ message: 'La correlatividad ya se encuentra inactiva.' });
        }
        
        // 2. Control de Acceso para Coordinador
        if (rol === 'Coordinador') {
            const hasAccess = await checkMateriaAccess(id_materia_principal, id_administrador);
            if (!hasAccess) {
                return res.status(403).json({ message: 'Acceso denegado. No coordina la carrera de la materia principal.' });
            }
        } else if (rol !== 'Rector') {
             return res.status(403).json({ message: 'Permisos insuficientes para dar de baja correlatividades.' });
        }
        
        // 3. Ejecutar la ELIMINACIÓN LÓGICA (Actualiza estado, fecha_eliminacion, y id_administrador_eliminacion)
        const [result] = await pool.query(
            `UPDATE correlatividad 
             SET estado = ?, fecha_eliminacion = NOW(), id_administrador_eliminacion = ? 
             WHERE id_correlatividad = ?`, 
            ['inactiva', id_administrador_eliminacion, id_correlatividad]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Correlatividad no encontrada para dar de baja.' }); 
        }

        res.json({ message: 'Correlatividad dada de baja (inactiva) con éxito. Se registraron los datos de la eliminación.' });
    } catch (error) {
        console.error('Error al dar de baja la correlatividad:', error);
        res.status(500).json({ message: 'Error interno del servidor al dar de baja la correlatividad.' });
    }
};