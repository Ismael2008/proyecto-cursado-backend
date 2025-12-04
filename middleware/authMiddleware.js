// backend/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const pool = require('../database'); 

const JWT_SECRET = process.env.JWT_SECRET; 

// Middleware para verificar si el usuario está logueado (PROTECT)
exports.protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];

            // 1. Verificar y decodificar el token
            const decoded = jwt.verify(token, JWT_SECRET);
            const idAdmin = decoded.id_administrador; // Guardamos el ID del administrador

            // 2. Buscar el administrador base y su ESTADO
            const [administradores] = await pool.query(
                // 🚨 CAMBIO CLAVE: Incluimos 'estado' en la selección
                'SELECT id_administrador, nombre_administrador, rol, estado FROM administrador WHERE id_administrador = ?', 
                [idAdmin] 
            );

            const user = administradores[0];

            if (administradores.length === 0) {
                return res.status(401).json({ message: 'No autorizado, administrador no encontrado' });
            }
            
            // 🚨 NUEVA VERIFICACIÓN: Bloquear si el estado no es 'Activo'
            if (user.estado !== 'activo') {
                return res.status(403).json({ 
                    message: `Acceso denegado. Su cuenta se encuentra ${user.estado}. Contacte a un Rector.` 
                });
            }
            
            // 🟢 Lógica para manejar la relación de muchos a muchos (admin_carrera)
            if (user.rol === 'Coordinador') {
                // Consultar la tabla intermedia para obtener todas las carreras asignadas
                const [carreras] = await pool.query(
                    'SELECT id_carrera FROM admin_carrera WHERE id_administrador = ?',
                    [idAdmin]
                );
                
                // Adjuntar un array de IDs de carreras (ej: [1, 5, 8])
                user.carreras_a_cargo_ids = carreras.map(row => row.id_carrera);
            } else {
                // Si es Rector, no tiene carreras específicas asignadas para filtrado
                user.carreras_a_cargo_ids = null; 
            }
            
            // ✅ CORRECCIÓN CLAVE: Normalizar el ID.
            // Esto permite que el controlador acceda al ID como 'req.user.id'.
            user.id = user.id_administrador;
            
            // Adjuntar datos del administrador (incluyendo las carreras a cargo si es coordinador)
            req.user = user;
            
            next();

        } catch (error) {
            console.error('Error al verificar el token:', error);
            // Esto captura errores como token expirado o inválido
            res.status(401).json({ message: 'No autorizado, token inválido o expirado' });
        }
    } else {
        res.status(401).json({ message: 'No autorizado, no hay token' });
    }
};

// Middleware para restringir el acceso a roles de administración (ADMIN)
// Usado para rutas accesibles por Rector y Coordinador
exports.admin = (req, res, next) => {
    // Usamos req.user.rol que ya está cargado por 'protect'
    if (req.user && (req.user.rol === 'Rector' || req.user.rol === 'Coordinador')) {
        next();
    } else {
        res.status(403).json({ message: 'Acceso denegado. Se requiere un rol de administración válido (Rector o Coordinador).' });
    }
};

// Middleware para acceso SÓLO de Rector
exports.rector = (req, res, next) => {
    // Usamos req.user.rol que ya está cargado por 'protect'
    if (req.user && req.user.rol === 'Rector') {
        next();
    } else {
        res.status(403).json({ message: 'Acceso denegado. Se requiere el rol de Rector.' });
    }
};