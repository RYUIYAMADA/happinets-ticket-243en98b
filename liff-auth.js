/**
 * liff-auth.js — LIFF認証共通モジュール
 *
 * 使い方:
 *   1. HTML <head> に LIFF SDK を読み込む
 *      <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
 *   2. HTML <head> に window.LIFF_CONFIG を設定する
 *      <script>window.LIFF_CONFIG = { formLiffId: "YOUR_FORM_LIFF_ID", dashboardLiffId: "YOUR_DASHBOARD_LIFF_ID" };</script>
 *   3. DOMContentLoaded 内で initAndAuthWithLiff(liffId) を呼ぶ
 *
 * LIFF_ID の注入手順（龍偉向け）:
 *   LINE Developers Console → LINEログインチャネル → LIFF タブ
 *   → 各LIFFアプリの「LIFF ID」欄に記載の値を下記に設定する。
 *
 *   設定場所: 各 HTML の <head> 内 LIFF_CONFIG スクリプトブロック
 *     window.LIFF_CONFIG = {
 *       formLiffId:      "XXXXXXXXXXXX-XXXXXXXX",  ← player-form 用 LIFF ID
 *       dashboardLiffId: "XXXXXXXXXXXX-XXXXXXXX",  ← player-dashboard 用 LIFF ID
 *     };
 */

(function () {
  /**
   * LIFF初期化 → ログイン → IDトークン取得 → Worker API認証 の一連フローを実行。
   *
   * @param {string} liffId - liff.init() に渡す LIFF ID
   * @returns {Promise<{token: string, playerId: string, name: string, role: string}|{unlinked: true}>}
   *   - 認証成功: セッション情報オブジェクト
   *   - 未連携 (409 UNLINKED): { unlinked: true }
   *   - ログイン中のリダイレクト: null（関数がリダイレクトして戻らない）
   * @throws {Error} 認証失敗・設定エラー時
   */
  async function initAndAuthWithLiff(liffId) {
    if (!liffId || liffId.includes("XXXXXXXXXXXX")) {
      throw new Error("LIFF IDが未設定です。管理者にお問い合わせください。");
    }

    // liff オブジェクトが存在しない（LINE外でSDKが読み込まれていない）場合の処理
    if (typeof liff === "undefined") {
      throw new Error("LIFF SDKが読み込まれていません。LINEアプリ内で開いてください。");
    }

    await liff.init({ liffId, withLoginOnExternalBrowser: true });

    if (!liff.isLoggedIn()) {
      liff.login();
      return null; // リダイレクト後はここに戻らない
    }

    const idToken = liff.getIDToken();
    if (!idToken) {
      throw new Error("IDトークンの取得に失敗しました。");
    }

    // sessionStorage にトークンがあれば再認証スキップ
    const storedToken = sessionStorage.getItem("sessionToken");
    if (storedToken) {
      const storedAuth = JSON.parse(sessionStorage.getItem("auth") || "null");
      if (storedAuth && storedAuth.role === "player") {
        return storedAuth;
      }
    }

    const result = await workerApiClient.loginWithLiff(idToken);

    if (result.ok) {
      const authData = { ...result.data, role: "player" };
      sessionStorage.setItem("auth", JSON.stringify(authData));
      sessionStorage.setItem("sessionToken", result.data.token);
      return authData;
    }

    if (result.error?.code === "UNLINKED") {
      return { unlinked: true };
    }

    throw new Error(result.error?.message || "LIFF認証に失敗しました。");
  }

  /**
   * 初回連携: 背番号を入力してアカウントを紐づける。
   *
   * @param {string} playerId - 背番号 (例: "6" or "006")
   * @returns {Promise<{token: string, playerId: string, name: string, role: string}>}
   * @throws {Error} 連携失敗時
   */
  async function linkWithPlayerNo(playerId) {
    if (typeof liff === "undefined") {
      throw new Error("LIFF SDKが読み込まれていません。");
    }

    const idToken = liff.getIDToken();
    if (!idToken) {
      throw new Error("IDトークンの取得に失敗しました。再度LINEからアクセスしてください。");
    }

    const result = await workerApiClient.linkLiff(idToken, playerId);

    if (result.ok) {
      const authData = { ...result.data, role: "player" };
      sessionStorage.setItem("auth", JSON.stringify(authData));
      sessionStorage.setItem("sessionToken", result.data.token);
      return authData;
    }

    if (result.error?.code === "UNAUTHORIZED") {
      throw new Error("背番号が見つかりません。正しい背番号を入力してください。");
    }

    throw new Error(result.error?.message || "連携に失敗しました。");
  }

  window.liffAuth = {
    initAndAuthWithLiff,
    linkWithPlayerNo,
  };
})();
