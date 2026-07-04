const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
// URL base dinámica para Render o entorno local
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// Asegurar que la carpeta de subidas exista
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Configuración de almacenamiento con Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Mantener la extensión original o forzar .m4a
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'audio-' + uniqueSuffix + '.m4a');
  }
});

const upload = multer({ storage: storage });

// Middleware para habilitar CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// CONFIGURACIÓN CORREGIDA: Servir archivos estáticos con los headers requeridos por Android
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m4a')) {
      res.setHeader('Content-Type', 'audio/mp4'); // MIME compatible con el reproductor nativo
      res.setHeader('Accept-Ranges', 'bytes');    // Requerido por Android para streaming/descarga
      res.setHeader('Cache-Control', 'no-store');  // Evitar almacenamiento en caché del navegador/sistema
    }
  }
}));

// ENDPOINT CORREGIDO: Subida de audio que retorna la estructura JSON esperada
app.post('/upload', upload.single('audio'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se recibió ningún archivo de audio' });
    }

    const emisor = req.body.emisor || 'desconocido';
    const fileUrl = `${BASE_URL}/uploads/${req.file.filename}`;

    // Notificar a todos los clientes conectados por WebSocket
    const mensajeNotificacion = JSON.stringify({
      type: 'nuevo_audio',
      url: fileUrl,
      emisor: emisor
    });

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(mensajeNotificacion);
      }
    });

    // Respuesta JSON corregida
    return res.status(200).json({ 
      success: true, 
      url: fileUrl 
    });

  } catch (error) {
    console.error('Error en el endpoint /upload:', error);
    return res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Ruta base de prueba
app.get('/', (req, res) => {
  res.send('Servidor Walkie-Talkie Colectivo-Link en línea.');
});

// Gestión de conexiones WebSocket
wss.on('connection', (ws) => {
  console.log('Cliente conectado por WebSocket');
  
  ws.on('close', () => {
    console.log('Cliente desconectado de WebSocket');
  });
});

// Iniciar el servidor HTTP y WebSocket
server.listen(PORT, () => {
  console.log(`Servidor ejecutándose en el puerto ${PORT}`);
  console.log(`URL Base configurada: ${BASE_URL}`);
});