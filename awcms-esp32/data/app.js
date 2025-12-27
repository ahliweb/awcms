/**
 * AWCMS ESP32 IoT Dashboard
 * Frontend JavaScript
 */

// WebSocket connection
let ws = null;
let reconnectInterval = null;

// DOM Elements
const elements = {
    connectionStatus: document.getElementById('connectionStatus'),
    deviceId: document.getElementById('deviceId'),
    ipAddress: document.getElementById('ipAddress'),
    wifiRssi: document.getElementById('wifiRssi'),
    uptime: document.getElementById('uptime'),
    heapFree: document.getElementById('heapFree'),
    temperature: document.getElementById('temperature'),
    humidity: document.getElementById('humidity'),
    lastUpdate: document.getElementById('lastUpdate')
};

/**
 * Initialize WebSocket connection
 */
function initWebSocket() {
    const wsUrl = `ws://${window.location.hostname}/ws`;
    console.log('Connecting to WebSocket:', wsUrl);

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket connected');
        updateConnectionStatus('connected');
        clearInterval(reconnectInterval);
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected');
        updateConnectionStatus('disconnected');

        // Auto reconnect
        reconnectInterval = setInterval(() => {
            console.log('Attempting to reconnect...');
            initWebSocket();
        }, 5000);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus('disconnected');
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleMessage(data);
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    };
}

/**
 * Handle incoming WebSocket messages
 */
function handleMessage(data) {
    console.log('Received:', data);

    if (data.type === 'sensor_data') {
        // Update sensor readings
        updateSensorData(data);
    } else if (data.device_id) {
        // Device status message
        updateDeviceInfo(data);
    }
}

/**
 * Update connection status indicator
 */
function updateConnectionStatus(status) {
    const badge = elements.connectionStatus;
    badge.className = 'status-badge ' + status;

    const statusText = {
        connected: 'Connected',
        disconnected: 'Disconnected',
        connecting: 'Connecting...'
    };

    badge.querySelector('span:last-child').textContent = statusText[status] || 'Unknown';
}

/**
 * Update device info display
 */
function updateDeviceInfo(data) {
    if (data.device_id) elements.deviceId.textContent = data.device_id;
    if (data.ip_address) elements.ipAddress.textContent = data.ip_address;
    if (data.wifi_rssi) elements.wifiRssi.textContent = data.wifi_rssi + ' dBm';
    if (data.uptime) elements.uptime.textContent = formatUptime(data.uptime);
    if (data.heap_free) elements.heapFree.textContent = formatBytes(data.heap_free);
}

/**
 * Update sensor data display
 */
function updateSensorData(data) {
    if (data.temperature !== undefined) {
        elements.temperature.textContent = data.temperature.toFixed(1);
    }
    if (data.humidity !== undefined) {
        elements.humidity.textContent = data.humidity.toFixed(1);
    }

    elements.lastUpdate.textContent = new Date().toLocaleTimeString();
}

/**
 * Format uptime in human readable format
 */
function formatUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
}

/**
 * Format bytes in human readable format
 */
function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

/**
 * Refresh data from API
 */
async function refreshData() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        updateDeviceInfo(data);

        const sensorResponse = await fetch('/api/sensors');
        const sensorData = await sensorResponse.json();
        updateSensorData(sensorData);
    } catch (error) {
        console.error('Error refreshing data:', error);
    }
}

/**
 * Restart the device
 */
async function restartDevice() {
    if (!confirm('Are you sure you want to restart the device?')) {
        return;
    }

    try {
        await fetch('/api/restart', { method: 'POST' });
        updateConnectionStatus('disconnected');
        alert('Device is restarting...');
    } catch (error) {
        console.error('Error restarting device:', error);
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initWebSocket();
    refreshData();
});
