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
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CANALES_PREDEFINIDOS = ['General', 'Canal 1', 'Canal 2', 'Canal 3'];

export default function App() {
  const [pantallaActual, setPantallaActual] = useState('cargando'); 
  const [nombreIngresado, setNombreIngresado] = useState('');
  const [nombreUsuarioCompleto, setNombreUsuarioCompleto] = useState('');

  const [modoComunicacion, setModoComunicacion] = useState(''); 
  const [canalActivo, setCanalActivo] = useState('General');

  const [mensajes, setMensajes] = useState([]);
  const [textoMensaje, setTextoMensaje] = useState('');

  const [isEditing, setIsEditing] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [emisorActual, setEmisorActual] = useState('');

  const [statusText, setStatusText] = useState('📻 CENTRAL EN LÍNEA');
  const [statusColor, setStatusColor] = useState('#2ed573');
  const [subText, setSubText] = useState('PULSA PARA HABLAR');
  const [isButtonActive, setIsButtonActive] = useState(false);

  const ws = useRef(null);
  const recordingRef = useRef(null);
  const soundRef = useRef(null); 
  const flatListRef = useRef(null);

  useEffect(() => {
    comprobarUsuario();
    configurarAudioInicial();

    return () => {
      if (ws.current) ws.current.close();
      descargarSound();
    };
  }, []);

  useEffect(() => {
    if (pantallaActual === 'chat') {
      cargarHistorialChat();
    }
  }, [canalActivo, pantallaActual]);

  const comprobarUsuario = async () => {
    try {
      const usuarioGuardado = await AsyncStorage.getItem('nombre_chofer');
      if (usuarioGuardado) {
        setNombreUsuarioCompleto(usuarioGuardado);
        setNuevoNombre(usuarioGuardado.split(' #')[0]);
        conectarWebSocket(usuarioGuardado);
        setPantallaActual('hub'); 
      } else {
        setPantallaActual('registro');
      }
    } catch (error) {
      console.log('Error al leer la memoria:', error);
      setPantallaActual('registro');
    }
  };

  const cargarHistorialChat = async () => {
    try {
      const historialGuardado = await AsyncStorage.getItem(`@chat_${canalActivo}`);
      if (historialGuardado) {
        setMensajes(JSON.parse(historialGuardado));
      } else {
        setMensajes([]);
      }
    } catch (error) {
      console.log('Error al cargar historial:', error);
    }
  };

  const guardarMensajeLocalmente = async (nuevoMsg, canalDestino) => {
    try {
      const historialActual = await AsyncStorage.getItem(`@chat_${canalDestino}`);
      let listaActualizada = [];
      if (historialActual) {
        listaActualizada = JSON.parse(historialActual);
      }
      listaActualizada.push(nuevoMsg);
      await AsyncStorage.setItem(`@chat_${canalDestino}`, JSON.stringify(listaActualizada));
      
      if (canalDestino === canalActivo) {
        setMensajes(listaActualizada);
      }
    } catch (error) {
      console.log('Error al guardar mensaje:', error);
    }
  };

  const manejarRegistro = async () => {
    if (nombreIngresado.trim() === '') return;

    const numeroAleatorio = Math.floor(100 + Math.random() * 900);
    const nombreCompleto = `${nombreIngresado.trim()} #${numeroAleatorio}`;

    try {
      await AsyncStorage.setItem('nombre_chofer', nombreCompleto);
      setNombreUsuarioCompleto(nombreCompleto);
      setNuevoNombre(nombreIngresado.trim());
      conectarWebSocket(nombreCompleto);
      setPantallaActual('hub');
    } catch (error) {
      console.log('Error al guardar en la memoria:', error);
    }
  };

  const guardarNuevoNombre = async () => {
    if (nuevoNombre.trim() === '') return;

    let numeroAleatorio = Math.floor(100 + Math.random() * 900);
    if (nombreUsuarioCompleto.includes('#')) {
      numeroAleatorio = nombreUsuarioCompleto.split('#')[1].trim();
    }

    const nuevoNombreCompleto = `${nuevoNombre.trim()} #${numeroAleatorio}`;

    try {
      await AsyncStorage.setItem('nombre_chofer', nuevoNombreCompleto);
      setNombreUsuarioCompleto(nuevoNombreCompleto);
      setIsEditing(false);

      if (ws.current) {
        ws.current.close();
      }
      
      Alert.alert("Éxito", "Nombre actualizado correctamente");
    } catch (error) {
      console.log('Error al actualizar el nombre:', error);
    }
  };

  const configurarAudioInicial = async () => {
    try {
      await Audio.requestPermissionsAsync();
    } catch (error) {
      console.error("Error al solicitar permisos de audio:", error);
    }
  };

  const descargarSound = async () => {
    if (soundRef.current) {
      try {
        await soundRef.current.unloadAsync();
      } catch (e) {
        console.log("Error al descargar sonido previo:", e);
      }
      soundRef.current = null;
    }
  };

  const conectarWebSocket = (nombreIdentificador) => {
    ws.current = new WebSocket('wss://servidor-colectivos.onrender.com');

    ws.current.onopen = () => {
      actualizarUI('📻 CENTRAL EN LÍNEA', '#2ed573', 'PULSA PARA HABLAR');
    };

    ws.current.onclose = () => {
      actualizarUI('❌ DESCONECTADO', '#ff4757', 'SIN SEÑAL');
      setTimeout(() => comprobarYReconectar(), 3000);
    };

    ws.current.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'nuevo_audio' && data.url) {
          if (data.emisor === nombreUsuarioCompleto) return;
          setEmisorActual(data.emisor);
          await descargarYReproducirAudio(data.url);
        }

        if (data.type === 'nuevo_mensaje_texto' && data.texto) {
          const mensajeEntrante = {
            id: data.id || Date.now().toString(),
            emisor: data.emisor,
            texto: data.texto,
            timestamp: data.timestamp
          };
          await guardarMensajeLocalmente(mensajeEntrante, data.sala || 'General');
        }

      } catch (error) {
        console.log("Dato recibido no válido:", event.data);
      }
    };
  };

  const enviarMensajeTexto = () => {
    if (textoMensaje.trim() === '' || !ws.current) return;

    const ahora = new Date();
    const horaFormateada = `${ahora.getHours().toString().padStart(2, '0')}:${ahora.getMinutes().toString().padStart(2, '0')}`;
    
    const objetoMensaje = {
      type: 'nuevo_mensaje_texto',
      sala: canalActivo,
      emisor: nombreUsuarioCompleto,
      texto: textoMensaje.trim(),
      timestamp: horaFormateada,
      id: Date.now().toString()
    };

    ws.current.send(JSON.stringify(objetoMensaje));
    guardarMensajeLocalmente(objetoMensaje, canalActivo);
    setTextoMensaje('');
  };

  const comprobarYReconectar = async () => {
    const usuarioActual = await AsyncStorage.getItem('nombre_chofer') || nombreUsuarioCompleto;
    conectarWebSocket(usuarioActual);
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

      await descargarSound();

      const { sound } = await Audio.Sound.createAsync(
        { uri: resultadoDescarga.uri },
        { shouldPlay: false, volume: 1.0, playThroughEarpieceAndroid: false, shouldDuckAndroid: false },
        (playbackStatus) => {
          if (playbackStatus.didJustFinish) {
            actualizarUI('📻 CENTRAL EN LÍNEA', '#2ed573', 'PULSA PARA HABLAR');
            descargarSound();
            setEmisorActual('');
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
      descargarSound();
      setEmisorActual('');
    }
  };

  const iniciarTransmision = async () => {
    try {
      Vibration.vibrate(80);
      await descargarSound();

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
      formData.append('canal', canalActivo); 
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

  const abrirPayPal = () => {
    Linking.openURL('https://www.paypal.me/Dreamnx');
  };

  const abrirMercadoPago = () => {
    Linking.openURL('https://mpago.la/2JFh7tY');
  };

  // 📝 PANTALLA 1: REGISTRO
  if (pantallaActual === 'registro') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.tarjetaCentrada}>
          <Text style={styles.tituloBienvenida}>¡Bienvenido! 👋</Text>
          <Text style={styles.subtituloBienvenida}>Identifícate para empezar a transmitir</Text>
          
          <TextInput
            style={styles.entradaTexto}
            placeholder="Escribe tu nombre aquí..."
            placeholderTextColor="#888"
            value={nombreIngresado}
            onChangeText={setNombreIngresado}
            maxLength={15}
          />

          <TouchableOpacity style={styles.botonVerde} onPress={manejarRegistro}>
            <Text style={styles.textoBotonVerde}>Ingresar al Sistema</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // 🧭 PANTALLA 2: MENÚ PRINCIPAL (HUB)
  if (pantallaActual === 'hub') {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center' }]}>
        <View style={styles.tarjetaCentrada}>
          <Text style={styles.brandTitleText}>Secoll Communications</Text>
          <Text style={styles.subtituloBienvenida}>Selecciona el modo de transmisión</Text>

          <TouchableOpacity 
            style={styles.botonHubMenu} 
            onPress={() => {
              setModoComunicacion('radio');
              setPantallaActual('selector_canal');
            }}
          >
            <Text style={styles.iconoHubMenu}>🎙️</Text>
            <View style={styles.contenedorTextoHub}>
              <Text style={styles.tituloBotonHub}>Radio Walkie-Talkie</Text>
              <Text style={styles.descripcionBotonHub}>Transmisión de voz en tiempo real</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.botonHubMenu, { marginTop: 15 }]} 
            onPress={() => {
              setModoComunicacion('chat');
              setPantallaActual('selector_canal');
            }}
          >
            <Text style={styles.iconoHubMenu}>💬</Text>
            <View style={styles.contenedorTextoHub}>
              <Text style={styles.tituloBotonHub}>Chat de Texto</Text>
              <Text style={styles.descripcionBotonHub}>Mensajes escritos persistentes</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.botonVolver, { marginTop: 30 }]} 
            onPress={() => setPantallaActual('configuracion')}
          >
            <Text style={styles.textoBotonVolver}>Configuración ⚙️</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // 🎛️ PANTALLA 3: SELECTOR DE CANALES
  if (pantallaActual === 'selector_canal') {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center' }]}>
        <View style={styles.tarjetaCentrada}>
          <Text style={styles.tituloConfig}>Selecciona un Canal 🎛️</Text>
          <Text style={styles.subtituloBienvenida}>
            Modo seleccionado: {modoComunicacion === 'radio' ? '🎙️ Radio' : '💬 Chat'}
          </Text>

          {CANALES_PREDEFINIDOS.map((canal, index) => (
            <TouchableOpacity
              key={index}
              style={styles.botonCanalItem}
              onPress={() => {
                setCanalActivo(canal);
                setPantallaActual(modoComunicacion === 'radio' ? 'walkie' : 'chat');
              }}
            >
              <Text style={styles.textoBotonCanalItem}>🔹 {canal}</Text>
              <Text style={styles.textoFlechaCanal}>▶</Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity 
            style={[styles.botonVolver, { marginTop: 25 }]} 
            onPress={() => setPantallaActual('hub')}
          >
            <Text style={styles.textoBotonVolver}>Volver al Menú</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // 💬 PANTALLA 4: CHAT UNIFICADO Y CORREGIDO
  if (pantallaActual === 'chat') {
    const renderItemMensaje = ({ item }) => {
      const esMio = item.emisor === nombreUsuarioCompleto;
      return (
        <View style={[styles.contenedorBurbuja, esMio ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }]}>
          <View style={[styles.burbujaChat, esMio ? styles.burbujaMia : styles.burbujaAjena]}>
            {!esMio && <Text style={styles.textoEmisorChat}>{item.emisor}</Text>}
            <Text style={styles.textoMensajeChat}>{item.texto}</Text>
            <Text style={styles.textoHoraChat}>{item.timestamp}</Text>
          </View>
        </View>
      );
    };

    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
          style={{ flex: 1, width: '100%' }}
        >
          <View style={styles.headerDisplay}>
            <View style={styles.headerFilaSuperior}>
              <Text style={styles.brandText}>Secoll Chat • {canalActivo}</Text>
              <TouchableOpacity onPress={() => setPantallaActual('hub')} style={styles.areaEngranaje}>
                <Text style={styles.textoEngranaje}>🏠</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.choferTag}>Usuario: {nombreUsuarioCompleto}</Text>
          </View>

          <FlatList
            ref={flatListRef}
            data={mensajes}
            keyExtractor={(item) => item.id}
            renderItem={renderItemMensaje}
            style={styles.listaChatContainer}
            contentContainerStyle={{ paddingVertical: 5 }}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          />

          <View style={styles.contenedorInputChat}>
            <TextInput
              style={styles.inputMensajeChat}
              placeholder="Escribe un mensaje..."
              placeholderTextColor="#888"
              value={textoMensaje}
              onChangeText={setTextoMensaje}
              maxLength={100}
            />
            <TouchableOpacity style={styles.botonEnviarChat} onPress={enviarMensajeTexto}>
              <Text style={{ fontSize: 18 }}>➡️</Text>
            </TouchableOpacity>
          </View>

          {/* Botón Gris de navegación unificado, sin verde ni azul brillante */}
          <TouchableOpacity 
            style={[styles.botonHubMenu, { width: '100%', height: 46, borderRadius: 12, marginBottom: 10 }]} 
            onPress={() => setPantallaActual('walkie')}
          >
            <Text style={{ fontSize: 15, color: '#ffffff', fontWeight: 'bold' }}>🎙️ Cambiar a Radio de este Canal</Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ⚙️ PANTALLA 5: CONFIGURACIÓN
  if (pantallaActual === 'configuracion') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.tarjetaCentrada}>
          <Text style={styles.tituloConfig}>Configuración ⚙️</Text>
          
          <View style={styles.seccionInfoEdicion}>
            <Text style={styles.textoInfoLabel}>Identificación del Usuario</Text>
            {isEditing ? (
              <TextInput
                style={styles.entradaTextoEdicion}
                value={nuevoNombre}
                onChangeText={setNuevoNombre}
                maxLength={15}
                placeholder="Nuevo nombre..."
                placeholderTextColor="#888"
              />
            ) : (
              <Text style={styles.textoInfoValorNombre}>
                {nombreUsuarioCompleto}
              </Text>
            )}
            
            <TouchableOpacity 
              style={[styles.botonVerde, { height: 40, borderRadius: 10, marginTop: 5 }]}
              onPress={isEditing ? guardarNuevoNombre : () => setIsEditing(true)}
            >
              <Text style={styles.textoBotonVerde}>
                {isEditing ? 'Guardar Cambios' : 'Editar Nombre'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.seccionInfo}>
            <Text style={styles.textoInfoLabel}>Versión de la App</Text>
            <Text style={styles.textoInfoValor}>v1.1</Text>
          </View>

          <View style={styles.seccionInfo}>
            <Text style={styles.textoInfoLabel}>Desarrollador</Text>
            <Text style={styles.textoInfoValorCed}>Dreama64</Text>
          </View>

          <TouchableOpacity style={styles.botonPayPal} onPress={abrirPayPal}>
            <Text style={styles.textoBotonPayPal}>💳 Si deseas donarme por PayPal</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.botonMercadoPago} onPress={abrirMercadoPago}>
            <Text style={styles.textoBotonPayPal}>🇨🇱 Aporte con Mercado Pago (Chile) 🇨🇱</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.botonVolver, { marginTop: 10 }]} 
            onPress={() => {
              setIsEditing(false);
              setPantallaActual('hub');
            }}
          >
            <Text style={styles.textoBotonVolver}>Volver al Menú</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // 📻 PANTALLA 6: RADIO WALKIE-TALKIE UNIFICADA
  if (pantallaActual === 'walkie') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.headerDisplay}>
          <View style={styles.headerFilaSuperior}>
            <Text style={styles.brandText}>Secoll v1.1 • {canalActivo}</Text>
            <TouchableOpacity onPress={() => setPantallaActual('hub')} style={styles.areaEngranaje}>
              <Text style={styles.textoEngranaje}>🏠</Text>
            </TouchableOpacity>
          </View>
          
          <Text style={styles.choferTag}>Usuario: {nombreUsuarioCompleto}</Text>

          <View style={styles.signalContainer}>
            <View style={[styles.signalDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.estado, { color: statusColor }]}>
              {emisorActual ? `🔊 DE: ${emisorActual}` : statusText}
            </Text>
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

        {/* Botón Gris de navegación unificado, sin azul brillante y con margen seguro */}
        <TouchableOpacity 
          style={[styles.botonHubMenu, { width: '100%', height: 46, borderRadius: 12, marginBottom: 10 }]} 
          onPress={() => setPantallaActual('chat')}
        >
          <Text style={{ fontSize: 15, color: '#ffffff', fontWeight: 'bold' }}>💬 Cambiar a Chat de este Canal</Text>
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Mantén presionado para hablar • Secoll Communications</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.container, styles.centradoTotal]}>
      <ActivityIndicator size="large" color="#2ed573" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#11141a',
    alignItems: 'center',
    justifyContent: 'flex-start', 
    paddingTop: Platform.OS === 'ios' ? 50 : 30,
    paddingBottom: Platform.OS === 'android' ? 30 : 20, // 👈 Más margen inferior para que no choque con los botones virtuales
    paddingHorizontal: 20,
  },
  centradoTotal: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  tarjetaCentrada: {
    width: '100%',
    backgroundColor: '#1c2029',
    borderRadius: 20,
    padding: 25,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2d3446',
    elevation: 5,
    marginTop: 'auto',
    marginBottom: 'auto',
  },
  headerDisplay: {
    width: '100%',
    backgroundColor: '#1c2029',
    borderRadius: 16,
    padding: 15,
    borderWidth: 1,
    borderColor: '#2d3446',
    alignItems: 'center',
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
    marginBottom: 5,
  },
  brandText: {
    color: '#57606f',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  brandTitleText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 5,
    letterSpacing: 1,
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
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1,
    textAlign: 'center',
  },
  centerSpace: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  btnHablar: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 8,
    alignItems: 'center',
    justifyContent: 'center',
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
    marginTop: 5,
  },
  footerText: {
    color: '#57606f',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  tituloBienvenida: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  subtituloBienvenida: {
    fontSize: 14,
    color: '#a4b0be',
    textAlign: 'center',
    marginBottom: 25,
  },
  tituloConfig: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 25,
  },
  seccionInfo: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2d3446',
  },
  seccionInfoEdicion: {
    width: '100%',
    flexDirection: 'column',
    alignItems: 'stretch',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2d3446',
  },
  textoInfoLabel: {
    fontSize: 14,
    color: '#a4b0be',
  },
  textoInfoValor: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  textoInfoValorNombre: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2ed573',
    marginTop: 5,
    marginBottom: 10,
  },
  textoInfoValorCed: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2ed573',
  },
  entradaTexto: {
    width: '100%',
    height: 50,
    backgroundColor: '#1e2432',
    borderRadius: 25,
    paddingHorizontal: 20,
    fontSize: 16,
    color: '#ffffff',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#2d3446',
  },
  entradaTextoEdicion: {
    width: '100%',
    height: 45,
    backgroundColor: '#1e2432',
    borderRadius: 10,
    paddingHorizontal: 15,
    fontSize: 15,
    color: '#ffffff',
    marginTop: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2ed573',
  },
  // 🧭 ESTILO DE BOTÓN GRIS UNIFICADO (PARA MENÚS Y NAVEGACIÓN DE PANTALLAS)
  botonHubMenu: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e2432',
    borderWidth: 1,
    borderColor: '#2d3446', // 👈 Gris unificado elegante
    borderRadius: 16,
    padding: 12,
    justifyContent: 'center',
  },
  iconoHubMenu: {
    fontSize: 28,
    marginRight: 15,
  },
  contenedorTextoHub: {
    flex: 1,
    alignItems: 'flex-start',
  },
  tituloBotonHub: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  descripcionBotonHub: {
    fontSize: 12,
    color: '#a4b0be',
    marginTop: 2,
  },
  botonCanalItem: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1e2432',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2d3446',
  },
  textoBotonCanalItem: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  textoFlechaCanal: {
    color: '#2ed573',
    fontSize: 14,
  },
  botonVerde: {
    width: '100%',
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
    backgroundColor: '#009ee3',
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
    backgroundColor: '#2d3446',
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textoBotonVolver: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 'bold',
  },

  // 💬 ESTILOS DEL CHAT
  listaChatContainer: {
    flex: 1,
    width: '100%',
    marginVertical: 10,
  },
  contenedorBurbuja: {
    width: '100%',
    paddingHorizontal: 5,
    marginVertical: 4, 
  },
  burbujaChat: {
    maxWidth: '80%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  burbujaMia: {
    backgroundColor: '#2d3446', // 👈 Mensajes propios ahora son Gris Oscuro para no desentonar
    borderBottomRightRadius: 2,
    borderWidth: 1,
    borderColor: '#3a445a',
  },
  burbujaAjena: {
    backgroundColor: '#1c2029',
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: '#2d3446',
  },
  textoEmisorChat: {
    color: '#2ed573',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 3,
  },
  textoMensajeChat: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 20,
  },
  textoHoraChat: {
    color: '#a4b0be',
    fontSize: 10,
    alignSelf: 'flex-end',
    marginTop: 4,
    opacity: 0.8,
  },
  contenedorInputChat: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e2432',
    borderRadius: 25,
    paddingHorizontal: 5,
    height: 50,
    borderWidth: 1,
    borderColor: '#2d3446',
    marginTop: 5,
    marginBottom: 15, 
  },
  inputMensajeChat: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 15,
    color: '#ffffff',
    fontSize: 15,
  },
  botonEnviarChat: {
    width: 40,
    height: 40,
    backgroundColor: '#2d3446',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 5,
  }
});