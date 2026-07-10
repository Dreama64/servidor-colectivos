import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert, Vibration } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy'; // Módulo correcto para Expo SDK 54

export default function App() {
  const [statusText, setStatusText] = useState('📻 CENTRAL EN LÍNEA');
  const [statusColor, setStatusColor] = useState('#2ed573');
  const [subText, setSubText] = useState('PULSA PARA HABLAR');
  const [isButtonActive, setIsButtonActive] = useState(false);

  const ws = useRef(null);
  const recordingRef = useRef(null);
  const soundRef = useRef(null); 
  const miId = useRef("android_" + Math.random().toString(36).substring(7)).current;

  useEffect(() => {
    conectarWebSocket();
    configurarAudioInicial();

    return () => {
      if (ws.current) ws.current.close();
      descargarSonido();
    };
  }, []);

  const configurarAudioInicial = async () => {
    try {
      await Audio.requestPermissionsAsync();
    } catch (error) {
      console.error("Error al solicitar permisos de audio:", error);
    }
  };

  const descargarSonido = async () => {
    if (soundRef.current) {
      try {
        await soundRef.current.unloadAsync();
      } catch (e) {
        console.log("Error al descargar sonido previo:", e);
      }
      soundRef.current = null;
    }
  };

  const conectarWebSocket = () => {
    ws.current = new WebSocket('wss://servidor-colectivos.onrender.com');

    ws.current.onopen = () => {
      actualizarUI('📻 CENTRAL EN LÍNEA', '#2ed573', 'PULSA PARA HABLAR');
    };

    ws.current.onclose = () => {
      actualizarUI('❌ DESCONECTADO', '#ff4757', 'SIN SEÑAL');
      setTimeout(conectarWebSocket, 3000);
    };

    ws.current.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'nuevo_audio' && data.url) {
          if (data.emisor === miId) return;
          await descargarYReproducirAudio(data.url);
        }
      } catch (error) {
        console.log("Dato recibido no válido:", event.data);
      }
    };
  };

  const actualizarUI = (texto, color, secundario) => {
    setStatusText(texto);
    setStatusColor(color);
    setSubText(secundario);
  };

  const descargarYReproducirAudio = async (urlRemota) => {
    try {
      actualizarUI('📥 DESCARGANDO AUDIO...', '#a4b0be', 'TRANSMISIÓN ENTRANTE');
      
      const nombreArchivo = `audio_${Date.now()}.m4a`;
      const rutaLocal = `${FileSystem.cacheDirectory}${nombreArchivo}`;
      
      const resultadoDescarga = await FileSystem.downloadAsync(urlRemota, rutaLocal);
      console.log("Archivo descargado en:", resultadoDescarga.uri);

      const infoArchivo = await FileSystem.getInfoAsync(resultadoDescarga.uri);
      if (!infoArchivo.exists) {
        Alert.alert("Error de Archivo", "El archivo descargado no existe en la ruta de la caché.");
        return;
      }

      actualizarUI('🔊 ESCUCHANDO RUTA...', '#eccc68', 'TRANSMISIÓN ENTRANTE');

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        playThroughEarpieceAndroid: false,
        shouldDuckAndroid: false,
        staysActiveInBackground: false
      });

      await descargarSonido();

      const { sound, status } = await Audio.Sound.createAsync(
        { uri: resultadoDescarga.uri },
        { 
          shouldPlay: false, 
          volume: 1.0,
          playThroughEarpieceAndroid: false,
          shouldDuckAndroid: false
        },
        (playbackStatus) => {
          if (playbackStatus.didJustFinish) {
            actualizarUI('📻 CENTRAL EN LÍNEA', '#2ed573', 'PULSA PARA HABLAR');
            descargarSonido();
          }
          if (playbackStatus.error) {
            Alert.alert("Error en PlaybackStatus", String(playbackStatus.error));
          }
        }
      );

      soundRef.current = sound;

      console.log("Estado inicial del sonido creado:", status);

      await soundRef.current.setVolumeAsync(1.0);
      await soundRef.current.setPositionAsync(0);
      await soundRef.current.playAsync();

      const estadoPostPlay = await soundRef.current.getStatusAsync();
      console.log("Estado del sonido después de playAsync():", estadoPostPlay);

    } catch (error) {
      Alert.alert(
        "Fallo Crítico Android",
        `Mensaje: ${error.message}\nCódigo: ${error.code || 'Desconocido'}`
      );
      actualizarUI('⚠️ ERROR DE AUDIO', '#ff4757', 'PULSA PARA INTENTAR');
      descargarSonido();
    }
  };

  const iniciarTransmision = async () => {
    try {
      Vibration.vibrate(80);
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        playThroughEarpieceAndroid: false,
        shouldDuckAndroid: false,
        staysActiveInBackground: false
      });

      await descargarSonido();

      const opcionesGrabacion = {
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 64000,
        },
        ios: {
          extension: '.m4a',
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality: Audio.IOSAudioQuality.MEDIUM,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 64000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 128000,
        },
      };

      const { recording } = await Audio.Recording.createAsync(opcionesGrabacion);
      recordingRef.current = recording;
      setIsButtonActive(true);
      actualizarUI('🎙️ TRANSMITIENDO...', '#ff4757', 'SUELTA PARA ENVIAR');
    } catch (error) {
      console.error("Error al iniciar grabación:", error);
      Alert.alert("Error", "No se pudo activar el micrófono.");
    }
  };

  const finalizarTransmision = async () => {
    if (!recordingRef.current) return;

    try {
      setIsButtonActive(false);
      actualizarUI('📥 ENVIANDO AUDIO...', '#a4b0be', 'PROCESANDO TRANSMISIÓN');

      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (!uri) throw new Error("No se generó URI de grabación");

      const formData = new FormData();
      formData.append('emisor', miId);
      formData.append('audio', {
        uri: uri,
        name: 'audio.m4a',
        type: 'audio/m4a',
      });

      await fetch('https://servidor-colectivos.onrender.com/upload', {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      actualizarUI('📻 CENTRAL EN LÍNEA', '#2ed573', 'PULSA PARA HABLAR');
    } catch (error) {
      console.error("Error al finalizar o enviar grabación:", error);
      actualizarUI('❌ ERROR AL ENVIAR', '#ff4757', 'FALLO DE RED');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerDisplay}>
        <Text style={styles.brandText}>Walkie-Talkie v1.0</Text>
        <View style={styles.signalContainer}>
          <View style={[styles.signalDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.estado, { color: statusColor }]}>{statusText}</Text>
        </View>
      </View>

      <View style={styles.centerSpace}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPressIn={iniciarTransmision}
          onPressOut={finalizarTransmision} // ✨ Enlace corregido a la función existente
          style={[
            styles.btnHablar,
            isButtonActive ? styles.btnActive : styles.btnInactive,
            statusText.includes('ESCUCHANDO') && styles.btnListening
          ]}
        >
          <Text style={styles.btnText}>PTT</Text>
          <Text style={styles.subTexto}>{subText}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Mantén presionado para hablar • Modo Chofer</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#11141a',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  headerDisplay: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#1c2029',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2d3446',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 5,
  },
  brandText: {
    color: '#57606f',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  signalContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signalDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  estado: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 1,
  },
  centerSpace: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnHablar: {
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 25,
    elevation: 8,
  },
  btnInactive: {
    borderColor: '#2ed573',
    backgroundColor: '#1e2432',
  },
  btnActive: {
    borderColor: '#ff6b81',
    backgroundColor: '#ff4757',
    transform: [{ scale: 0.95 }],
  },
  btnListening: {
    borderColor: '#eccc68',
    backgroundColor: '#222f3e',
  },
  btnText: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 1,
  },
  subTexto: {
    fontSize: 10,
    color: '#a4b0be',
    fontWeight: 'bold',
    letterSpacing: 1,
    marginTop: 5,
    textAlign: 'center',
  },
  footer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerText: {
    color: '#57606f',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
});