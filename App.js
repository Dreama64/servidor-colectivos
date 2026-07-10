import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  Alert, 
  Vibration, 
  TextInput, 
  SafeAreaView, 
  Linking, 
  ActivityIndicator 
} from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy'; // Módulo correcto para Expo SDK 54
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function App() {
  // 🗺️ Estados de Navegación y Usuario
  const [pantallaActual, setPantallaActual] = useState('cargando');
  const [nombreIngresado, setNombreIngresado] = useState('');
  const [nombreUsuarioCompleto, setNombreUsuarioCompleto] = useState('');

  // 📻 Estados originales de tu Walkie-Talkie
  const [statusText, setStatusText] = useState('📻 CENTRAL EN LÍNEA');
  const [statusColor, setStatusColor] = useState('#2ed573');
  const [subText, setSubText] = useState('PULSA PARA HABLAR');
  const [isButtonActive, setIsButtonActive] = useState(false);

  const ws = useRef(null);
  const recordingRef = useRef(null);
  const soundRef = useRef(null); 

  // 🔄 Ciclo de vida inicial
  useEffect(() => {
    comprobarUsuario();
    configurarAudioInicial();

    return () => {
      if (ws.current) ws.current.close();
      descargarSonido();
    };
  }, []);

  // 💾 Comprobar si el chofer ya está registrado
  const comprobarUsuario = async () => {
    try {
      const usuarioGuardado = await AsyncStorage.getItem('nombre_chofer');
      if (usuarioGuardado) {
        setNombreUsuarioCompleto(usuarioGuardado);
        conectarWebSocket(usuarioGuardado);
        setPantallaActual('walkie');
      } else {
        setPantallaActual('registro');
      }
    } catch (error) {
      console.log('Error al leer la memoria:', error);
      setPantallaActual('registro');
    }
  };

  // 🟢 Guardar nombre del chofer con número aleatorio único
  const manejarRegistro = async () => {
    if (nombreIngresado.trim() === '') return;

    const numeroAleatorio = Math.floor(100 + Math.random() * 900);
    const nombreCompleto = `${nombreIngresado.trim()} #${numeroAleatorio}`;

    try {
      await AsyncStorage.setItem('nombre_chofer', nombreCompleto);
      setNombreUsuarioCompleto(nombreCompleto);
      conectarWebSocket(nombreCompleto);
      setPantallaActual('walkie');
    } catch (error) {
      console.log('Error al guardar en la memoria:', error);
    }
  };

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

  // 🌐 Tu conexión WebSocket conectada al nombre real
  const conectarWebSocket = (nombreIdentificador) => {
    ws.current = new WebSocket('wss://servidor-colectivos.onrender.com');

    ws.current.onopen = () => {
      actualizarUI('📻 CENTRAL EN LÍNEA', '#2ed573', 'PULSA PARA HABLAR');
    };

    ws.current.onclose = () => {
      actualizarUI('❌ DESCONECTADO', '#ff4757', 'SIN SEÑAL');
      setTimeout(() => conectarWebSocket(nombreIdentificador), 3000);
    };

    ws.current.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'nuevo_audio' && data.url) {
          if (data.emisor === nombreIdentificador) return;
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

      const infoArchivo = await FileSystem.getInfoAsync(resultadoDescarga.uri);
      if (!infoArchivo.exists) {
        Alert.alert("Error de Archivo", "El archivo descargado no existe.");
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

      const { sound } = await Audio.Sound.createAsync(
        { uri: resultadoDescarga.uri },
        { shouldPlay: false, volume: 1.0, playThroughEarpieceAndroid: false, shouldDuckAndroid: false },
        (playbackStatus) => {
          if (playbackStatus.didJustFinish) {
            actualizarUI('📻 CENTRAL EN LÍNEA', '#2ed573', 'PULSA PARA HABLAR');
            descargarSonido();
          }
        }
      );

      soundRef.current = sound;
      await soundRef.current.setVolumeAsync(1.0);
      await soundRef.current.setPositionAsync(0);
      await soundRef.current.playAsync();

    } catch (error) {
      Alert.alert("Fallo Crítico Android", `Mensaje: ${error.message}`);
      actualizarUI('⚠️ ERROR DE AUDIO', '#ff4757', 'PULSA PARA INTENTAR');
      descargarSonido();
    }
  };

  const iniciarTransmision = async () => {
    try {
      Vibration.vibrate(80);

      // 🛠️ SOLUCIÓN APK: Primero limpiamos cualquier sonido para liberar los canales de audio
      await descargarSonido();

      // Luego configuramos de forma segura el modo de grabación
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        playThroughEarpieceAndroid: false,
        shouldDuckAndroid: false,
        staysActiveInBackground: false
      });

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
      console.error(error);
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
      formData.append('emisor', nombreUsuarioCompleto);
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
      actualizarUI('❌ ERROR AL ENVIAR', '#ff4757', 'FALLO DE RED');
    }
  };

  // 🔗 Funciones para abrir plataformas de donación externas
  const abrirPayPal = () => {
    Linking.openURL('https://www.paypal.me/Dreamnx');
  };

  const abrirMercadoPago = () => {
    Linking.openURL('https://mpago.la/2JFh7tY');
  };

  // 📝 RENDER PANTALLA 1: REGISTRO (Claro)
  if (pantallaActual === 'registro') {
    return (
      <SafeAreaView style={styles.contenedorClaro}>
        <View style={styles.tarjetaCentrada}>
          <Text style={styles.tituloBienvenida}>¡Bienvenido! 👋</Text>
          <Text style={styles.subtituloBienvenida}>Identifícate para empezar a transmitir</Text>
          
          <TextInput
            style={styles.entradaTexto}
            placeholder="Escribe tu nombre aquí..."
            placeholderTextColor="#a0a0a0"
            value={nombreIngresado}
            onChangeText={setNombreIngresado}
            maxLength={15}
          />

          <TouchableOpacity style={styles.botonVerde} onPress={manejarRegistro}>
            <Text style={styles.textoBotonVerde}>Ingresar al Walkie-Talkie</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ⚙️ RENDER PANTALLA 2: CONFIGURACIÓN (Claro)
  if (pantallaActual === 'configuracion') {
    return (
      <SafeAreaView style={styles.contenedorClaro}>
        <View style={styles.tarjetaCentrada}>
          <Text style={styles.tituloConfig}>Configuración ⚙️</Text>
          
          <View style={styles.seccionInfo}>
            <Text style={styles.textoInfoLabel}>Versión de la App</Text>
            <Text style={styles.textoInfoValor}>v1.1</Text>
          </View>

          <View style={styles.seccionInfo}>
            <Text style={styles.textoInfoLabel}>Desarrollador</Text>
            <Text style={styles.textoInfoValorCed}>Dreama64</Text>
          </View>

          {/* Botón PayPal */}
          <TouchableOpacity style={styles.botonPayPal} onPress={abrirPayPal}>
            <Text style={styles.textoBotonPayPal}>💳 Si deseas donarme por PayPal</Text>
          </TouchableOpacity>

          {/* Botón Mercado Pago */}
          <TouchableOpacity style={styles.botonMercadoPago} onPress={abrirMercadoPago}>
            <Text style={styles.textoBotonPayPal}>🇨🇱 Aporte con Mercado Pago (Chile) 🇨🇱</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.botonVolver} 
            onPress={() => setPantallaActual('walkie')}
          >
            <Text style={styles.textoBotonVolver}>Volver al Radio</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // 📻 RENDER PANTALLA 3: TU WALKIE-TALKIE ORIGINAL (Oscuro)
  if (pantallaActual === 'walkie') {
    return (
      <View style={styles.container}>
        <View style={styles.headerDisplay}>
          <View style={styles.headerFilaSuperior}>
            <Text style={styles.brandText}>Walkie-Talkie v1.1</Text>
            <TouchableOpacity onPress={() => setPantallaActual('configuracion')} style={styles.areaEngranaje}>
              <Text style={styles.textoEngranaje}>⚙️</Text>
            </TouchableOpacity>
          </View>
          
          <Text style={styles.choferTag}>Chofer: {nombreUsuarioCompleto}</Text>

          <View style={styles.signalContainer}>
            <View style={[styles.signalDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.estado, { color: statusColor }]}>{statusText}</Text>
          </View>
        </View>

        <View style={styles.centerSpace}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPressIn={iniciarTransmision}
            onPressOut={finalizarTransmision}
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
          <Text style={styles.footerText}>Mantén presionado para hablar • Central Colectivos</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.contenedorClaro, styles.centradoTotal]}>
      <ActivityIndicator size="large" color="#2ed573" />
    </View>
  );
}

const styles = StyleSheet.create({
  // --- TUS ESTILOS ORIGINALES PRESERVADOS ---
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
  headerFilaSuperior: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  areaEngranaje: {
    padding: 4,
  },
  textoEngranaje: {
    fontSize: 20,
  },
  choferTag: {
    color: '#2ed573',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  brandText: {
    color: '#57606f',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  signalContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 5,
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

  // --- NUEVOS ESTILOS PARA GESTIÓN (PANTALLAS CLARAS) ---
  contenedorClaro: {
    flex: 1,
    backgroundColor: '#f5f6fa',
    justifyContent: 'center',
    alignItems: 'center',
  },
  centradoTotal: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  tarjetaCentrada: {
    width: '85%',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 25,
    alignItems: 'center',
    elevation: 5,
  },
  tituloBienvenida: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2f3542',
    marginBottom: 8,
  },
  subtituloBienvenida: {
    fontSize: 14,
    color: '#747d8c',
    textAlign: 'center',
    marginBottom: 25,
  },
  entradaTexto: {
    width: '100%',
    height: 50,
    backgroundColor: '#f1f2f6',
    borderRadius: 25,
    paddingHorizontal: 20,
    fontSize: 16,
    color: '#2f3542',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e4e7eb',
  },
  botonVerde: {
    width: '100%',
    height: 50,
    backgroundColor: '#2ed573',
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textoBotonVerde: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  tituloConfig: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2f3542',
    marginBottom: 25,
  },
  seccionInfo: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f2f6',
  },
  textoInfoLabel: {
    fontSize: 14,
    color: '#747d8c',
  },
  textoInfoValor: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2f3542',
  },
  textoInfoValorCed: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2ed573',
  },
  botonPayPal: {
    width: '100%',
    height: 50,
    backgroundColor: '#003087',
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 10,
  },
  botonMercadoPago: {
    width: '100%',
    height: 50,
    backgroundColor: '#009ee3', // Color oficial de Mercado Pago
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  textoBotonPayPal: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  botonVolver: {
    width: '100%',
    height: 50,
    backgroundColor: '#747d8c',
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textoBotonVolver: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 'bold',
  },
});