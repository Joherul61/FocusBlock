const countdown = document.getElementById("countdown");
const sessionStatus = document.getElementById("session-status");
let expiryRefreshPending = false;
let countdownInterval;

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

async function loadSession() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!response || !response.ok) {
      throw new Error(response?.error || "Session status is unavailable.");
    }
    if (!response.focusActive || !response.session) {
      countdown.textContent = "00:00";
      sessionStatus.textContent = "The Focus session has ended. Reload the page to continue.";
      return;
    }

    const updateCountdown = () => {
      countdown.textContent = formatRemainingTime(response.session.endTime);
      if (response.session.endTime <= Date.now() && !expiryRefreshPending) {
        expiryRefreshPending = true;
        clearInterval(countdownInterval);
        chrome.runtime.sendMessage({ type: "GET_STATE" }).then((state) => {
          if (!state || !state.ok) {
            throw new Error(state?.error || "Session status is unavailable.");
          }
          sessionStatus.textContent = state.focusActive
            ? `${state.session.mode === "lockdown" ? "Lockdown Mode" : "Focus Mode"} is active.`
            : "The Focus session has ended. Reload the page to continue.";
        }).catch((error) => {
          sessionStatus.textContent = error.message;
        });
      }
    };
    countdownInterval = setInterval(updateCountdown, 1000);
    updateCountdown();
    sessionStatus.textContent = response.session.mode === "lockdown"
      ? "Lockdown Mode is active."
      : "Focus Mode is active.";
  } catch (error) {
    sessionStatus.textContent = error.message;
  }
}

loadSession();
