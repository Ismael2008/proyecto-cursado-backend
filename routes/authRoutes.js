// backend/routes/authRoutes.js

const express = require('express');
const { 
    registerUser, 
    loginUser,
    // 👈 1. Importamos las funciones necesarias para la recuperación
    forgotPassword, 
    resetPassword
} = require('../controllers/authController');

const router = express.Router();

// Rutas de autenticación
router.post('/register', registerUser); // Para registrar el primer administrador

// Ruta de login (se ha actualizado en el controlador para aceptar 'usuario' O 'email')
router.post('/login', loginUser);     

// ===========================================
// 2. RUTAS DE RECUPERACIÓN DE CONTRASEÑA
// ===========================================

// Ruta para solicitar el restablecimiento (recibe el email y envía el enlace)
router.post('/forgot-password', forgotPassword); 

// Ruta para aplicar la nueva contraseña (recibe el token y la nueva contraseña)
router.post('/reset-password', resetPassword);   

module.exports = router;