const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');

const app = express();
app.use(cors());

// 1. Crear carpeta física para guardar los audios si no existe
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// 2. Hacer que la carpeta sea pública para que los teléfonos puedan acceder a los enlaces
app.use('/uploads', express.static(uploadsDir));

// 3. Configurar el motor de subida (Multer)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    // Generar un nombre único para evitar la caché de Android
    cb(null, `audio_${Date.now()}.m4a`);
  }
});
const upload = multer({ storage: storage });

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// 4. API Endpoint: Aquí los teléfonos envían el audio cuando sueltan el botón PTT
app.post('/upload', upload.single('audio'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No se recibió audio.');
  }
  
  // Construimos la URL completa (ej: https://servidor-colectivos.onrender.com/uploads/audio_123.m4a)
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  console.log(`🎙️ Archivo guardado y disponible en: ${fileUrl}`);

  // 5. Avisamos a todos los choferes conectados enviando solo el texto con la URL
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ type: 'nuevo_audio', url: fileUrl }));
    }
  });

  res.status(200).json({ success: true });
});

// Manejo de conexiones del WebSocket para saber quién está en línea
wss.on('connection', (ws) => {
  console.log('📱 Chofer conectado al canal ✅');
  ws.on('close', () => console.log('❌ Chofer fuera de línea'));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🚀 Servidor HTTP y Radio escuchando en el puerto ${PORT}`);
});