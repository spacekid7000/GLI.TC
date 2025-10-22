document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const fileInput = document.getElementById('audio-file');
    const fileNameDisplay = document.getElementById('file-name-display');
    const generateBtn = document.getElementById('generateBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const loopBtn = document.getElementById('loopBtn');
    const kitContainer = document.getElementById('kit-container');
    const statusText = document.getElementById('status-text');
    const progressBar = document.getElementById('progress-bar');
    const progressFill = document.getElementById('progress-fill');

    // Control Sliders
    const thresholdSlider = document.getElementById('threshold-slider');
    const thresholdValue = document.getElementById('threshold-value');
    const attackSlider = document.getElementById('attack-slider');
    const attackValue = document.getElementById('attack-value');
    const lengthSlider = document.getElementById('length-slider');
    const lengthValue = document.getElementById('length-value');
    const pitchSlider = document.getElementById('pitch-slider');
    const pitchValue = document.getElementById('pitch-value');

    // --- Web Audio API ---
    let audioContext;
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        alert('Web Audio API is not supported in this browser');
    }

    // --- State ---
    let sourceBuffer = null;
    let generatedKit = [];
    let isLooping = false;
    let loopInterval;

    // --- Constants ---
    const KIT_SIZE = 8;
    const LOOP_SPEED_MS = 250;

    // --- Initial UI setup ---
    const setupInitialValues = () => {
        thresholdValue.textContent = parseFloat(thresholdSlider.value).toFixed(2);
        attackValue.textContent = `${parseFloat(attackSlider.value).toFixed(3)} s`;
        lengthValue.textContent = `${parseFloat(lengthSlider.value).toFixed(2)} s`;
        pitchValue.textContent = pitchSlider.value;
    };
    setupInitialValues();

    // --- File Handling ---
    fileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        fileNameDisplay.textContent = file.name;
        updateStatus('Loading audio file...', true, 0);

        try {
            const arrayBuffer = await file.arrayBuffer();
            sourceBuffer = await audioContext.decodeAudioData(arrayBuffer);
            updateStatus('Audio loaded. Ready to generate.', false);
            generateBtn.disabled = false;
            downloadBtn.disabled = true;
            generateKit();
        } catch (error) {
            console.error('Error decoding audio file:', error);
            updateStatus('Error: Could not process audio file.', false);
            generateBtn.disabled = true;
        }
    });

    // --- Core Logic ---
    async function generateKit() {
        if (!sourceBuffer) {
            alert('Please upload an audio file first.');
            return;
        }

        updateStatus('Generating kit...', true, 0);
        generateBtn.disabled = true;
        downloadBtn.disabled = true;
        generatedKit = [];

        // Get current values from controls
        const threshold = parseFloat(thresholdSlider.value);
        const attack = parseFloat(attackSlider.value);
        const maxLength = parseFloat(lengthSlider.value);
        const pitchVariation = parseInt(pitchSlider.value, 10);
        
        const transients = detectTransients(sourceBuffer, threshold);

        for (let i = 0; i < KIT_SIZE; i++) {
            updateStatus(`Generating shot ${i + 1}/${KIT_SIZE}...`, true, ((i + 1) / KIT_SIZE) * 100);

            const useTransient = Math.random() > 0.3 && transients.length > 0;
            const startSample = useTransient
                ? transients[Math.floor(Math.random() * transients.length)]
                : Math.random() * (sourceBuffer.length - 22050);

            const lengthInSeconds = 0.02 + Math.random() * (maxLength - 0.02);
            const lengthInSamples = Math.floor(lengthInSeconds * sourceBuffer.sampleRate);

            if (startSample + lengthInSamples > sourceBuffer.length) continue;

            const slice = audioContext.createBuffer(
                sourceBuffer.numberOfChannels,
                lengthInSamples,
                sourceBuffer.sampleRate
            );

            for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel++) {
                slice.getChannelData(channel).set(sourceBuffer.getChannelData(channel).subarray(startSample, startSample + lengthInSamples));
            }
            
            const processedBuffer = await applyEnvelopesAndPitch(slice, attack, pitchVariation);
            generatedKit.push({ id: i, buffer: processedBuffer });
        }

        renderKit();
        updateStatus(`Generated ${generatedKit.length} shots.`, false);
        generateBtn.disabled = false;
        downloadBtn.disabled = false;
    }

    function detectTransients(buffer, thresholdRatio) {
        const data = buffer.getChannelData(0);
        const transients = [];
        const chunkSize = 512;
        let maxEnergy = 0;
        const energies = [];

        for (let i = 0; i < data.length; i += chunkSize) {
            let energy = 0;
            for (let j = 0; j < chunkSize && i + j < data.length; j++) {
                energy += data[i + j] ** 2;
            }
            energies.push(energy);
            if (energy > maxEnergy) maxEnergy = energy;
        }

        const threshold = maxEnergy * thresholdRatio;

        for (let i = 1; i < energies.length; i++) {
            if (energies[i] > threshold && energies[i - 1] <= threshold) {
                transients.push(i * chunkSize);
            }
        }
        return transients;
    }

    async function applyEnvelopesAndPitch(buffer, attack, pitchVariation) {
        // --- Pitch Shift ---
        const randomSemitones = (Math.random() * 2 - 1) * pitchVariation;
        const playbackRate = Math.pow(2, randomSemitones / 12);
        
        // Adjust context length for pitched audio
        const newLength = Math.floor(buffer.length / playbackRate);
        const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, newLength, buffer.sampleRate);

        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = playbackRate;

        // --- Volume Envelope ---
        const gainNode = offlineCtx.createGain();
        const now = offlineCtx.currentTime;
        const duration = buffer.duration / playbackRate; // Duration is affected by playback rate
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(1, now + attack);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

        // --- Low-pass Filter Envelope ---
        const filterNode = offlineCtx.createBiquadFilter();
        filterNode.type = 'lowpass';
        const startFreq = 2000 + Math.random() * 10000;
        const endFreq = 100 + Math.random() * 400;
        filterNode.frequency.setValueAtTime(startFreq, now);
        filterNode.frequency.exponentialRampToValueAtTime(endFreq, now + duration * (0.5 + Math.random() * 0.5));

        source.connect(filterNode);
        filterNode.connect(gainNode);
        gainNode.connect(offlineCtx.destination);

        source.start(0);
        return await offlineCtx.startRendering();
    }


    // --- UI & Playback ---
    function renderKit() {
        kitContainer.innerHTML = '';
        generatedKit.forEach((shot, index) => {
            const waveformContainer = document.createElement('div');
            waveformContainer.className = 'waveform-container';
            waveformContainer.innerHTML = `
                <div class="waveform-header">
                    <h3>SHOT ${index + 1}</h3>
                    <button class="play-button" data-id="${shot.id}"></button>
                </div>
                <div class="canvas-wrapper">
                    <canvas id="canvas-${shot.id}"></canvas>
                </div>
            `;
            kitContainer.appendChild(waveformContainer);
            drawWaveform(shot.buffer, document.getElementById(`canvas-${shot.id}`));
        });
    }

    function drawWaveform(buffer, canvas) {
        const ctx = canvas.getContext('2d');
        const data = buffer.getChannelData(0);
        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);

        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(160, 160, 160, 0.7)';
        ctx.beginPath();

        const sliceWidth = width / data.length;
        for (let i = 0; i < data.length; i++) {
            const y = ((data[i] + 1) / 2) * height;
            if (i === 0) ctx.moveTo(i * sliceWidth, y);
            else ctx.lineTo(i * sliceWidth, y);
        }
        ctx.stroke();
    }

    function playSound(buffer) {
        if (!audioContext || !buffer) return;
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.start(0);
    }

    // --- Event Listeners ---
    generateBtn.addEventListener('click', generateKit);

    thresholdSlider.addEventListener('input', () => { thresholdValue.textContent = parseFloat(thresholdSlider.value).toFixed(2); });
    attackSlider.addEventListener('input', () => { attackValue.textContent = `${parseFloat(attackSlider.value).toFixed(3)} s`; });
    lengthSlider.addEventListener('input', () => { lengthValue.textContent = `${parseFloat(lengthSlider.value).toFixed(2)} s`; });
    pitchSlider.addEventListener('input', () => { pitchValue.textContent = pitchSlider.value; });

    kitContainer.addEventListener('click', (event) => {
        if (event.target.classList.contains('play-button')) {
            playSound(generatedKit.find(s => s.id === parseInt(event.target.dataset.id, 10))?.buffer);
        }
    });

    loopBtn.addEventListener('click', () => {
        isLooping = !isLooping;
        loopBtn.classList.toggle('active', isLooping);

        if (isLooping && generatedKit.length > 0) {
            let currentIndex = 0;
            loopInterval = setInterval(() => {
                document.querySelectorAll('.play-button').forEach(btn => btn.classList.remove('playing'));
                const currentShot = generatedKit[currentIndex];
                playSound(currentShot.buffer);
                const currentBtn = document.querySelector(`.play-button[data-id='${currentShot.id}']`);
                if (currentBtn) currentBtn.classList.add('playing');
                currentIndex = (currentIndex + 1) % generatedKit.length;
            }, LOOP_SPEED_MS);
        } else {
            clearInterval(loopInterval);
            document.querySelectorAll('.play-button').forEach(btn => btn.classList.remove('playing'));
        }
    });

    downloadBtn.addEventListener('click', async () => {
        if (generatedKit.length === 0) return;
        updateStatus('Preparing ZIP file...', true, 0);
        const zip = new JSZip();

        for (let i = 0; i < generatedKit.length; i++) {
            const shot = generatedKit[i];
            const wavBlob = bufferToWav(shot.buffer);
            zip.file(`glitch_shot_${String(i + 1).padStart(2, '0')}.wav`, wavBlob);
            updateStatus(`Zipping file ${i + 1}/${generatedKit.length}`, true, ((i + 1) / generatedKit.length) * 100);
        }

        const content = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = 'glitch_kit.zip';
        link.click();
        link.remove();
        updateStatus('Download complete.', false);
    });

    // --- Utility Functions ---
    function updateStatus(message, isLoading, progress) {
        statusText.textContent = message;
        progressBar.style.display = isLoading ? 'block' : 'none';
        if (isLoading) {
            progressFill.style.width = `${progress}%`;
            statusText.classList.add('loading');
        } else {
            statusText.classList.remove('loading');
        }
    }

    // --- WAV Conversion ---
    function bufferToWav(buffer) {
        const numOfChan = buffer.numberOfChannels;
        const length = buffer.length * numOfChan * 2 + 44;
        const bufferOut = new ArrayBuffer(length);
        const view = new DataView(bufferOut);
        const channels = Array.from({ length: numOfChan }, (_, i) => buffer.getChannelData(i));
        let pos = 0;

        const setUint16 = data => { view.setUint16(pos, data, true); pos += 2; };
        const setUint32 = data => { view.setUint32(pos, data, true); pos += 4; };

        setUint32(0x46464952); // RIFF
        setUint32(length - 8);
        setUint32(0x45564157); // WAVE
        setUint32(0x20746d66); // fmt
        setUint32(16);
        setUint16(1);
        setUint16(numOfChan);
        setUint32(buffer.sampleRate);
        setUint32(buffer.sampleRate * 2 * numOfChan);
        setUint16(numOfChan * 2);
        setUint16(16);
        setUint32(0x61746164); // data
        setUint32(length - pos - 4);

        for (let i = 0; i < buffer.length; i++) {
            for (let j = 0; j < numOfChan; j++) {
                let sample = Math.max(-1, Math.min(1, channels[j][i]));
                sample = sample < 0 ? sample * 32768 : sample * 32767;
                view.setInt16(pos, sample, true);
                pos += 2;
            }
        }
        return new Blob([view], { type: 'audio/wav' });
    }
});