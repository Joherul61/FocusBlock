const CONFIG_URL = chrome.runtime.getURL("rules/rules.json");
const setupView = document.getElementById("setup-view");
const activeView = document.getElementById("active-view");
const completionView = document.getElementById("completion-view");
const siteOptions = document.getElementById("site-options");
const durationSelect = document.getElementById("duration");
const customDuration = document.getElementById("custom-duration");
const customHours = document.getElementById("custom-hours");
const customMinutes = document.getElementById("custom-minutes");
const focusForm = document.getElementById("focus-form");
const countdown = document.getElementById("countdown");
const blockedSites = document.getElementById("blocked-sites");
const messageElement = document.getElementById("message");
const stopButton = document.getElementById("stop-button");
const activeHeading = document.querySelector(".active-heading");
const activeDescription = document.getElementById("active-description");
const lockdownStatus = document.getElementById("lockdown-status");
const attemptUnlockButton = document.getElementById("attempt-unlock-button");
const unlockForm = document.getElementById("unlock-form");
const unlockPassword = document.getElementById("unlock-password");
const completedDuration = document.getElementById("completed-duration");
const completionOutcome = document.getElementById("completion-outcome");
const completedSites = document.getElementById("completed-sites");
const anotherSessionButton = document.getElementById("another-session-button");
const settingsButton = document.getElementById("settings-button");

let config;
let countdownInterval;
let expiryRefreshPending = false;

async function loadConfig() {
  const response = await fetch(CONFIG_URL);
  if (!response.ok) {
    throw new Error("FocusBlock configuration could not be loaded.");
  }
  return response.json();
}

function createSiteOption(site, checked = false) {
  const label = document.createElement("label");
  label.className = "site-option";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = "site";
  checkbox.value = site.id;
  checkbox.checked = checked;
  checkbox.disabled = site.enabled === false;

  const name = document.createElement("span");
  name.textContent = site.name;
  label.append(checkbox, name);
  return label;
}

function renderOptions(customSites = [], settings = null) {
  siteOptions.replaceChildren();
  config.categories.forEach((category) => {
    const group = document.createElement("fieldset");
    group.className = "site-category";
    const title = document.createElement("legend");
    title.textContent = category.name;
    const grid = document.createElement("div");
    grid.className = "site-grid";

    config.sites
      .filter((site) => site.category === category.id)
      .forEach((site) => grid.append(createSiteOption(site)));

    group.append(title, grid);
    siteOptions.append(group);
  });

  const customGroup = document.createElement("fieldset");
  customGroup.className = "site-category custom-category";
  const customTitle = document.createElement("legend");
  customTitle.textContent = "Custom Websites";
  const customGrid = document.createElement("div");
  customGrid.className = "site-grid";
  const enabledCustomSites = customSites.filter((site) => site.enabled);

  if (enabledCustomSites.length) {
    enabledCustomSites.forEach((site) => {
      customGrid.append(createSiteOption({
        id: site.id,
        name: site.domain,
        enabled: site.enabled
      }));
    });
  } else {
    const emptyNote = document.createElement("p");
    emptyNote.className = "empty-note";
    emptyNote.textContent = "Add websites in Settings to block them here.";
    customGrid.append(emptyNote);
  }
  customGroup.append(customTitle, customGrid);
  siteOptions.append(customGroup);

  durationSelect.replaceChildren();
  config.durations.forEach((duration) => {
    const option = document.createElement("option");
    option.value = String(duration.minutes);
    option.textContent = duration.label;
    durationSelect.append(option);
  });
  const customOption = document.createElement("option");
  customOption.value = "custom";
  customOption.textContent = "Custom Duration";
  durationSelect.append(customOption);

  const defaultDuration = settings?.durationMinutes || 30;
  if (config.durations.some((duration) => duration.minutes === defaultDuration)) {
    durationSelect.value = String(defaultDuration);
    customDuration.hidden = true;
  } else {
    durationSelect.value = "custom";
    customDuration.hidden = false;
    customHours.value = String(Math.floor(defaultDuration / 60));
    customMinutes.value = String(defaultDuration % 60);
  }

  const defaultMode = settings?.mode || "focus";
  focusForm.querySelector(`input[name="mode"][value="${defaultMode}"]`).checked = true;
  focusForm.querySelector('button[type="submit"]').textContent =
    defaultMode === "lockdown" ? "Start Lockdown" : "Start Focus";
}

function formatRemainingTime(endTime) {
  const remainingSeconds = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

function showMessage(message) {
  messageElement.textContent = message || "";
}

function getSiteNameMap(customSites = []) {
  const siteNames = new Map(config.sites.map((site) => [site.id, site.name]));
  customSites.forEach((site) => siteNames.set(site.id, site.domain));
  return siteNames;
}

function fillSiteSummary(container, selectedSites, customSites = []) {
  const siteNames = getSiteNameMap(customSites);
  container.textContent = selectedSites
    .map((siteId) => siteNames.get(siteId) || siteId.replace(/^custom:/, ""))
    .join(", ");
}

function renderActiveSession(session, customSites = [], blockingError = null) {
  clearInterval(countdownInterval);
  setupView.hidden = true;
  activeView.hidden = false;
  completionView.hidden = true;
  showMessage("");

  const isLockdown = session.mode === "lockdown";
  activeHeading.textContent = isLockdown ? "🔒 LOCKDOWN MODE" : "⚡ FOCUS MODE";
  activeHeading.classList.toggle("lockdown", isLockdown);
  activeDescription.textContent = isLockdown
    ? "This session is locked."
    : "You can stop this session.";
  stopButton.hidden = isLockdown;
  lockdownStatus.hidden = !isLockdown;
  attemptUnlockButton.hidden = !isLockdown;
  unlockForm.hidden = true;
  unlockPassword.value = "";
  fillSiteSummary(blockedSites, session.selectedSites, customSites);
  if (blockingError) {
    showMessage(`Blocking needs attention: ${blockingError}`);
  }

  const updateCountdown = () => {
    countdown.textContent = formatRemainingTime(session.endTime);
    if (session.endTime <= Date.now() && !expiryRefreshPending) {
      expiryRefreshPending = true;
      refreshState();
    }
  };
  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 1000);
}

function renderSetup() {
  clearInterval(countdownInterval);
  setupView.hidden = false;
  activeView.hidden = true;
  completionView.hidden = true;
  showMessage("");
}

function renderCompletion(completion, customSites = []) {
  clearInterval(countdownInterval);
  setupView.hidden = true;
  activeView.hidden = true;
  completionView.hidden = false;
  showMessage("");
  completedDuration.textContent = completion.elapsedMinutes === 1
    ? "1 minute"
    : `${completion.elapsedMinutes} minutes`;
  completionOutcome.textContent = completion.outcome === "completed"
    ? "Completed naturally"
    : "Manually stopped";
  fillSiteSummary(completedSites, completion.selectedSites, customSites);
}

async function sendRequest(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || !response.ok) {
    throw new Error(response?.error || "FocusBlock could not complete that request.");
  }
  return response;
}

async function refreshState() {
  try {
    const response = await sendRequest({ type: "GET_STATE" });
    renderOptions(response.customSites, response.settings);
    if (response.focusActive && response.session) {
      expiryRefreshPending = false;
      renderActiveSession(
        response.session,
        response.customSites,
        response.blockingError
      );
    } else if (response.completion) {
      expiryRefreshPending = false;
      renderCompletion(response.completion, response.customSites);
    } else {
      expiryRefreshPending = false;
      renderSetup();
    }
  } catch (error) {
    expiryRefreshPending = false;
    showMessage(error.message);
  }
}

function getSelectedDuration() {
  if (durationSelect.value !== "custom") {
    return Number(durationSelect.value);
  }

  const hours = Number(customHours.value);
  const minutes = Number(customMinutes.value);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) ||
      hours < 0 || hours > 12 || minutes < 0 || minutes > 59 ||
      (hours === 0 && minutes === 0)) {
    throw new Error("Enter a custom duration between 1 minute and 12 hours.");
  }
  return hours * 60 + minutes;
}

durationSelect.addEventListener("change", () => {
  customDuration.hidden = durationSelect.value !== "custom";
});

focusForm.querySelectorAll('input[name="mode"]').forEach((modeInput) => {
  modeInput.addEventListener("change", () => {
    focusForm.querySelector('button[type="submit"]').textContent =
      modeInput.value === "lockdown" ? "Start Lockdown" : "Start Focus";
  });
});

focusForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");

  const selectedSites = Array.from(
    focusForm.querySelectorAll('input[name="site"]:checked'),
    (checkbox) => checkbox.value
  );
  if (selectedSites.length === 0) {
    showMessage("Select at least one website to block.");
    return;
  }

  let durationMinutes;
  try {
    durationMinutes = getSelectedDuration();
  } catch (error) {
    showMessage(error.message);
    return;
  }

  const submitButton = focusForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const response = await sendRequest({
      type: "START_FOCUS",
      selectedSites,
      durationMinutes,
      mode: focusForm.querySelector('input[name="mode"]:checked').value
    });
    if (response.session) {
      renderActiveSession(response.session);
    } else {
      await refreshState();
    }
  } catch (error) {
    showMessage(error.message);
  } finally {
    submitButton.disabled = false;
  }
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  showMessage("");
  try {
    const response = await sendRequest({ type: "STOP_FOCUS" });
    if (response.completion) {
      renderCompletion(response.completion);
    } else {
      renderSetup();
    }
  } catch (error) {
    showMessage(error.message);
  } finally {
    stopButton.disabled = false;
  }
});

attemptUnlockButton.addEventListener("click", () => {
  unlockForm.hidden = false;
  attemptUnlockButton.hidden = true;
  unlockPassword.focus();
});

unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");
  if (!unlockPassword.reportValidity()) {
    return;
  }

  const password = unlockPassword.value;
  unlockPassword.value = "";
  const unlockButton = unlockForm.querySelector('button[type="submit"]');
  unlockButton.disabled = true;
  try {
    const response = await sendRequest({ type: "UNLOCK_LOCKDOWN", password });
    if (response.unlocked && response.completion) {
      renderCompletion(response.completion);
    } else if (response.completed && response.completion) {
      renderCompletion(response.completion);
    } else {
      showMessage("Incorrect password. The focus session continues.");
      unlockPassword.focus();
    }
  } catch (error) {
    showMessage(error.message);
  } finally {
    unlockButton.disabled = false;
  }
});

anotherSessionButton.addEventListener("click", async () => {
  anotherSessionButton.disabled = true;
  try {
    await sendRequest({ type: "DISMISS_COMPLETION" });
    renderSetup();
  } catch (error) {
    showMessage(error.message);
  } finally {
    anotherSessionButton.disabled = false;
  }
});

settingsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

async function initialize() {
  try {
    config = await loadConfig();
    await refreshState();
  } catch (error) {
    showMessage(error.message);
  }
}

initialize();
