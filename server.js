const { WebSocketServer } = require('ws');

// En internet, el servidor nos asigna un puerto automáticamente a través de process.env.PORT.
// Si no existe, usa el 8080 (para cuando pruebes en tu casa).
const PORT = process.env.PORT || 8080;

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  console.log('📱 Chofer conectado al canal ✅');

  ws.on('message', (audioData) => {
    console.log('🎙️ Audio recibido, transmitiendo a la línea...');

    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === 1) {
        client.send(audioData);
      }
    });
  });

  ws.on('close', () => {
    console.log('❌ Chofer fuera de línea');
  });
});

console.log(`🚀 Servidor de Colectivos escuchando en el puerto ${PORT}`);