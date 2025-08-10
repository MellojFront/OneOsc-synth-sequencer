import React, { useRef, useState, useEffect } from "react";

// MIDI note names and their frequencies
const NOTE_LIST = [
  "C3", "C#3", "D3", "D#3", "E3", "F3", "F#3", "G3", "G#3", "A3", "A#3", "B3",
  "C4", "C#4", "D4", "D#4", "E4", "F4", "F#4", "G4", "G#4", "A4", "A#4", "B4",
  "C5", "C#5", "D5", "D#5", "E5", "F5", "F#5", "G5"
];
const NOTE_FREQS = {
  "C3": 130.81, "C#3": 138.59, "D3": 146.83, "D#3": 155.56, "E3": 164.81, "F3": 174.61, "F#3": 185.00, "G3": 196.00, "G#3": 207.65, "A3": 220.00, "A#3": 233.08, "B3": 246.94,
  "C4": 261.63, "C#4": 277.18, "D4": 293.66, "D#4": 311.13, "E4": 329.63, "F4": 349.23, "F#4": 369.99, "G4": 392.00, "G#4": 415.30, "A4": 440.00, "A#4": 466.16, "B4": 493.88,
  "C5": 523.25, "C#5": 554.37, "D5": 587.33, "D#5": 622.25, "E5": 659.25, "F5": 698.46, "F#5": 739.99, "G5": 783.99
};

const DEFAULT_SEQ = [
  "E3", "E3", "G3", "A3",
  "B3", "B3", "A3", "G3",
  "E3", "E3", "G3", "A3",
  "B3", "A3", "G3", "E3"
];

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function Knob({ label, min, max, step, value, onChange, unit }) {
  return (
    <div className="knob">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="knob-input"
      />
      <div className="knob-value">{value}{unit}</div>
      <div className="knob-label">{label}</div>
    </div>
  );
}

function createImpulseResponse(ctx, duration = 2, decay = 2) {
  const rate = ctx.sampleRate;
  const length = rate * duration;
  const impulse = ctx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const channel = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

function ADSRGraph({ a, d, s, r }) {
  // Envelope times in seconds
  const totalTime = a + d + r + 0.5; // 0.5s sustain for visualization
  const width = 220, height = 80;
  const ax = (a / totalTime) * width;
  const dx = (d / totalTime) * width;
  const sx = width - ax - dx - (r / totalTime) * width;
  const rx = (r / totalTime) * width;

  // Points: [x, y] pairs
  const points = [
    [0, height], // Start
    [ax, 0], // Attack peak
    [ax + dx, height - s * height], // Decay to sustain
    [ax + dx + sx, height - s * height], // Sustain
    [width, height] // Release
  ];
  const path = `M${points[0][0]},${points[0][1]}
    L${points[1][0]},${points[1][1]}
    L${points[2][0]},${points[2][1]}
    L${points[3][0]},${points[3][1]}
    L${points[4][0]},${points[4][1]}`;

  return (
    <svg width={width} height={height} style={{ background: "#181c24", borderRadius: 8, boxShadow: "0 2px 8px #0003" }}>
      <polyline
        fill="none"
        stroke="#7fdfff"
        strokeWidth="3"
        points={points.map(p => p.join(",")).join(" ")}
      />
      <text x={5} y={15} fontSize="12" fill="#7fdfff">A</text>
      <text x={ax + 5} y={15} fontSize="12" fill="#7fdfff">D</text>
      <text x={ax + dx + 5} y={15} fontSize="12" fill="#7fdfff">S</text>
      <text x={width - 20} y={height - 5} fontSize="12" fill="#7fdfff">R</text>
    </svg>
  );
}

export default function App() {
  const [waveform, setWaveform] = useState("sine");
  const [steps, setSteps] = useState(DEFAULT_SEQ);
  const [bpm, setBpm] = useState(120);
  const [volume, setVolume] = useState(0.5);
  const [filter, setFilter] = useState(20000);
  const [adsr, setAdsr] = useState({ a: 0.01, d: 0.1, s: 0.7, r: 0.2 });
  const [playing, setPlaying] = useState(false);
  const [reverb, setReverb] = useState(0.01);
  const playingRef = useRef(false);
  const [currentStep, setCurrentStep] = useState(-1);

  // Audio nodes refs
  const audioCtxRef = useRef(null);
  const dryGainRef = useRef(null);
  const wetGainRef = useRef(null);
  const convolverRef = useRef(null);
  const stepTimerRef = useRef(null);

  // --- Real-time parameter update ---
  useEffect(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;

    // Create dry/wet gain nodes and convolver once
    if (!dryGainRef.current) {
      dryGainRef.current = ctx.createGain();
      dryGainRef.current.gain.value = 1 - reverb;
      dryGainRef.current.connect(ctx.destination);
    }
    if (!wetGainRef.current) {
      wetGainRef.current = ctx.createGain();
      wetGainRef.current.gain.value = reverb;
      wetGainRef.current.connect(ctx.destination);
    }
    if (!convolverRef.current) {
      const convolver = ctx.createConvolver();
      convolver.buffer = createImpulseResponse(ctx, 2, 2.5);
      convolver.connect(wetGainRef.current);
      convolverRef.current = convolver;
    }
  }, []);

  // Update dry/wet mix in real time
  useEffect(() => {
    if (dryGainRef.current) dryGainRef.current.gain.value = 1 - reverb;
    if (wetGainRef.current) wetGainRef.current.gain.value = reverb;
  }, [reverb]);

  // --- Real-time parameter update for filter, volume, waveform ---
  const lastGainRef = useRef(null);
  const lastOscRef = useRef(null);
  const lastFilterRef = useRef(null);

  useEffect(() => {
    if (lastOscRef.current) lastOscRef.current.type = waveform;
  }, [waveform]);
  useEffect(() => {
    if (lastFilterRef.current) lastFilterRef.current.frequency.value = filter;
  }, [filter]);
  useEffect(() => {
    if (lastGainRef.current) lastGainRef.current.gain.value = volume;
  }, [volume]);

  function playSequence() {
    if (playingRef.current) return;
    setPlaying(true);
    playingRef.current = true;
    setCurrentStep(-1);

    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    nextStep(0);
  }

  function stopSequence() {
    setPlaying(false);
    playingRef.current = false;
    setCurrentStep(-1);
    if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
    // Stop last oscillator
    if (lastOscRef.current) {
      lastOscRef.current.stop();
      lastOscRef.current.disconnect();
      lastOscRef.current = null;
    }
    if (lastGainRef.current) {
      lastGainRef.current.disconnect();
      lastGainRef.current = null;
    }
    if (lastFilterRef.current) {
      lastFilterRef.current.disconnect();
      lastFilterRef.current = null;
    }
  }

  function nextStep(idx) {
    setCurrentStep(idx);

    // Stop previous note
    if (lastOscRef.current) {
      lastOscRef.current.stop();
      lastOscRef.current.disconnect();
      lastOscRef.current = null;
    }
    if (lastGainRef.current) {
      lastGainRef.current.disconnect();
      lastGainRef.current = null;
    }
    if (lastFilterRef.current) {
      lastFilterRef.current.disconnect();
      lastFilterRef.current = null;
    }

    // Prepare next note
    const note = steps[idx];
    if (note && NOTE_FREQS[note]) {
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filterNode = ctx.createBiquadFilter();

      osc.type = waveform;
      osc.frequency.value = NOTE_FREQS[note];
      filterNode.type = "lowpass";
      filterNode.frequency.value = filter;
      gain.gain.value = volume;

      osc.connect(filterNode);
      filterNode.connect(gain);

      // Split to dry/wet
      gain.connect(dryGainRef.current);
      gain.connect(convolverRef.current);

      // ADSR envelope
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(volume, now + adsr.a); // Attack
      gain.gain.linearRampToValueAtTime(volume * adsr.s, now + adsr.a + adsr.d); // Decay/Sustain
      gain.gain.linearRampToValueAtTime(0, now + adsr.a + adsr.d + adsr.r); // Release

      osc.start(now);
      osc.stop(now + adsr.a + adsr.d + adsr.r);

      lastOscRef.current = osc;
      lastGainRef.current = gain;
      lastFilterRef.current = filterNode;
    }

    // Schedule next step
    const stepMs = (60 * 1000) / bpm / 4; // 1/16 note
    stepTimerRef.current = setTimeout(() => {
      if (playingRef.current) {
        nextStep((idx + 1) % steps.length);
      }
    }, stepMs);
  }

  function handleStepChange(idx, val) {
    const newSteps = [...steps];
    newSteps[idx] = val;
    setSteps(newSteps);
  }

  function handleAdsrChange(field, val) {
    setAdsr({ ...adsr, [field]: clamp(Number(val), 0, 2) });
    // Real-time ADSR update for next note
    if (lastGainRef.current && audioCtxRef.current) {
      const ctx = audioCtxRef.current;
      const now = ctx.currentTime;
      lastGainRef.current.gain.cancelScheduledValues(now);
      lastGainRef.current.gain.setValueAtTime(0, now);
      lastGainRef.current.gain.linearRampToValueAtTime(volume, now + adsr.a); // Attack
      lastGainRef.current.gain.linearRampToValueAtTime(volume * adsr.s, now + adsr.a + adsr.d); // Decay/Sustain
      lastGainRef.current.gain.linearRampToValueAtTime(0, now + adsr.a + adsr.d + adsr.r); // Release
    }
  }

  useEffect(() => {
    return () => stopSequence();
    // eslint-disable-next-line
  }, []);

  return (
    <div className="synth-bg">
      <h1 className="synth-title">Synth Sequencer</h1>
      <div className="synth-panels">
        <div className="synth-panel">
          <h2>Oscillator</h2>
          <div className="osc-row">
            <Knob
              label="Volume"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={setVolume}
            />
            <Knob
              label="Filter"
              min={20}
              max={20000}
              step={1}
              value={filter}
              onChange={setFilter}
              unit="Hz"
            />
            <Knob
              label="BPM"
              min={40}
              max={300}
              step={1}
              value={bpm}
              onChange={v => setBpm(clamp(v, 40, 300))}
            />
            <Knob
              label="Reverb"
              min={0}
              max={1}
              step={0.01}
              value={reverb}
              onChange={setReverb}
            />
          </div>
          <div className="osc-row">
            <label className="wave-label">
              <span>Waveform:</span>
              <select value={waveform} onChange={e => setWaveform(e.target.value)} className="wave-select">
                <option value="sine">Sine</option>
                <option value="sawtooth">Saw</option>
                <option value="triangle">Triangle</option>
              </select>
            </label>
          </div>
        </div>
        <div className="synth-panel">
          <h2>Envelope (ADSR)</h2>
          <ADSRGraph a={adsr.a} d={adsr.d} s={adsr.s} r={adsr.r} />
          <div className="adsr-row">
            <Knob
              label="Attack"
              min={0}
              max={2}
              step={0.01}
              value={adsr.a}
              onChange={v => handleAdsrChange("a", v)}
              unit="s"
            />
            <Knob
              label="Decay"
              min={0}
              max={2}
              step={0.01}
              value={adsr.d}
              onChange={v => handleAdsrChange("d", v)}
              unit="s"
            />
            <Knob
              label="Sustain"
              min={0}
              max={1}
              step={0.01}
              value={adsr.s}
              onChange={v => handleAdsrChange("s", v)}
            />
            <Knob
              label="Release"
              min={0}
              max={2}
              step={0.01}
              value={adsr.r}
              onChange={v => handleAdsrChange("r", v)}
              unit="s"
            />
          </div>
        </div>
        <div className="synth-panel">
          <h2>Sequencer</h2>
          <div className="seq-grid">
            {steps.map((step, idx) => (
              <select
                key={idx}
                value={step}
                onChange={e => handleStepChange(idx, e.target.value)}
                className={`seq-step ${playing && currentStep === idx ? "seq-active" : ""}`}
              >
                <option value="">--</option>
                {NOTE_LIST.map(note => (
                  <option key={note} value={note}>{note}</option>
                ))}
              </select>
            ))}
          </div>
          <button
            onClick={playing ? stopSequence : playSequence}
            className={`seq-btn ${playing ? "seq-stop" : "seq-play"}`}
          >
            {playing ? "Stop" : "Play"}
          </button>
        </div>
      </div>
      <footer className="synth-footer">
        <small>Inspired by Serum/Vital &copy; 2025</small>
      </footer>
      <style>{`
        .synth-bg {
          background: linear-gradient(135deg, #181c24 60%, #232b3a 100%);
          color: #fff;
          min-height: 100vh;
          padding: 32px;
        }
        .synth-title {
          text-align: center;
          font-size: 2.2em;
          letter-spacing: 0.05em;
          margin-bottom: 24px;
          font-weight: 700;
          text-shadow: 0 2px 12px #0008;
        }
        .synth-panels {
          display: flex;
          gap: 32px;
          justify-content: center;
          flex-wrap: wrap;
        }
        .synth-panel {
          background: #232b3a;
          border-radius: 18px;
          box-shadow: 0 4px 24px #0005;
          padding: 24px 28px;
          min-width: 320px;
          margin-bottom: 24px;
        }
        .synth-panel h2 {
          font-size: 1.2em;
          margin-bottom: 16px;
          letter-spacing: 0.03em;
          color: #7fdfff;
        }
        .osc-row, .adsr-row {
          display: flex;
          gap: 24px;
          align-items: center;
          margin-bottom: 12px;
        }
        .wave-label {
          font-size: 1em;
          color: #fff;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .wave-select {
          background: #181c24;
          color: #fff;
          border: 1px solid #7fdfff;
          border-radius: 6px;
          padding: 4px 12px;
          font-size: 1em;
        }
        .knob {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 80px;
          margin-bottom: 8px;
        }
        .knob-input {
          width: 80px;
          accent-color: #7fdfff;
        }
        .knob-value {
          font-size: 1.1em;
          color: #7fdfff;
          margin-top: 2px;
        }
        .knob-label {
          font-size: 0.95em;
          color: #fff;
          margin-top: 2px;
        }
        .seq-grid {
          display: grid;
          grid-template-columns: repeat(8, 1fr);
          gap: 8px;
          margin-bottom: 18px;
        }
        .seq-step {
          width: 60px;
          padding: 8px 0;
          background: #181c24;
          color: #fff;
          border: 2px solid #232b3a;
          border-radius: 8px;
          text-align: center;
          font-size: 1em;
          box-shadow: 0 2px 8px #0003;
          transition: border 0.2s, background 0.2s;
        }
        .seq-step option {
          background: #232b3a;
          color: #fff;
        }
        .seq-active {
          border: 2px solid #7fdfff;
          background: #2a3b5a;
        }
        .seq-btn {
          padding: 10px 32px;
          font-size: 1.1em;
          border-radius: 8px;
          border: none;
          cursor: pointer;
          font-weight: 600;
          box-shadow: 0 2px 12px #0004;
          transition: background 0.2s;
        }
        .seq-play {
          background: linear-gradient(90deg, #7fdfff 60%, #3ad1ff 100%);
          color: #181c24;
        }
        .seq-stop {
          background: linear-gradient(90deg, #ff7f7f 60%, #ff3a3a 100%);
          color: #fff;
        }
        .synth-footer {
          text-align: center;
          margin-top: 32px;
          opacity: 0.5;
        }
      `}</style>
    </div>
  );
}