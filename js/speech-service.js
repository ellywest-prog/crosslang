/* =============================================
   SpeechService - Azure Speech SDK Wrapper
   Handles: Speech Recognition, Translation, TTS
   ============================================= */

class SpeechService {
    constructor() {
        this.apiKey = '';
        this.apiKey2 = '';
        this.region = 'westeurope'; // Sabit bölge
        this.recognizer = null;
        this.synthesizer = null;
        this.isListening = false;
        this.isSpeaking = false;

        // Callbacks
        this.onRecognizing = null;  // Interim results
        this.onRecognized = null;   // Final results with translation
        this.onError = null;
        this.onStatusChange = null;

        // Azure TTS voice map
        this.voiceMap = {
            'en': 'en-US-JennyNeural',
            'tr': 'tr-TR-EmelNeural',
            'it': 'it-IT-ElsaNeural',
            'ko': 'ko-KR-SunHiNeural',
            'ja': 'ja-JP-NanamiNeural'
        };

        // Language code mapping (full -> short for translation target)
        this.langShortMap = {
            'en-US': 'en',
            'tr-TR': 'tr',
            'it-IT': 'it',
            'ko-KR': 'ko',
            'ja-JP': 'ja'
        };
    }

    configure(apiKey, region, apiKey2 = '') {
        this.apiKey = apiKey;
        this.region = region;
        this.apiKey2 = apiKey2;
    }

    isConfigured() {
        return this.apiKey && this.region;
    }

    /**
     * Test connection to Azure Speech Service
     */
    async testConnection() {
        if (!this.isConfigured()) {
            throw new Error('API anahtarı ve bölge gerekli');
        }

        return new Promise((resolve, reject) => {
            try {
                const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(this.apiKey, this.region);
                speechConfig.speechRecognitionLanguage = 'en-US';

                const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
                const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

                // Just try to create the connection, then close
                recognizer.recognizeOnceAsync(
                    result => {
                        recognizer.close();
                        if (result.reason === SpeechSDK.ResultReason.NoMatch ||
                            result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
                            resolve(true);
                        } else {
                            resolve(true); // Connection works even if no speech detected
                        }
                    },
                    error => {
                        recognizer.close();
                        // Check if it's an auth error
                        if (error.toString().includes('401') || error.toString().includes('Unauthorized')) {
                            reject(new Error('API anahtarı geçersiz veya bölge yanlış'));
                        } else {
                            // Other errors might still mean connection works
                            reject(new Error('Bağlantı hatası: ' + error));
                        }
                    }
                );

                // Timeout after 8 seconds
                setTimeout(() => {
                    try { recognizer.close(); } catch(e) {}
                    resolve(true); // If no error in 8s, connection likely works
                }, 8000);
            } catch (err) {
                reject(new Error('SDK hatası: ' + err.message));
            }
        });
    }

    /**
     * Start continuous translation recognition
     * @param {string} sourceLang - Source language (e.g., 'en-US')
     * @param {string} targetLang - Target language (e.g., 'tr-TR')
     * @param {string} micDeviceId - Microphone device ID
     */
    async startTranslation(sourceLang, targetLang, micDeviceId) {
        if (this.isListening) {
            await this.stopTranslation();
        }

        if (!this.isConfigured()) {
            throw new Error('Azure Speech API yapılandırılmamış. Ayarlardan API anahtarı girin.');
        }

        const targetShort = this.langShortMap[targetLang] || targetLang.split('-')[0];
        const sourceShort = this.langShortMap[sourceLang] || sourceLang.split('-')[0];

        try {
            // Create translation config
            const translationConfig = SpeechSDK.SpeechTranslationConfig.fromSubscription(
                this.apiKey, this.region
            );
            translationConfig.speechRecognitionLanguage = sourceLang;
            translationConfig.addTargetLanguage(targetShort);

            // Set profanity to raw (don't censor)
            translationConfig.setProfanity(SpeechSDK.ProfanityOption.Raw);

            // Audio config with specific mic
            let audioConfig;
            if (micDeviceId && micDeviceId !== 'default') {
                audioConfig = SpeechSDK.AudioConfig.fromMicrophoneInput(micDeviceId);
            } else {
                audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
            }

            // Create recognizer
            this.recognizer = new SpeechSDK.TranslationRecognizer(translationConfig, audioConfig);

            // Event: Recognizing (interim results)
            this.recognizer.recognizing = (sender, event) => {
                if (event.result.reason === SpeechSDK.ResultReason.TranslatingSpeech) {
                    const original = event.result.text;
                    const translated = event.result.translations.get(targetShort);
                    if (this.onRecognizing) {
                        this.onRecognizing(original, translated, sourceLang, targetLang);
                    }
                }
            };

            // Event: Recognized (final results)
            this.recognizer.recognized = (sender, event) => {
                if (event.result.reason === SpeechSDK.ResultReason.TranslatedSpeech) {
                    const original = event.result.text;
                    const translated = event.result.translations.get(targetShort);
                    if (original && translated && this.onRecognized) {
                        this.onRecognized(original, translated, sourceLang, targetLang);
                    }
                } else if (event.result.reason === SpeechSDK.ResultReason.NoMatch) {
                    console.log('[SpeechService] No speech detected');
                }
            };

            // Event: Canceled
            this.recognizer.canceled = (sender, event) => {
                console.error('[SpeechService] Canceled:', event.reason, event.errorDetails);
                if (event.reason === SpeechSDK.CancellationReason.Error) {
                    const errorMsg = event.errorDetails || 'Bilinmeyen hata';
                    if (this.onError) {
                        this.onError(errorMsg);
                    }
                    // Try backup key
                    if (this.apiKey2 && this.apiKey === this._currentKey) {
                        console.log('[SpeechService] Trying backup key...');
                        this.apiKey = this.apiKey2;
                        this.startTranslation(sourceLang, targetLang, micDeviceId);
                    }
                }
            };

            // Event: Session stopped
            this.recognizer.sessionStopped = (sender, event) => {
                console.log('[SpeechService] Session stopped');
                this.isListening = false;
                if (this.onStatusChange) this.onStatusChange('stopped');
            };

            // Start continuous recognition
            this._currentKey = this.apiKey;
            await new Promise((resolve, reject) => {
                this.recognizer.startContinuousRecognitionAsync(
                    () => {
                        this.isListening = true;
                        if (this.onStatusChange) this.onStatusChange('listening');
                        console.log('[SpeechService] Translation started:', sourceLang, '→', targetShort);
                        resolve();
                    },
                    error => {
                        console.error('[SpeechService] Start failed:', error);
                        reject(new Error('Dinleme başlatılamadı: ' + error));
                    }
                );
            });

        } catch (err) {
            console.error('[SpeechService] Translation start error:', err);
            throw err;
        }
    }

    /**
     * Stop translation recognition
     */
    async stopTranslation() {
        if (!this.recognizer) return;

        return new Promise((resolve) => {
            this.recognizer.stopContinuousRecognitionAsync(
                () => {
                    this.isListening = false;
                    if (this.onStatusChange) this.onStatusChange('stopped');
                    try { this.recognizer.close(); } catch(e) {}
                    this.recognizer = null;
                    console.log('[SpeechService] Translation stopped');
                    resolve();
                },
                (error) => {
                    console.warn('[SpeechService] Stop error:', error);
                    this.isListening = false;
                    this.recognizer = null;
                    resolve();
                }
            );
        });
    }

    /**
     * Synthesize speech from text
     * @param {string} text - Text to speak
     * @param {string} targetLang - Target language code (e.g., 'tr-TR')
     * @returns {Promise<ArrayBuffer>} Audio data
     */
    async synthesizeSpeech(text, targetLang) {
        if (!text || !this.isConfigured()) return null;

        const langShort = this.langShortMap[targetLang] || targetLang.split('-')[0];
        const voiceName = this.voiceMap[langShort] || 'en-US-JennyNeural';

        return new Promise((resolve, reject) => {
            try {
                const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(this.apiKey, this.region);
                speechConfig.speechSynthesisVoiceName = voiceName;

                // Use null audio config to get raw audio data (don't auto-play)
                const synthesizer = new SpeechSDK.SpeechSynthesizer(speechConfig, null);

                this.isSpeaking = true;
                if (this.onStatusChange) this.onStatusChange('speaking');

                synthesizer.speakTextAsync(
                    text,
                    result => {
                        this.isSpeaking = false;
                        if (this.onStatusChange) this.onStatusChange(this.isListening ? 'listening' : 'stopped');
                        synthesizer.close();

                        if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                            resolve(result.audioData);
                        } else {
                            console.error('[SpeechService] TTS failed:', result.errorDetails);
                            reject(new Error('Ses sentezi başarısız'));
                        }
                    },
                    error => {
                        this.isSpeaking = false;
                        synthesizer.close();
                        console.error('[SpeechService] TTS error:', error);
                        reject(new Error('TTS hatası: ' + error));
                    }
                );
            } catch (err) {
                this.isSpeaking = false;
                reject(err);
            }
        });
    }

    /**
     * Get the display name for a voice
     */
    getVoiceName(langCode) {
        const short = this.langShortMap[langCode] || langCode;
        return this.voiceMap[short] || 'Unknown';
    }

    /**
     * Cleanup resources
     */
    destroy() {
        this.stopTranslation();
        this.isListening = false;
        this.isSpeaking = false;
    }
}

// Export as global
window.SpeechService = SpeechService;
