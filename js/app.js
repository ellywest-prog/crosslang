/* =============================================
   CrossLang App - Main Application Controller
   ============================================= */

class CrossLangApp {
    constructor() {
        this.audioManager = new AudioDeviceManager();
        this.speechService = new SpeechService();
        this.activeMode = null; // 'A' or 'B'
        this.isProcessing = false;

        // DOM references
        this.dom = {};
    }

    async init() {
        this.cacheDom();
        this.loadSettings();
        this.bindEvents();

        // Initialize audio devices
        try {
            await this.audioManager.init();
            this.populateDeviceSelects();
            this.showToast('🎤 Mikrofon izni alındı');
        } catch (err) {
            this.showToast('❌ ' + err.message, 4000);
        }

        // Listen for device changes
        this.audioManager.onDeviceChange(() => {
            this.populateDeviceSelects();
            this.showToast('🔄 Ses cihazları güncellendi');
        });

        // Setup speech service callbacks
        this.speechService.onRecognizing = (original, translated, srcLang, tgtLang) => {
            this.showInterim(original, translated);
        };

        this.speechService.onRecognized = (original, translated, srcLang, tgtLang) => {
            this.hideInterim();
            this.addMessage(this.activeMode, original, translated, srcLang, tgtLang);
            // Speak the translation
            this.speakTranslation(translated, tgtLang);
        };

        this.speechService.onError = (error) => {
            this.showToast('❌ Hata: ' + error, 4000);
            this.stopListening();
        };

        this.speechService.onStatusChange = (status) => {
            this.updateConnectionStatus(status);
        };

        // Check if configured
        if (this.speechService.isConfigured()) {
            this.updateConnectionStatus('ready');
        } else {
            this.showToast('⚙️ Ayarlardan API anahtarı girin', 5000);
            this.openSettings();
        }

        console.log('[CrossLang] App initialized');
    }

    cacheDom() {
        this.dom = {
            langA: document.getElementById('langA'),
            langB: document.getElementById('langB'),
            flagA: document.getElementById('flagA'),
            flagB: document.getElementById('flagB'),
            swapLangs: document.getElementById('swapLangs'),
            inputDevice: document.getElementById('inputDevice'),
            outputDevice: document.getElementById('outputDevice'),
            refreshDevices: document.getElementById('refreshDevices'),
            transcript: document.getElementById('transcript'),
            interimText: document.getElementById('interimText'),
            interimContent: document.getElementById('interimContent'),
            clearTranscript: document.getElementById('clearTranscript'),
            btnPersonA: document.getElementById('btnPersonA'),
            btnPersonB: document.getElementById('btnPersonB'),
            activeMode: document.getElementById('activeMode'),
            connectionStatus: document.getElementById('connectionStatus'),
            settingsBtn: document.getElementById('settingsBtn'),
            settingsModal: document.getElementById('settingsModal'),
            closeSettings: document.getElementById('closeSettings'),
            azureKey: document.getElementById('azureKey'),
            azureKey2: document.getElementById('azureKey2'),
            azureRegion: document.getElementById('azureRegion'),
            autoDetectSilence: document.getElementById('autoDetectSilence'),
            saveSettings: document.getElementById('saveSettings'),
            testConnection: document.getElementById('testConnection'),
            settingsStatus: document.getElementById('settingsStatus'),
            toast: document.getElementById('toast')
        };
    }

    bindEvents() {
        // Language selectors
        this.dom.langA.addEventListener('change', () => this.updateFlag('A'));
        this.dom.langB.addEventListener('change', () => this.updateFlag('B'));
        this.dom.swapLangs.addEventListener('click', () => this.swapLanguages());

        // Device selectors
        this.dom.refreshDevices.addEventListener('click', async () => {
            await this.audioManager.refreshDevices();
            this.populateDeviceSelects();
            this.showToast('🔄 Cihazlar yenilendi');
        });

        this.dom.inputDevice.addEventListener('change', (e) => {
            this.audioManager.setSelectedInput(e.target.value);
        });

        this.dom.outputDevice.addEventListener('change', (e) => {
            this.audioManager.setSelectedOutput(e.target.value);
        });

        // Talk buttons
        this.dom.btnPersonA.addEventListener('click', () => this.toggleMode('A'));
        this.dom.btnPersonB.addEventListener('click', () => this.toggleMode('B'));

        // Transcript
        this.dom.clearTranscript.addEventListener('click', () => this.clearTranscript());

        // Settings
        this.dom.settingsBtn.addEventListener('click', () => this.openSettings());
        this.dom.closeSettings.addEventListener('click', () => this.closeSettings());
        this.dom.settingsModal.addEventListener('click', (e) => {
            if (e.target === this.dom.settingsModal) this.closeSettings();
        });
        this.dom.saveSettings.addEventListener('click', () => this.saveSettings());
        this.dom.testConnection.addEventListener('click', () => this.testConnection());
    }

    // ===== LANGUAGE MANAGEMENT =====

    updateFlag(person) {
        const select = person === 'A' ? this.dom.langA : this.dom.langB;
        const flagEl = person === 'A' ? this.dom.flagA : this.dom.flagB;
        const option = select.options[select.selectedIndex];
        flagEl.textContent = option.dataset.flag || '🌐';
    }

    swapLanguages() {
        const tempVal = this.dom.langA.value;
        const tempFlag = this.dom.flagA.textContent;

        this.dom.langA.value = this.dom.langB.value;
        this.dom.langB.value = tempVal;

        this.dom.flagA.textContent = this.dom.flagB.textContent;
        this.dom.flagB.textContent = tempFlag;

        // If currently listening, restart with new languages
        if (this.activeMode) {
            const mode = this.activeMode;
            this.stopListening().then(() => this.startListening(mode));
        }
    }

    // ===== DEVICE MANAGEMENT =====

    populateDeviceSelects() {
        const { inputs, outputs } = this.audioManager.devices;

        // Input devices
        this.dom.inputDevice.innerHTML = '';
        inputs.forEach(device => {
            const opt = document.createElement('option');
            opt.value = device.id;
            opt.textContent = (device.isBluetooth ? '🎧 ' : '📱 ') + device.label;
            this.dom.inputDevice.appendChild(opt);
        });

        // Output devices
        this.dom.outputDevice.innerHTML = '';
        outputs.forEach(device => {
            const opt = document.createElement('option');
            opt.value = device.id;
            opt.textContent = (device.isBluetooth ? '🎧 ' : '🔊 ') + device.label;
            this.dom.outputDevice.appendChild(opt);
        });
    }

    // ===== TRANSLATION MODE =====

    async toggleMode(person) {
        if (this.activeMode === person) {
            // Stop current mode
            await this.stopListening();
        } else {
            // Stop other mode if active, then start this one
            if (this.activeMode) {
                await this.stopListening();
            }
            await this.startListening(person);
        }
    }

    async startListening(person) {
        if (!this.speechService.isConfigured()) {
            this.showToast('⚙️ Önce API anahtarı ayarlayın', 3000);
            this.openSettings();
            return;
        }

        let sourceLang, targetLang, micDeviceId;

        if (person === 'A') {
            // Person A speaks into phone mic → translate to Person B's language
            sourceLang = this.dom.langA.value;
            targetLang = this.dom.langB.value;
            // Use phone mic (or selected input if no BT distinction needed)
            const phoneMic = this.audioManager.getPhoneInput();
            micDeviceId = phoneMic ? phoneMic.id : 'default';
        } else {
            // Person B speaks into BT mic → translate to Person A's language
            sourceLang = this.dom.langB.value;
            targetLang = this.dom.langA.value;
            // Use bluetooth mic if available, otherwise selected input
            const btMic = this.audioManager.getBluetoothInput();
            micDeviceId = btMic ? btMic.id : this.dom.inputDevice.value;
        }

        if (sourceLang === targetLang) {
            this.showToast('⚠️ Kaynak ve hedef dil aynı olamaz', 3000);
            return;
        }

        try {
            this.showToast(person === 'A' ? '📱 Kişi A dinleniyor...' : '🎧 Kişi B dinleniyor...');

            await this.speechService.startTranslation(sourceLang, targetLang, micDeviceId);

            this.activeMode = person;
            this.updateButtonStates();
            this.updateModeIndicator();

        } catch (err) {
            this.showToast('❌ ' + err.message, 4000);
            console.error('[CrossLang] Start error:', err);
        }
    }

    async stopListening() {
        await this.speechService.stopTranslation();
        this.activeMode = null;
        this.hideInterim();
        this.updateButtonStates();
        this.updateModeIndicator();
    }

    // ===== TTS OUTPUT =====

    async speakTranslation(text, targetLang) {
        if (!text || this.isProcessing) return;
        this.isProcessing = true;

        try {
            // Determine output device based on active mode
            let outputDeviceId;
            if (this.activeMode === 'A') {
                // Person A spoke → output to BT (Person B hears)
                const btOut = this.audioManager.getBluetoothOutput();
                outputDeviceId = btOut ? btOut.id : 'default';
            } else {
                // Person B spoke → output to phone speaker (Person A hears)
                const phoneOut = this.audioManager.getPhoneOutput();
                outputDeviceId = phoneOut ? phoneOut.id : 'default';
            }

            const audioData = await this.speechService.synthesizeSpeech(text, targetLang);
            if (audioData) {
                await this.audioManager.playAudioOnDevice(audioData, outputDeviceId);
            }
        } catch (err) {
            console.error('[CrossLang] TTS error:', err);
        } finally {
            this.isProcessing = false;
        }
    }

    // ===== UI UPDATES =====

    updateButtonStates() {
        this.dom.btnPersonA.classList.toggle('active', this.activeMode === 'A');
        this.dom.btnPersonB.classList.toggle('active', this.activeMode === 'B');
    }

    updateModeIndicator() {
        if (!this.activeMode) {
            this.dom.activeMode.textContent = '⏸️ Hazır';
        } else if (this.activeMode === 'A') {
            this.dom.activeMode.textContent = '📱 → 🎧';
        } else {
            this.dom.activeMode.textContent = '🎧 → 📱';
        }
    }

    updateConnectionStatus(status) {
        const el = this.dom.connectionStatus;
        el.className = 'status-dot';

        switch (status) {
            case 'listening':
            case 'ready':
            case 'online':
                el.classList.add('online');
                break;
            case 'connecting':
            case 'speaking':
                el.classList.add('connecting');
                break;
            default:
                el.classList.add('offline');
        }
    }

    showInterim(original, translated) {
        this.dom.interimText.style.display = 'flex';
        this.dom.interimContent.textContent = original + (translated ? ' → ' + translated : '');
    }

    hideInterim() {
        this.dom.interimText.style.display = 'none';
        this.dom.interimContent.textContent = '';
    }

    addMessage(person, original, translated, srcLang, tgtLang) {
        // Remove welcome message if present
        const welcome = this.dom.transcript.querySelector('.welcome-msg');
        if (welcome) welcome.remove();

        const srcFlag = this.getFlagForLang(srcLang);
        const tgtFlag = this.getFlagForLang(tgtLang);

        const msgEl = document.createElement('div');
        msgEl.className = `msg person-${person.toLowerCase()}`;
        msgEl.innerHTML = `
            <span class="msg-sender">${person === 'A' ? '📱 Kişi A' : '🎧 Kişi B'} ${srcFlag}</span>
            <span class="msg-original">${this.escapeHtml(original)}</span>
            <span class="msg-translated">${tgtFlag} ${this.escapeHtml(translated)}</span>
        `;

        this.dom.transcript.appendChild(msgEl);
        this.dom.transcript.scrollTop = this.dom.transcript.scrollHeight;
    }

    clearTranscript() {
        this.dom.transcript.innerHTML = `
            <div class="welcome-msg">
                <span class="welcome-icon">👋</span>
                <p>Konuşmak için aşağıdaki butonlara basın</p>
                <p class="welcome-sub">Kişi A telefon mikrofonu kullanır, Kişi B bluetooth kulaklık kullanır</p>
            </div>
        `;
    }

    getFlagForLang(langCode) {
        const flags = {
            'en-US': '🇺🇸', 'tr-TR': '🇹🇷', 'it-IT': '🇮🇹', 'ko-KR': '🇰🇷', 'ja-JP': '🇯🇵'
        };
        return flags[langCode] || '🌐';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ===== SETTINGS =====

    openSettings() {
        this.dom.settingsModal.style.display = 'flex';
        this.dom.settingsStatus.textContent = '';
    }

    closeSettings() {
        this.dom.settingsModal.style.display = 'none';
    }

    saveSettings() {
        const key = this.dom.azureKey.value.trim();
        const key2 = this.dom.azureKey2.value.trim();
        const region = this.dom.azureRegion.value;

        if (!key) {
            this.dom.settingsStatus.textContent = '❌ API anahtarı gerekli';
            this.dom.settingsStatus.className = 'settings-status error';
            return;
        }

        // Save to localStorage
        localStorage.setItem('crosslang_key', key);
        localStorage.setItem('crosslang_key2', key2);
        localStorage.setItem('crosslang_region', region);
        localStorage.setItem('crosslang_autoSilence',
            this.dom.autoDetectSilence.checked ? 'true' : 'false');

        // Configure speech service
        this.speechService.configure(key, region, key2);

        this.dom.settingsStatus.textContent = '✅ Ayarlar kaydedildi';
        this.dom.settingsStatus.className = 'settings-status success';
        this.updateConnectionStatus('ready');
        this.showToast('✅ Ayarlar kaydedildi');

        setTimeout(() => this.closeSettings(), 1000);
    }

    loadSettings() {
        const key = localStorage.getItem('crosslang_key') || '';
        const key2 = localStorage.getItem('crosslang_key2') || '';
        const region = localStorage.getItem('crosslang_region') || 'westeurope';
        const autoSilence = localStorage.getItem('crosslang_autoSilence') !== 'false';

        this.dom.azureKey.value = key;
        this.dom.azureKey2.value = key2;
        this.dom.azureRegion.value = region;
        this.dom.autoDetectSilence.checked = autoSilence;

        if (key) {
            this.speechService.configure(key, region, key2);
        }
    }

    async testConnection() {
        const key = this.dom.azureKey.value.trim();
        const region = this.dom.azureRegion.value;

        if (!key) {
            this.dom.settingsStatus.textContent = '❌ API anahtarı girin';
            this.dom.settingsStatus.className = 'settings-status error';
            return;
        }

        this.dom.settingsStatus.textContent = '🔄 Test ediliyor...';
        this.dom.settingsStatus.className = 'settings-status';
        this.dom.testConnection.disabled = true;

        // Temporarily configure with entered values
        this.speechService.configure(key, region, this.dom.azureKey2.value.trim());

        try {
            await this.speechService.testConnection();
            this.dom.settingsStatus.textContent = '✅ Bağlantı başarılı!';
            this.dom.settingsStatus.className = 'settings-status success';
        } catch (err) {
            this.dom.settingsStatus.textContent = '❌ ' + err.message;
            this.dom.settingsStatus.className = 'settings-status error';
        } finally {
            this.dom.testConnection.disabled = false;
        }
    }

    // ===== TOAST =====

    showToast(message, duration = 2500) {
        this.dom.toast.textContent = message;
        this.dom.toast.style.display = 'block';

        clearTimeout(this._toastTimeout);
        this._toastTimeout = setTimeout(() => {
            this.dom.toast.style.display = 'none';
        }, duration);
    }
}

// ===== INITIALIZE =====
document.addEventListener('DOMContentLoaded', () => {
    window.app = new CrossLangApp();
    window.app.init();
});
