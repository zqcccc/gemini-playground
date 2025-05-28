import { Logger } from '../utils/logger.js';
import { ApplicationError, ErrorCodes } from '../utils/error-boundary.js';
import { CONFIG } from '../config/config.js';

/**
 * @class AudioRecorder
 * @description Handles audio recording functionality with configurable sample rate
 * and real-time audio processing through WebAudio API.
 */
export class AudioRecorder {
    /**
     * @constructor
     * @param {number} sampleRate - The sample rate for audio recording (default: 16000)
     */
    constructor(sampleRate = CONFIG.AUDIO.SAMPLE_RATE) {
        this.sampleRate = sampleRate;
        this.stream = null;
        this.mediaRecorder = null;
        this.audioContext = null;
        this.source = null;
        this.processor = null;
        this.onAudioData = null;
        this.gainNode = null;
        this.volume = 1.0;
        
        // Bind methods to preserve context
        this.start = this.start.bind(this);
        this.stop = this.stop.bind(this);

        // Add state tracking
        this.isRecording = false;
    }

    /**
     * @method start
     * @description Starts audio recording with the specified callback for audio data.
     * @param {Function} onAudioData - Callback function for processed audio data.
     * @throws {Error} If unable to access microphone or set up audio processing.
     * @async
     */
    async start(onAudioData) {
        this.onAudioData = onAudioData;
        try {
            // Request microphone access
            this.stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    channelCount: 1,
                    sampleRate: this.sampleRate
                } 
            });
            
            this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
            this.source = this.audioContext.createMediaStreamSource(this.stream);

            // Load and initialize audio worklet
            await this.audioContext.audioWorklet.addModule('js/audio/worklets/audio-processing.js');
            this.processor = new AudioWorkletNode(this.audioContext, 'audio-recorder-worklet');
            
            // Handle processed audio data
            this.processor.port.onmessage = (event) => {
                if (event.data.event === 'chunk' && this.onAudioData && this.isRecording) {
                    const base64Data = this.arrayBufferToBase64(event.data.data.int16arrayBuffer);
                    this.onAudioData(base64Data);
                }
            };

            // Create gain node and set initial volume
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = this.volume;

            // Connect audio nodes
            this.source.connect(this.gainNode);
            this.gainNode.connect(this.processor);
            this.processor.connect(this.audioContext.destination);
            this.isRecording = true;
        } catch (error) {
            console.error('Error starting audio recording:', error);
            throw error;
        }
    }

    /**
     * @method stop
     * @description Stops the current recording session and cleans up resources.
     * @throws {ApplicationError} If an error occurs during stopping the recording.
     */
    stop() {
        try {
            if (!this.isRecording) {
                Logger.warn('Attempting to stop recording when not recording');
                return;
            }

            // Stop the microphone stream
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
                this.stream = null;
            }

            this.isRecording = false;
            Logger.info('Audio recording stopped successfully');
        } catch (error) {
            Logger.error('Error stopping audio recording', error);
            throw new ApplicationError(
                'Failed to stop audio recording',
                ErrorCodes.AUDIO_STOP_FAILED,
                { originalError: error }
            );
        }
    }

    /**
     * @method arrayBufferToBase64
     * @description Converts ArrayBuffer to Base64 string.
     * @param {ArrayBuffer} buffer - The ArrayBuffer to convert.
     * @returns {string} The Base64 representation of the ArrayBuffer.
     * @throws {ApplicationError} If an error occurs during conversion.
     * @private
     */
    arrayBufferToBase64(buffer) {
        try {
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return btoa(binary);
        } catch (error) {
            Logger.error('Error converting buffer to base64', error);
            throw new ApplicationError(
                'Failed to convert audio data',
                ErrorCodes.AUDIO_CONVERSION_FAILED,
                { originalError: error }
            );
        }
    }

    /**
     * @method checkBrowserSupport
     * @description Checks if the browser supports required audio APIs.
     * @throws {ApplicationError} If the browser does not support audio recording.
     * @private
     */
    checkBrowserSupport() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new ApplicationError(
                'Audio recording is not supported in this browser',
                ErrorCodes.AUDIO_NOT_SUPPORTED
            );
        }
    }

    /**
     * @method setVolume
     * @description Sets the recording volume level
     * @param {number} volume - Volume level between 0 (mute) and 1 (max)
     */
    setVolume(volume) {
        if (this.gainNode) {
            // Ensure volume is clamped between 0 and 1
            const clampedVolume = Math.max(0, Math.min(1, volume));
            this.gainNode.gain.value = clampedVolume;
            
            // When volume is 0, disconnect the source to prevent any audio passing through
            if (clampedVolume === 0) {
                this.source.disconnect(this.gainNode);
            } else if (!this.source.isConnected) {
                // Reconnect if volume is restored
                this.source.connect(this.gainNode);
            }
        }
    }
}
