(() => {
  "use strict";

  const elements = {
    companyName: document.querySelector("#company-name"),
    connection: document.querySelector("#connection-state"),
    engine: document.querySelector("#engine-label"),
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

  const state = {
    busy: false,
    lastFailed: null,
    typingRow: null,
    toastTimer: null,
    userId: getOrCreateUserId()
  };

  function getOrCreateUserId() {
    const existing = window.localStorage.getItem("lia-simulator-user");
    if (existing) return existing;

    const generated =
      typeof window.crypto?.randomUUID === "function"
        ? `web-${window.crypto.randomUUID()}`
        : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem("lia-simulator-user", generated);
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

  function setBusy(busy) {
    state.busy = busy;
    elements.input.disabled = busy;
    elements.send.disabled = busy;
    elements.reset.disabled = busy;
    for (const shortcut of elements.shortcuts) shortcut.disabled = busy;
  }

  function setConnection(online, label) {
    elements.connection.classList.toggle("offline", !online);
    elements.connection.querySelector("span:last-child").textContent = label;
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

  async function requestJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data?.error ? `Erro: ${data.error}` : `Erro HTTP ${response.status}`;
        throw new Error(message);
      }
      return data;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function sendMessage(rawMessage) {
    const message = String(rawMessage ?? "").trim();
    if (!message || state.busy) return;

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
            : "A automação está pausada aguardando atendimento humano. Use “Novo teste” somente para iniciar outro cenário local.";
        appendMessage("system", pausedMessage);
      }
      setConnection(true, "Servidor online");
    } catch (error) {
      state.lastFailed = { message, messageId, failedAt: Date.now() };
      removeTyping();
      setConnection(false, "Sem conexão");
      appendMessage(
        "system",
        error?.name === "AbortError"
          ? "O servidor demorou para responder. Tente novamente."
          : "Não consegui falar com o servidor local."
      );
      showToast(error instanceof Error ? error.message : "Falha inesperada");
    } finally {
      setBusy(false);
      elements.input.focus();
    }
  }

  async function resetConversation() {
    if (state.busy) return;
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
      showToast("Novo teste iniciado; protocolos locais anteriores foram preservados");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Não foi possível iniciar um novo teste");
    } finally {
      setBusy(false);
      elements.input.focus();
    }
  }

  async function loadHealth() {
    try {
      const health = await requestJson("/health");
      elements.companyName.textContent = `Assistente virtual da ${health.company}`;
      elements.modePill.textContent = health.mode === "prototype" ? "PROTÓTIPO" : "CONFIGURADO";
      elements.engine.textContent =
        health.openai === "configured" ? "OpenAI conectada" : "Motor determinístico · regras + FAQ";
      setConnection(true, "Servidor online");
    } catch {
      elements.engine.textContent = "Servidor indisponível";
      setConnection(false, "Sem conexão");
      showToast("Não encontrei o servidor local na porta 3000");
    }
  }

  async function loadSessionState() {
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
          "Esta sessão já estava pausada para atendimento humano. Use “Novo teste” para começar outro cenário local."
        );
      } else if (result.state?.flow && result.state.flow !== "none") {
        appendMessage("system", "Uma conversa em andamento foi restaurada. Continue respondendo pelo campo abaixo.");
      }
    } catch {
      // O health check já apresenta a indisponibilidade do servidor.
    }
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
    }, 3200);
  }

  function addWelcomeMessages() {
    appendMessage(
      "assistant",
      "Olá! Eu sou a Lia. Esta é uma conversa de teste — escreva livremente ou use os atalhos ao lado.",
      "simulador local"
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

  addWelcomeMessages();
  updateSession({ status: "active", flow: "none" });
  void loadHealth();
  void loadSessionState();
  elements.input.focus();
})();
