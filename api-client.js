(function () {
  const WORKER_API_BASE_URL = "http://127.0.0.1:8787";

  function getStoredToken() {
    const auth = JSON.parse(sessionStorage.getItem("auth") || "null");
    return auth?.token || sessionStorage.getItem("sessionToken") || "";
  }

  async function request(path, options) {
    const response = await fetch(`${WORKER_API_BASE_URL}${path}`, options);
    const json = await response.json();
    if (!response.ok && json?.ok === false) {
      return json;
    }
    return json;
  }

  async function loginPlayer(playerId) {
    const result = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });

    if (result.ok && result.data?.token) {
      sessionStorage.setItem("sessionToken", result.data.token);
    }

    return result;
  }

  function getGames(params) {
    const search = new URLSearchParams();
    if (params?.season) search.set("season", params.season);
    if (typeof params?.active === "boolean") search.set("active", String(params.active));
    const qs = search.toString();
    return request(`/api/games${qs ? `?${qs}` : ""}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
  }

  window.workerApiClient = {
    baseUrl: WORKER_API_BASE_URL,
    loginPlayer,
    getGames,
  };
})();
