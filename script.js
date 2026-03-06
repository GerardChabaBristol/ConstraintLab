document.addEventListener("DOMContentLoaded", () => {
  console.log("ConstraintLab UI initialized.");

  // Edit these values to rebalance instrument and metronome volume levels.
  const INSTRUMENT_GAIN = {
    kick: 1.0,
    snare: 0.5,
    hihat: 0.4,
    perc: 1.5,
    openhat: 1,
    metronome: 0.4,
  };

  // Transport and panel controls already present in the UI.
  const playbackToggleButton = document.getElementById("playbackToggleButton");
  const bpmInput = document.getElementById("bpmInput");
  const metronomeToggleButton = document.getElementById("metronomeToggleButton");
  const clearPatternButton = document.getElementById("clearPatternButton");
  const resetConstraintsButton = document.getElementById("resetConstraintsButton");
  const tryThisText = document.getElementById("try-this-text");
  const baseTryThisMessage = tryThisText ? tryThisText.textContent : "";
  const constraintSliders = Array.from(document.querySelectorAll(".constraint-slider"));
  const constraintLevelLabels = Array.from(
    document.querySelectorAll(".constraint-level-value")
  );
  const densityScaleLabels = Array.from(document.querySelectorAll("[data-density-level]"));
  const lockSlidersCheckbox = document.getElementById("lock-sliders");
  const sequencerMount = document.getElementById("stepSequencer");

  // Audio setup: one shared context and one buffer per drum instrument.
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioContext = AudioContextClass ? new AudioContextClass() : null;
  const instrumentGainNodes = audioContext
    ? {
      kick: audioContext.createGain(),
      snare: audioContext.createGain(),
      hihat: audioContext.createGain(),
      perc: audioContext.createGain(),
      openhat: audioContext.createGain(),
      metronome: audioContext.createGain(),
    }
    : {
      kick: null,
      snare: null,
      hihat: null,
      perc: null,
      openhat: null,
      metronome: null,
    };
  const drumBuffers = { kick: null, snare: null, hihat: null, perc: null, openhat: null };
  const drumSamplePaths = {
    kick: "assets/audio/kick.wav",
    snare: "assets/audio/snare.wav",
    hihat: "assets/audio/hihat.wav",
    perc: "assets/audio/perc.wav",
    openhat: "assets/audio/openhat.wav",
  };
  const instrumentBufferKeys = ["kick", "snare", "hihat", "perc", "openhat"];
  const PATTERN_STORAGE_KEY = "constraintlab.pattern";
  const CONSTRAINT_STORAGE_KEY = "constraintlab.constraints";
  const LOOP_LENGTH_OPTIONS = [8, 16, 32];
  const LOOP_LENGTH_SLIDER_INDEX = 0;
  const KIT_SIZE_OPTIONS = [3, 4, 5];
  const KIT_SIZE_SLIDER_INDEX = 3;
  const DENSITY_LEVELS = ["sparse", "moderate", "dense", "free"];
  const DENSITY_SLIDER_INDEX = 2;

  Object.entries(instrumentGainNodes).forEach(([instrumentKey, gainNode]) => {
    if (!gainNode) return;
    gainNode.gain.value = INSTRUMENT_GAIN[instrumentKey] ?? 1;
    // Route each per-hit source through its instrument gain before output.
    gainNode.connect(audioContext.destination);
  });

  async function loadDrumBuffer(bufferKey, filePath) {
    if (!audioContext) return;

    try {
      const response = await fetch(filePath);
      if (!response.ok) {
        console.warn(`Could not load sample: ${filePath}`);
        return;
      }

      const audioData = await response.arrayBuffer();
      drumBuffers[bufferKey] = await audioContext.decodeAudioData(audioData);
    } catch {
      console.warn(`Could not load sample: ${filePath}`);
    }
  }

  function loadAllDrumBuffers() {
    Object.entries(drumSamplePaths).forEach(([bufferKey, filePath]) => {
      loadDrumBuffer(bufferKey, filePath);
    });
  }

  function playDrum(buffer, gainNode, startTime = audioContext ? audioContext.currentTime : 0) {
    if (!audioContext) return;
    if (!buffer) {
      console.warn("Could not play hit: missing audio buffer.");
      return;
    }

    // Create a new source for each hit so simultaneous notes can overlap correctly.
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(gainNode || audioContext.destination);
    source.start(startTime);
  }

  loadAllDrumBuffers();

  // Sequencer scaffold and pattern state used by editing and playback.
  const instruments = [
    { name: "Kick" },
    { name: "Snare" },
    { name: "Hi-hat" },
    { name: "Perc" },
    { name: "Open-hat" },
  ];
  const instrumentTooltips = {
    Kick: "Kick - the low drum that provides the main pulse of the beat.",
    Snare: "Snare - a sharp drum sound that adds impact and rhythm to a beat.",
    "Hi-hat": "Hi-hat - a short, crisp cymbal sound often used to keep the rhythm moving.",
    Perc: "Percussion - a small rhythmic accent used to add groove and variation.",
    "Open-hat": "Open hi-hat - a longer cymbal sound that adds energy and movement.",
  };
  const stepsPerInstrument = 32;
  const pattern = Array.from({ length: instruments.length }, () =>
    Array(stepsPerInstrument).fill(false)
  );
  const stepCellsByColumn = Array.from({ length: stepsPerInstrument }, () => []);
  const stepCellsByInstrument = Array.from({ length: instruments.length }, () => []);
  const allStepCells = [];
  const stepNumberElements = [];
  const instrumentButtons = [];

  let isPlaying = false;
  let playbackTimerId = null;
  let currentStepIndex = 0;
  let previousStepIndex = -1;
  let isMetronomeOn = false;
  let loopLength = 8;
  let kitSize = 3;
  let densityLevel = "moderate";
  let isOverDensityLimit = false;
  let overDensityCount = 0;
  let overDensityMaxHits = 0;
  let overDensityOverBy = 0;
  let tryThisMessageTimeoutId = null;
  let persistentTryMessage = baseTryThisMessage;

  // Persist only the step matrix so edits survive reloads until the user clears them.
  function savePatternToStorage() {
    try {
      window.localStorage.setItem(PATTERN_STORAGE_KEY, JSON.stringify(pattern));
    } catch {
      // Ignore storage write failures and keep the sequencer usable.
    }
  }

  function loadPatternFromStorage() {
    try {
      const rawPattern = window.localStorage.getItem(PATTERN_STORAGE_KEY);
      if (!rawPattern) return;

      const parsedPattern = JSON.parse(rawPattern);
      if (!Array.isArray(parsedPattern) || parsedPattern.length !== instruments.length) return;

      parsedPattern.forEach((row, instrumentIndex) => {
        if (!Array.isArray(row) || row.length !== stepsPerInstrument) return;

        row.forEach((stepValue, stepIndex) => {
          pattern[instrumentIndex][stepIndex] = Boolean(stepValue);
        });
      });
    } catch {
      // Ignore invalid saved data and keep the default empty pattern.
    }
  }

  loadPatternFromStorage();

  function saveConstraintValuesToStorage() {
    try {
      const sliderState = {};
      constraintSliders.forEach((slider) => {
        if (!slider.id) return;
        sliderState[slider.id] = slider.value;
      });
      window.localStorage.setItem(CONSTRAINT_STORAGE_KEY, JSON.stringify(sliderState));
    } catch {
      // Ignore storage write failures and keep controls usable.
    }
  }

  function loadConstraintValuesFromStorage() {
    try {
      const rawState = window.localStorage.getItem(CONSTRAINT_STORAGE_KEY);
      if (!rawState) return;

      const parsedState = JSON.parse(rawState);
      if (!parsedState || typeof parsedState !== "object") return;

      constraintSliders.forEach((slider) => {
        if (!slider.id) return;

        const savedValue = parsedState[slider.id];
        if (savedValue === undefined) return;

        const min = Number(slider.min);
        const max = Number(slider.max);
        const numericValue = Number(savedValue);
        if (!Number.isFinite(numericValue)) return;

        const clampedValue = Math.min(max, Math.max(min, numericValue));
        slider.value = String(clampedValue);
      });
    } catch {
      // Ignore invalid saved data and keep default slider values.
    }
  }

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

  function setMetronomeButtonState(enabled) {
    if (!metronomeToggleButton) return;

    metronomeToggleButton.classList.toggle("is-on", enabled);
    metronomeToggleButton.setAttribute("aria-pressed", String(enabled));
    metronomeToggleButton.setAttribute(
      "aria-label",
      enabled ? "Disable metronome" : "Enable metronome"
    );
  }

  function playMetronomeClick() {
    if (!audioContext) return;

    const osc = audioContext.createOscillator();
    const clickEnvelopeGain = audioContext.createGain();
    const now = audioContext.currentTime;

    osc.type = "square";
    osc.frequency.setValueAtTime(1500, now);
    clickEnvelopeGain.gain.setValueAtTime(0.0001, now);
    clickEnvelopeGain.gain.exponentialRampToValueAtTime(0.22, now + 0.001);
    clickEnvelopeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);

    osc.connect(clickEnvelopeGain);
    clickEnvelopeGain.connect(instrumentGainNodes.metronome || audioContext.destination);
    osc.start(now);
    osc.stop(now + 0.045);
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
    const tickTime = audioContext ? audioContext.currentTime + 0.005 : 0;

    if (isMetronomeOn && currentStepIndex % 4 === 0) {
      playMetronomeClick();
    }

    setPlayhead(currentStepIndex);

    instruments.forEach((_, instrumentIndex) => {
      if (instrumentIndex >= kitSize) return;
      if (!pattern[instrumentIndex][currentStepIndex]) return;

      const bufferKey = instrumentBufferKeys[instrumentIndex];
      playDrum(drumBuffers[bufferKey], instrumentGainNodes[bufferKey], tickTime);
    });

    currentStepIndex = (currentStepIndex + 1) % loopLength;
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

  if (metronomeToggleButton) {
    metronomeToggleButton.addEventListener("click", () => {
      isMetronomeOn = !isMetronomeOn;
      setMetronomeButtonState(isMetronomeOn);
    });
    setMetronomeButtonState(isMetronomeOn);
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

    const target = document.activeElement;
    if (target instanceof HTMLInputElement && target.type !== "range") {
      return;
    }

    if (
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }

    event.preventDefault();
    if (
      target instanceof HTMLElement &&
      (
        target.classList.contains("step-cell") ||
        target.classList.contains("constraint-slider") ||
        target.classList.contains("instrument-label")
      )
    ) {
      target.blur();
    }
    togglePlayback();
  });

  function auditionInstrument(instrumentIndex) {
    if (instrumentIndex >= kitSize) return;
    const bufferKey = instrumentBufferKeys[instrumentIndex];
    playDrum(drumBuffers[bufferKey], instrumentGainNodes[bufferKey]);
  }

  function readLoopLengthFromSliderValue(sliderValue) {
    const sliderIndex = Math.max(1, Math.min(3, Number(sliderValue)));
    return LOOP_LENGTH_OPTIONS[sliderIndex - 1];
  }

  function updateLoopLengthState() {
    const loopSlider = constraintSliders[LOOP_LENGTH_SLIDER_INDEX];
    if (!loopSlider) return;

    loopLength = readLoopLengthFromSliderValue(loopSlider.value);

    allStepCells.forEach((cell) => {
      const stepIndex = Number(cell.dataset.step);
      const instrumentIndex = Number(cell.dataset.instrument);
      const isStepLocked = stepIndex >= loopLength;
      const isRowLocked = instrumentIndex >= kitSize;
      cell.classList.toggle("step-cell--locked", isStepLocked);
      cell.setAttribute("aria-disabled", String(isStepLocked || isRowLocked));
    });

    stepNumberElements.forEach((numberElement, stepIndex) => {
      numberElement.classList.toggle("step-number--locked", stepIndex >= loopLength);
    });

    if (currentStepIndex >= loopLength) {
      clearPlayhead();
      currentStepIndex = 0;
    }

    updateDensityState();
  }

  function readKitSizeFromSliderValue(sliderValue) {
    const sliderIndex = Math.max(1, Math.min(3, Number(sliderValue)));
    return KIT_SIZE_OPTIONS[sliderIndex - 1];
  }

  function updateKitSizeState() {
    const kitSlider = constraintSliders[KIT_SIZE_SLIDER_INDEX];
    if (!kitSlider) return;

    kitSize = readKitSizeFromSliderValue(kitSlider.value);

    instrumentButtons.forEach((button, instrumentIndex) => {
      const isLocked = instrumentIndex >= kitSize;
      button.classList.toggle("instrument-label--locked", isLocked);
      if (isLocked) {
        button.classList.remove("instrument--active");
        button.setAttribute("aria-pressed", "false");
      }
      button.setAttribute("aria-disabled", String(isLocked));
    });

    stepCellsByInstrument.forEach((rowCells, instrumentIndex) => {
      const isLocked = instrumentIndex >= kitSize;
      rowCells.forEach((cell) => {
        cell.classList.toggle("step-cell--row-locked", isLocked);
        cell.setAttribute("aria-disabled", String(isLocked || Number(cell.dataset.step) >= loopLength));
      });
    });

    updateDensityState();
  }

  function readDensityLevelFromSliderValue(sliderValue) {
    const sliderIndex = Math.max(1, Math.min(4, Number(sliderValue)));
    return DENSITY_LEVELS[sliderIndex - 1];
  }

  function computeMaxHits(activeSteps, level) {
    if (level === "free") return null;
    if (level === "sparse") return Math.max(3, Math.ceil(activeSteps * 0.35));
    if (level === "moderate") return Math.max(6, Math.ceil(activeSteps * 0.55));
    return Math.max(10, Math.ceil(activeSteps * 0.8));
  }

  function countActiveHitsInEditableRegion() {
    let count = 0;
    for (let instrumentIndex = 0; instrumentIndex < kitSize; instrumentIndex += 1) {
      for (let stepIndex = 0; stepIndex < loopLength; stepIndex += 1) {
        if (pattern[instrumentIndex][stepIndex]) {
          count += 1;
        }
      }
    }
    return count;
  }

  function getDensityComplianceState() {
    const activeSteps = loopLength;
    const computedMaxHits = computeMaxHits(activeSteps, densityLevel);
    const maxHits = computedMaxHits === null ? Number.POSITIVE_INFINITY : computedMaxHits;
    const hitCount = countActiveHitsInEditableRegion();
    const isOverLimit = Number.isFinite(maxHits) && hitCount > maxHits;
    const overBy = isOverLimit ? hitCount - maxHits : 0;

    return { activeSteps, maxHits, hitCount, isOverLimit, overBy };
  }

  function getDensityPolicyText(activeSteps, level) {
    if (level === "free") {
      return "No hit limit.";
    }

    const maxHits = computeMaxHits(activeSteps, level);
    const levelName = level.charAt(0).toUpperCase() + level.slice(1);
    return `${levelName} density: max ${maxHits} hits (current loop length: ${activeSteps}-step loop).`;
  }

  function getDensityScaleTooltipText(level) {
    const meaning = {
      sparse: "Fewer hits, more space.",
      moderate: "Balanced hit density.",
      dense: "More hits, tighter rhythm.",
      free: "No hit limit.",
    };

    if (level === "free") {
      return "No hit limit.";
    }

    const policyText = getDensityPolicyText(loopLength, level).replace(/^[^:]+:\s*/, "Here: ");
    return `${meaning[level]}\n\n${policyText}`;
  }

  function showTemporaryTryMessage(message, durationMs = 1500) {
    if (!tryThisText) return;

    tryThisText.textContent = message;

    if (tryThisMessageTimeoutId !== null) {
      window.clearTimeout(tryThisMessageTimeoutId);
    }

    tryThisMessageTimeoutId = window.setTimeout(() => {
      tryThisText.textContent = persistentTryMessage;
      tryThisMessageTimeoutId = null;
    }, durationMs);
  }

  function triggerBlockedStepFeedback(stepCell) {
    stepCell.classList.remove("step-cell--blocked");
    void stepCell.offsetWidth;
    stepCell.classList.add("step-cell--blocked");

    window.setTimeout(() => {
      stepCell.classList.remove("step-cell--blocked");
    }, 280);
  }

  function updateDensityState() {
    const densitySlider = constraintSliders[DENSITY_SLIDER_INDEX];
    if (!densitySlider) return;

    densityLevel = readDensityLevelFromSliderValue(densitySlider.value);

    densityScaleLabels.forEach((label) => {
      const level = label.dataset.densityLevel;
      if (!level) return;

      const tooltipText = getDensityScaleTooltipText(level);
      label.setAttribute("title", tooltipText);
      label.removeAttribute("data-tooltip");
    });

    const compliance = getDensityComplianceState();
    isOverDensityLimit = compliance.isOverLimit;
    overDensityCount = compliance.hitCount;
    overDensityMaxHits = Number.isFinite(compliance.maxHits) ? compliance.maxHits : 0;
    overDensityOverBy = compliance.overBy;

    if (isOverDensityLimit) {
      const nextMessage = `Over density limit: ${overDensityCount} hits in steps 1-${compliance.activeSteps} (max ${overDensityMaxHits}). Remove ${overDensityOverBy} hits to continue adding.`;
      if (persistentTryMessage !== nextMessage) {
        persistentTryMessage = nextMessage;
        if (tryThisText && tryThisMessageTimeoutId === null) {
          tryThisText.textContent = persistentTryMessage;
        }
      }
    } else {
      if (persistentTryMessage !== baseTryThisMessage) {
        persistentTryMessage = baseTryThisMessage;
        if (tryThisText && tryThisMessageTimeoutId === null) {
          tryThisText.textContent = persistentTryMessage;
        }
      }
    }

    allStepCells.forEach((cell) => {
      const instrumentIndex = Number(cell.dataset.instrument);
      const stepIndex = Number(cell.dataset.step);
      const isActive = pattern[instrumentIndex][stepIndex];
      const inActiveRegion = instrumentIndex < kitSize && stepIndex < loopLength;
      cell.classList.toggle(
        "step-cell--over-limit-removable",
        isOverDensityLimit && isActive && inActiveRegion
      );
    });
  }

  if (sequencerMount) {
    // Mark the end of each 4-step block for visual grouping only.
    function isBlockEnd(stepIndex) {
      return (stepIndex + 1) % 4 === 0 && stepIndex !== stepsPerInstrument - 1;
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

      if (name === "Perc") {
        return `
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <line x1="4.8" y1="6.4" x2="19.4" y2="13.6"></line>
            <line x1="6.2" y1="4.8" x2="14.2" y2="18.8"></line>
            <circle cx="4.3" cy="6.1" r="1"></circle>
            <circle cx="5.8" cy="4.3" r="1"></circle>
          </svg>
        `;
      }

      if (name === "Open-hat") {
        return `
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <ellipse cx="12" cy="9" rx="7" ry="2"></ellipse>
            <ellipse cx="12" cy="14.2" rx="5.6" ry="1.8"></ellipse>
            <path d="M12 11v6.2"></path>
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
      label.className = "instrument-label has-tooltip";
      label.setAttribute("aria-label", instrument.name);
      label.setAttribute("aria-pressed", "false");
      label.setAttribute("data-tooltip", instrumentTooltips[instrument.name] || instrument.name);
      label.innerHTML = symbolMarkup(instrument.name);
      label.addEventListener("click", () => {
        if (instrumentIndex >= kitSize) return;
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

      if (pattern[instrumentIndex][stepIndex]) {
        stepButton.classList.add("step-cell--active");
        stepButton.setAttribute("aria-pressed", "true");
      }

      stepButton.addEventListener("click", () => {
        if (stepIndex >= loopLength || instrumentIndex >= kitSize) return;

        const isCurrentlyActive = pattern[instrumentIndex][stepIndex];
        if (!isCurrentlyActive) {
          const compliance = getDensityComplianceState();
          if (compliance.isOverLimit) {
            triggerBlockedStepFeedback(stepButton);
            showTemporaryTryMessage(
              `Over density limit (${compliance.maxHits} max). Remove hits to add new ones.`,
              3000
            );
            return;
          }

          if (Number.isFinite(compliance.maxHits) && compliance.hitCount >= compliance.maxHits) {
            triggerBlockedStepFeedback(stepButton);
            showTemporaryTryMessage(
              `Density limit reached (${compliance.maxHits} max). Remove a hit to add another.`,
              3000
            );
            return;
          }
        }

        pattern[instrumentIndex][stepIndex] = !isCurrentlyActive;
        const isActive = pattern[instrumentIndex][stepIndex];
        stepButton.classList.toggle("step-cell--active", isActive);
        stepButton.setAttribute("aria-pressed", String(isActive));
        savePatternToStorage();
        updateDensityState();

        if (isActive) {
          auditionInstrument(instrumentIndex);
        }
      });

      stepCellsByColumn[stepIndex].push(stepButton);
      stepCellsByInstrument[instrumentIndex].push(stepButton);
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

    const cornerSpacer = document.createElement("div");
    cornerSpacer.className = "step-corner-spacer";
    cornerSpacer.setAttribute("aria-hidden", "true");
    sequencerMount.appendChild(cornerSpacer);

    const numberRow = document.createElement("div");
    numberRow.className = "step-numbers";

    for (let stepIndex = 0; stepIndex < stepsPerInstrument; stepIndex += 1) {
      const stepNumber = document.createElement("span");
      stepNumber.className = "step-number";
      stepNumber.textContent = String(stepIndex + 1);

      if (isBlockEnd(stepIndex)) {
        stepNumber.classList.add("step-number--block-end");
      }

      stepNumberElements.push(stepNumber);
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
      savePatternToStorage();
      updateDensityState();
    });
  }

  // Keep each fader's displayed level in sync with its current value.
  function updateSliderLabel(index, value) {
    const valueLabel = constraintLevelLabels[index];
    if (!valueLabel) return;

    if (index === LOOP_LENGTH_SLIDER_INDEX) {
      valueLabel.textContent = `Loop: ${readLoopLengthFromSliderValue(value)}`;
      return;
    }

    if (index === KIT_SIZE_SLIDER_INDEX) {
      valueLabel.textContent = `Kit: ${readKitSizeFromSliderValue(value)}`;
      return;
    }

    if (index === DENSITY_SLIDER_INDEX) {
      const level = readDensityLevelFromSliderValue(value);
      valueLabel.textContent = `Density: ${level.charAt(0).toUpperCase() + level.slice(1)}`;
      return;
    }

    valueLabel.textContent = `Level: ${value}`;
  }

  // Apply one shared value across all constraints when lock mode is enabled.
  function setAllSliderValues(value) {
    constraintSliders.forEach((slider, index) => {
      slider.value = value;
      updateSliderLabel(index, slider.value);
    });
  }

  // Per-slider input handling: update labels, apply loop/kit locking, and persist values.
  loadConstraintValuesFromStorage();

  constraintSliders.forEach((slider, index) => {
    updateSliderLabel(index, slider.value);

    slider.addEventListener("input", () => {
      if (lockSlidersCheckbox.checked) {
        setAllSliderValues(slider.value);
        updateLoopLengthState();
        updateKitSizeState();
        saveConstraintValuesToStorage();
        return;
      }

      updateSliderLabel(index, slider.value);
      if (index === LOOP_LENGTH_SLIDER_INDEX) {
        updateLoopLengthState();
      }
      if (index === KIT_SIZE_SLIDER_INDEX) {
        updateKitSizeState();
      }
      if (index === DENSITY_SLIDER_INDEX) {
        updateDensityState();
      }
      saveConstraintValuesToStorage();
    });
  });

  if (resetConstraintsButton) {
    resetConstraintsButton.addEventListener("click", () => {
      constraintSliders.forEach((slider, index) => {
        slider.value = slider.defaultValue;
        updateSliderLabel(index, slider.value);
      });

      updateLoopLengthState();
      updateKitSizeState();
      saveConstraintValuesToStorage();
    });
  }

  updateLoopLengthState();
  updateKitSizeState();
});

