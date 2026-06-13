(function () {
  const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:8787";
  const BASE_URL_STORAGE_KEY = "workerApiBaseUrl";

  function normalizeBaseUrl(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function resolveBaseUrl() {
    const stored = normalizeBaseUrl(localStorage.getItem(BASE_URL_STORAGE_KEY));
    if (stored) return stored;
    const globalBaseUrl = normalizeBaseUrl(window.WORKER_API_BASE_URL);
    if (globalBaseUrl) return globalBaseUrl;
    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
      return normalizeBaseUrl(window.location.origin);
    }
    return DEFAULT_LOCAL_BASE_URL;
  }

  function getStoredAuth() {
    return JSON.parse(sessionStorage.getItem("auth") || "null");
  }

  function getStoredToken() {
    const auth = getStoredAuth();
    return auth?.token || sessionStorage.getItem("adminToken") || sessionStorage.getItem("sessionToken") || "";
  }

  function setStoredToken(role, token) {
    if (!token) return;
    if (role === "admin") {
      sessionStorage.setItem("adminToken", token);
      sessionStorage.removeItem("sessionToken");
      return;
    }
    sessionStorage.setItem("sessionToken", token);
    sessionStorage.removeItem("adminToken");
  }

  function clearStoredTokens() {
    sessionStorage.removeItem("sessionToken");
    sessionStorage.removeItem("adminToken");
  }

  function buildHeaders(options, includeAuth) {
    const headers = new Headers(options?.headers || {});
    if (!headers.has("Content-Type") && options?.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    if (includeAuth) {
      const token = getStoredToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }
    return headers;
  }

  async function parseResponse(response) {
    const text = await response.text();
    let json = null;

    if (text) {
      try {
        json = JSON.parse(text);
      } catch (error) {
        json = null;
      }
    }

    if (json && typeof json === "object") {
      if (!response.ok) {
        const errorObj = typeof json.error === "object" && json.error
          ? { ...json.error, status: response.status }
          : { message: json.error || response.statusText || "Request failed", status: response.status };
        return { ok: false, error: errorObj };
      }
      return json;
    }

    if (!response.ok) {
      return {
        ok: false,
        error: { message: response.statusText || "Request failed", status: response.status },
      };
    }

    return { ok: true, data: null };
  }

  async function request(path, options = {}, includeAuth = false) {
    const response = await fetch(`${resolveBaseUrl()}${path}`, {
      ...options,
      headers: buildHeaders(options, includeAuth),
    });
    const result = await parseResponse(response);

    if (result.ok && result.data?.token && result.data?.role) {
      setStoredToken(result.data.role, result.data.token);
    }

    return result;
  }

  function withQuery(path, params) {
    const search = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      search.set(key, String(value));
    });
    const query = search.toString();
    return query ? `${path}?${query}` : path;
  }

  function loginPlayer(playerId) {
    return request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ playerId }),
    });
  }

  /**
   * LIFF IDトークンでログイン。
   * 成功: { ok: true, data: { token, playerId, ... } }
   * 未連携: { ok: false, error: { code: "UNLINKED", ... } }
   */
  function loginWithLiff(idToken) {
    return request("/api/auth/liff-login", {
      method: "POST",
      body: JSON.stringify({ idToken }),
    });
  }

  /**
   * 初回連携: IDトークン + 背番号 でアカウントを紐づけてトークンを発行。
   * playerId: 背番号文字列 (例: "006" or "6")
   */
  function linkLiff(idToken, playerId) {
    return request("/api/auth/link-liff", {
      method: "POST",
      body: JSON.stringify({ idToken, playerId }),
    });
  }

  function loginAdmin(password) {
    return request("/api/auth/admin-login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  }

  async function logout() {
    const result = await request("/api/auth/logout", { method: "POST" }, true);
    clearStoredTokens();
    return result;
  }

  function getGames(params) {
    return request(withQuery("/api/games", params), { method: "GET" });
  }

  function getApplications() {
    return request("/api/applications", { method: "GET" }, true);
  }

  function submitApplication(payload) {
    return request("/api/applications", {
      method: "POST",
      body: JSON.stringify(payload),
    }, true);
  }

  function cancelApplication(applicationId) {
    return request(`/api/applications/${encodeURIComponent(applicationId)}/cancel`, {
      method: "PUT",
    }, true);
  }

  function getAllApplications(params) {
    return request(withQuery("/api/admin/applications", params), { method: "GET" }, true);
  }

  function updateApplicationStatus(applicationId, status) {
    return request(`/api/admin/applications/${encodeURIComponent(applicationId)}/status`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    }, true);
  }

  function getPlayers() {
    return request("/api/admin/players", { method: "GET" }, true);
  }

  function addPlayer(player) {
    return request("/api/admin/players", {
      method: "POST",
      body: JSON.stringify(player),
    }, true);
  }

  function updatePlayer(playerId, fields) {
    return request(`/api/admin/players/${encodeURIComponent(playerId)}`, {
      method: "PUT",
      body: JSON.stringify(fields),
    }, true);
  }

  function updateDeadline(gameId, deadline) {
    return request(`/api/admin/games/${encodeURIComponent(gameId)}/deadline`, {
      method: "PUT",
      body: JSON.stringify({ deadline }),
    }, true);
  }

  function addGame(game) {
    return request("/api/admin/games", {
      method: "POST",
      body: JSON.stringify(game),
    }, true);
  }

  function updateGame(gameId, fields) {
    return request(`/api/admin/games/${encodeURIComponent(gameId)}`, {
      method: "PUT",
      body: JSON.stringify(fields),
    }, true);
  }

  function deleteGame(gameId) {
    return request(`/api/admin/games/${encodeURIComponent(gameId)}`, {
      method: "DELETE",
    }, true);
  }

  function replaceSeason2627(payload) {
    return request("/api/admin/games/replace-season", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    }, true);
  }

  function getLineStats() {
    return request("/api/admin/line-stats", { method: "GET" }, true);
  }

  function isUnauthorizedResult(result) {
    return !result?.ok && Number(result?.error?.status) === 401;
  }

  window.workerApiClient = {
    get baseUrl() {
      return resolveBaseUrl();
    },
    setBaseUrl(url) {
      const normalized = normalizeBaseUrl(url);
      if (normalized) localStorage.setItem(BASE_URL_STORAGE_KEY, normalized);
      else localStorage.removeItem(BASE_URL_STORAGE_KEY);
      return resolveBaseUrl();
    },
    clearStoredTokens,
    getGames,
    getApplications,
    submitApplication,
    cancelApplication,
    getAllApplications,
    updateApplicationStatus,
    getPlayers,
    addPlayer,
    updatePlayer,
    updateDeadline,
    addGame,
    updateGame,
    deleteGame,
    replaceSeason2627,
    getLineStats,
    loginPlayer,
    loginWithLiff,
    linkLiff,
    loginAdmin,
    logout,
    isUnauthorizedResult,
  };
})();
