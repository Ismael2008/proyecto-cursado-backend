// backend/database.js

const mysql = require('mysql2/promise');
require('dotenv').config();

// Configuración de la conexión a la base de datos
const pool = mysql.createPool({
    host: process.env.DB_HOST, 
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306
});

// Comprobar la conexión
pool.getConnection()
    .then(connection => {
        console.log('¡Pool de conexión a la base de datos IES6_CURSADO creado con éxito!');
        connection.release();
    })
    .catch(err => {
        console.error('Error al conectar con el pool de la base de datos:', err);
        process.exit(1);
    });

module.exports = pool;