// backend/controllers/authController.js

const pool = require('../database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer'); 
const { parse } = require('dotenv');

// Asegúrate de que todas estas variables estén en tu archivo .env
const JWT_SECRET = process.env.JWT_SECRET;           
const RESET_SECRET = process.env.RESET_SECRET;       
const CLIENT_URL = process.env.CLIENT_URL;           

// ⚙️ VARIABLES PARA SMTP EXTERNO (SendGrid)
const EMAIL_SERVICE_HOST = process.env.EMAIL_SERVICE_HOST;
const EMAIL_SERVICE_PORT = process.env.EMAIL_SERVICE_PORT;
const EMAIL_SERVICE_USER = process.env.EMAIL_SERVICE_USER; 
const EMAIL_SERVICE_PASS = process.env.EMAIL_SERVICE_PASS; 
const EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS; // Remitente

// ⚙️ CONFIGURACIÓN DE NODEMAILER (Usando SMTP Externo)
const transporter = nodemailer.createTransport({
    host: EMAIL_SERVICE_HOST, 
    port: EMAIL_SERVICE_PORT, 
    secure: false, 
    auth: {
        user: EMAIL_SERVICE_USER,
        pass: EMAIL_SERVICE_PASS,
    },
    
});

// Función auxiliar para generar el Token JWT (para login)
const generateToken = (id_administrador, rol) => {
    return jwt.sign({ id_administrador, rol }, JWT_SECRET, {
        expiresIn: '1d', // Expira en 1 día
    });
};

// ========================================================
// FUNCIONES DE AUTENTICACIÓN
// ========================================================

// @desc    Registrar un nuevo usuario (ADMIN o USUARIO)
// @route   POST /api/auth/register
// @access  Public
exports.registerUser = async (req, res) => {
    // ✅ CAMBIO 1: Incluir los nuevos campos (dni, telefono)
    const { nombre_administrador, contraseña, rol, email, dni, telefono } = req.body; 

    if (!nombre_administrador || !contraseña) {
        return res.status(400).json({ message: 'Por favor, ingrese un nombre de administrador y contraseña.' });
    }

    try {
        // 1. Encriptar la contraseña
        const salt = await bcrypt.genSalt(10);
        const contraseña_hash = await bcrypt.hash(contraseña, salt);

        // ✅ CAMBIO 2: Asignar 'Rector' como rol por defecto/inicial
        const rol_final = rol || 'Rector';

        // 2. Insertar en la tabla 'administrador'
        const [result] = await pool.query(
            // ✅ CAMBIO 3: Incluir 'dni' y 'telefono' en la consulta SQL
            `INSERT INTO administrador (nombre_administrador, contraseña, rol, email, dni, telefono) VALUES (?, ?, ?, ?, ?, ?)`,
            // ✅ CAMBIO 4: Usar rol_final y los nuevos campos
            [nombre_administrador, contraseña_hash, rol_final, email || null, dni || null, telefono || null]
        );

        const id_administrador = result.insertId;

        res.status(201).json({
            id_administrador,
            nombre_administrador,
            // ✅ CAMBIO 5: Devolver el rol_final (Rector/Coordinador)
            rol: rol_final, 
            // ✅ CAMBIO 6: Generar token con el rol_final
            token: generateToken(id_administrador, rol_final),
        });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'El nombre de administrador o el email ya existe.' });
        }
        console.error("Error al registrar administrador:", error);
        res.status(500).json({ message: 'Error interno del servidor al registrar.' });
    }
};

// @desc    Autenticar un usuario (Login)
// @route   POST /api/auth/login
// @access  Public
exports.loginUser = async (req, res) => {
    const { identificador, contraseña } = req.body; 

    if (!identificador || !contraseña) {
        return res.status(400).json({ message: 'Por favor, ingrese usuario/email y contraseña.' });
    }

    try {
        const [usuarios] = await pool.query(
            // La consulta SELECT * ya trae dni y telefono
            `SELECT * FROM administrador WHERE nombre_administrador = ? OR email = ?`, 
            [identificador, identificador] 
        );

        const usuario = usuarios[0];

        if (usuario && (await bcrypt.compare(contraseña, usuario.contraseña))) {
            
            // 🛑 NUEVA VERIFICACIÓN DE SEGURIDAD: Bloquear el acceso si el estado NO es 'activo'
            if (usuario.estado !== 'activo') {
                // Mensaje genérico para no revelar si existe el usuario o por qué está bloqueado
                return res.status(401).json({ 
                    message: 'Credenciales inválidas o cuenta no activa. Contacte al administrador.' 
                });
            }

            res.json({
                id_administrador: usuario.id_administrador, 
                nombre_administrador: usuario.nombre_administrador, 
                email: usuario.email,
                // ✅ CAMBIO 7: Devolver los nuevos campos en la respuesta de login
                dni: usuario.dni,
                telefono: usuario.telefono,
                // El rol será 'Rector' o 'Coordinador'
                rol: usuario.rol, 
                token: generateToken(usuario.id_administrador, usuario.rol),
            });
        } else {
            res.status(401).json({ message: 'Credenciales inválidas.' });
        }

    } catch (error) {
        console.error("Error al iniciar sesión:", error);
        res.status(500).json({ message: 'Error interno del servidor al iniciar sesión.' });
    }
};

// ========================================================
// FUNCIÓN: FORGOT PASSWORD (Solicitud de Restablecimiento)
// ========================================================
// @desc    Solicita restablecimiento de contraseña
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
    const { email } = req.body;
    
    try {
        // Buscar el usuario por email
        const [rows] = await pool.query('SELECT id_administrador, nombre_administrador, email FROM administrador WHERE email = ?', [email]);
        const user = rows[0];

        if (!user || !user.email) {
            return res.status(200).json({ message: 'Si el email es válido, recibirás un enlace de restablecimiento.' });
        }

        // Generar un token JWT (1 hora de duración)
        const resetToken = jwt.sign({ id: user.id_administrador }, RESET_SECRET, { expiresIn: '1h' });
        
        // Crear el enlace de restablecimiento
        const resetLink = `${CLIENT_URL}?token=${resetToken}`;

        // Configurar y enviar el email
        const mailOptions = {
            from: EMAIL_FROM_ADDRESS, 
            to: user.email,
            subject: 'Restablecimiento de Contraseña de Administrador IES6',
            html: `
                <p>Hola ${user.nombre_administrador},</p>
                <p>Haz clic en el siguiente enlace para crear tu nueva contraseña. Este enlace expira en 1 hora:</p>
                <p><a href="${resetLink}" style="background-color: #2563EB; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                    Restablecer Contraseña
                </a></p>
                <p style="margin-top: 20px;">Si no solicitaste esto, ignora este correo.</p>
            `,
        };

        await transporter.sendMail(mailOptions);
        console.log('Email de restablecimiento enviado a:', user.email);
        res.status(200).json({ message: 'Si el email es válido, recibirás un enlace de restablecimiento.' });
    } catch (error) {
        console.error('Error al enviar el email (SMTP/Conexión):', error);
        res.status(500).json({ message: 'Hubo un error al intentar enviar el correo. Por favor, contacta a soporte.' });
    }
};

// ========================================================
// FUNCIÓN: RESET PASSWORD (Actualizar la Contraseña)
// ========================================================
// @desc    Actualiza la contraseña si el token es válido
// @route   POST /api/auth/reset-password
// @access  Public (mediante token)
exports.resetPassword = async (req, res) => {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
        return res.status(400).json({ message: 'Faltan datos requeridos (token o nueva contraseña).' });
    }

    try {
        // 1. Verificar el token usando el RESET_SECRET
        const decoded = jwt.verify(token, RESET_SECRET);
        const adminId = decoded.id; 

        // 2. Hashear la nueva contraseña
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // 3. Actualizar la contraseña en la BD
        const [result] = await pool.query('UPDATE administrador SET contraseña = ? WHERE id_administrador = ?', [hashedPassword, adminId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'El enlace de restablecimiento es inválido.' });
        }

        return res.status(200).json({ message: 'Contraseña restablecida con éxito. Ya puedes iniciar sesión.' });

    } catch (error) {
        console.error('Error en restablecimiento:', error.message);
        return res.status(401).json({ message: 'El enlace de restablecimiento es inválido o ha expirado. Solicita uno nuevo.' });
    }
};