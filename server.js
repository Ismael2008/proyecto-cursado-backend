// backend/server.js

const express = require('express');
const cors = require('cors');
// 1. Cargamos las variables de entorno para que process.env funcione
require('dotenv').config(); 

// Importamos la conexión a la base de datos (para que se inicialice)
require('./database'); 

// 2. Importar las NUEVAS rutas de Autenticación y Administración
const authRoutes = require('./routes/authRoutes'); 
const adminRoutes = require('./routes/adminRoutes');
const apiRoutes = require('./routes/apiRoutes');
const chatbotRoutes = require('./routes/chatbotRoutes');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json()); 
app.use(cors()); 

// Rutas de la API
// Rutas de Autenticación (Login, Registro)
app.use('/api/auth', authRoutes);

// Rutas de Administración (CRUD de Materias/Carreras, serán protegidas)
app.use('/api/admin', adminRoutes);

// RUTA DEL CHATBOT: Se mapea POST /chatbot a /api/chatbot
app.use('/api', chatbotRoutes);

// Todas las rutas definidas en materiasRoutes serán prefijadas con /api
app.use('/api', apiRoutes);

// Iniciar el servidor
app.listen(port, () => {
    console.log(`Servidor escuchando en el puerto ${port}`);
});