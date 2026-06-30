const { WebSocketServer } = require('ws');

// En internet, el servidor nos asigna un puerto automáticamente a través de process.env.PORT.
// Si no existe, usa el 8080 (para cuando pruebes en tu casa).
const PORT = process.env.PORT || 8080;

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  console.log('📱 Chofer conectado al canal ✅');

  // Recibir audio y retransmitir forzando el formato binario puro
  ws.on('message', (audioData, isBinary) => {
    console.log('🎙️ Audio recibido, transmitiendo a la línea...');

    wss.clients.forEach((client) => {
      // Verificamos que no sea el mismo que mandó el audio y que la conexión esté abierta (1 = OPEN)
      if (client !== ws && client.readyState === 1) {
        client.send(audioData, { binary: isBinary });
      }
    });
  });

  ws.on('close', () => {
    console.log('❌ Chofer fuera de línea');
  });
});

console.log(`🚀 Servidor de Colectivos escuchando en el puerto ${PORT}`);