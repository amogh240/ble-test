import { StatusBar } from "expo-status-bar";
import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  Alert,
  Platform,
  PermissionsAndroid,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
} from "react-native";
import { BleManager, Device, Characteristic, State } from "react-native-ble-plx";
import { encode as btoa } from "base-64";

const manager = new BleManager();

type AppScreen = "scan" | "device";

export default function App() {
  const [screen, setScreen] = useState<AppScreen>("scan");
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [services, setServices] = useState<string[]>([]);
  const [characteristics, setCharacteristics] = useState<Characteristic[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const devicesRef = useRef<Map<string, Device>>(new Map());

  const addLog = (message: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  // Request permissions on Android
  const requestPermissions = async (): Promise<boolean> => {
    if (Platform.OS === "android") {
      const apiLevel = Platform.Version;
      if (apiLevel >= 31) {
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        return Object.values(result).every(
          (v) => v === PermissionsAndroid.RESULTS.GRANTED
        );
      } else {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        return result === PermissionsAndroid.RESULTS.GRANTED;
      }
    }
    return true;
  };

  // Check BLE state on mount
  useEffect(() => {
    const subscription = manager.onStateChange((state) => {
      if (state === State.PoweredOn) {
        addLog("Bluetooth is powered on");
      } else {
        addLog(`Bluetooth state: ${state}`);
      }
    }, true);

    return () => {
      subscription.remove();
      manager.stopDeviceScan();
    };
  }, []);

  const startScan = async () => {
    const granted = await requestPermissions();
    if (!granted) {
      Alert.alert("Permissions required", "BLE permissions are needed to scan.");
      return;
    }

    devicesRef.current.clear();
    setDevices([]);
    setScanning(true);
    addLog("Scanning started...");

    manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        addLog(`Scan error: ${error.message}`);
        setScanning(false);
        return;
      }
      if (device && device.name) {
        if (!devicesRef.current.has(device.id)) {
          devicesRef.current.set(device.id, device);
          setDevices(Array.from(devicesRef.current.values()));
          addLog(`Found: ${device.name} (${device.id})`);
        }
      }
    });

    // Auto-stop after 15 seconds
    setTimeout(() => {
      manager.stopDeviceScan();
      setScanning(false);
      addLog("Scan stopped (timeout)");
    }, 15000);
  };

  const stopScan = () => {
    manager.stopDeviceScan();
    setScanning(false);
    addLog("Scan stopped manually");
  };

  const connectToDevice = async (device: Device) => {
    stopScan();
    setConnecting(true);
    addLog(`Connecting to ${device.name}...`);

    try {
      const connected = await device.connect({ timeout: 10000 });
      addLog(`Connected to ${connected.name}`);

      const discovered = await connected.discoverAllServicesAndCharacteristics();
      addLog("Services & characteristics discovered");

      // Get services
      const deviceServices = await discovered.services();
      const serviceUUIDs = deviceServices.map((s) => s.uuid);
      setServices(serviceUUIDs);
      addLog(`Found ${serviceUUIDs.length} services`);

      // Get all characteristics
      const allChars: Characteristic[] = [];
      for (const service of deviceServices) {
        const chars = await discovered.characteristicsForService(service.uuid);
        allChars.push(...chars);
      }
      setCharacteristics(allChars);
      addLog(`Found ${allChars.length} characteristics`);

      setConnectedDevice(discovered);
      setConnecting(false);
      setScreen("device");
    } catch (error: any) {
      addLog(`Connection failed: ${error.message}`);
      setConnecting(false);
      Alert.alert("Connection Failed", error.message);
    }
  };

  const sendDummyData = async (characteristic: Characteristic) => {
    if (!connectedDevice) return;

    const dummyData = "Hello from BLE!";
    const encoded = btoa(dummyData);

    try {
      if (characteristic.isWritableWithResponse) {
        await connectedDevice.writeCharacteristicWithResponseForService(
          characteristic.serviceUUID,
          characteristic.uuid,
          encoded
        );
        addLog(`Wrote "${dummyData}" to ${characteristic.uuid}`);
      } else if (characteristic.isWritableWithoutResponse) {
        await connectedDevice.writeCharacteristicWithoutResponseForService(
          characteristic.serviceUUID,
          characteristic.uuid,
          encoded
        );
        addLog(`Wrote (no response) "${dummyData}" to ${characteristic.uuid}`);
      } else {
        addLog(`Characteristic ${characteristic.uuid} is not writable`);
      }
    } catch (error: any) {
      addLog(`Write failed: ${error.message}`);
    }
  };

  const readCharacteristic = async (characteristic: Characteristic) => {
    if (!connectedDevice) return;

    try {
      if (characteristic.isReadable) {
        const read = await connectedDevice.readCharacteristicForService(
          characteristic.serviceUUID,
          characteristic.uuid
        );
        addLog(`Read from ${characteristic.uuid}: ${read.value ?? "(empty)"}`);
      } else {
        addLog(`Characteristic ${characteristic.uuid} is not readable`);
      }
    } catch (error: any) {
      addLog(`Read failed: ${error.message}`);
    }
  };

  const disconnect = async () => {
    if (connectedDevice) {
      try {
        await connectedDevice.cancelConnection();
        addLog(`Disconnected from ${connectedDevice.name}`);
      } catch (error: any) {
        addLog(`Disconnect error: ${error.message}`);
      }
    }
    setConnectedDevice(null);
    setServices([]);
    setCharacteristics([]);
    setScreen("scan");
  };

  // ─── Scan Screen ───
  if (screen === "scan") {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <Text style={styles.title}>BLE Scanner</Text>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, scanning && styles.buttonDisabled]}
            onPress={startScan}
            disabled={scanning}
          >
            <Text style={styles.buttonText}>
              {scanning ? "Scanning..." : "Start Scan"}
            </Text>
          </TouchableOpacity>

          {scanning && (
            <TouchableOpacity
              style={[styles.button, styles.buttonStop]}
              onPress={stopScan}
            >
              <Text style={styles.buttonText}>Stop</Text>
            </TouchableOpacity>
          )}
        </View>

        {scanning && <ActivityIndicator size="large" color="#4A90D9" style={{ marginVertical: 10 }} />}

        <Text style={styles.sectionTitle}>
          Devices Found ({devices.length})
        </Text>

        <FlatList
          data={devices}
          keyExtractor={(item) => item.id}
          style={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.deviceItem}
              onPress={() => connectToDevice(item)}
              disabled={connecting}
            >
              <Text style={styles.deviceName}>{item.name || "Unknown"}</Text>
              <Text style={styles.deviceId}>{item.id}</Text>
              <Text style={styles.deviceRssi}>RSSI: {item.rssi ?? "N/A"}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {scanning ? "Searching for devices..." : "No devices found. Tap Start Scan."}
            </Text>
          }
        />

        {connecting && (
          <View style={styles.overlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.overlayText}>Connecting...</Text>
          </View>
        )}

        {/* Log panel */}
        <View style={styles.logPanel}>
          <Text style={styles.logTitle}>Log</Text>
          <ScrollView style={styles.logScroll}>
            {logs.slice(-10).map((log, i) => (
              <Text key={i} style={styles.logText}>{log}</Text>
            ))}
          </ScrollView>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Device Screen ───
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <Text style={styles.title}>{connectedDevice?.name ?? "Device"}</Text>
      <Text style={styles.subtitle}>{connectedDevice?.id}</Text>

      <TouchableOpacity
        style={[styles.button, styles.buttonStop]}
        onPress={disconnect}
      >
        <Text style={styles.buttonText}>Disconnect</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>
        Services ({services.length})
      </Text>
      <ScrollView style={styles.serviceList}>
        {services.map((uuid) => (
          <Text key={uuid} style={styles.serviceUuid}>{uuid}</Text>
        ))}
      </ScrollView>

      <Text style={styles.sectionTitle}>
        Characteristics ({characteristics.length})
      </Text>
      <FlatList
        data={characteristics}
        keyExtractor={(item, index) => `${item.uuid}-${index}`}
        style={styles.list}
        renderItem={({ item }) => (
          <View style={styles.charItem}>
            <Text style={styles.charUuid} numberOfLines={1}>{item.uuid}</Text>
            <Text style={styles.charProps}>
              {[
                item.isReadable && "Read",
                item.isWritableWithResponse && "Write",
                item.isWritableWithoutResponse && "WriteNoResp",
                item.isNotifiable && "Notify",
              ]
                .filter(Boolean)
                .join(", ") || "No properties"}
            </Text>
            <View style={styles.charActions}>
              {item.isReadable && (
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => readCharacteristic(item)}
                >
                  <Text style={styles.actionText}>Read</Text>
                </TouchableOpacity>
              )}
              {(item.isWritableWithResponse || item.isWritableWithoutResponse) && (
                <TouchableOpacity
                  style={[styles.actionButton, styles.writeButton]}
                  onPress={() => sendDummyData(item)}
                >
                  <Text style={styles.actionText}>Send Data</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      />

      {/* Log panel */}
      <View style={styles.logPanel}>
        <Text style={styles.logTitle}>Log</Text>
        <ScrollView style={styles.logScroll}>
          {logs.slice(-10).map((log, i) => (
            <Text key={i} style={styles.logText}>{log}</Text>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    paddingTop: Platform.OS === "android" ? 40 : 0,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#e0e0e0",
    textAlign: "center",
    marginTop: 10,
  },
  subtitle: {
    fontSize: 12,
    color: "#888",
    textAlign: "center",
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#4A90D9",
    marginTop: 12,
    marginBottom: 6,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginVertical: 12,
  },
  button: {
    backgroundColor: "#4A90D9",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonStop: {
    backgroundColor: "#D94A4A",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  list: {
    flex: 1,
  },
  deviceItem: {
    backgroundColor: "#16213e",
    padding: 14,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#4A90D9",
  },
  deviceName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#e0e0e0",
  },
  deviceId: {
    fontSize: 11,
    color: "#888",
    marginTop: 2,
  },
  deviceRssi: {
    fontSize: 12,
    color: "#4A90D9",
    marginTop: 2,
  },
  emptyText: {
    color: "#666",
    textAlign: "center",
    marginTop: 40,
    fontSize: 14,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  overlayText: {
    color: "#fff",
    fontSize: 18,
    marginTop: 12,
  },
  serviceList: {
    maxHeight: 80,
  },
  serviceUuid: {
    color: "#aaa",
    fontSize: 12,
    marginBottom: 2,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  charItem: {
    backgroundColor: "#16213e",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  charUuid: {
    color: "#e0e0e0",
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  charProps: {
    color: "#4A90D9",
    fontSize: 11,
    marginTop: 4,
  },
  charActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  actionButton: {
    backgroundColor: "#4A90D9",
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
  },
  writeButton: {
    backgroundColor: "#2ECC71",
  },
  actionText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  logPanel: {
    height: 120,
    backgroundColor: "#0f0f1a",
    borderRadius: 8,
    padding: 8,
    marginVertical: 8,
  },
  logTitle: {
    color: "#4A90D9",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
  },
  logScroll: {
    flex: 1,
  },
  logText: {
    color: "#6a6a8a",
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 16,
  },
});
