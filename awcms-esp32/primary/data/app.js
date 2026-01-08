/**
 * AWCMS ESP32 IoT Dashboard
 * Frontend JavaScript v2.0
 * Gas Sensor + Camera Edition
 */

// WebSocket connection
let ws = null;
let reconnectInterval = null;
let cameraRefreshInterval = null;

// DOM Elements
const elements = {
    connectionStatus: document.getElementById('connectionStatus'),
    alertBanner: document.getElementById('alertBanner'),
    alertText: document.getElementById('alertText'),
    deviceId: document.getElementById('deviceId'),
    ipAddress: document.getElementById('ipAddress'),
    wifiRssi: document.getElementById('wifiRssi'),
    uptime: document.getElementById('uptime'),
    gasPPM: document.getElementById('gasPPM'),
    gasStatus: document.getElementById('gasStatus'),
    gasCalibrated: document.getElementById('gasCalibrated'),
    gasDisplay: document.getElementById('gasDisplay'),
    cameraFeed: document.getElementById('cameraFeed'),
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

        reconnectInterval = setInterval(() => {
            console.log('Reconnecting...');
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
            console.error('Parse error:', e);
        }
    };
}

/**
 * Handle incoming WebSocket messages
 */
function handleMessage(data) {
    console.log('Received:', data);

    if (data.type === 'sensor_data') {
        updateGasData(data);

        // Check for alerts
        if (data.alert) {
            showAlert(data.alert);
        }
    } else if (data.device_id) {
        updateDeviceInfo(data);
    }

    elements.lastUpdate.textContent = new Date().toLocaleTimeString();
}

/**
 * Update gas sensor display
 */
function updateGasData(data) {
    if (data.gas_ppm !== undefined) {
        const ppm = data.gas_ppm.toFixed(1);
        elements.gasPPM.textContent = ppm;

        // Update status based on PPM level
        let status = 'Normal';
        let level = 'normal';

        if (data.gas_ppm > 1000) {
            status = 'DANGER';
            level = 'danger';
        } else if (data.gas_ppm > 500) {
            status = 'Warning';
            level = 'warning';
        } else if (data.gas_ppm > 200) {
            status = 'Elevated';
            level = 'elevated';
        }

        elements.gasStatus.textContent = status;
        elements.gasDisplay.className = 'sensor-item gas ' + level;
    }

    if (data.gas_calibrated !== undefined) {
        elements.gasCalibrated.textContent = data.gas_calibrated ? 'Calibrated' : 'Not calibrated';
    }
}

/**
 * Show alert banner
 */
function showAlert(message) {
    elements.alertText.textContent = message;
    elements.alertBanner.classList.remove('hidden');

    // Auto-hide after 10 seconds
    setTimeout(() => {
        elements.alertBanner.classList.add('hidden');
    }, 10000);
}

/**
 * Update connection status
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
 * Update device info
 */
function updateDeviceInfo(data) {
    if (data.device_id) elements.deviceId.textContent = data.device_id;
    if (data.ip_address) elements.ipAddress.textContent = data.ip_address;
    if (data.wifi_rssi) elements.wifiRssi.textContent = data.wifi_rssi + ' dBm';
    if (data.uptime) elements.uptime.textContent = formatUptime(data.uptime);
}

/**
 * Format uptime
 */
function formatUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m ${seconds % 60}s`;
}

/**
 * Refresh all data
 */
async function refreshData() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        updateDeviceInfo(data);

        const gasResponse = await fetch('/api/gas');
        const gasData = await gasResponse.json();
        updateGasData({
            gas_ppm: gasData.ppm,
            gas_calibrated: gasData.calibrated
        });

        refreshCamera();
    } catch (error) {
        console.error('Refresh error:', error);
    }
}

/**
 * Calibrate gas sensor
 */
async function calibrateGas() {
    if (!confirm('Calibrate gas sensor?\nMake sure sensor is in clean air.')) {
        return;
    }

    try {
        const response = await fetch('/api/gas/calibrate', { method: 'POST' });
        const data = await response.json();

        if (data.status === 'calibrated') {
            alert('Calibration successful!');
            elements.gasCalibrated.textContent = 'Calibrated';
        } else {
            alert('Calibration failed. Check sensor connection.');
        }
    } catch (error) {
        console.error('Calibration error:', error);
        alert('Calibration error');
    }
}

/**
 * Refresh camera feed
 */
function refreshCamera() {
    const timestamp = new Date().getTime();
    elements.cameraFeed.src = '/capture?' + timestamp;
}

/**
 * Download camera capture
 */
function downloadCapture() {
    const link = document.createElement('a');
    link.href = '/capture';
    link.download = 'capture_' + new Date().toISOString() + '.jpg';
    link.click();
}

/**
 * Restart device
 */
async function restartDevice() {
    if (!confirm('Restart device?')) return;

    try {
        await fetch('/api/restart', { method: 'POST' });
        updateConnectionStatus('disconnected');
        alert('Device restarting...');
    } catch (error) {
        console.error('Restart error:', error);
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initWebSocket();
    refreshData();

    // Auto-refresh camera every 5 seconds
    cameraRefreshInterval = setInterval(refreshCamera, 5000);
});
