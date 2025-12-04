// backend/routes/apiRoutes.js

const express = require('express');
const router = express.Router();
const cursadoController = require('../controllers/cursadoController');

// ==========================================================
// 🚨 Rutas de Cursado (Asegura la funcionalidad del horario)
// ==========================================================

// 1. Ruta para obtener TODAS LAS CARRERAS (Usada por el select inicial/menú)
router.get('/carreras', cursadoController.getCarreras);

// 2. RUTA NUEVA: Obtener el detalle completo de una carrera por su ID (Para carrera.html)
// Endpoint: /api/carreras/:id
router.get('/carreras/:id', cursadoController.getCarreraDetalleById); 

// 2.1 RUTA CRUCIAL: Descargar el plan de estudio en PDF. 🆕
// Endpoint: /api/carreras/:id/plan-estudio-pdf
router.get('/carreras/:id/plan-estudio-pdf', cursadoController.descargarPlanEstudioPDF);

// 3. RUTA CRUCIAL: Obtener los AÑOS disponibles para una carrera. 🆕
// Endpoint: /api/anios?id_carrera=X
router.get('/anios', cursadoController.getAniosByCarrera);

// 4. Ruta para obtener MATERIAS por ID de carrera y año
// Endpoint: /api/materias?id_carrera=X&año=Y (Nota: el parámetro fue corregido a 'año' en el controller)
router.get('/materias', cursadoController.getMaterias);

// 5. Ruta para obtener HORARIOS por ID de materia
router.get('/horarios', cursadoController.getHorariosByMateria);


// ==========================================================
// Rutas Adicionales del Proyecto
// ==========================================================

// 1. Rutas de vistas 
router.post('/destacadas/:id/vista', cursadoController.registrarVista);

// 2. Ruta para obtener materias destacadas 
router.get('/destacadas', cursadoController.getMateriasDestacadas); 

// 3. Ruta para buscar materias por nombre 
router.get('/materias/buscar', cursadoController.searchMaterias);

// 4. Ruta para obtener materias de un año específico (Ruta menos común, podría solaparse con /materias)
// Nota: La función en el controlador se renombró a getMateriasByAnioIncompleto
router.get('/materias/anio/:anio', cursadoController.getMateriasByAnioIncompleto); 

// 5. Ruta para obtener el detalle de una materia por su ID 
// Endpoint: /api/materias/:id
router.get('/materias/:id', cursadoController.getMateriaById); 

module.exports = router;