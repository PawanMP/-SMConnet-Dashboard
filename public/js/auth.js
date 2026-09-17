// ── window.fetch Wrapper for Authentication ──────────────────────────────────
const originalFetch = window.fetch;
window.fetch = async function(url, options) {
  options = options || {};
  options.headers = options.headers || {};
  const token = sessionStorage.getItem("authToken");
  
  if (token) {
    if (options.headers instanceof Headers) {
      options.headers.set("Authorization", "Bearer " + token);
    } else if (Array.isArray(options.headers)) {
      options.headers.push(["Authorization", "Bearer " + token]);
    } else {
      options.headers["Authorization"] = "Bearer " + token;
    }
  }
  
  const response = await originalFetch(url, options);
  
  if (response.status === 401 && !url.includes("/api/login")) {
    sessionStorage.removeItem("authToken");
    showLoginScreen();
  }
  
  return response;
};

// ── Auth Helper Functions ───────────────────────────────────────────────────
function showLoginScreen() {
  const loginContainer = document.getElementById("login-container");
  const appContainer = document.getElementById("app-container");
  if (loginContainer) loginContainer.style.display = "flex";
  if (appContainer) appContainer.style.display = "none";
}

function showAppScreen() {
  const loginContainer = document.getElementById("login-container");
  const appContainer = document.getElementById("app-container");
  if (loginContainer) loginContainer.style.display = "none";
  if (appContainer) appContainer.style.display = "flex";
}

function fillCredentials(value) {
  if (value === 'admin') {
    const el = document.getElementById("login-username");
    if (el) el.value = "admin";
  } else if (value === 'admin123') {
    const el = document.getElementById("login-password");
    if (el) el.value = "admin123";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // Clear any legacy persistent token
  localStorage.removeItem("authToken");
  
  const token = sessionStorage.getItem("authToken");
  if (!token) {
    showLoginScreen();
  } else {
    showAppScreen();
  }

  // Bind login form submit
  document.getElementById("login-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value.trim();
    const errorEl  = document.getElementById("login-error");
    const spinner  = document.getElementById("login-spinner");
    const submitBtn = document.getElementById("login-btn-submit");
    
    if (errorEl) errorEl.style.display = "none";
    if (spinner) spinner.style.display = "inline-block";
    if (submitBtn) submitBtn.disabled = true;
    
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        sessionStorage.setItem("authToken", data.token);
        showAppScreen();
      } else {
        if (errorEl) {
          errorEl.textContent = data.message || "Invalid credentials.";
          errorEl.style.display = "block";
        }
      }
    } catch {
      if (errorEl) {
        errorEl.textContent = "Network error. Is the server running?";
        errorEl.style.display = "block";
      }
    } finally {
      if (spinner) spinner.style.display = "none";
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // Bind logout button click
  document.getElementById("logout-btn")?.addEventListener("click", () => {
    sessionStorage.removeItem("authToken");
    showLoginScreen();
  });
});
