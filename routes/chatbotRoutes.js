// Archivo: backend/routes/chatbotRoutes.js

const express = require('express');
const router = express.Router();
const chatbotController = require('../controllers/chatbotController');

// Rutas GET requeridas por el frontend (Scripts/chatbot.js)

// 1. Menú Principal: Obtiene todas las carreras.
// GET /api/chatbot/carreras
router.get('/chatbot/carreras', chatbotController.getCarreras);

// 2. Menú de Materias/Años: Obtiene todas las materias de una carrera.
// GET /api/chatbot/materias/:carreraId
router.get('/chatbot/materias/:carreraId', chatbotController.getMateriasPorCarrera);

// 3. Información Detallada (Detalles de Carrera, Coordinador, Horario, Correlativas).
// GET /api/chatbot/info?action=...&id=...
router.get('/chatbot/info', chatbotController.getInfo);

module.exports = router;