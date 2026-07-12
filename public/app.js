(() => {
  "use strict";

  const BACKEND_URL_KEY = "yolo-hub-backend-url";
  const TOKEN_SESSION_KEY = "yolo-hub-simulator-token";

  const elements = {
    backendClose: document.querySelector("#backend-dialog-close"),
    backendDefault: document.querySelector("#backend-default-button"),
    backendDialog: document.querySelector("#backend-dialog"),
    backendError: document.querySelector("#backend-error"),
    backendForm: document.querySelector("#backend-form"),
    backendInput: document.querySelector("#backend-url"),
    backendSettings: document.querySelector("#backend-settings-button"),
    backendToken: document.querySelector("#backend-token"),
    companyName: document.querySelector("#company-name"),
    connection: document.querySelector("#connection-state"),
    engine: document.querySelector("#engine-label"),
    environmentDescription: document.querySelector("#environment-description"),
    environmentLabel: document.querySelector("#environment-label"),
    form: document.querySelector("#message-form"),
    input: document.querySelector("#message-input"),
    list: document.querySelector("#message-list"),
    modePill: document.querySelector("#mode-pill"),
    reset: document.querySelector("#reset-button"),
    send: document.querySelector("#send-button"),
    session: document.querySelector("#session-label"),
    shortcuts: [...document.querySelectorAll("[data-message]")],
    template: document.querySelector("#message-template"),
    toast: document.querySelector("#toast")
  };

  const initialBackend = resolveBackendConfiguration();
  const state = {
    apiBaseUrl: initialBackend.url,
    apiSource: initialBackend.source,
    apiToken: readTokenForBackend(initialBackend.url),
    backendOnline: false,
    busy: false,
    lastFailed: null,
    typingRow: null,
    toastTimer: null,
    userId: getOrCreateUserId()
  };

  function readLocalValue(key) {
    try {
      return window.localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  }

  function writeLocalValue(key, value) {
    try {
      if (value) window.localStorage.setItem(key, value);
      else window.localStorage.removeItem(key);
    } catch {
      // A configuração continuará válida nesta aba mesmo se o navegador bloquear o armazenamento.
    }
  }

  function readSessionValue(key) {
    try {
      return window.sessionStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  }

  function writeSessionValue(key, value) {
    try {
      if (value) window.sessionStorage.setItem(key, value);
      else window.sessionStorage.removeItem(key);
    } catch {
      // O token continuará somente na memória desta página se sessionStorage estiver bloqueado.
    }
  }

  function backendOrigin(url) {
    try {
      return new URL(url).origin;
    } catch {
      return "";
    }
  }

  function readTokenForBackend(url) {
    const expectedOrigin = backendOrigin(url);
    const stored = readSessionValue(TOKEN_SESSION_KEY);
    if (!expectedOrigin || !stored) return "";

    try {
      const parsed = JSON.parse(stored);
      if (parsed?.origin === expectedOrigin && typeof parsed?.token === "string") {
        return parsed.token;
      }
    } catch {
      // Tokens do formato antigo são descartados para não migrarem entre backends.
    }

    writeSessionValue(TOKEN_SESSION_KEY, "");
    return "";
  }

  function writeTokenForBackend(url, token) {
    const origin = backendOrigin(url);
    if (!origin || !token) {
      writeSessionValue(TOKEN_SESSION_KEY, "");
      return;
    }
    writeSessionValue(TOKEN_SESSION_KEY, JSON.stringify({ origin, token }));
  }

  function isLoopbackHostname(hostname) {
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".localhost")
    );
  }

  function normalizeApiBaseUrl(rawValue) {
    const value = String(rawValue ?? "").trim();
    if (!value) return "";

    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("Informe uma URL completa, por exemplo https://api.exemplo.com.");
    }

    const loopbackHttp = parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname);
    if (parsed.protocol !== "https:" && !loopbackHttp) {
      throw new Error("O backend remoto precisa usar HTTPS. HTTP é aceito apenas em localhost.");
    }
    if (parsed.username || parsed.password) {
      throw new Error("Não inclua usuário, senha ou token na URL.");
    }
    if (parsed.search || parsed.hash) {
      throw new Error("Remova parâmetros e fragmentos da URL do backend.");
    }

    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${pathname === "/" ? "" : pathname}`;
  }

  function isGitHubPagesHost() {
    return window.location.hostname.toLowerCase().endsWith(".github.io");
  }

  function resolveBackendConfiguration({ ignoreUserOverride = false } = {}) {
    if (!ignoreUserOverride) {
      const override = readLocalValue(BACKEND_URL_KEY);
      if (override) {
        try {
          return { url: normalizeApiBaseUrl(override), source: "user" };
        } catch {
          writeLocalValue(BACKEND_URL_KEY, "");
        }
      }
    }

    const publishedValue = window.YOLO_HUB_CONFIG?.apiBaseUrl;
    if (publishedValue) {
      try {
        return { url: normalizeApiBaseUrl(publishedValue), source: "published" };
      } catch {
        return { url: "", source: "invalid-published" };
      }
    }

    if (!isGitHubPagesHost() && /^https?:$/.test(window.location.protocol)) {
      return { url: normalizeApiBaseUrl(window.location.origin), source: "same-origin" };
    }

    return { url: "", source: "unconfigured" };
  }

  function getOrCreateUserId() {
    const existing = readLocalValue("lia-simulator-user");
    if (existing) return existing;

    const generated =
      typeof window.crypto?.randomUUID === "function"
        ? `web-${window.crypto.randomUUID()}`
        : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    writeLocalValue("lia-simulator-user", generated);
    return generated;
  }

  function currentTime() {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date());
  }

  function createMessageId() {
    return typeof window.crypto?.randomUUID === "function"
      ? `ui-${window.crypto.randomUUID()}`
      : `ui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function renderFormattedText(target, value) {
    const text = String(value ?? "");
    const parts = text.split(/(\*[^*\n]+\*)/g);
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
        const strong = document.createElement("strong");
        strong.textContent = part.slice(1, -1);
        target.append(strong);
      } else {
        target.append(document.createTextNode(part));
      }
    }
  }

  function appendMessage(kind, text, detail = "") {
    const fragment = elements.template.content.cloneNode(true);
    const row = fragment.querySelector(".message-row");
    const messageText = fragment.querySelector(".message-text");
    const messageDetail = fragment.querySelector(".message-detail");
    const time = fragment.querySelector("time");

    row.classList.add(kind);
    renderFormattedText(messageText, text);
    messageDetail.textContent = detail;
    time.textContent = currentTime();
    time.dateTime = new Date().toISOString();
    elements.list.append(fragment);
    scrollToLatest();
  }

  function showTyping() {
    removeTyping();
    const row = document.createElement("article");
    row.className = "message-row typing";
    row.setAttribute("aria-label", "Lia está digitando");

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    const dots = document.createElement("div");
    dots.className = "typing-dots";
    dots.setAttribute("aria-hidden", "true");
    dots.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
    bubble.append(dots);
    row.append(bubble);
    elements.list.append(row);
    state.typingRow = row;
    scrollToLatest();
  }

  function removeTyping() {
    state.typingRow?.remove();
    state.typingRow = null;
  }

  function scrollToLatest() {
    window.requestAnimationFrame(() => {
      elements.list.scrollTop = elements.list.scrollHeight;
    });
  }

  function updateControls() {
    const disabled = state.busy || !state.backendOnline;
    elements.input.disabled = disabled;
    elements.send.disabled = disabled;
    elements.reset.disabled = disabled;
    for (const shortcut of elements.shortcuts) shortcut.disabled = disabled;

    if (!state.apiBaseUrl) elements.input.placeholder = "Configure o backend para começar";
    else if (!state.backendOnline) elements.input.placeholder = "Backend indisponível";
    else elements.input.placeholder = "Digite uma mensagem…";
  }

  function setBusy(busy) {
    state.busy = busy;
    updateControls();
  }

  function setBackendOnline(online) {
    state.backendOnline = online;
    updateControls();
  }

  function setConnection(online, label) {
    elements.connection.classList.toggle("offline", !online);
    elements.connection.querySelector("span:last-child").textContent = label;
  }

  function updateEnvironmentCopy() {
    const local = state.apiSource === "same-origin" && isLoopbackHostname(window.location.hostname);
    if (!state.apiBaseUrl) {
      elements.environmentLabel.textContent = "Backend não configurado";
      elements.environmentDescription.textContent =
        "O site está pronto, mas precisa do endereço HTTPS da API para conversar com o agente.";
      return;
    }

    elements.environmentLabel.textContent = local ? "Ambiente local" : "Ambiente online";
    elements.environmentDescription.textContent = local
      ? "Esta tela usa o servidor local e não envia mensagens para clientes reais. Use somente dados fictícios."
      : "Esta tela acessa um backend remoto de demonstração. Não use dados pessoais, confidenciais ou de clientes reais.";
  }

  function updateSession(sessionState) {
    const status = sessionState?.status ?? "active";
    const flow = sessionState?.flow ?? "none";
    const statusLabels = {
      active: "Sessão ativa",
      human_handoff: "Aguardando humano",
      opted_out: "Mensagens desativadas"
    };
    const flowLabels = {
      none: "",
      lead_consent: " · consentimento",
      lead_name: " · coleta de lead",
      lead_company: " · coleta de lead",
      lead_need: " · coleta de lead",
      lead_contact_time: " · coleta de lead",
      lead_confirm: " · confirmação do lead",
      schedule_service: " · agendamento",
      schedule_datetime: " · agendamento",
      schedule_timezone: " · agendamento",
      schedule_confirm: " · confirmação da agenda",
      support_description: " · triagem de suporte",
      support_check_1: " · suporte passo 1",
      support_check_2: " · suporte passo 2",
      opt_in_confirm: " · confirmar reativação"
    };
    elements.session.textContent = `${statusLabels[status] ?? status}${flowLabels[flow] ?? ""}`;
  }

  function responseDetail(result) {
    const labels = {
      faq: "base aprovada",
      openai: "OpenAI",
      rule: "regra do fluxo",
      system: "sistema"
    };
    const pieces = [labels[result.source] ?? result.source];
    if (result.intent) pieces.push(result.intent);
    if (result.protocol) pieces.push(result.protocol);
    return pieces.filter(Boolean).join(" · ");
  }

  function buildApiUrl(path) {
    if (!state.apiBaseUrl) {
      const error = new Error("Configure o endereço do backend antes de continuar.");
      error.code = "BACKEND_UNCONFIGURED";
      throw error;
    }
    const relativePath = String(path).replace(/^\/+/, "");
    return new URL(relativePath, `${state.apiBaseUrl}/`).toString();
  }

  async function requestJson(path, options = {}) {
    const { timeoutMs = 20000, ...fetchOptions } = options;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    const requestUrl = buildApiUrl(path);
    const targetOrigin = new URL(requestUrl).origin;
    const headers = new Headers(options.headers ?? {});
    headers.set("Accept", "application/json");
    if (state.apiToken) headers.set("Authorization", `Bearer ${state.apiToken}`);

    try {
      const response = await fetch(requestUrl, {
        ...fetchOptions,
        credentials: targetOrigin === window.location.origin ? "same-origin" : "omit",
        headers,
        mode: "cors",
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          response.status === 401
            ? "Token ausente ou inválido. Informe o acesso do simulador."
            : data?.error
              ? `Erro: ${data.error}`
              : `Erro HTTP ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error?.name === "AbortError" || error?.status) throw error;
      throw new Error(
        "Não foi possível acessar o backend. Verifique a URL, a disponibilidade do serviço e a política CORS."
      );
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function clearBackendError() {
    elements.backendError.hidden = true;
    elements.backendError.textContent = "";
    elements.backendInput.removeAttribute("aria-invalid");
    elements.backendToken.removeAttribute("aria-invalid");
  }

  function showBackendError(message, field = "url") {
    elements.backendError.textContent = message;
    elements.backendError.hidden = false;
    const target = field === "token" ? elements.backendToken : elements.backendInput;
    target.setAttribute("aria-invalid", "true");
    target.focus();
  }

  function openBackendDialog({ authenticationRequired = false } = {}) {
    clearBackendError();
    elements.backendInput.value = state.apiBaseUrl;
    elements.backendToken.value = state.apiToken;
    if (!elements.backendDialog.open) elements.backendDialog.showModal();

    if (authenticationRequired) {
      showBackendError("Informe o token de acesso fornecido pelo administrador.", "token");
    } else {
      window.requestAnimationFrame(() => elements.backendInput.focus());
    }
  }

  function requireAccessToken() {
    setBackendOnline(false);
    setConnection(false, "Acesso necessário");
    elements.engine.textContent = "Backend protegido · informe o token";
    openBackendDialog({ authenticationRequired: true });
  }

  async function sendMessage(rawMessage) {
    const message = String(rawMessage ?? "").trim();
    if (!message || state.busy || !state.backendOnline) return;

    const retrying =
      state.lastFailed?.message === message && Date.now() - state.lastFailed.failedAt < 120000;
    const messageId = retrying ? state.lastFailed.messageId : createMessageId();

    if (retrying) appendMessage("system", "Repetindo o envio anterior com o mesmo identificador seguro.");
    else appendMessage("user", message, "você");
    elements.input.value = "";
    resizeInput();
    setBusy(true);
    showTyping();

    try {
      const result = await requestJson("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: state.userId, message, messageId })
      });
      state.lastFailed = null;
      removeTyping();
      updateSession(result.state);

      if (result.reply) {
        appendMessage("assistant", result.reply, responseDetail(result));
      } else if (result.suppressed) {
        const pausedMessage =
          result.state?.status === "opted_out"
            ? "Mensagens desativadas. Para testar a reativação correta, digite VOLTAR e depois confirme com SIM."
            : "A automação está pausada aguardando atendimento humano. Use “Novo teste” somente para iniciar outro cenário.";
        appendMessage("system", pausedMessage);
      }
      setConnection(true, "Backend online");
    } catch (error) {
      state.lastFailed = { message, messageId, failedAt: Date.now() };
      removeTyping();
      if (error?.status === 401) {
        appendMessage("system", "O backend pediu autenticação. Informe o token e tente novamente.");
        requireAccessToken();
      } else {
        setBackendOnline(false);
        setConnection(false, "Sem conexão");
        appendMessage(
          "system",
          error?.name === "AbortError"
            ? "O backend demorou para responder. Verifique se o serviço está ativo."
            : "Não consegui falar com o backend configurado. Abra Backend para revisar a conexão."
        );
      }
      showToast(error instanceof Error ? error.message : "Falha inesperada");
    } finally {
      setBusy(false);
      if (state.backendOnline) elements.input.focus();
    }
  }

  async function resetConversation() {
    if (state.busy || !state.backendOnline) return;
    setBusy(true);
    try {
      await requestJson("/api/simulate/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: state.userId })
      });
      elements.list.replaceChildren();
      addWelcomeMessages();
      updateSession({ status: "active", flow: "none" });
      state.lastFailed = null;
      showToast("Novo teste iniciado; protocolos anteriores foram preservados");
    } catch (error) {
      if (error?.status === 401) requireAccessToken();
      else {
        setBackendOnline(false);
        setConnection(false, "Sem conexão");
      }
      showToast(error instanceof Error ? error.message : "Não foi possível iniciar um novo teste");
    } finally {
      setBusy(false);
      if (state.backendOnline) elements.input.focus();
    }
  }

  async function loadHealth() {
    if (!state.apiBaseUrl) {
      elements.engine.textContent = "Configure um backend HTTPS";
      setBackendOnline(false);
      setConnection(false, "Não configurado");
      return false;
    }

    const remoteBackend = new URL(state.apiBaseUrl).origin !== window.location.origin;
    setConnection(false, remoteBackend ? "Acordando backend" : "Conectando");
    if (remoteBackend) {
      elements.engine.textContent = "Conectando · a hospedagem gratuita pode levar até 1 minuto";
    }
    try {
      const health = await requestJson("/health", { timeoutMs: remoteBackend ? 90000 : 20000 });
      elements.companyName.textContent = `Assistente virtual da ${health.company}`;
      elements.modePill.textContent = health.mode === "prototype" ? "PROTÓTIPO" : "CONFIGURADO";
      elements.engine.textContent =
        health.openai === "configured" ? "OpenAI conectada" : "Motor determinístico · regras + FAQ";
      setBackendOnline(true);
      setConnection(true, "Backend online");
      return true;
    } catch (error) {
      if (error?.status === 401) requireAccessToken();
      else {
        elements.engine.textContent = "Backend indisponível · revise a conexão";
        setBackendOnline(false);
        setConnection(false, "Sem conexão");
        showToast(error instanceof Error ? error.message : "Backend indisponível");
      }
      return false;
    }
  }

  async function loadSessionState() {
    if (!state.backendOnline) return;
    try {
      const result = await requestJson("/api/simulate/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: state.userId })
      });
      updateSession(result.state);

      if (result.state?.status === "opted_out") {
        appendMessage(
          "system",
          "Esta sessão já estava com mensagens desativadas. Digite VOLTAR e confirme SIM para reativar."
        );
      } else if (result.state?.status === "human_handoff") {
        appendMessage(
          "system",
          "Esta sessão já estava pausada para atendimento humano. Use “Novo teste” para começar outro cenário."
        );
      } else if (result.state?.flow && result.state.flow !== "none") {
        appendMessage("system", "Uma conversa em andamento foi restaurada. Continue respondendo pelo campo abaixo.");
      }
    } catch (error) {
      if (error?.status === 401) requireAccessToken();
      else {
        setBackendOnline(false);
        setConnection(false, "Sem conexão");
        showToast(error instanceof Error ? error.message : "Não foi possível restaurar a sessão");
      }
    }
  }

  async function connectBackend({ announce = false } = {}) {
    setBackendOnline(false);
    updateEnvironmentCopy();
    const online = await loadHealth();
    if (online) {
      if (announce) appendMessage("system", "Backend conectado. O simulador está pronto para uso.");
      await loadSessionState();
    } else if (!state.apiBaseUrl && announce) {
      appendMessage("system", "Configure um backend HTTPS para habilitar o simulador.");
    }
  }

  function applyTokenFromDialog() {
    state.apiToken = elements.backendToken.value.trim();
    writeTokenForBackend(state.apiBaseUrl, state.apiToken);
  }

  function clearTokenWhenOriginChanges(nextUrl) {
    if (backendOrigin(nextUrl) === backendOrigin(state.apiBaseUrl)) return;
    if (elements.backendToken.value.trim() === state.apiToken) elements.backendToken.value = "";
    state.apiToken = "";
    writeSessionValue(TOKEN_SESSION_KEY, "");
  }

  function saveBackendConfiguration() {
    clearBackendError();
    const rawUrl = elements.backendInput.value.trim();
    let resolved;

    if (rawUrl) {
      try {
        resolved = { url: normalizeApiBaseUrl(rawUrl), source: "user" };
      } catch (error) {
        showBackendError(error instanceof Error ? error.message : "URL inválida");
        return;
      }
      writeLocalValue(BACKEND_URL_KEY, resolved.url);
    } else {
      writeLocalValue(BACKEND_URL_KEY, "");
      resolved = resolveBackendConfiguration({ ignoreUserOverride: true });
      if (!resolved.url) {
        showBackendError("Informe a URL HTTPS do backend para usar o simulador no GitHub Pages.");
        return;
      }
    }

    clearTokenWhenOriginChanges(resolved.url);
    state.apiBaseUrl = resolved.url;
    state.apiSource = resolved.source;
    applyTokenFromDialog();
    elements.backendDialog.close();
    void connectBackend({ announce: true });
  }

  function usePublishedBackend() {
    clearBackendError();
    writeLocalValue(BACKEND_URL_KEY, "");
    const resolved = resolveBackendConfiguration({ ignoreUserOverride: true });
    if (!resolved.url) {
      showBackendError("Ainda não há um backend publicado. Informe uma URL HTTPS acima.");
      return;
    }

    clearTokenWhenOriginChanges(resolved.url);
    state.apiBaseUrl = resolved.url;
    state.apiSource = resolved.source;
    applyTokenFromDialog();
    elements.backendInput.value = resolved.url;
    elements.backendDialog.close();
    void connectBackend({ announce: true });
  }

  function resizeInput() {
    elements.input.style.height = "auto";
    elements.input.style.height = `${Math.min(elements.input.scrollHeight, 128)}px`;
    elements.input.style.overflowY = elements.input.scrollHeight > 128 ? "auto" : "hidden";
  }

  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    state.toastTimer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, 4200);
  }

  function addWelcomeMessages() {
    appendMessage(
      "assistant",
      "Olá! Eu sou a Lia. Esta é uma conversa de teste — escreva livremente ou use os atalhos ao lado.",
      "simulador web"
    );
    appendMessage(
      "system",
      "Dica: experimente serviços, horário, contratação, agenda, suporte, atendimento humano e STOP."
    );
  }

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendMessage(elements.input.value);
  });

  elements.input.addEventListener("input", resizeInput);
  elements.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.form.requestSubmit();
    }
  });

  elements.reset.addEventListener("click", () => void resetConversation());
  for (const shortcut of elements.shortcuts) {
    shortcut.addEventListener("click", () => void sendMessage(shortcut.dataset.message));
  }

  elements.backendSettings.addEventListener("click", () => openBackendDialog());
  elements.backendClose.addEventListener("click", () => elements.backendDialog.close());
  elements.backendDefault.addEventListener("click", usePublishedBackend);
  elements.backendForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveBackendConfiguration();
  });
  elements.backendDialog.addEventListener("click", (event) => {
    if (event.target === elements.backendDialog) elements.backendDialog.close();
  });

  addWelcomeMessages();
  updateSession({ status: "active", flow: "none" });
  updateEnvironmentCopy();
  updateControls();
  void connectBackend();
})();
