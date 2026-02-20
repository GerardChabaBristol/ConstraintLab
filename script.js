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
