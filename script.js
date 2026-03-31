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
  const GRID_RESOLUTION_OPTIONS = ["coarse", "medium", "fine"];
  const GRID_RESOLUTION_SLIDER_INDEX = 1;
  const REPETITION_LEVELS = ["strong", "partial", "free"];
  const REPETITION_SLIDER_INDEX = 5;
  const KIT_SIZE_OPTIONS = [3, 4, 5];
  const KIT_SIZE_SLIDER_INDEX = 3;
  const GUIDANCE_LEVELS = ["strong", "light", "free"];
  const GUIDANCE_SLIDER_INDEX = 4;
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

    // Create a new source for each hit so notes can overlap on the same step.
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
    Kick: "Kick: the low drum that provides the main pulse of the beat.",
    Snare: "Snare: a sharp drum sound that adds impact and rhythm to a beat.",
    "Hi-hat": "Hi-hat: a short, crisp cymbal sound often used to keep the rhythm moving.",
    Perc: "Percussion: a small rhythmic accent used to add groove and variation.",
    "Open-hat": "Open hi-hat: a longer cymbal sound that adds energy and movement.",
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
  let isGridPointerDown = false;
  let isGridDragPlacing = false;
  let suppressNextGridClick = false;
  let pendingDragStartCell = null;
  let selectedInstrumentIndex = 0;
  let selectedStepIndex = 0;
  let isKeyboardGridSelectionVisible = false;
  let activeGridHistorySnapshot = null;
  let gridInteractionDirty = false;
  let pendingSliderHistorySnapshot = null;
  let loopLength = 8;
  let gridResolutionLevel = "fine";
  let kitSize = 3;
  let densityLevel = "moderate";
  let guidanceLevel = "free";
  let repetitionLevel = "free";
  let isOverDensityLimit = false;
  let tryThisMessageTimeoutId = null;
  let persistentTryMessage = baseTryThisMessage;
  const undoHistory = [];
  const redoHistory = [];
  const isMacPlatform = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

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

  function clonePatternState() {
    return pattern.map((row) => row.slice());
  }

  function cloneConstraintState() {
    return constraintSliders.map((slider) => slider.value);
  }

  function getEditorStateSnapshot() {
    return {
      pattern: clonePatternState(),
      sliders: cloneConstraintState(),
    };
  }

  function areEditorStatesEqual(firstState, secondState) {
    if (!firstState || !secondState) return false;

    const firstPattern = JSON.stringify(firstState.pattern);
    const secondPattern = JSON.stringify(secondState.pattern);
    if (firstPattern !== secondPattern) return false;

    return JSON.stringify(firstState.sliders) === JSON.stringify(secondState.sliders);
  }

  function pushUndoState(previousState) {
    if (!previousState) return;

    const currentState = getEditorStateSnapshot();
    if (areEditorStatesEqual(previousState, currentState)) return;

    undoHistory.push(previousState);
    redoHistory.length = 0;
  }

  function captureVisibleEffectivePatternSignature() {
    const visibleStates = [];

    for (let instrumentIndex = 0; instrumentIndex < kitSize; instrumentIndex += 1) {
      for (let stepIndex = 0; stepIndex < loopLength; stepIndex += 1) {
        if (!isStepAllowedByGridResolution(stepIndex)) continue;
        visibleStates.push(isEffectiveStepActive(instrumentIndex, stepIndex) ? "1" : "0");
      }
    }

    return visibleStates.join("");
  }

  function applyEditorStateSnapshot(stateSnapshot, options = {}) {
    if (!stateSnapshot) return;
    const { showRepetitionMessage = false } = options;
    const previousRepetitionLevel = repetitionLevel;
    const previousVisiblePattern = captureVisibleEffectivePatternSignature();

    pattern.forEach((row, instrumentIndex) => {
      row.forEach((_, stepIndex) => {
        pattern[instrumentIndex][stepIndex] = Boolean(stateSnapshot.pattern[instrumentIndex]?.[stepIndex]);
      });
    });

    constraintSliders.forEach((slider, index) => {
      const nextValue = stateSnapshot.sliders[index];
      if (nextValue === undefined) return;
      slider.value = nextValue;
      updateSliderLabel(index, slider.value);
    });

    updateLoopLengthState({ silent: true });
    updateGridResolutionState({ silent: true });
    updateKitSizeState({ silent: true });
    updateGuidanceState({ silent: true });
    repetitionLevel = readRepetitionLevelFromSliderValue(
      constraintSliders[REPETITION_SLIDER_INDEX]?.value
    );
    refreshStepAvailabilityState();
    refreshEffectivePatternState();
    updateDensityState();
    savePatternToStorage();
    saveConstraintValuesToStorage();

    const nextRepetitionLevel = repetitionLevel;
    const nextVisiblePattern = captureVisibleEffectivePatternSignature();
    if (
      showRepetitionMessage &&
      previousRepetitionLevel !== nextRepetitionLevel &&
      nextRepetitionLevel !== "free" &&
      previousVisiblePattern !== nextVisiblePattern
    ) {
      showTemporaryTryMessage(getRepetitionAppliedMessage(nextRepetitionLevel), 4500, true);
    }
  }

  function performUndo() {
    const previousState = undoHistory.pop();
    if (!previousState) return;

    redoHistory.push(getEditorStateSnapshot());
    applyEditorStateSnapshot(previousState, { showRepetitionMessage: true });
  }

  function performRedo() {
    const nextState = redoHistory.pop();
    if (!nextState) return;

    undoHistory.push(getEditorStateSnapshot());
    applyEditorStateSnapshot(nextState, { showRepetitionMessage: true });
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
      if (!isStepAllowedByGridResolution(currentStepIndex)) return;
      if (!isEffectiveStepActive(instrumentIndex, currentStepIndex)) return;

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

  // Keyboard shortcuts: transport, grid navigation, and focus cleanup for UI controls.
  document.addEventListener("keydown", (event) => {
    const isSpace = event.key === " " || event.code === "Space";
    if (!isSpace) return;

    const target = document.activeElement;
    if (
      target instanceof HTMLInputElement &&
      target.type !== "range" &&
      target.type !== "checkbox"
    ) {
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
    if (isKeyboardBlurTarget(target)) {
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

  function readGridResolutionFromSliderValue(sliderValue) {
    const sliderIndex = Math.max(1, Math.min(3, Number(sliderValue)));
    return GRID_RESOLUTION_OPTIONS[sliderIndex - 1];
  }

  function readRepetitionLevelFromSliderValue(sliderValue) {
    const sliderIndex = Math.max(1, Math.min(3, Number(sliderValue)));
    return REPETITION_LEVELS[sliderIndex - 1];
  }

  function getRepetitionSourceStepForLevel(stepIndex, level) {
    if (stepIndex >= loopLength || level === "free") return null;

    const halfLength = loopLength / 2;
    if (level === "strong") {
      return stepIndex >= halfLength ? stepIndex - halfLength : null;
    }

    const mirroredLength = loopLength / 4;
    const mirroredStart = halfLength;
    const mirroredEnd = mirroredStart + mirroredLength;
    return stepIndex >= mirroredStart && stepIndex < mirroredEnd
      ? stepIndex - halfLength
      : null;
  }

  function getRepetitionSourceStep(stepIndex) {
    return getRepetitionSourceStepForLevel(stepIndex, repetitionLevel);
  }

  function isCellCurrentlyAvailable(instrumentIndex, stepIndex) {
    return (
      instrumentIndex < kitSize &&
      stepIndex < loopLength &&
      isStepAllowedByGridResolution(stepIndex)
    );
  }

  function createActiveScopeMap() {
    const nextScope = Array.from({ length: instruments.length }, () =>
      Array(stepsPerInstrument).fill(false)
    );

    for (let instrumentIndex = 0; instrumentIndex < kitSize; instrumentIndex += 1) {
      for (let stepIndex = 0; stepIndex < loopLength; stepIndex += 1) {
        if (!isStepAllowedByGridResolution(stepIndex)) continue;
        nextScope[instrumentIndex][stepIndex] = true;
      }
    }

    return nextScope;
  }

  function isStepDerivedByRepetition(instrumentIndex, stepIndex) {
    return isCellCurrentlyAvailable(instrumentIndex, stepIndex) && getRepetitionSourceStep(stepIndex) !== null;
  }

  function isGuidanceGhostAnchor(instrumentIndex, stepIndex) {
    if (guidanceLevel !== "strong") return false;
    if (!isCellCurrentlyAvailable(instrumentIndex, stepIndex)) return false;
    if (isStepDerivedByRepetition(instrumentIndex, stepIndex)) return false;
    if (isEffectiveStepActive(instrumentIndex, stepIndex)) return false;

    const anchors = getGuidanceGhostAnchors(loopLength);
    return Boolean(anchors[instrumentIndex]?.includes(stepIndex));
  }

  function isEffectiveStepActiveForLevel(instrumentIndex, stepIndex, level) {
    const isInActiveRegion = isCellCurrentlyAvailable(instrumentIndex, stepIndex);

    if (!isInActiveRegion) {
      return Boolean(pattern[instrumentIndex][stepIndex]);
    }

    const sourceStepIndex = getRepetitionSourceStepForLevel(stepIndex, level);
    if (sourceStepIndex !== null && !isStepAllowedByGridResolution(sourceStepIndex)) {
      return false;
    }
    const effectiveStepIndex = sourceStepIndex === null ? stepIndex : sourceStepIndex;
    return Boolean(pattern[instrumentIndex][effectiveStepIndex]);
  }

  function isEffectiveStepActive(instrumentIndex, stepIndex) {
    return isEffectiveStepActiveForLevel(instrumentIndex, stepIndex, repetitionLevel);
  }

  function getRepetitionAppliedMessage(level = repetitionLevel) {
    return level === "strong"
      ? "Repetition applied: second half now mirrors the first."
      : "Repetition applied: part of the second half now mirrors part of the first.";
  }

  function captureVisibleRepetitionOverrideSnapshot() {
    const overrideStates = [];

    for (let instrumentIndex = 0; instrumentIndex < kitSize; instrumentIndex += 1) {
      for (let stepIndex = 0; stepIndex < loopLength; stepIndex += 1) {
        if (!isStepAllowedByGridResolution(stepIndex)) continue;

        const sourceStepIndex = getRepetitionSourceStep(stepIndex);
        if (sourceStepIndex === null) continue;

        const storedValue = Boolean(pattern[instrumentIndex][stepIndex]);
        const effectiveValue = isEffectiveStepActive(instrumentIndex, stepIndex);
        if (storedValue === effectiveValue) continue;

        overrideStates.push(`${instrumentIndex}:${stepIndex}:${effectiveValue ? 1 : 0}`);
      }
    }

    return overrideStates.join("|");
  }

  function maybeShowRepetitionScopeChangeMessage(previousSnapshot, silent = false) {
    if (silent) return;
    if (repetitionLevel !== "strong" && repetitionLevel !== "partial") return;

    const nextSnapshot = captureVisibleRepetitionOverrideSnapshot();
    if (!nextSnapshot || previousSnapshot === nextSnapshot) return;

    showTemporaryTryMessage(getRepetitionAppliedMessage(), 4500, true);
  }

  function willStepBeDerived(stepIndex, level) {
    return getRepetitionSourceStepForLevel(stepIndex, level) !== null;
  }

  function getProjectedStepStateForRepetitionChange(
    instrumentIndex,
    stepIndex,
    previousLevel,
    nextLevel,
    activeScope
  ) {
    if (!activeScope[instrumentIndex][stepIndex]) {
      return Boolean(pattern[instrumentIndex][stepIndex]);
    }

    const wasDerived = willStepBeDerived(stepIndex, previousLevel);
    const willBeDerived = willStepBeDerived(stepIndex, nextLevel);

    if (wasDerived && !willBeDerived) {
      return isEffectiveStepActiveForLevel(instrumentIndex, stepIndex, previousLevel);
    }

    return isEffectiveStepActiveForLevel(instrumentIndex, stepIndex, nextLevel);
  }

  function isStepAllowedByGridResolution(stepIndex) {
    const stepNumber = stepIndex + 1;

    if (gridResolutionLevel === "fine") return true;
    if (gridResolutionLevel === "medium") return (stepNumber - 1) % 2 === 0;
    return (stepNumber - 1) % 4 === 0;
  }

  function refreshStepAvailabilityState() {
    allStepCells.forEach((cell) => {
      const stepIndex = Number(cell.dataset.step);
      const instrumentIndex = Number(cell.dataset.instrument);
      const isStepLocked = stepIndex >= loopLength;
      const isRowLocked = instrumentIndex >= kitSize;
      const isResolutionLocked = !isStepLocked && !isStepAllowedByGridResolution(stepIndex);
      const isDerived =
        !isStepLocked &&
        !isRowLocked &&
        !isResolutionLocked &&
        isStepDerivedByRepetition(instrumentIndex, stepIndex);
      cell.classList.toggle("step-cell--locked", isStepLocked);
      cell.classList.toggle("step-cell--row-locked", isRowLocked);
      cell.classList.toggle("step-cell--resolution-locked", isResolutionLocked);
      cell.classList.toggle("step-cell--derived", isDerived);
      cell.setAttribute(
        "aria-disabled",
        String(isStepLocked || isRowLocked || isResolutionLocked || isDerived)
      );
    });

    stepNumberElements.forEach((numberElement, stepIndex) => {
      const isStepLocked = stepIndex >= loopLength;
      const isResolutionLocked = !isStepLocked && !isStepAllowedByGridResolution(stepIndex);
      numberElement.classList.toggle("step-number--locked", isStepLocked);
      numberElement.classList.toggle("step-number--resolution-locked", isResolutionLocked);
    });

    refreshEffectivePatternState();
  }

  function updateLoopLengthState(options = {}) {
    const { silent = false } = options;
    const loopSlider = constraintSliders[LOOP_LENGTH_SLIDER_INDEX];
    if (!loopSlider) return;
    const previousSnapshot = captureVisibleRepetitionOverrideSnapshot();

    loopLength = readLoopLengthFromSliderValue(loopSlider.value);

    refreshStepAvailabilityState();

    if (currentStepIndex >= loopLength) {
      clearPlayhead();
      currentStepIndex = 0;
    }

    updateDensityState();
    maybeShowRepetitionScopeChangeMessage(previousSnapshot, silent);
  }

  function updateGridResolutionState(options = {}) {
    const { silent = false } = options;
    const gridSlider = constraintSliders[GRID_RESOLUTION_SLIDER_INDEX];
    if (!gridSlider) return;
    const previousSnapshot = captureVisibleRepetitionOverrideSnapshot();

    gridResolutionLevel = readGridResolutionFromSliderValue(gridSlider.value);
    refreshStepAvailabilityState();
    updateDensityState();
    maybeShowRepetitionScopeChangeMessage(previousSnapshot, silent);
  }

  function updateRepetitionState(options = {}) {
    const { silent = false } = options;
    const repetitionSlider = constraintSliders[REPETITION_SLIDER_INDEX];
    if (!repetitionSlider) return;

    const previousLevel = repetitionLevel;
    const nextLevel = readRepetitionLevelFromSliderValue(repetitionSlider.value);
    const activeScope = createActiveScopeMap();
    let shouldShowRepetitionMessage = false;

    if (nextLevel === "strong" || nextLevel === "partial") {
      for (let instrumentIndex = 0; instrumentIndex < kitSize; instrumentIndex += 1) {
        for (let stepIndex = 0; stepIndex < loopLength; stepIndex += 1) {
          if (!activeScope[instrumentIndex][stepIndex]) continue;

          const wasActive = isEffectiveStepActiveForLevel(instrumentIndex, stepIndex, previousLevel);
          const willBeActive = getProjectedStepStateForRepetitionChange(
            instrumentIndex,
            stepIndex,
            previousLevel,
            nextLevel,
            activeScope
          );

          if (wasActive !== willBeActive) {
            shouldShowRepetitionMessage = true;
            break;
          }
        }

        if (shouldShowRepetitionMessage) {
          break;
        }
      }
    }

    for (let instrumentIndex = 0; instrumentIndex < instruments.length; instrumentIndex += 1) {
      for (let stepIndex = 0; stepIndex < stepsPerInstrument; stepIndex += 1) {
        if (!activeScope[instrumentIndex][stepIndex]) continue;

        const wasDerived = getRepetitionSourceStepForLevel(stepIndex, previousLevel) !== null;
        const isDerived = getRepetitionSourceStepForLevel(stepIndex, nextLevel) !== null;
        if (!wasDerived || isDerived) continue;

        pattern[instrumentIndex][stepIndex] = isEffectiveStepActiveForLevel(instrumentIndex, stepIndex, previousLevel);
      }
    }

    repetitionLevel = nextLevel;
    refreshStepAvailabilityState();
    savePatternToStorage();
    updateDensityState();

    if (!silent && shouldShowRepetitionMessage) {
      showTemporaryTryMessage(
        getRepetitionAppliedMessage(nextLevel),
        4500,
        true
      );
    }
  }

  function readKitSizeFromSliderValue(sliderValue) {
    const sliderIndex = Math.max(1, Math.min(3, Number(sliderValue)));
    return KIT_SIZE_OPTIONS[sliderIndex - 1];
  }

  function updateKitSizeState(options = {}) {
    const { silent = false } = options;
    const kitSlider = constraintSliders[KIT_SIZE_SLIDER_INDEX];
    if (!kitSlider) return;
    const previousSnapshot = captureVisibleRepetitionOverrideSnapshot();

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

    refreshStepAvailabilityState();

    updateDensityState();
    maybeShowRepetitionScopeChangeMessage(previousSnapshot, silent);
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

  function readGuidanceLevelFromSliderValue(sliderValue) {
    const sliderIndex = Math.max(1, Math.min(3, Number(sliderValue)));
    return GUIDANCE_LEVELS[sliderIndex - 1];
  }

  function getGuidanceGhostAnchors(activeLoopLength) {
    const halfLength = activeLoopLength / 2;
    const quarterLength = activeLoopLength / 4;

    return {
      0: [0, halfLength],
      1: [quarterLength, quarterLength + halfLength],
    };
  }

  function isGuidanceColumn(stepIndex, activeLoopLength, level = guidanceLevel) {
    if (level !== "light" || stepIndex >= activeLoopLength) return false;

    if (activeLoopLength === 8) {
      return [0, 2, 4, 6].includes(stepIndex);
    }

    if (activeLoopLength === 16) {
      return [0, 4, 8, 12].includes(stepIndex);
    }

    return [0, 8, 16, 24].includes(stepIndex);
  }

  function getGuidanceTryMessage(level = guidanceLevel) {
    if (level === "strong") {
      return "Try starting with the suggested kick and snare steps (you don't need to use every suggestion).";
    }
    if (level === "light") {
      return "Try starting with the highlighted beat positions (you don't need to use every suggestion).";
    }
    return "Try creating your own pattern freely.";
  }

  function setTryThisAlertState(isAlert) {
    if (!tryThisText) return;
    tryThisText.classList.toggle("try-inline-text--alert", isAlert);
  }

  function refreshPersistentTryMessage() {
    if (isOverDensityLimit) return;

    const nextMessage = guidanceLevel === "free" ? baseTryThisMessage : getGuidanceTryMessage();
    if (persistentTryMessage !== nextMessage) {
      persistentTryMessage = nextMessage;
      if (tryThisText && tryThisMessageTimeoutId === null) {
        setTryThisAlertState(false);
        tryThisText.textContent = persistentTryMessage;
      }
    }
  }

  function countActiveHitsInEditableRegion() {
    let count = 0;
    for (let instrumentIndex = 0; instrumentIndex < kitSize; instrumentIndex += 1) {
      for (let stepIndex = 0; stepIndex < loopLength; stepIndex += 1) {
        if (!isStepAllowedByGridResolution(stepIndex)) continue;
        if (isEffectiveStepActive(instrumentIndex, stepIndex)) {
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

  function showTemporaryTryMessage(message, durationMs = 1500, isAlert = false) {
    if (!tryThisText) return;

    setTryThisAlertState(isAlert);
    tryThisText.textContent = message;

    if (tryThisMessageTimeoutId !== null) {
      window.clearTimeout(tryThisMessageTimeoutId);
    }

    tryThisMessageTimeoutId = window.setTimeout(() => {
      setTryThisAlertState(isOverDensityLimit);
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

  function triggerDerivedStepFeedback(stepCell) {
    stepCell.classList.remove("step-cell--derived-feedback");
    void stepCell.offsetWidth;
    stepCell.classList.add("step-cell--derived-feedback");

    window.setTimeout(() => {
      stepCell.classList.remove("step-cell--derived-feedback");
    }, 280);
  }

  function tryActivateStepCell(stepCell, instrumentIndex, stepIndex) {
    if (
      stepIndex >= loopLength ||
      instrumentIndex >= kitSize ||
      !isStepAllowedByGridResolution(stepIndex)
    ) {
      return false;
    }

    if (isStepDerivedByRepetition(instrumentIndex, stepIndex)) {
      return false;
    }

    if (pattern[instrumentIndex][stepIndex]) {
      return false;
    }

    const compliance = getDensityComplianceState();
    if (compliance.isOverLimit) {
      triggerBlockedStepFeedback(stepCell);
      showTemporaryTryMessage(
        `Over density limit (${compliance.maxHits} max). Remove hits to add new ones.`,
        3000,
        true
      );
      return false;
    }

    if (Number.isFinite(compliance.maxHits) && compliance.hitCount >= compliance.maxHits) {
      triggerBlockedStepFeedback(stepCell);
      showTemporaryTryMessage(
        `Density limit reached (${compliance.maxHits} max). Remove a hit to add another.`,
        3000,
        true
      );
      return false;
    }

    pattern[instrumentIndex][stepIndex] = true;
    refreshEffectivePatternState();
    savePatternToStorage();
    updateDensityState();
    gridInteractionDirty = true;
    return true;
  }

  function beginGridInteractionSnapshot() {
    if (!activeGridHistorySnapshot) {
      activeGridHistorySnapshot = getEditorStateSnapshot();
    }
  }

  function finalizeGridInteractionSnapshot() {
    if (!activeGridHistorySnapshot) return;

    if (gridInteractionDirty) {
      pushUndoState(activeGridHistorySnapshot);
    }

    activeGridHistorySnapshot = null;
    gridInteractionDirty = false;
  }

  function beginSliderInteractionSnapshot() {
    if (!pendingSliderHistorySnapshot) {
      pendingSliderHistorySnapshot = getEditorStateSnapshot();
    }
  }

  function finalizeSliderInteractionSnapshot() {
    if (!pendingSliderHistorySnapshot) return;

    pushUndoState(pendingSliderHistorySnapshot);
    pendingSliderHistorySnapshot = null;
  }

  function isTypingTarget(element) {
    if (!element) return false;
    if (element.isContentEditable) return true;

    const tagName = element.tagName;
    if (tagName === "TEXTAREA" || tagName === "SELECT") return true;
    if (tagName !== "INPUT") return false;

    const inputType = element.type;
    return inputType !== "range" && inputType !== "checkbox" && inputType !== "button";
  }

  function isGridCellNavigable(instrumentIndex, stepIndex) {
    return (
      instrumentIndex >= 0 &&
      instrumentIndex < kitSize &&
      stepIndex >= 0 &&
      stepIndex < loopLength &&
      isStepAllowedByGridResolution(stepIndex) &&
      !isStepDerivedByRepetition(instrumentIndex, stepIndex)
    );
  }

  function getFirstNavigableGridCell() {
    for (let instrumentIndex = 0; instrumentIndex < kitSize; instrumentIndex += 1) {
      for (let stepIndex = 0; stepIndex < loopLength; stepIndex += 1) {
        if (isStepAllowedByGridResolution(stepIndex)) {
          return { instrumentIndex, stepIndex };
        }
      }
    }

    return null;
  }

  function normalizeSelectedGridCell() {
    if (isGridCellNavigable(selectedInstrumentIndex, selectedStepIndex)) return;

    const firstCell = getFirstNavigableGridCell();
    if (!firstCell) return;

    selectedInstrumentIndex = firstCell.instrumentIndex;
    selectedStepIndex = firstCell.stepIndex;
  }

  function refreshKeyboardGridSelection() {
    normalizeSelectedGridCell();

    allStepCells.forEach((cell) => {
      const instrumentIndex = Number(cell.dataset.instrument);
      const stepIndex = Number(cell.dataset.step);
      const isSelected =
        isKeyboardGridSelectionVisible &&
        instrumentIndex === selectedInstrumentIndex &&
        stepIndex === selectedStepIndex &&
        isGridCellNavigable(instrumentIndex, stepIndex);

      cell.classList.toggle("step-cell--keyboard-selected", isSelected);
    });
  }

  function setKeyboardGridSelection(instrumentIndex, stepIndex) {
    if (!isGridCellNavigable(instrumentIndex, stepIndex)) return false;

    selectedInstrumentIndex = instrumentIndex;
    selectedStepIndex = stepIndex;
    refreshKeyboardGridSelection();
    return true;
  }

  function moveKeyboardGridSelection(stepDelta, instrumentDelta) {
    normalizeSelectedGridCell();

    if (stepDelta !== 0) {
      let nextStepIndex = selectedStepIndex + stepDelta;
      while (nextStepIndex >= 0 && nextStepIndex < loopLength) {
        if (isGridCellNavigable(selectedInstrumentIndex, nextStepIndex)) {
          return setKeyboardGridSelection(selectedInstrumentIndex, nextStepIndex);
        }
        nextStepIndex += stepDelta;
      }
      return false;
    }

    if (instrumentDelta !== 0) {
      const nextInstrumentIndex = selectedInstrumentIndex + instrumentDelta;
      if (!isGridCellNavigable(nextInstrumentIndex, selectedStepIndex)) return false;
      return setKeyboardGridSelection(nextInstrumentIndex, selectedStepIndex);
    }

    return false;
  }

  function isKeyboardBlurTarget(element) {
    if (!(element instanceof HTMLElement)) return false;

    return (
      element.classList.contains("playback-toggle-button") ||
      element.classList.contains("clear-button") ||
      element.classList.contains("lock-checkbox") ||
      element.classList.contains("step-cell") ||
      element.classList.contains("constraint-slider") ||
      element.classList.contains("instrument-label") ||
      element.classList.contains("metronome-toggle-button") ||
      element.classList.contains("constraints-reset-button")
    );
  }

  function refreshEffectivePatternState() {
    allStepCells.forEach((cell) => {
      const instrumentIndex = Number(cell.dataset.instrument);
      const stepIndex = Number(cell.dataset.step);
      const isActive = isEffectiveStepActive(instrumentIndex, stepIndex);
      cell.classList.toggle("step-cell--active", isActive);
      cell.setAttribute("aria-pressed", String(isActive));

      const isStepLocked = stepIndex >= loopLength;
      const isRowLocked = instrumentIndex >= kitSize;
      const isResolutionLocked = !isStepLocked && !isStepAllowedByGridResolution(stepIndex);
      const isDerived = !isStepLocked && !isRowLocked && !isResolutionLocked &&
        isStepDerivedByRepetition(instrumentIndex, stepIndex);
      const isGuidanceGhost = !isStepLocked && !isRowLocked && !isResolutionLocked &&
        !isDerived && isGuidanceGhostAnchor(instrumentIndex, stepIndex);
      const isGuidanceColumnHighlight = !isStepLocked && !isRowLocked && !isResolutionLocked &&
        isGuidanceColumn(stepIndex, loopLength);

      cell.classList.toggle("step-cell--guidance-ghost", isGuidanceGhost);
      cell.classList.toggle("step-cell--guidance-column", isGuidanceColumnHighlight);
    });

    refreshKeyboardGridSelection();
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

    if (isOverDensityLimit) {
      const limitedMaxHits = Number.isFinite(compliance.maxHits) ? compliance.maxHits : 0;
      const nextMessage = `Over density limit: ${compliance.hitCount} hits in steps 1-${compliance.activeSteps} (max ${limitedMaxHits}). Remove ${compliance.overBy} hits to continue adding.`;
      if (persistentTryMessage !== nextMessage) {
        persistentTryMessage = nextMessage;
        if (tryThisText && tryThisMessageTimeoutId === null) {
          setTryThisAlertState(true);
          tryThisText.textContent = persistentTryMessage;
        }
      }
    } else {
      refreshPersistentTryMessage();
    }

    allStepCells.forEach((cell) => {
      const instrumentIndex = Number(cell.dataset.instrument);
      const stepIndex = Number(cell.dataset.step);
      const isActive = isEffectiveStepActive(instrumentIndex, stepIndex);
      const inActiveRegion =
        instrumentIndex < kitSize &&
        stepIndex < loopLength &&
        isStepAllowedByGridResolution(stepIndex);
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

    function clearActiveInstrument() {
      instrumentButtons.forEach((button) => {
        button.classList.remove("instrument--active");
        button.setAttribute("aria-pressed", "false");
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
        window.setTimeout(clearActiveInstrument, 140);
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

      stepButton.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;

        setKeyboardGridSelection(instrumentIndex, stepIndex);
        beginGridInteractionSnapshot();
        isGridPointerDown = true;
        isGridDragPlacing = false;
        pendingDragStartCell = { stepButton, instrumentIndex, stepIndex };
      });

      stepButton.addEventListener("mouseenter", () => {
        if (!isGridPointerDown) return;

        const startedElsewhere =
          pendingDragStartCell &&
          (
            pendingDragStartCell.instrumentIndex !== instrumentIndex ||
            pendingDragStartCell.stepIndex !== stepIndex
          );

        if (startedElsewhere) {
          isGridDragPlacing = true;
          suppressNextGridClick = true;
          tryActivateStepCell(
            pendingDragStartCell.stepButton,
            pendingDragStartCell.instrumentIndex,
            pendingDragStartCell.stepIndex
          );
          pendingDragStartCell = null;
        }

        if (isGridDragPlacing) {
          tryActivateStepCell(stepButton, instrumentIndex, stepIndex);
        }
      });

      stepButton.addEventListener("click", () => {
        if (suppressNextGridClick) {
          suppressNextGridClick = false;
          return;
        }

        setKeyboardGridSelection(instrumentIndex, stepIndex);

        if (
          stepIndex >= loopLength ||
          instrumentIndex >= kitSize ||
          !isStepAllowedByGridResolution(stepIndex)
        ) {
          return;
        }

        if (isStepDerivedByRepetition(instrumentIndex, stepIndex)) {
          triggerDerivedStepFeedback(stepButton);
          return;
        }

        const isCurrentlyActive = pattern[instrumentIndex][stepIndex];
        if (!isCurrentlyActive) {
          tryActivateStepCell(stepButton, instrumentIndex, stepIndex);
          return;
        }

        pattern[instrumentIndex][stepIndex] = false;
        refreshEffectivePatternState();
        savePatternToStorage();
        updateDensityState();
        gridInteractionDirty = true;
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
    clearActiveInstrument();
  }

  document.addEventListener("mouseup", () => {
    const shouldResetSuppressedClick = isGridDragPlacing;
    isGridPointerDown = false;
    isGridDragPlacing = false;
    pendingDragStartCell = null;

    if (shouldResetSuppressedClick) {
      window.setTimeout(() => {
        suppressNextGridClick = false;
      }, 0);
    }

    window.setTimeout(() => {
      finalizeGridInteractionSnapshot();
    }, 0);
  });

  document.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    if (!isKeyboardGridSelectionVisible) return;

    isKeyboardGridSelectionVisible = false;
    refreshKeyboardGridSelection();
  });

  if (clearPatternButton) {
    clearPatternButton.addEventListener("click", () => {
      if (!window.confirm("Are you sure you want to clear the pattern?")) {
        return;
      }

      const previousState = getEditorStateSnapshot();

      pattern.forEach((row) => row.fill(false));

      allStepCells.forEach((cell) => {
        cell.classList.remove("step-cell--active", "step-cell--playhead");
        cell.setAttribute("aria-pressed", "false");
      });

      previousStepIndex = -1;
      savePatternToStorage();
      refreshEffectivePatternState();
      updateDensityState();
      pushUndoState(previousState);
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

    if (index === GRID_RESOLUTION_SLIDER_INDEX) {
      const level = readGridResolutionFromSliderValue(value);
      valueLabel.textContent = `Grid: ${level.charAt(0).toUpperCase() + level.slice(1)}`;
      return;
    }

    if (index === KIT_SIZE_SLIDER_INDEX) {
      valueLabel.textContent = `Kit: ${readKitSizeFromSliderValue(value)}`;
      return;
    }

    if (index === GUIDANCE_SLIDER_INDEX) {
      const level = readGuidanceLevelFromSliderValue(value);
      valueLabel.textContent = `Guidance: ${level.charAt(0).toUpperCase() + level.slice(1)}`;
      return;
    }

    if (index === DENSITY_SLIDER_INDEX) {
      const level = readDensityLevelFromSliderValue(value);
      valueLabel.textContent = `Density: ${level.charAt(0).toUpperCase() + level.slice(1)}`;
      return;
    }

    if (index === REPETITION_SLIDER_INDEX) {
      const level = readRepetitionLevelFromSliderValue(value);
      valueLabel.textContent = `Repetition: ${level.charAt(0).toUpperCase() + level.slice(1)}`;
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

  // Per-slider input handling: update labels, refresh current constraint/guidance state, and persist undoable values.
  loadConstraintValuesFromStorage();

  constraintSliders.forEach((slider, index) => {
    updateSliderLabel(index, slider.value);

    slider.addEventListener("pointerdown", () => {
      beginSliderInteractionSnapshot();
    });

    slider.addEventListener("focus", () => {
      beginSliderInteractionSnapshot();
    });

    slider.addEventListener("input", () => {
      if (lockSlidersCheckbox.checked) {
        setAllSliderValues(slider.value);
        updateLoopLengthState();
        updateGridResolutionState();
        updateKitSizeState();
        updateGuidanceState();
        updateRepetitionState();
        saveConstraintValuesToStorage();
        return;
      }

      updateSliderLabel(index, slider.value);
      if (index === LOOP_LENGTH_SLIDER_INDEX) {
        updateLoopLengthState();
      }
      if (index === GRID_RESOLUTION_SLIDER_INDEX) {
        updateGridResolutionState();
      }
      if (index === KIT_SIZE_SLIDER_INDEX) {
        updateKitSizeState();
      }
      if (index === GUIDANCE_SLIDER_INDEX) {
        updateGuidanceState();
      }
      if (index === DENSITY_SLIDER_INDEX) {
        updateDensityState();
      }
      if (index === REPETITION_SLIDER_INDEX) {
        updateRepetitionState();
      }
      saveConstraintValuesToStorage();
    });

    slider.addEventListener("change", () => {
      finalizeSliderInteractionSnapshot();
    });

    slider.addEventListener("blur", () => {
      finalizeSliderInteractionSnapshot();
    });
  });

  if (resetConstraintsButton) {
    resetConstraintsButton.addEventListener("click", () => {
      if (!window.confirm("Are you sure you want to reset all constraints?")) {
        return;
      }

      const previousState = getEditorStateSnapshot();

      constraintSliders.forEach((slider, index) => {
        slider.value = slider.defaultValue;
        updateSliderLabel(index, slider.value);
      });

      updateLoopLengthState({ silent: true });
      updateGridResolutionState({ silent: true });
      updateKitSizeState({ silent: true });
      updateGuidanceState({ silent: true });
      updateRepetitionState({ silent: true });
      saveConstraintValuesToStorage();
      pushUndoState(previousState);
    });
  }

  function updateGuidanceState(options = {}) {
    const { silent = false } = options;
    const guidanceSlider = constraintSliders[GUIDANCE_SLIDER_INDEX];
    if (!guidanceSlider) return;

    const previousLevel = guidanceLevel;
    guidanceLevel = readGuidanceLevelFromSliderValue(guidanceSlider.value);

    if (previousLevel === "free" && guidanceLevel !== "free" && tryThisMessageTimeoutId !== null) {
      window.clearTimeout(tryThisMessageTimeoutId);
      tryThisMessageTimeoutId = null;
    }

    refreshEffectivePatternState();
    refreshPersistentTryMessage();

    if (
      !silent &&
      previousLevel !== guidanceLevel &&
      guidanceLevel === "free" &&
      !isOverDensityLimit
    ) {
      showTemporaryTryMessage(getGuidanceTryMessage("free"), 4000);
    }
  }

  updateLoopLengthState({ silent: true });
  updateGridResolutionState({ silent: true });
  updateKitSizeState({ silent: true });
  updateGuidanceState({ silent: true });
  updateRepetitionState({ silent: true });

  document.addEventListener("keydown", (event) => {
    if (isTypingTarget(document.activeElement)) return;

    const navigationKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"]);
    if (!navigationKeys.has(event.key)) return;

    if (event.altKey || event.ctrlKey || event.metaKey) return;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      isKeyboardGridSelectionVisible = true;
      moveKeyboardGridSelection(-1, 0);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      isKeyboardGridSelectionVisible = true;
      moveKeyboardGridSelection(1, 0);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      isKeyboardGridSelectionVisible = true;
      moveKeyboardGridSelection(0, -1);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      isKeyboardGridSelectionVisible = true;
      moveKeyboardGridSelection(0, 1);
      return;
    }

    normalizeSelectedGridCell();
    const selectedCell = stepCellsByInstrument[selectedInstrumentIndex]?.[selectedStepIndex];
    if (!selectedCell || !isGridCellNavigable(selectedInstrumentIndex, selectedStepIndex)) return;

    event.preventDefault();
    isKeyboardGridSelectionVisible = true;
    refreshKeyboardGridSelection();
    selectedCell.click();
  });

  document.addEventListener("keydown", (event) => {
    const target = document.activeElement;
    if (!isKeyboardBlurTarget(target) || isTypingTarget(target)) return;

    if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(event.key)) {
      return;
    }

    target.blur();

    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (isTypingTarget(document.activeElement)) return;

    const isUndoShortcut = (isMacPlatform && event.metaKey && !event.shiftKey && event.key.toLowerCase() === "z") ||
      (!isMacPlatform && event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "z");
    const isRedoShortcut = (isMacPlatform && event.metaKey && event.shiftKey && event.key.toLowerCase() === "z") ||
      (!isMacPlatform && event.ctrlKey && event.key.toLowerCase() === "y");

    if (!isUndoShortcut && !isRedoShortcut) return;

    event.preventDefault();

    if (isUndoShortcut) {
      performUndo();
      return;
    }

    performRedo();
  });
});

