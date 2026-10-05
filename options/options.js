const CONFIG_URL = chrome.runtime.getURL("rules/rules.json");
const DEFAULT_SETTINGS = { durationMinutes: 30, mode: "focus" };
const customSiteList = document.getElementById("custom-site-list");
const customSiteForm = document.getElementById("custom-site-form");
const customDomainInput = document.getElementById("custom-domain");
const customSiteMessage = document.getElementById("custom-site-message");
const settingsMessage = document.getElementById("settings-message");
const statisticsMessage = document.getElementById("statistics-message");
const durationSelect = document.getElementById("default-duration");
const customDuration = document.getElementById("default-custom-duration");
const customHours = document.getElementById("default-hours");
const customMinutes = document.getElementById("default-minutes");
const modeSelect = document.getElementById("default-mode");
const emptyCustomSites = document.getElementById("empty-custom-sites");

let config;
let state;

async function sendRequest(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || !response.ok) {
    throw new Error(response?.error || "FocusBlock could not complete that request.");
  }
  return response;
}

function showMessage(element, message) {
  element.textContent = message || "";
}

function renderDurationOptions() {
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
}

function renderSettings(settings) {
  if (config.durations.some((item) => item.minutes === settings.durationMinutes)) {
    durationSelect.value = String(settings.durationMinutes);
    customDuration.hidden = true;
  } else {
    durationSelect.value = "custom";
    customDuration.hidden = false;
    customHours.value = String(Math.floor(settings.durationMinutes / 60));
    customMinutes.value = String(settings.durationMinutes % 60);
  }
  modeSelect.value = settings.mode;
}

function formatFocusTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function renderStatistics(statistics, streak) {
  const today = new Date();
  const todayKey = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
  ].join("-");
  const todayStats = statistics.daily[todayKey] || {};

  document.getElementById("streak").textContent =
    `🔥 ${streak} day streak`;
  document.getElementById("today-focus-time").textContent =
    formatFocusTime(todayStats.focusMinutes || 0);
  document.getElementById("today-sessions").textContent = todayStats.sessions || 0;
  document.getElementById("today-completed").textContent = todayStats.completed || 0;
  document.getElementById("today-stopped").textContent = todayStats.stoppedEarly || 0;
  document.getElementById("today-lockdown").textContent = todayStats.lockdown || 0;
  document.getElementById("total-completed").textContent = statistics.completedSessions;
  document.getElementById("total-focus-time").textContent =
    formatFocusTime(statistics.totalFocusMinutes);
  document.getElementById("total-focus-sessions").textContent =
    statistics.totalFocusSessions;
  document.getElementById("total-lockdown-sessions").textContent =
    statistics.totalLockdownSessions;
  document.getElementById("total-stopped").textContent =
    statistics.manuallyStoppedSessions;
}

function normalizeDomain(value) {
  const domain = value.trim().toLowerCase();
  if (!domain || /[/:@?#\s*]/.test(domain)) {
    throw new Error("Enter a domain only, such as example.com.");
  }
  const normalized = new URL(`https://${domain}`).hostname;
  if (normalized !== domain || !domain.includes(".") ||
      domain.split(".").some((label) =>
        !label || label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
      ) ||
      /^\d+(?:\.\d+){3}$/.test(domain)) {
    throw new Error("Enter a valid website domain, such as example.com.");
  }
  return domain;
}

function getOriginPattern(domain) {
  return `*://*.${domain}/*`;
}

async function hasOriginPermission(domain) {
  return chrome.permissions.contains({ origins: [getOriginPattern(domain)] });
}

async function requestOriginPermission(domain) {
  return chrome.permissions.request({ origins: [getOriginPattern(domain)] });
}

async function saveCustomSites(sites) {
  const response = await sendRequest({
    type: "SAVE_CUSTOM_SITES",
    customSites: sites
  });
  state.customSites = response.customSites;
  await renderCustomSites();
}

async function renderCustomSites() {
  customSiteList.replaceChildren();
  emptyCustomSites.hidden = state.customSites.length > 0;

  for (const site of state.customSites) {
    const item = document.createElement("li");
    item.className = "custom-site-item";

    const text = document.createElement("div");
    const domain = document.createElement("div");
    domain.className = "site-domain";
    domain.textContent = site.domain;
    text.append(domain);
    const permissionGranted = await hasOriginPermission(site.domain);
    if (!permissionGranted) {
      const warning = document.createElement("p");
      warning.className = "permission-note";
      warning.textContent = "Site access is not granted.";
      text.append(warning);
      const grantButton = document.createElement("button");
      grantButton.type = "button";
      grantButton.className = "grant-site";
      grantButton.textContent = "Grant access";
      grantButton.addEventListener("click", async () => {
        showMessage(customSiteMessage, "");
        try {
          if (!await requestOriginPermission(site.domain)) {
            throw new Error("Site access was not granted.");
          }
          await renderCustomSites();
        } catch (error) {
          showMessage(customSiteMessage, error.message);
        }
      });
      text.append(grantButton);
    }

    const controls = document.createElement("div");
    controls.className = "site-controls";
    const toggleLabel = document.createElement("label");
    toggleLabel.className = "site-toggle";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = site.enabled;
    toggle.setAttribute("aria-label", `Enable blocking for ${site.domain}`);
    toggle.addEventListener("change", () => toggleCustomSite(site.id, toggle));
    const toggleText = document.createElement("span");
    toggleText.textContent = site.enabled ? "Enabled" : "Disabled";
    toggleLabel.append(toggle, toggleText);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-site";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => removeCustomSite(site));
    controls.append(toggleLabel, removeButton);
    item.append(text, controls);
    customSiteList.append(item);
  }
}

async function toggleCustomSite(siteId, toggle) {
  showMessage(customSiteMessage, "");
  const site = state.customSites.find((item) => item.id === siteId);
  if (!site) {
    return;
  }
  try {
    if (toggle.checked) {
      const granted = await requestOriginPermission(site.domain);
      if (!granted) {
        toggle.checked = false;
        showMessage(customSiteMessage, "Site access was not granted.");
        return;
      }
    }
    const sites = state.customSites.map((item) =>
      item.id === siteId ? { ...item, enabled: toggle.checked } : item
    );
    await saveCustomSites(sites);
  } catch (error) {
    toggle.checked = !toggle.checked;
    showMessage(customSiteMessage, error.message);
  }
}

async function removeCustomSite(site) {
  showMessage(customSiteMessage, "");
  try {
    const active = await sendRequest({ type: "GET_STATE" });
    if (active.session?.customDomains.includes(site.domain)) {
      throw new Error("This website is selected in the active session. Remove it after the session ends.");
    }

    await saveCustomSites(state.customSites.filter((item) => item.id !== site.id));
    if (await hasOriginPermission(site.domain)) {
      await chrome.permissions.remove({ origins: [getOriginPattern(site.domain)] });
    }
  } catch (error) {
    showMessage(customSiteMessage, error.message);
  }
}

durationSelect.addEventListener("change", () => {
  customDuration.hidden = durationSelect.value !== "custom";
});

customSiteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage(customSiteMessage, "");
  let domain;
  try {
    domain = normalizeDomain(customDomainInput.value);
  } catch (error) {
    showMessage(customSiteMessage, error.message);
    return;
  }

  if (state.customSites.some((site) => site.domain === domain)) {
    showMessage(customSiteMessage, "That website is already in your list.");
    return;
  }

  const addButton = customSiteForm.querySelector('button[type="submit"]');
  addButton.disabled = true;
  try {
    const granted = await requestOriginPermission(domain);
    if (!granted) {
      throw new Error("Site access is required to block this website.");
    }
    const sites = [
      ...state.customSites,
      { id: `custom:${domain}`, domain, enabled: true }
    ];
    await saveCustomSites(sites);
    customDomainInput.value = "";
  } catch (error) {
    showMessage(customSiteMessage, error.message);
  } finally {
    addButton.disabled = false;
  }
});

document.getElementById("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage(settingsMessage, "");

  let durationMinutes = Number(durationSelect.value);
  if (durationSelect.value === "custom") {
    const hours = Number(customHours.value);
    const minutes = Number(customMinutes.value);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) ||
        hours < 0 || hours > 12 || minutes < 0 || minutes > 59 ||
        (hours === 0 && minutes === 0)) {
      showMessage(settingsMessage, "Enter a default duration between 1 minute and 12 hours.");
      return;
    }
    durationMinutes = hours * 60 + minutes;
  }

  try {
    const response = await sendRequest({
      type: "SAVE_SETTINGS",
      settings: { durationMinutes, mode: modeSelect.value }
    });
    state.settings = response.settings;
    renderSettings(state.settings);
    showMessage(settingsMessage, "Defaults saved on this device.");
  } catch (error) {
    showMessage(settingsMessage, error.message);
  }
});

document.getElementById("reset-statistics").addEventListener("click", async () => {
  if (!window.confirm("Reset all FocusBlock statistics and streak dates? Any active session will continue unchanged.")) {
    return;
  }
  showMessage(statisticsMessage, "");
  try {
    await sendRequest({ type: "RESET_STATISTICS" });
    const response = await sendRequest({ type: "GET_STATE" });
    state = response;
    renderStatistics(response.statistics, response.currentStreak);
    showMessage(statisticsMessage, "Statistics reset. Any active session remains unchanged.");
  } catch (error) {
    showMessage(statisticsMessage, error.message);
  }
});

async function initialize() {
  try {
    const response = await fetch(CONFIG_URL);
    if (!response.ok) {
      throw new Error("FocusBlock configuration could not be loaded.");
    }
    config = await response.json();
    renderDurationOptions();
    state = await sendRequest({ type: "GET_STATE" });
    renderSettings(state.settings || DEFAULT_SETTINGS);
    renderStatistics(state.statistics, state.currentStreak);
    await renderCustomSites();
    if (state.blockingError) {
      showMessage(customSiteMessage, `Active session needs attention: ${state.blockingError}`);
    }
  } catch (error) {
    showMessage(settingsMessage, error.message);
  }
}

initialize();
