document.addEventListener("DOMContentLoaded", () => {
  console.log("ConstraintLab UI initialized.");

  // Transport control and constraint UI elements.
  const playbackToggleButton = document.getElementById("playbackToggleButton");
  const constraintSliders = Array.from(document.querySelectorAll(".constraint-slider"));
  const constraintLevelLabels = Array.from(
    document.querySelectorAll(".constraint-level-value")
  );
  const lockSlidersCheckbox = document.getElementById("lock-sliders");
  let isPlaying = false;

  // Simple play/pause UI state toggle (audio engine wiring comes later).
  if (playbackToggleButton) {
    playbackToggleButton.addEventListener("click", () => {
      isPlaying = !isPlaying;

      playbackToggleButton.classList.toggle("is-play", !isPlaying);
      playbackToggleButton.classList.toggle("is-pause", isPlaying);
      playbackToggleButton.setAttribute(
        "aria-label",
        isPlaying ? "Pause playback" : "Start playback"
      );

      if (isPlaying) {
        console.log("Playback started.");
      } else {
        console.log("Playback stopped.");
      }
    });
  }

  // Basic sequencer scaffold (visual editing only; no playback timing yet).
  const sequencerMount = document.getElementById("stepSequencer");
  const instruments = [
    { name: "Kick" },
    { name: "Snare" },
    { name: "Hi-hat" },
  ];
  const stepsPerInstrument = 32;
  const pattern = Array.from({ length: instruments.length }, () =>
    Array(stepsPerInstrument).fill(false)
  );

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
      label.addEventListener("click", () => setActiveInstrument(instrumentIndex));
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
      });

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
