// backend/routes/adminRoutes.js
const express = require('express');
const router = express.Router();

// Importar los middleware de autenticación
const { protect, admin, rector } = require('../middleware/authMiddleware'); 

// Importar todos los controladores CRUD y de Filtrado
const { 
    // Carreras
    getCarreras, getCarreraById, createCarrera, updateCarrera, deleteCarrera,

    // Materias
    getMateriasAll, 
    getMateriaById, createMateria, updateMateria, deleteMateria,

    // Horarios
    getHorariosPorMateria, getHorarioById, createHorario, updateHorario, deleteHorario,

    // Correlatividades
    getCorrelatividadesPorMateria, getCorrelatividadById, createCorrelatividad, updateCorrelatividad, deleteCorrelatividad,
    
    // ADMINISTRADORES
    listUsers, getUserById, createUserByAdmin, updateUserByAdmin, deleteUserByAdmin,
    listCoordinadores
    
} = require('../controllers/adminController'); 

// La ruta base para este archivo es típicamente /api/admin/

// =========================================================
// 1. RUTAS: GESTIÓN DE CARRERAS (Rector: All | Coordinador: View/Edit Asignadas)
// =========================================================

// Ruta de Colección: Listar (todas) y Crear nueva
router.route('/carreras')
    .get(protect, admin, getCarreras)      // GET: Rector/Coordinador (el controlador filtra)
    .post(protect, rector, createCarrera); // POST: SOLO Rector 

// Ruta de Recurso por ID
router.route('/carreras/:id')
    .get(protect, admin, getCarreraById)  // GET: Rector/Coordinador
    .put(protect, admin, updateCarrera)   // PUT: Rector/Coordinador
    .delete(protect, rector, deleteCarrera); // DELETE: SOLO Rector (Correcto)

// ---------------------------------------------------------
// =========================================================
// 2. RUTAS: GESTIÓN DE MATERIAS (Rector: All | Coordinador: All Asignadas)
// =========================================================

// Ruta de Colección: Listar (todas) y Crear nueva
router.route('/materias')
    .get(protect, admin, getMateriasAll)    // GET: Rector/Coordinador
    .post(protect, admin, createMateria);  // POST: Rector/Coordinador (el controlador valida la id_carrera)

// Ruta de Recurso por ID
router.route('/materias/:id')
    .get(protect, admin, getMateriaById)  // GET: Rector/Coordinador
    .put(protect, admin, updateMateria)   // PUT: Rector/Coordinador
    .delete(protect, admin, deleteMateria); // DELETE: Rector/Coordinador (el controlador valida la id_carrera)

// ---------------------------------------------------------
// =========================================================
// 3. RUTAS: GESTIÓN DE HORARIOS (CRUD con FILTRO)
// =========================================================
// Nota: Se mantiene el permiso 'admin' (Rector/Coordinador)
router.route('/horarios')
    .get(protect, admin, getHorariosPorMateria) 
    .post(protect, admin, createHorario); 

router.route('/horarios/:id')
    .get(protect, admin, getHorarioById)  
    .put(protect, admin, updateHorario)   
    .delete(protect, admin, deleteHorario); 

// ---------------------------------------------------------
// =========================================================
// 4. RUTAS: GESTIÓN DE CORRELATIVIDADES (CRUD con FILTRO)
// =========================================================
// Nota: Se mantiene el permiso 'admin' (Rector/Coordinador)

// Ruta con filtro por materia
router.get('/correlatividades/por-materia/:id', protect, admin, getCorrelatividadesPorMateria); 

// Ruta principal de Correlatividades (POST y CRUD por ID)
router.route('/correlatividades')
    .post(protect, admin, createCorrelatividad); 

router.route('/correlatividades/:id')
    .get(protect, admin, getCorrelatividadById)  
    .put(protect, admin, updateCorrelatividad)   
    .delete(protect, admin, deleteCorrelatividad); 

// =========================================================
// 5. RUTAS: GESTIÓN DE ADMINISTRADORES (CRUD) 🔐
// =========================================================

// ⚠️ CORRECCIÓN CLAVE: Las rutas GET y PUT para usuarios/administradores deben usar 'admin'
// para permitir que el Coordinador acceda a su propio perfil.
router.route('/usuarios')
    .get(protect, admin, listUsers)      // 🟢 CORREGIDO: Antes 'rector'
    .post(protect, rector, createUserByAdmin); // Mantener POST solo para Rector

router.route('/usuarios/:id')
    .get(protect, admin, getUserById)      // 🟢 CORREGIDO: Antes 'rector'
    .put(protect, admin, updateUserByAdmin)    // 🟢 CORREGIDO: Antes 'rector'
    .delete(protect, rector, deleteUserByAdmin); // Mantener DELETE solo para Rector

// =========================================================
// 6. RUTAS: UTILIDAD DE ADMINISTRADORES (Lista Coordinadores)
// =========================================================

// Ruta para obtener solo la lista de administradores que son coordinadores
router.get('/coordinadores', protect, admin, listCoordinadores); // GET: Rector/Coordinador (para formularios)

module.exports = router;