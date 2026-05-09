/* =============================================
   AudioDeviceManager - Bluetooth & Audio Device Management
   ============================================= */

class AudioDeviceManager {
    constructor() {
        this.devices = { inputs: [], outputs: [] };
        this.selectedInput = 'default';
        this.selectedOutput = 'default';
        this.onDeviceChangeCallback = null;
        this._stream = null;
    }

    async init() {
        try {
            // Request mic permission first (required to get device labels)
            this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // Stop the stream tracks, we just needed permission
            this._stream.getTracks().forEach(t => t.stop());
            this._stream = null;

            await this.refreshDevices();

            // Listen for device changes (BT connect/disconnect)
            navigator.mediaDevices.addEventListener('devicechange', async () => {
                console.log('[AudioDevices] Device change detected');
                await this.refreshDevices();
                if (this.onDeviceChangeCallback) {
                    this.onDeviceChangeCallback(this.devices);
                }
            });

            return true;
        } catch (err) {
            console.error('[AudioDevices] Init failed:', err);
            throw new Error('Mikrofon izni gerekli: ' + err.message);
        }
    }

    async refreshDevices() {
        const allDevices = await navigator.mediaDevices.enumerateDevices();

        this.devices.inputs = allDevices
            .filter(d => d.kind === 'audioinput')
            .map(d => ({
                id: d.deviceId,
                label: d.label || `Mikrofon ${d.deviceId.substring(0, 6)}`,
                isBluetooth: this._isBluetooth(d.label),
                isDefault: d.deviceId === 'default'
            }));

        this.devices.outputs = allDevices
            .filter(d => d.kind === 'audiooutput')
            .map(d => ({
                id: d.deviceId,
                label: d.label || `Hoparlör ${d.deviceId.substring(0, 6)}`,
                isBluetooth: this._isBluetooth(d.label),
                isDefault: d.deviceId === 'default'
            }));

        console.log('[AudioDevices] Inputs:', this.devices.inputs.length, 'Outputs:', this.devices.outputs.length);
        return this.devices;
    }

    _isBluetooth(label) {
        if (!label) return false;
        const lower = label.toLowerCase();
        const btKeywords = ['bluetooth', 'bt ', 'airpods', 'galaxy buds', 'jbl', 'sony wh',
            'bose', 'beats', 'jabra', 'sennheiser', 'wireless', 'hands-free',
            'headset', 'handsfree', 'a2dp', 'hfp', 'le_'];
        return btKeywords.some(kw => lower.includes(kw));
    }

    getBluetoothInput() {
        return this.devices.inputs.find(d => d.isBluetooth);
    }

    getBluetoothOutput() {
        return this.devices.outputs.find(d => d.isBluetooth);
    }

    getPhoneInput() {
        // Return built-in mic (first non-bluetooth, non-default)
        const builtin = this.devices.inputs.find(d => !d.isBluetooth && d.id !== 'default');
        return builtin || this.devices.inputs.find(d => d.id === 'default');
    }

    getPhoneOutput() {
        const builtin = this.devices.outputs.find(d => !d.isBluetooth && d.id !== 'default');
        return builtin || this.devices.outputs.find(d => d.id === 'default');
    }

    setSelectedInput(deviceId) {
        this.selectedInput = deviceId;
    }

    setSelectedOutput(deviceId) {
        this.selectedOutput = deviceId;
    }

    onDeviceChange(callback) {
        this.onDeviceChangeCallback = callback;
    }

    /**
     * Play audio data through a specific output device
     * @param {ArrayBuffer} audioData - WAV/MP3 audio data
     * @param {string} outputDeviceId - Target output device ID
     * @returns {Promise<void>}
     */
    async playAudioOnDevice(audioData, outputDeviceId) {
        return new Promise((resolve, reject) => {
            const blob = new Blob([audioData], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);

            // Try to route to specific device
            if (outputDeviceId && outputDeviceId !== 'default' && typeof audio.setSinkId === 'function') {
                audio.setSinkId(outputDeviceId)
                    .then(() => {
                        console.log('[AudioDevices] Audio routed to:', outputDeviceId);
                    })
                    .catch(err => {
                        console.warn('[AudioDevices] setSinkId failed, using default:', err);
                    });
            }

            audio.onended = () => {
                URL.revokeObjectURL(url);
                resolve();
            };

            audio.onerror = (e) => {
                URL.revokeObjectURL(url);
                reject(e);
            };

            audio.play().catch(reject);
        });
    }
}

// Export as global
window.AudioDeviceManager = AudioDeviceManager;
