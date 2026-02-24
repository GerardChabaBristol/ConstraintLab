document.addEventListener("DOMContentLoaded", () => {
  console.log("ConstraintLab UI initialized.");

  // Transport and panel controls already present in the UI.
  const playbackToggleButton = document.getElementById("playbackToggleButton");
  const bpmInput = document.getElementById("bpmInput");
  const clearPatternButton = document.getElementById("clearPatternButton");
  const constraintSliders = Array.from(document.querySelectorAll(".constraint-slider"));
  const constraintLevelLabels = Array.from(
    document.querySelectorAll(".constraint-level-value")
  );
  const lockSlidersCheckbox = document.getElementById("lock-sliders");
  const sequencerMount = document.getElementById("stepSequencer");

  // Audio setup: one shared context and one buffer per drum instrument.
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioContext = AudioContextClass ? new AudioContextClass() : null;
  const drumBuffers = { kick: null, snare: null, hihat: null };
  const drumSamplePaths = {
    kick: "assets/audio/kick.wav",
    snare: "assets/audio/snare.wav",
    hihat: "assets/audio/hihat.wav",
  };
  const instrumentBufferKeys = ["kick", "snare", "hihat"];

  async function loadDrumBuffer(bufferKey, filePath) {
    if (!audioContext) return;

    try {
      const response = await fetch(filePath);
      if (!response.ok) return;

      const audioData = await response.arrayBuffer();
      drumBuffers[bufferKey] = await audioContext.decodeAudioData(audioData);
    } catch {
      // Missing files are acceptable during early prototype setup.
    }
  }

  function loadAllDrumBuffers() {
    Object.entries(drumSamplePaths).forEach(([bufferKey, filePath]) => {
      loadDrumBuffer(bufferKey, filePath);
    });
  }

  function playDrum(buffer) {
    if (!audioContext || !buffer) return;

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start();
  }

  loadAllDrumBuffers();

  // Sequencer scaffold and pattern state used by editing and playback.
  const instruments = [
    { name: "Kick" },
    { name: "Snare" },
    { name: "Hi-hat" },
  ];
  const stepsPerInstrument = 32;
  const pattern = Array.from({ length: instruments.length }, () =>
    Array(stepsPerInstrument).fill(false)
  );
  const stepCellsByColumn = Array.from({ length: stepsPerInstrument }, () => []);
  const allStepCells = [];

  let isPlaying = false;
  let playbackTimerId = null;
  let currentStepIndex = 0;
  let previousStepIndex = -1;

  function setPlaybackButtonState(playing) {
    if (!playbackToggleButton) return;

    playbackToggleButton.classList.toggle("is-play", !playing);
    playbackToggleButton.classList.toggle("is-pause", playing);
    playbackToggleButton.setAttribute(
      "aria-label",
      playing ? "Pause playback" : "Start playback"
    );
  }

  function readCurrentBpm() {
    if (!bpmInput) return 90;

    const parsedBpm = Number(bpmInput.value);
    if (!Number.isFinite(parsedBpm)) return 90;
    return Math.min(240, Math.max(40, parsedBpm));
  }

  function getStepIntervalMs() {
    const bpm = readCurrentBpm();
    const secondsPerSixteenth = (60 / bpm) / 4;
    return secondsPerSixteenth * 1000;
  }

  // Rebuild the step timer so live BPM edits apply while playback is running.
  function restartPlaybackTimer() {
    if (!isPlaying) return;

    if (playbackTimerId !== null) {
      window.clearInterval(playbackTimerId);
    }

    playbackTimerId = window.setInterval(sequencerTick, getStepIntervalMs());
  }

  function clearPlayhead() {
    if (previousStepIndex < 0) return;

    stepCellsByColumn[previousStepIndex].forEach((cell) => {
      cell.classList.remove("step-cell--playhead");
    });

    previousStepIndex = -1;
  }

  function setPlayhead(stepIndex) {
    clearPlayhead();

    stepCellsByColumn[stepIndex].forEach((cell) => {
      cell.classList.add("step-cell--playhead");
    });

    previousStepIndex = stepIndex;
  }

  // Timing loop: advance one step, trigger matching active cells, repeat.
  function sequencerTick() {
    setPlayhead(currentStepIndex);

    instruments.forEach((_, instrumentIndex) => {
      if (!pattern[instrumentIndex][currentStepIndex]) return;

      const bufferKey = instrumentBufferKeys[instrumentIndex];
      playDrum(drumBuffers[bufferKey]);
    });

    currentStepIndex = (currentStepIndex + 1) % stepsPerInstrument;
  }

  async function startPlayback() {
    if (isPlaying) return;

    isPlaying = true;
    setPlaybackButtonState(true);

    if (audioContext && audioContext.state === "suspended") {
      try {
        await audioContext.resume();
      } catch {
        // If resume fails, keep UI responsive and continue silently.
      }
    }

    currentStepIndex = 0;
    sequencerTick();
    playbackTimerId = window.setInterval(sequencerTick, getStepIntervalMs());
  }

  function stopPlayback() {
    if (!isPlaying) return;

    isPlaying = false;
    setPlaybackButtonState(false);

    if (playbackTimerId !== null) {
      window.clearInterval(playbackTimerId);
      playbackTimerId = null;
    }

    clearPlayhead();
  }

  function togglePlayback() {
    if (isPlaying) {
      stopPlayback();
      return;
    }

    startPlayback();
  }

  if (playbackToggleButton) {
    playbackToggleButton.addEventListener("click", togglePlayback);
  }

  // Clamp and normalize BPM input, then sync the running timer if needed.
  function commitBpmInputValue() {
    const clampedBpm = readCurrentBpm();
    bpmInput.value = String(Math.round(clampedBpm));
    restartPlaybackTimer();
  }

  if (bpmInput) {
    bpmInput.addEventListener("change", commitBpmInputValue);
    bpmInput.addEventListener("blur", commitBpmInputValue);
    bpmInput.addEventListener("input", restartPlaybackTimer);
  }

  // Global transport shortcut: space toggles play/pause and avoids grid button activation.
  document.addEventListener("keydown", (event) => {
    const isSpace = event.key === " " || event.code === "Space";
    if (!isSpace) return;

    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }

    event.preventDefault();
    togglePlayback();
  });

  function auditionInstrument(instrumentIndex) {
    const bufferKey = instrumentBufferKeys[instrumentIndex];
    playDrum(drumBuffers[bufferKey]);
  }

  if (sequencerMount) {
    const instrumentButtons = [];

    // Mark the end of each 8-step block for visual grouping only.
    function isBlockEnd(stepIndex) {
      return (stepIndex + 1) % 8 === 0 && stepIndex !== stepsPerInstrument - 1;
    }

    function symbolMarkup(name) {
      if (name === "Kick") {
        return `
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="7"></circle>
            <circle cx="12" cy="12" r="2.3"></circle>
          </svg>
        `;
      }

      if (name === "Snare") {
        return `
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <ellipse cx="12" cy="8.5" rx="6.4" ry="2.2"></ellipse>
            <path d="M5.6 8.5v6.2"></path>
            <path d="M18.4 8.5v6.2"></path>
            <path d="M5.6 14.7h12.8"></path>
          </svg>
        `;
      }

      return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <ellipse cx="12" cy="11.5" rx="7.2" ry="2.1"></ellipse>
          <path d="M12 13.6v5.2"></path>
          <path d="M8.3 18.8h7.4"></path>
        </svg>
      `;
    }

    // Highlight one instrument row at a time (visual selection only).
    function setActiveInstrument(index) {
      instrumentButtons.forEach((button, buttonIndex) => {
        const isActive = buttonIndex === index;
        button.classList.toggle("instrument--active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });
    }

    function createInstrumentLabel(instrument, instrumentIndex) {
      const label = document.createElement("button");
      label.type = "button";
      label.className = "instrument-label";
      label.setAttribute("aria-label", instrument.name);
      label.setAttribute("aria-pressed", "false");
      label.innerHTML = symbolMarkup(instrument.name);
      label.addEventListener("click", () => {
        setActiveInstrument(instrumentIndex);
        auditionInstrument(instrumentIndex);
      });
      instrumentButtons.push(label);
      return label;
    }

    function createStepCell(instrumentIndex, stepIndex) {
      const stepButton = document.createElement("button");
      stepButton.type = "button";
      stepButton.className = "step-cell";
      stepButton.dataset.instrument = String(instrumentIndex);
      stepButton.dataset.step = String(stepIndex);
      stepButton.setAttribute("aria-label", `${instruments[instrumentIndex].name} step ${stepIndex + 1}`);
      stepButton.setAttribute("aria-pressed", "false");

      if (isBlockEnd(stepIndex)) {
        stepButton.classList.add("step-cell--block-end");
      }

      stepButton.addEventListener("click", () => {
        pattern[instrumentIndex][stepIndex] = !pattern[instrumentIndex][stepIndex];
        const isActive = pattern[instrumentIndex][stepIndex];
        stepButton.classList.toggle("step-cell--active", isActive);
        stepButton.setAttribute("aria-pressed", String(isActive));

        if (isActive) {
          auditionInstrument(instrumentIndex);
        }
      });

      stepCellsByColumn[stepIndex].push(stepButton);
      allStepCells.push(stepButton);
      return stepButton;
    }

    instruments.forEach((instrument, instrumentIndex) => {
      sequencerMount.appendChild(createInstrumentLabel(instrument, instrumentIndex));

      const row = document.createElement("div");
      row.className = "step-row";

      for (let stepIndex = 0; stepIndex < stepsPerInstrument; stepIndex += 1) {
        row.appendChild(createStepCell(instrumentIndex, stepIndex));
      }

      sequencerMount.appendChild(row);
    });

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "add-instrument-button";
    addButton.setAttribute("aria-label", "Add instrument");
    addButton.textContent = "+";
    sequencerMount.appendChild(addButton);

    const numberRow = document.createElement("div");
    numberRow.className = "step-numbers";

    for (let stepIndex = 0; stepIndex < stepsPerInstrument; stepIndex += 1) {
      const stepNumber = document.createElement("span");
      stepNumber.className = "step-number";
      stepNumber.textContent = String(stepIndex + 1);

      if (isBlockEnd(stepIndex)) {
        stepNumber.classList.add("step-number--block-end");
      }

      numberRow.appendChild(stepNumber);
    }

    sequencerMount.appendChild(numberRow);
    setActiveInstrument(0);
  }

  if (clearPatternButton) {
    clearPatternButton.addEventListener("click", () => {
      pattern.forEach((row) => row.fill(false));

      allStepCells.forEach((cell) => {
        cell.classList.remove("step-cell--active", "step-cell--playhead");
        cell.setAttribute("aria-pressed", "false");
      });

      previousStepIndex = -1;
    });
  }

  // Keep each fader's displayed level in sync with its current value.
  function updateSliderLabel(index, value) {
    const valueLabel = constraintLevelLabels[index];
    if (!valueLabel) return;
    valueLabel.textContent = `Level: ${value}`;
  }

  // Apply one shared value across all constraints when lock mode is enabled.
  function setAllSliderValues(value) {
    constraintSliders.forEach((slider, index) => {
      slider.value = value;
      updateSliderLabel(index, value);
    });
  }

  // Per-slider input handling: independent updates, or mirrored updates when locked.
  constraintSliders.forEach((slider, index) => {
    updateSliderLabel(index, slider.value);

    slider.addEventListener("input", () => {
      if (lockSlidersCheckbox.checked) {
        setAllSliderValues(slider.value);
        return;
      }

      updateSliderLabel(index, slider.value);
    });
  });
});
