const println = console.log;

println('--- local voice Extension loaded');


const MY_VOICE_BUTTON_ID = 'record_button'


const isChatGPT = 'chatgpt.com'  === window.location.hostname
const isCopilot = 'copilot.microsoft.com' === window.location.hostname

// Copilot selectors
const COPILOT_TARGET_CONTAINER_QUERY = 'button[data-testid="audio-call-button"]'
// const COPILOT_TARGET_CONTAINER_QUERY = 'button[data-testid="composer-chat-mode-smart-button"]'
const COPILOT_INPUT_SELECTOR1 = 'textarea#userInput'

// ChatGPT selectors
const CHATGPT_TARGET_CONTAINER_QUERY = '[data-testid="composer-speech-button-container"]'
const CHATGPT_INPUT_SELECTOR1 = 'textarea[name="prompt-textarea"]'
const CHATGPT_INPUT_SELECTOR2 = 'div#prompt-textarea p'


// const WHISPER_URL = `${window.location.protocol}//${window.location.hostname}:${Number(window.location.port)+1}`
const WHISPER_URL = 'http://localhost:16002'

const ID = (o) => document.querySelector(o)


let audioContext;
let mediaStream;
let mediaStreamSource;
let scriptProcessor;
let audioChunks = [];


// ##################  Audio helper functions

function mergeBuffers(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function resampleBuffer(buffer, originalRate, targetRate) {
  const ratio = originalRate / targetRate;
  const newLength = Math.round(buffer.length / ratio);
  const offlineCtx = new OfflineAudioContext(1, newLength, targetRate);
  const audioBuffer = offlineCtx.createBuffer(1, buffer.length, originalRate);
  audioBuffer.copyToChannel(buffer, 0);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start();
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM
  view.setUint16(20, 1, true);  // Linear PCM
  view.setUint16(22, 1, true);  // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);  // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  // Write PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}
// ##################


async function sendSpeechToText(wavBlob) {
  // Prepare form data
  const formData = new FormData();
  formData.append('file', wavBlob, 'recording.wav');
  formData.append('response_format', 'json');
  // formData.append('temperature', '0.0');
  // formData.append('temperature_inc', '0.2');

  // Send to API endpoint
  const postOptions = { method: 'POST', body: formData }
  let response = new Response('', { status: 500 })
  try {
    response = await fetch(`${WHISPER_URL}/inference`, postOptions)
  } catch (_) { }

  if (response.status !== 200) return "";

  const data = await response.json()
  console.log('Server response:', data);
  const rawText = data.text
  const cleanText = rawText.replaceAll("[BLANK_AUDIO]", "").trim()
  println('>> STT => ', cleanText)

  return cleanText
}


function set_prompt(prompt) {
  if (isChatGPT) {
    const textInput1 = ID(CHATGPT_INPUT_SELECTOR1)
    textInput1.value = prompt
    textInput1.rawText = prompt

    // Create and dispatch an event for svelte to enable the send button
    textInput1.dispatchEvent(new Event("input", { bubbles: true }));

    const textInput2 = ID(CHATGPT_INPUT_SELECTOR2)
    textInput2.innerText = prompt
  } else if (isCopilot) {
    const textInput3 = ID(COPILOT_INPUT_SELECTOR1)
    textInput3.value = prompt
    textInput3.rawText = prompt

    // Create and dispatch an event for svelte to enable the send button
    textInput3.dispatchEvent(new Event("input", { bubbles: true }));
  }
}


async function start_record() {
  println('--- Starting recording')
  audioChunks = [];
  audioContext = new AudioContext(); // default rate (e.g. 44.1kHz)
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaStreamSource = audioContext.createMediaStreamSource(mediaStream);

  scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
  mediaStreamSource.connect(scriptProcessor);
  scriptProcessor.connect(audioContext.destination);

  scriptProcessor.onaudioprocess = e => {
    const input = e.inputBuffer.getChannelData(0);
    audioChunks.push(new Float32Array(input));
  };

};

async function stop_record(recordBtn) {
  recordBtn.backgroundColor = 'blue'

  scriptProcessor.disconnect();
  mediaStreamSource.disconnect();
  mediaStream.getTracks().forEach(track => track.stop());

  // Merge chunks
  const fullBuffer = mergeBuffers(audioChunks);
  const resampled = await resampleBuffer(fullBuffer, audioContext.sampleRate, 16000);
  const wavBlob = encodeWAV(resampled, 16000);

  recordBtn.backgroundColor = 'blue'
  println('--- Stopped recording.  sending speech')

  const speechText = await sendSpeechToText(wavBlob);

  set_prompt(speechText);
};


const voiceOnClick = (evt) => {
  const recordBtn = ID('#record_button')
  if (recordBtn.getAttribute('recording') === 'off') {
    recordBtn.style.backgroundColor = 'red'
    recordBtn.setAttribute('recording', 'on')
    start_record();
  } else {
    stop_record(recordBtn);
    recordBtn.style.backgroundColor = 'green'
    recordBtn.setAttribute('recording', 'off')
  }
}


function addMyVoiceButton() {
  if (document.getElementById(MY_VOICE_BUTTON_ID)) return;

  const newBtn = document.createElement("button")
  newBtn.innerHTML = `<svg width="28" height="28" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-label="Microphone in circle">
  <!-- Circle background -->
  <circle cx="16" cy="16" r="14" fill="#F4F6F8" stroke="#2D3A45" stroke-width="2"/>

  <!-- Microphone capsule -->
  <rect x="12" y="8" width="8" height="12" rx="4" fill="#2D3A45"/>

  <!-- Microphone stem -->
  <rect x="15" y="20" width="2" height="4" fill="#2D3A45"/>

  <!-- Microphone base -->
  <path d="M11 25h10v2H11z" fill="#2D3A45"/>

  <!-- Sound pickup bracket (U-shape) -->
  <path d="M10 14c0 4 3 7 6 7s6-3 6-7" fill="none" stroke="#2D3A45" stroke-width="2" stroke-linecap="round"/>
</svg>`

  newBtn.style.cssText = 'width: 32px; height: 32px; border-radius: 50%; border-width: 2px'
  newBtn.style.backgroundColor = 'green'
  newBtn.setAttribute('recording', 'off')
  newBtn.id = MY_VOICE_BUTTON_ID

  newBtn.onclick = voiceOnClick

  if (isChatGPT) {
    const target = document.querySelector(CHATGPT_TARGET_CONTAINER_QUERY)
    if (target) {
      println('Found ChatGPT insert target');
      target.innerHTML = '';
      target.style.display = 'flex'
      target.appendChild(newBtn);
    }
  } else if(isCopilot) {
    const targetChild = document.querySelector(COPILOT_TARGET_CONTAINER_QUERY)
    const target2 = targetChild ? targetChild.parentNode : null
    if (target2) {
      println('Found Copilot insert target');
      target2.innerHTML = '';
      target2.style.display = 'flex'
      target2.appendChild(newBtn);
    }
  }
}


addMyVoiceButton();

// Optionally, observe DOM changes for dynamic content
const observer = new MutationObserver(() => {
  addMyVoiceButton();
});

observer.observe(document.body, { childList: true, subtree: true });
