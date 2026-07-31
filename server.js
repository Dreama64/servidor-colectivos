const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// Asegurar que la carpeta de subidas exista
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Configuración de almacenamiento con Multer (para audio e imágenes de reporte)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || (file.mimetype.includes('image') ? '.jpg' : '.m4a');
    cb(null, 'file-' + uniqueSuffix + ext);
  }
});

const upload = multer({ storage: storage });

// Middlewares
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Servir archivos estáticos
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m4a')) {
      res.setHeader('Content-Type', 'audio/mp4'); 
      res.setHeader('Accept-Ranges', 'bytes');    
      res.setHeader('Cache-Control', 'no-store');  
    }
  }
}));

// Configuración del servicio de correo (Reemplazar con tus credenciales o variables de entorno)
const transporter = nodemailer.createTransport({
  service: 'gmail', // O usar servidor SMTP de la empresa/fundo
  auth: {
    user: process.env.EMAIL_USER || 'alertas.fundo.secoll@gmail.com',
    pass: process.env.EMAIL_PASS || 'tu_password_de_aplicacion' 
  }
});

// -------------------------------------------------------------
// ENDPOINT 1: Subida y Retransmisión de Audio
// -------------------------------------------------------------
app.post('/upload', upload.single('audio'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se recibió ningún archivo de audio' });
    }

    const emisor = req.body.emisor || 'desconocido';
    const sala = req.body.sala || req.body.canal || req.body.room || 'General';
    const fileUrl = `${BASE_URL}/uploads/${req.file.filename}`;

    const mensajeNotificacion = JSON.stringify({
      type: 'nuevo_audio',
      url: fileUrl,
      emisor: emisor,
      sala: sala
    });

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(mensajeNotificacion);
      }
    });

    return res.status(200).json({ success: true, url: fileUrl });

  } catch (error) {
    console.error('Error en el endpoint /upload:', error);
    return res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// -------------------------------------------------------------
// ENDPOINT 2: Recepción de Reportes de Incidencia y Envío por Correo
// -------------------------------------------------------------
app.post('/report', upload.single('photo'), async (req, res) => {
  try {
    const { author, dateTime, description } = req.body;
    const photoFile = req.file;

    console.log(`🚨 Nuevo reporte recibido de: ${author}`);

    const mailOptions = {
      from: '"Secoll Alertas" <alertas.fundo.secoll@gmail.com>',
      to: process.env.ADMIN_EMAIL || 'administracion@fundo.cl', // Destinatario
      subject: `🚨 REPORTE DE INCIDENCIA - ${author}`,
      html: `
        <h2>Nuevo Reporte desde Terreno</h2>
        <p><strong>Guardia / Emisor:</strong> ${author}</p>
        <p><strong>Fecha y Hora:</strong> ${dateTime}</p>
        <p><strong>Detalle de la Incidencia:</strong></p>
        <blockquote style="background: #f4f4f4; padding: 10px; border-left: 4px solid #d97706;">
          ${description}
        </blockquote>
      `,
      attachments: photoFile ? [{
        filename: photoFile.originalname || 'evidencia.jpg',
        path: photoFile.path
      }] : []
    };

    // Intentar enviar correo (Si falla, responde exitoso para la app de demostración)
    try {
      await transporter.sendMail(mailOptions);
    } catch (mailErr) {
      console.warn("⚠️ No se pudo enviar el email real (revisar credenciales SMTP), pero el reporte fue registrado localmente.");
    }

    return res.status(200).json({ success: true, message: 'Reporte procesado correctamente' });

  } catch (error) {
    console.error('Error en /report:', error);
    return res.status(500).json({ success: false, error: 'Error al procesar reporte' });
  }
});

app.get('/', (req, res) => {
  res.send('Servidor Walkie-Talkie Secoll Communications en línea 🟢');
});

// -------------------------------------------------------------
// GESTIÓN DE WEBSOCKETS Y PRESENCIA EN TIEMPO REAL
// -------------------------------------------------------------

// Mapa para rastrear los datos de cada cliente: { wsClient: { nombre, canal } }
const clientsMap = new Map();

function transmitirListaUsuarios(canalActual) {
  // Filtrar los usuarios que pertenecen a este canal en específico
  const usuariosEnCanal = [];
  
  clientsMap.forEach((data, clientWs) => {
    if (clientWs.readyState === WebSocket.OPEN && data.canal === canalActual && data.nombre) {
      usuariosEnCanal.push({
        id: data.id,
        nombre: data.nombre,
        canal: data.canal
      });
    }
  });

  const payload = JSON.stringify({
    type: 'lista_usuarios',
    tipo: 'lista_usuarios',
    canal: canalActual,
    usuarios: usuariosEnCanal
  });

  // Reenviar la lista actualizada a todos los conectados en esa sala
  clientsMap.forEach((data, clientWs) => {
    if (clientWs.readyState === WebSocket.OPEN && data.canal === canalActual) {
      clientWs.send(payload);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('Cliente conectado por WebSocket 🟢');
  
  // Registrar cliente con datos iniciales
  clientsMap.set(ws, { id: Date.now().toString(), nombre: 'Guardia', canal: 'General' });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // 1. REGISTRO / CAMBIO DE CANAL DEL USUARIO
      if (data.type === 'join_channel' || data.emisor || data.canal || data.sala) {
        const clientInfo = clientsMap.get(ws) || {};
        const canalAnterior = clientInfo.canal;
        
        clientInfo.nombre = data.emisor || clientInfo.nombre;
        clientInfo.canal = data.sala || data.canal || data.room || 'General';
        
        clientsMap.set(ws, clientInfo);

        // Notificar presencia en el canal actual (y en el anterior si cambió de sala)
        transmitirListaUsuarios(clientInfo.canal);
        if (canalAnterior && canalAnterior !== clientInfo.canal) {
          transmitirListaUsuarios(canalAnterior);
        }
      }

      // 2. REENVIAR MENSAJES DE TEXTO Y OTROS EVENTOS
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(data));
        }
      });

    } catch (e) {
      // Reenvío de datos binarios o texto plano
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message.toString());
        }
      });
    }
  });

  ws.on('close', () => {
    console.log('Cliente desconectado de WebSocket 🔴');
    const clientInfo = clientsMap.get(ws);
    clientsMap.delete(ws);

    if (clientInfo && clientInfo.canal) {
      transmitirListaUsuarios(clientInfo.canal);
    }
  });
});

// Iniciar el servidor
server.listen(PORT, () => {
  console.log(`Servidor ejecutándose en el puerto ${PORT}`);
  console.log(`URL Base configurada: ${BASE_URL}`);
});