const SESSION_KEY = "focusSession";
const COMPLETION_KEY = "focusCompletion";
const STATISTICS_KEY = "focusStatistics";
const SETTINGS_KEY = "focusSettings";
const CUSTOM_SITES_KEY = "focusCustomSites";
const SESSION_ALARM = "focus-session-end";
const BLOCKING_RULE_ID = 1001;
const CONFIG_URL = chrome.runtime.getURL("rules/rules.json");

// Personal Lockdown password pool. Keep exactly 30 unique four-digit entries.
const LOCKDOWN_PASSWORDS = [

    "5837", "2149", "7603", "4816", "9352", "1074",

    "6285", "3491", "8027", "5164", "2738", "6940",

    "1586", "9273", "4051", "7319", "8642", "2905",

    "6478", "3126", "9584", "1763", "5209", "8437",

    "3915", "7058", "2641", "6197", "4382", "8516"

];

const DEFAULT_SETTINGS = { durationMinutes: 30, mode: "focus" };
const EMPTY_STATISTICS = {
  completedSessions: 0,
  totalFocusMinutes: 0,
  totalLockdownSessions: 0,
  totalFocusSessions: 0,
  manuallyStoppedSessions: 0,
  daily: {},
  completionDates: []
};

let operationQueue = Promise.resolve();
let configPromise;

function enqueueOperation(operation) {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.catch(() => {});
  return result;
}

async function loadConfig() {
  if (!configPromise) {
    configPromise = fetch(CONFIG_URL).then((response) => {
      if (!response.ok) {
        throw new Error("FocusBlock configuration could not be loaded.");
      }
      return response.json();
    });
  }
  return configPromise;
}

async function readLocalData() {
  return chrome.storage.local.get([
    SESSION_KEY,
    COMPLETION_KEY,
    STATISTICS_KEY,
    SETTINGS_KEY,
    CUSTOM_SITES_KEY
  ]);
}

async function readStoredSession() {
  const stored = await chrome.storage.local.get(SESSION_KEY);
  return stored[SESSION_KEY];
}

function isValidDomain(domain) {
  return typeof domain === "string" &&
    domain.length <= 253 &&
    domain.includes(".") &&
    !/^\d+(?:\.\d+){3}$/.test(domain) &&
    domain.split(".").every((label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    );
}

function getCustomSites(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((site) =>
    site &&
    typeof site.id === "string" &&
    site.id === `custom:${site.domain}` &&
    isValidDomain(site.domain) &&
    typeof site.enabled === "boolean"
  );
}

function validateSession(session, config) {
  if (!session || typeof session !== "object" ||
      session.focusActive !== true ||
      !["focus", "lockdown"].includes(session.mode) ||
      !Number.isFinite(session.endTime) || !Number.isFinite(session.startedAt) ||
      session.startedAt <= 0 || session.endTime <= session.startedAt ||
      !Array.isArray(session.selectedSites) || session.selectedSites.length === 0) {
    return false;
  }

  session.customDomains = Array.isArray(session.customDomains)
    ? session.customDomains
    : [];
  const knownSiteIds = new Set(config.sites.map((site) => site.id));
  const validPasswordState = session.mode === "focus"
    ? !Object.hasOwn(session, "passwordHash")
    : typeof session.passwordHash === "string" &&
      /^[a-f0-9]{64}$/.test(session.passwordHash);
  const validCustomDomains = session.customDomains.every((domain) =>
    isValidDomain(domain)
  );
  const validSelectedSites = session.selectedSites.every((siteId) =>
    knownSiteIds.has(siteId) ||
    (typeof siteId === "string" &&
      siteId.startsWith("custom:") &&
      validCustomDomains &&
      session.customDomains.includes(siteId.slice("custom:".length)))
  );

  return validPasswordState &&
    validCustomDomains &&
    validSelectedSites &&
    new Set(session.selectedSites).size === session.selectedSites.length &&
    new Set(session.customDomains).size === session.customDomains.length &&
    Number.isInteger(session.durationMinutes) &&
    session.durationMinutes >= 1 &&
    session.durationMinutes <= 720;
}

function selectLockdownPassword() {
  if (LOCKDOWN_PASSWORDS.length !== 30 ||
      !LOCKDOWN_PASSWORDS.every((password) => /^\d{4}$/.test(password))) {
    throw new Error("Lockdown password list must contain exactly 30 four-digit passwords.");
  }

  const range = 0x100000000;
  const acceptedRange = Math.floor(range / LOCKDOWN_PASSWORDS.length) *
    LOCKDOWN_PASSWORDS.length;
  const randomValue = new Uint32Array(1);
  do {
    crypto.getRandomValues(randomValue);
  } while (randomValue[0] >= acceptedRange);

  return LOCKDOWN_PASSWORDS[randomValue[0] % LOCKDOWN_PASSWORDS.length];
}

async function hashPassword(password) {
  const encodedPassword = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", encodedPassword);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function hashesMatch(firstHash, secondHash) {
  if (firstHash.length !== secondHash.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < firstHash.length; index += 1) {
    difference |= firstHash.charCodeAt(index) ^ secondHash.charCodeAt(index);
  }
  return difference === 0;
}

function getPublicSession(session) {
  if (!session) {
    return null;
  }
  const publicSession = { ...session };
  delete publicSession.passwordHash;
  return publicSession;
}

function getLocalDate(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeStatistics(value) {
  if (!value || typeof value !== "object") {
    return {
      ...EMPTY_STATISTICS,
      daily: {},
      completionDates: []
    };
  }
  const readCount = (count) =>
    Number.isSafeInteger(count) && count >= 0 ? count : 0;
  const daily = {};
  if (value.daily && typeof value.daily === "object" && !Array.isArray(value.daily)) {
    for (const [date, counts] of Object.entries(value.daily)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !counts || typeof counts !== "object" || Array.isArray(counts)) {
        continue;
      }
      daily[date] = {
        sessions: readCount(counts.sessions),
        focusMinutes: readCount(counts.focusMinutes),
        completed: readCount(counts.completed),
        stoppedEarly: readCount(counts.stoppedEarly),
        lockdown: readCount(counts.lockdown)
      };
    }
  }
  return {
    completedSessions: readCount(value.completedSessions),
    totalFocusMinutes: readCount(value.totalFocusMinutes),
    totalLockdownSessions: readCount(value.totalLockdownSessions),
    totalFocusSessions: readCount(value.totalFocusSessions),
    manuallyStoppedSessions: readCount(value.manuallyStoppedSessions),
    daily,
    completionDates: Array.isArray(value.completionDates)
      ? [...new Set(value.completionDates.filter((date) =>
        typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ))]
      : []
  };
}

function getCurrentStreak(completionDates) {
  const completedDays = new Set(completionDates);
  const today = getLocalDate();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = getLocalDate(yesterdayDate.getTime());
  let currentDate = completedDays.has(today) ? today : yesterday;
  if (!completedDays.has(currentDate)) {
    return 0;
  }

  let streak = 0;
  while (completedDays.has(currentDate)) {
    streak += 1;
    const previousDate = new Date(`${currentDate}T12:00:00`);
    previousDate.setDate(previousDate.getDate() - 1);
    currentDate = getLocalDate(previousDate.getTime());
  }
  return streak;
}

function createBlockingRule(selectedSites, customDomains, config) {
  const selectedIds = new Set(selectedSites);
  const domains = config.sites
    .filter((site) => selectedIds.has(site.id))
    .flatMap((site) => site.domains)
    .concat(customDomains)
    .filter((domain, index, allDomains) => allDomains.indexOf(domain) === index)
    .sort();

  if (domains.length === 0) {
    throw new Error("No websites are available to block.");
  }

  return {
    id: BLOCKING_RULE_ID,
    priority: 1,
    action: {
      type: "redirect",
      redirect: { extensionPath: "/blocked/blocked.html" }
    },
    condition: {
      requestDomains: domains,
      resourceTypes: ["main_frame"]
    }
  };
}

async function setBlockingEnabled(enabled, session, config) {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const currentRule = rules.find((rule) => rule.id === BLOCKING_RULE_ID);

  if (!enabled) {
    if (currentRule) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [BLOCKING_RULE_ID]
      });
    }
    return;
  }

  const nextRule = createBlockingRule(
    session.selectedSites,
    session.customDomains || [],
    config
  );
  if (currentRule && JSON.stringify(currentRule) === JSON.stringify(nextRule)) {
    return;
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: currentRule ? [BLOCKING_RULE_ID] : [],
    addRules: [nextRule]
  });
}

async function ensureSessionAlarm(endTime) {
  const alarm = await chrome.alarms.get(SESSION_ALARM);
  if (!alarm || alarm.scheduledTime !== endTime) {
    await chrome.alarms.create(SESSION_ALARM, { when: endTime });
  }
}

function getElapsedMinutes(session, completedNaturally) {
  if (completedNaturally) {
    return session.durationMinutes;
  }
  return Math.min(
    session.durationMinutes,
    Math.floor(Math.max(0, Date.now() - session.startedAt) / 60000)
  );
}

function updateStatistics(statisticsValue, session, outcome, elapsedMinutes) {
  const statistics = normalizeStatistics(statisticsValue);
  const today = getLocalDate();
  const daily = {
    sessions: 0,
    focusMinutes: 0,
    completed: 0,
    stoppedEarly: 0,
    lockdown: 0,
    ...(statistics.daily[today] || {})
  };
  for (const key of ["sessions", "focusMinutes", "completed", "stoppedEarly", "lockdown"]) {
    daily[key] = Number.isSafeInteger(daily[key]) && daily[key] >= 0
      ? daily[key]
      : 0;
  }

  daily.sessions += 1;
  daily.focusMinutes += elapsedMinutes;
  if (session.mode === "focus") {
    statistics.totalFocusSessions += 1;
  } else {
    statistics.totalLockdownSessions += 1;
    daily.lockdown += 1;
  }
  statistics.totalFocusMinutes += elapsedMinutes;

  if (outcome === "completed") {
    statistics.completedSessions += 1;
    daily.completed += 1;
    statistics.completionDates = [
      ...new Set([...statistics.completionDates, today])
    ];
  } else {
    statistics.manuallyStoppedSessions += 1;
    daily.stoppedEarly += 1;
  }
  statistics.daily[today] = daily;
  return statistics;
}

async function finishSession(session, outcome) {
  const data = await readLocalData();
  if (!data[SESSION_KEY] || data[SESSION_KEY].startedAt !== session.startedAt) {
    return data[COMPLETION_KEY] || null;
  }

  await setBlockingEnabled(false, session, await loadConfig());
  await chrome.alarms.clear(SESSION_ALARM);

  const elapsedMinutes = getElapsedMinutes(session, outcome === "completed");
  const completion = {
    outcome,
    mode: session.mode,
    durationMinutes: session.durationMinutes,
    elapsedMinutes,
    selectedSites: session.selectedSites,
    customDomains: session.customDomains,
    completedAt: Date.now()
  };
  const statistics = updateStatistics(
    data[STATISTICS_KEY],
    session,
    outcome,
    elapsedMinutes
  );

  await chrome.storage.local.set({
    [SESSION_KEY]: null,
    [COMPLETION_KEY]: completion,
    [STATISTICS_KEY]: statistics
  });
  await chrome.storage.local.remove(SESSION_KEY);
  return completion;
}

async function stopSession() {
  const data = await readLocalData();
  const session = data[SESSION_KEY];
  if (!session) {
    await chrome.alarms.clear(SESSION_ALARM);
    return { focusActive: false };
  }
  if (session.mode === "lockdown") {
    throw new Error("Lockdown Mode requires its password to unlock.");
  }
  const completion = await finishSession(session, "stopped");
  return { focusActive: false, completion };
}

async function reconcileSession() {
  const config = await loadConfig();
  const data = await readLocalData();
  const session = data[SESSION_KEY];

  if (!session) {
    await setBlockingEnabled(false, null, config);
    await chrome.alarms.clear(SESSION_ALARM);
    return null;
  }
  if (!validateSession(session, config)) {
    await setBlockingEnabled(false, session, config);
    await chrome.alarms.clear(SESSION_ALARM);
    await chrome.storage.local.remove(SESSION_KEY);
    return null;
  }
  if (session.endTime <= Date.now()) {
    await finishSession(session, "completed");
    return null;
  }

  await setBlockingEnabled(true, session, config);
  await ensureSessionAlarm(session.endTime);
  return session;
}

async function startSession(message) {
  const currentSession = await reconcileSession();
  if (currentSession) {
    return { focusActive: true, session: getPublicSession(currentSession) };
  }

  const config = await loadConfig();
  const data = await readLocalData();
  const mode = message.mode ?? data[SETTINGS_KEY]?.mode ?? DEFAULT_SETTINGS.mode;
  const durationMinutes = Number(message.durationMinutes ??
    data[SETTINGS_KEY]?.durationMinutes ?? DEFAULT_SETTINGS.durationMinutes);
  const selectedSites = Array.isArray(message.selectedSites)
    ? [...new Set(message.selectedSites)]
    : [];
  if (!["focus", "lockdown"].includes(mode)) {
    throw new Error("Choose a valid blocking mode.");
  }
  if (!config.durations.some((duration) => duration.minutes === durationMinutes) &&
      !(Number.isInteger(durationMinutes) && durationMinutes >= 1 && durationMinutes <= 720)) {
    throw new Error("Choose a valid session duration.");
  }
  if (selectedSites.length === 0) {
    throw new Error("Select at least one website to block.");
  }

  const customSites = getCustomSites(data[CUSTOM_SITES_KEY]);
  const enabledCustomSites = new Set(
    customSites.filter((site) => site.enabled).map((site) => site.id)
  );
  const builtInIds = new Set(config.sites.map((site) => site.id));
  if (!selectedSites.every((siteId) =>
    builtInIds.has(siteId) || enabledCustomSites.has(siteId)
  )) {
    throw new Error("One or more selected websites are not enabled.");
  }

  const customDomains = selectedSites
    .filter((siteId) => siteId.startsWith("custom:"))
    .map((siteId) => siteId.slice("custom:".length));
  const origins = customDomains.map((domain) => `*://*.${domain}/*`);
  if (origins.length &&
      !await chrome.permissions.contains({ origins })) {
    throw new Error("Allow FocusBlock access to each selected custom website first.");
  }

  const startedAt = Date.now();
  const session = {
    focusActive: true,
    mode,
    startedAt,
    endTime: startedAt + durationMinutes * 60000,
    durationMinutes,
    selectedSites,
    customDomains
  };
  if (mode === "lockdown") {
    session.passwordHash = await hashPassword(selectLockdownPassword());
  }

  await chrome.storage.local.remove(COMPLETION_KEY);
  await chrome.storage.local.set({ [SESSION_KEY]: session });
  try {
    await setBlockingEnabled(true, session, config);
    await ensureSessionAlarm(session.endTime);
  } catch (error) {
    await setBlockingEnabled(false, session, config);
    await chrome.alarms.clear(SESSION_ALARM);
    await chrome.storage.local.remove(SESSION_KEY);
    throw error;
  }

  return { focusActive: true, session: getPublicSession(session) };
}

async function unlockLockdown(password) {
  const config = await loadConfig();
  const data = await readLocalData();
  const session = data[SESSION_KEY];
  if (!validateSession(session, config)) {
    await reconcileSession();
    const refreshedData = await readLocalData();
    return {
      unlocked: false,
      completed: Boolean(refreshedData[COMPLETION_KEY]),
      completion: refreshedData[COMPLETION_KEY] || null
    };
  }
  if (session.endTime <= Date.now()) {
    await finishSession(session, "completed");
    const refreshedData = await readLocalData();
    return {
      unlocked: false,
      completed: true,
      completion: refreshedData[COMPLETION_KEY]
    };
  }
  if (session.mode !== "lockdown") {
    throw new Error("This session does not require a password.");
  }
  if (typeof password !== "string" || !/^\d{4}$/.test(password)) {
    return { unlocked: false };
  }

  const suppliedHash = await hashPassword(password);
  if (!hashesMatch(suppliedHash, session.passwordHash)) {
    return { unlocked: false };
  }

  const completion = await finishSession(session, "stopped");
  return { unlocked: true, completion };
}

function getDefaultSettings(value) {
  const durationMinutes = Number(value?.durationMinutes);
  return {
    durationMinutes: Number.isInteger(durationMinutes) &&
      durationMinutes >= 1 && durationMinutes <= 720
      ? durationMinutes
      : DEFAULT_SETTINGS.durationMinutes,
    mode: value?.mode === "lockdown" ? "lockdown" : "focus"
  };
}

async function handleMessage(message) {
  if (!message || typeof message.type !== "string") {
    throw new Error("Invalid FocusBlock request.");
  }
  if (message.type === "GET_STATE") {
    let session;
    let blockingError = null;
    try {
      session = await reconcileSession();
    } catch (error) {
      const storedData = await readLocalData();
      const storedSession = storedData[SESSION_KEY];
      const config = await loadConfig();
      if (!validateSession(storedSession, config) ||
          storedSession.endTime <= Date.now()) {
        throw error;
      }
      session = storedSession;
      blockingError = error instanceof Error
        ? error.message
        : "Website blocking could not be restored.";
    }
    const data = await readLocalData();
    const statistics = normalizeStatistics(data[STATISTICS_KEY]);
    return {
      focusActive: Boolean(session),
      session: getPublicSession(session),
      blockingError,
      completion: data[COMPLETION_KEY] || null,
      settings: getDefaultSettings(data[SETTINGS_KEY]),
      customSites: getCustomSites(data[CUSTOM_SITES_KEY]),
      statistics,
      currentStreak: getCurrentStreak(statistics.completionDates)
    };
  }
  if (message.type === "START_FOCUS") {
    return startSession(message);
  }
  if (message.type === "STOP_FOCUS") {
    const config = await loadConfig();
    const session = await readStoredSession();
    if (validateSession(session, config) && session.endTime > Date.now() &&
        session.mode === "lockdown") {
      throw new Error("Lockdown Mode requires its password to unlock.");
    }
    if (!validateSession(session, config) || session.endTime <= Date.now()) {
      await reconcileSession();
      const data = await readLocalData();
      return {
        focusActive: false,
        completion: data[COMPLETION_KEY] || null
      };
    }
    return stopSession();
  }
  if (message.type === "UNLOCK_LOCKDOWN") {
    return unlockLockdown(message.password);
  }
  if (message.type === "SAVE_SETTINGS") {
    const durationMinutes = Number(message.settings?.durationMinutes);
    const mode = message.settings?.mode;
    if (!Number.isInteger(durationMinutes) ||
        durationMinutes < 1 || durationMinutes > 720 ||
        !["focus", "lockdown"].includes(mode)) {
      throw new Error("Default duration must be 1 minute to 12 hours and the mode must be valid.");
    }
    const settings = { durationMinutes, mode };
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return { settings };
  }
  if (message.type === "SAVE_CUSTOM_SITES") {
    if (!Array.isArray(message.customSites) || message.customSites.length > 100) {
      throw new Error("Custom website settings are invalid.");
    }
    const customSites = getCustomSites(message.customSites);
    if (customSites.length !== message.customSites.length ||
        new Set(customSites.map((site) => site.domain)).size !== customSites.length) {
      throw new Error("One or more custom website settings are invalid.");
    }
    const currentSession = await readStoredSession();
    const config = await loadConfig();
    if (validateSession(currentSession, config) &&
        currentSession.endTime > Date.now() &&
        currentSession.customDomains.some((domain) =>
      !customSites.some((site) => site.domain === domain)
    )) {
      throw new Error("A website selected in the active session cannot be removed yet.");
    }
    await chrome.storage.local.set({ [CUSTOM_SITES_KEY]: customSites });
    return { customSites };
  }
  if (message.type === "RESET_STATISTICS") {
    const session = await readStoredSession();
    const config = await loadConfig();
    const focusActive = validateSession(session, config) &&
      session.endTime > Date.now();
    await chrome.storage.local.set({
      [STATISTICS_KEY]: {
        ...EMPTY_STATISTICS,
        daily: {},
        completionDates: []
      }
    });
    return { statistics: { ...EMPTY_STATISTICS }, focusActive };
  }
  if (message.type === "DISMISS_COMPLETION") {
    await chrome.storage.local.remove(COMPLETION_KEY);
    return { dismissed: true };
  }
  throw new Error("Unknown FocusBlock request.");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    return false;
  }

  enqueueOperation(() => handleMessage(message)).then(
    (result) => sendResponse({ ok: true, ...result }),
    (error) => {
      console.error("FocusBlock request failed:", error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "FocusBlock request failed."
      });
    }
  );
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SESSION_ALARM) {
    enqueueOperation(reconcileSession).catch((error) => {
      console.error("FocusBlock session alarm could not be handled:", error);
    });
  }
});

function restoreSession() {
  enqueueOperation(reconcileSession).catch((error) => {
    console.error("FocusBlock session could not be restored:", error);
  });
}

chrome.runtime.onStartup.addListener(restoreSession);
chrome.runtime.onInstalled.addListener(restoreSession);
restoreSession();
