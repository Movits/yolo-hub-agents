import type { LlmResponder, SessionStore } from "./ports.js";
import type { KnowledgeRelease } from "../config/release.js";
import { findFaq, findSupportProcedure, formatServices } from "./knowledge.js";
import {
  cleanUserValue,
  includesAny,
  isConsentPositive,
  isNegative,
  isPositive,
  normalizeText,
  redactSecrets
} from "./text.js";
import type {
  AgentResult,
  ConversationSession,
  IncomingMessage,
  Intent,
  ReplySource,
  SupportTicket
} from "../domain/types.js";
import { tenantScopeKey, type TenantContext } from "../domain/tenant.js";

const optOutPhrases = [
  "stop",
  "unsubscribe",
  "quero parar",
  "pare de mandar",
  "parar mensagens",
  "me remover",
  "remover meu contato",
  "remover da lista",
  "descadastrar",
  "cancelar mensagens",
  "parem de mandar mensagens",
  "parem de me mandar mensagem",
  "parem de me mandar mensagens",
  "pare de me mandar mensagem",
  "nao me mande mensagens",
  "nao me mandem mensagens",
  "nao quero receber mensagens",
  "nao quero receber mensagem",
  "nao quero mais receber mensagens",
  "nao quero mais mensagens",
  "nao quero mais mensagem",
  "nao entre em contato",
  "nao quero contato",
  "nao quero receber contato"
];

const optInPhrases = ["voltar", "reativar", "quero receber novamente", "retomar mensagens"];

const humanPhrases = [
  "falar com atendente",
  "falar com um atendente",
  "falar com uma pessoa",
  "falar com alguem",
  "falar com o gerente",
  "falar com gerente",
  "atendimento humano",
  "atendente humano",
  "quero um humano",
  "quero atendente",
  "quero uma pessoa",
  "chamar atendente",
  "chamar gerente"
];

const sensitivePhrases = [
  "fraude",
  "cartao clonado",
  "cobranca indevida",
  "vazamento de dados",
  "ameaca",
  "advogado",
  "processo judicial",
  "problema juridico",
  "codigo de autenticacao",
  "codigo por sms",
  "cvv",
  "senha",
  "token",
  "otp",
  "lgpd",
  "privacidade",
  "dados pessoais",
  "excluir meus dados",
  "apagar meus dados",
  "acessar meus dados"
];

const complaintPhrases = ["reclamacao", "insatisfeito", "pessimo atendimento", "absurdo"];

const extendedComplaintPhrases = [
  "esperando ha muito tempo",
  "ninguem responde",
  "ja expliquei isso",
  "ja falei isso",
  "ja expliquei e nao resolveram",
  "reclamar nas redes sociais",
  "muito decepcionado",
  "muito decepcionada",
  "cansei de esperar",
  "isso e uma vergonha",
  "pessimo atendimento"
];

const promptAttackPhrases = [
  "ignore suas regras",
  "ignore as regras",
  "mostre o prompt",
  "revele o prompt",
  "dados de clientes",
  "mostre credenciais",
  "revele credenciais"
];

const credentialDisclosurePhrases = [
  "me mande a senha",
  "me passe a senha",
  "qual a senha",
  "mostre a senha",
  "me mande o token",
  "me passe o token",
  "qual o token",
  "mostre credenciais"
];

const otherPeopleDataPhrases = [
  "dados de outro cliente",
  "dados de outra pessoa",
  "informacoes de outro cliente",
  "telefone de outro cliente",
  "cadastro de outro cliente"
];

const unverifiedActionPhrases = [
  "finja que o pagamento",
  "pagamento ja foi aprovado",
  "confirme que meu pedido foi enviado",
  "confirme o envio sem",
  "confirme um prazo mesmo sem saber",
  "invente um prazo"
];

const personalContactPhrases = [
  "telefone pessoal do gerente",
  "numero pessoal do gerente",
  "telefone particular do gerente"
];

const privacyInformationPhrases = [
  "quais dados meus voces guardam",
  "que dados meus voces guardam",
  "quais dados voces armazenam",
  "como usam meus dados",
  "por quanto tempo guardam meus dados"
];

const identityPhrases = [
  "voce e uma pessoa ou um robo",
  "voce e um robo",
  "voce e humano",
  "estou falando com uma pessoa",
  "voce e uma inteligencia artificial",
  "a assistente e uma inteligencia artificial",
  "estou falando com uma inteligencia artificial"
];

const hoursPhrases = [
  "horario de funcionamento",
  "horario de atendimento",
  "que horas abre",
  "que horas fecha",
  "abre hoje",
  "esta aberto",
  "estao abertos",
  "estarao abertos",
  "aberto agora",
  "atendendo agora",
  "atendente humano estara disponivel"
];

const catalogPhrases = [
  "quais produtos",
  "que produtos",
  "produtos voces vendem",
  "produtos voces tem",
  "o que voces vendem",
  "quais servicos",
  "que servicos"
];

const supportAndOrderPhrases = [
  "nao esta funcionando",
  "nao ta funcionando",
  "continua com problema",
  "pedido nao chegou",
  "pedido atrasado",
  "produto com problema",
  "comprei errado",
  "troca produto",
  "trocar produto",
  "troca de produto",
  "quero trocar",
  "valor errado",
  "cobraram errado",
  "cobranca errada"
];

const commerceDetailPhrases = [
  "produto disponivel",
  "tem na cor",
  "outro tamanho",
  "tem tamanho",
  "tamanho m",
  "volta ao estoque",
  "tem estoque",
  "tem no estoque",
  "em estoque",
  "conseguem reservar",
  "fazer reserva",
  "fazem entrega",
  "tem entrega",
  "retirar na loja",
  "retirada na loja",
  "tem estacionamento",
  "posso parcelar",
  "vezes sem juros",
  "desconto a vista",
  "desconto no dinheiro",
  "tem promocao",
  "promocao hoje"
];

const commerceHandoffPhrases = [
  "pedido nao chegou",
  "pedido ainda nao chegou",
  "pedido atrasado",
  "pedido esta atrasado",
  "onde esta meu pedido",
  "rastrear meu pedido",
  "status do meu pedido",
  "cancelar meu pedido",
  "cancelar o pedido",
  "produto com problema",
  "comprei errado",
  "como faco pra trocar",
  "como faco para trocar",
  "troca produto",
  "trocar produto",
  "troca de produto",
  "quero trocar",
  "devolver o produto",
  "devolver produto",
  "devolucao",
  "prazo para troca",
  "prazo de troca",
  "quero reembolso",
  "pedir reembolso",
  "valor errado",
  "cobraram errado",
  "cobranca errada",
  "cobranca veio duplicada",
  "cobranca duplicada",
  "cobraram duas vezes"
];

const cancellationPhrases = [
  "cancelar meu plano",
  "cancelar o plano",
  "cancelar contrato",
  "cancelar assinatura",
  "cancelar tudo",
  "desistir do plano"
];

const urgentPhrases = [
  "e urgente",
  "emergencia",
  "urgente agora",
  "urgencia"
];

interface ResponseInput {
  reply: string | null;
  intent: Intent;
  source: ReplySource;
  suppressed?: boolean;
  duplicate?: boolean;
  handoff?: boolean;
  protocol?: string;
  recordHistory?: boolean;
}

function isOptOutRequest(text: string): boolean {
  const normalized = normalizeText(text);
  if (["parar", "sair", "stop", "remover"].includes(normalized)) return true;
  if (includesAny(normalized, optOutPhrases)) return true;
  if (
    /\b(?:nao quero|nao desejo)\s+(?:mais\s+)?(?:receber|ganhar)\s+(?:(?:essas?|suas?)\s+)?mensagens?\b/.test(
      normalized
    ) ||
    /\bparem?\s+de\s+(?:me\s+)?(?:mandar|enviar)\s+(?:qualquer\s+)?mensagens?\b/.test(
      normalized
    )
  ) {
    return true;
  }
  return (
    includesAny(normalized, ["quero sair"]) &&
    !includesAny(normalized, ["sair do meu plano", "sair da minha conta", "sair do contrato"])
  );
}

function isOptInRequest(text: string): boolean {
  const normalized = normalizeText(text);
  return includesAny(normalized, optInPhrases);
}

function isHumanRequest(text: string): boolean {
  const normalized = normalizeText(text);
  if (
    /\b(?:nao quero|nao preciso)(?:\s+de)?\s+(?:(?:falar|conversar)\s+com\s+|chamar\s+)?(?:o|a|um|uma)?\s*(?:atendente|pessoa|gerente|humano)\b/.test(
      normalized
    ) ||
    /\bsem\s+(?:(?:falar|conversar)\s+com\s+)?(?:o|a|um|uma)?\s*(?:atendente|pessoa|gerente|humano)\b/.test(
      normalized
    ) ||
    /\bnao chame\s+(?:o|a|um|uma)?\s*(?:atendente|pessoa|gerente|humano)\b/.test(
      normalized
    )
  ) {
    return false;
  }
  return includesAny(normalized, humanPhrases);
}

function isSensitiveRequest(text: string): boolean {
  return includesAny(text, sensitivePhrases);
}

function isComplaintRequest(text: string): boolean {
  const normalized = normalizeText(text)
    .replace(
      /\bnao (?:estou|fiquei|sou)?\s*(?:muito )?(?:insatisfeito|insatisfeita|decepcionado|decepcionada)\b/g,
      ""
    )
    .replace(/\bnao cansei de esperar\b/g, "")
    .replace(/\bnao (?:e|foi) (?:um |uma )?(?:absurdo|vergonha|pessimo atendimento)\b/g, "");
  return includesAny(normalized, [...complaintPhrases, ...extendedComplaintPhrases]);
}

function containsSuppliedSecret(text: string): boolean {
  return redactSecrets(text) !== text;
}

function isCredentialDisclosureRequest(text: string): boolean {
  return includesAny(text, credentialDisclosurePhrases);
}

function isOtherPeopleDataRequest(text: string): boolean {
  return includesAny(text, otherPeopleDataPhrases);
}

function isUnverifiedActionRequest(text: string): boolean {
  return includesAny(text, unverifiedActionPhrases);
}

function isPersonalContactRequest(text: string): boolean {
  return includesAny(text, personalContactPhrases);
}

function isPrivacyInformationRequest(text: string): boolean {
  return includesAny(text, privacyInformationPhrases);
}

function isPrivacyRequest(text: string): boolean {
  return (
    isPrivacyInformationRequest(text) ||
    includesAny(text, [
      "lgpd",
      "privacidade",
      "dados pessoais",
      "excluir meus dados",
      "apagar meus dados",
      "acessar meus dados"
    ])
  );
}

function isIdentityQuestion(text: string): boolean {
  return includesAny(text, identityPhrases);
}

function isHoursQuestion(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    includesAny(normalized, hoursPhrases) ||
    (/\b(?:domingos?|segundas?|tercas?|quartas?|quintas?|sextas?|sabados?)\b/.test(normalized) &&
      includesAny(normalized, [
        "abre",
        "abrem",
        "atende",
        "atendem",
        "funciona",
        "funcionam",
        "estarao abertos"
      ])) ||
    (/\b(?:sao|agora sao)\s+\d{1,2}h\b/.test(normalized) &&
      includesAny(normalized, ["ajuda", "atendimento", "atendendo", "disponivel"]))
  );
}

function isCatalogQuestion(text: string): boolean {
  return includesAny(text, catalogPhrases);
}

function isSupportOrOrderIssue(text: string): boolean {
  return includesAny(text, supportAndOrderPhrases);
}

function isCommerceDetailQuestion(text: string): boolean {
  return includesAny(text, commerceDetailPhrases);
}

function isNegatedCommerceAction(text: string): boolean {
  return /\bnao (?:quero|preciso|desejo)(?:\s+de)?\s+(?:cancelar(?:\s+(?:meu|o|um)?\s*(?:pedido|produto|compra))?|reembolso|trocar(?:\s+(?:o|um)?\s*produto)?|devolver(?:\s+(?:o|um)?\s*produto)?)\b/.test(
    normalizeText(text)
  );
}

function needsCommerceHandoff(text: string): boolean {
  const normalized = normalizeText(text).replace(
    /\bnao (?:quero|preciso|desejo)(?:\s+de)?\s+(?:cancelar(?:\s+(?:meu|o|um)?\s*(?:pedido|produto|compra))?|reembolso|trocar(?:\s+(?:o|um)?\s*produto)?|devolver(?:\s+(?:o|um)?\s*produto)?)\b/g,
    ""
  );
  return (
    includesAny(normalized, commerceHandoffPhrases) ||
    /\b(?:cancelar|cancelamento)\b.*\b(?:pedido|compra|produto)\b/.test(normalized)
  );
}

function isCancellationQuestion(text: string): boolean {
  return includesAny(text, cancellationPhrases);
}

function isUrgentRequest(text: string): boolean {
  const normalized = normalizeText(text);
  if (includesAny(normalized, ["nao e urgente", "nao urgente", "sem urgencia"])) return false;
  return includesAny(normalized, urgentPhrases);
}

function isExternalLinkRequest(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    includesAny(normalized, ["clique neste link", "acesse este link", "abra este link"]) ||
    /https?:\/\//.test(text)
  );
}

function isUnsupportedDiscountRequest(text: string): boolean {
  const normalized = normalizeText(text);
  return /\bdesconto\b/.test(normalized) && /\b\d{2,3}\s*%?\b/.test(normalized);
}

function shouldEscalateSensitive(text: string): boolean {
  if (
    includesAny(text, promptAttackPhrases) ||
    isCredentialDisclosureRequest(text) ||
    isOtherPeopleDataRequest(text) ||
    isUnverifiedActionRequest(text) ||
    isPersonalContactRequest(text)
  ) {
    return false;
  }
  if (containsSuppliedSecret(text) || isPrivacyRequest(text)) return true;
  return isSensitiveRequest(text);
}

function cleanLeadName(value: string): string {
  return cleanUserValue(
    value.replace(/^(?:meu nome (?:é|e)|eu me chamo|me chamo)\s+/i, ""),
    80
  );
}

function cleanLeadCompany(value: string): string {
  const normalized = normalizeText(value);
  if (
    includesAny(normalized, [
      "nao tenho empresa",
      "nao se aplica",
      "sem empresa",
      "sou autonomo",
      "sou autonoma",
      "pessoa fisica"
    ])
  ) {
    return "Não se aplica";
  }
  return cleanUserValue(
    value.replace(/^(?:minha empresa (?:é|e|se chama)|a empresa (?:é|e|se chama))\s+/i, ""),
    120
  );
}

interface ParsedBusinessHours {
  weekdays: Set<number>;
  startMinutes: number;
  endMinutes: number;
}

function parseBusinessHours(value: string): ParsedBusinessHours | null {
  const normalized = normalizeText(value);
  const match = normalized.match(
    /\b(\d{1,2})h(?:\s*(\d{2}))?\s+(?:a|as|ate)\s+(\d{1,2})h(?:\s*(\d{2}))?\b/
  );
  if (!match) return null;

  const startHour = Number(match[1]);
  const startMinute = Number(match[2] ?? 0);
  const endHour = Number(match[3]);
  const endMinute = Number(match[4] ?? 0);
  if (
    startHour > 23 ||
    endHour > 23 ||
    startMinute > 59 ||
    endMinute > 59 ||
    startHour * 60 + startMinute >= endHour * 60 + endMinute
  ) {
    return null;
  }

  const dayOrder = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
  const weekdays = new Set<number>();
  if (includesAny(normalized, ["todos os dias", "diariamente"])) {
    for (let day = 0; day <= 6; day += 1) weekdays.add(day);
  } else {
    const range = normalized.match(
      /\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)\s+a\s+(domingo|segunda|terca|quarta|quinta|sexta|sabado)\b/
    );
    if (range) {
      const startDay = dayOrder.indexOf(range[1] ?? "");
      const endDay = dayOrder.indexOf(range[2] ?? "");
      if (startDay >= 0 && endDay >= startDay) {
        for (let day = startDay; day <= endDay; day += 1) weekdays.add(day);
      }
    }
    if (weekdays.size === 0) {
      dayOrder.forEach((dayName, day) => {
        if (normalized.includes(dayName)) weekdays.add(day);
      });
    }
  }

  if (weekdays.size === 0) return null;
  return {
    weekdays,
    startMinutes: startHour * 60 + startMinute,
    endMinutes: endHour * 60 + endMinute
  };
}

function zonedDayAndMinutes(date: Date, timezone: string): { weekday: number; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    const weekdayName = parts.find((part) => part.type === "weekday")?.value;
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      weekdayName ?? ""
    );
    if (weekday < 0 || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return { weekday, minutes: hour * 60 + minute };
  } catch {
    return null;
  }
}

function isFlowCancelRequest(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    ["cancelar", "cancela", "quero cancelar", "menu", "recomecar"].includes(normalized) ||
    includesAny(normalized, ["cancelar fluxo", "deixa pra la", "voltar ao menu"])
  );
}

export class MessageAlreadyProcessingError extends Error {
  constructor() {
    super("Mensagem já está em processamento; solicite retry.");
    this.name = "MessageAlreadyProcessingError";
  }
}

export class BusinessAgent {
  private readonly userQueues = new Map<string, Promise<AgentResult>>();
  private readonly pendingPauseRequests = new Map<string, number>();
  private readonly knowledge: KnowledgeRelease["knowledge"];

  constructor(
    private readonly tenant: TenantContext,
    private readonly release: KnowledgeRelease,
    private readonly store: SessionStore,
    private readonly llm?: LlmResponder
  ) {
    this.knowledge = release.knowledge;
    if (
      tenant.agentId !== release.identity.agentId ||
      release.identity.agentId !== release.knowledge.agentId
    ) {
      throw new Error("TenantContext.agentId deve corresponder ao conhecimento carregado.");
    }
  }

  process(message: IncomingMessage): Promise<AgentResult> {
    const userKey = this.scopedUserKey(message.userId);
    const requestsPause =
      isOptOutRequest(message.text) ||
      isHumanRequest(message.text) ||
      shouldEscalateSensitive(message.text) ||
      isComplaintRequest(message.text) ||
      needsCommerceHandoff(message.text) ||
      isUrgentRequest(message.text);
    if (requestsPause) {
      this.pendingPauseRequests.set(
        userKey,
        (this.pendingPauseRequests.get(userKey) ?? 0) + 1
      );
    }

    const previous = this.userQueues.get(userKey) ?? Promise.resolve(undefined);
    const current = previous
      .catch(() => undefined)
      .then(() => this.processSequential(message))
      .catch((error: unknown) => {
        if (!(error instanceof MessageAlreadyProcessingError)) {
          this.store.releaseMessage(this.tenant, message.id);
        }
        throw error;
      });
    this.userQueues.set(userKey, current);

    return current.finally(() => {
      if (requestsPause) {
        const remaining = (this.pendingPauseRequests.get(userKey) ?? 1) - 1;
        if (remaining <= 0) this.pendingPauseRequests.delete(userKey);
        else this.pendingPauseRequests.set(userKey, remaining);
      }
      if (this.userQueues.get(userKey) === current) {
        this.userQueues.delete(userKey);
      }
    });
  }

  shouldSendOutbound(userId: string, result: AgentResult): boolean {
    if (!result.reply || result.suppressed) return false;
    if (this.pendingPauseRequests.has(this.scopedUserKey(userId))) return false;

    const session = this.store.getSession(this.tenant, userId);
    if (session.status === "active") return true;
    if (session.status === "human_handoff") return result.handoff;
    return result.intent === "opt_out" || result.intent === "opt_in";
  }

  private async processSequential(message: IncomingMessage): Promise<AgentResult> {
    if (!this.store.markMessageProcessed(this.tenant, message.id)) {
      const current = this.store.getSession(this.tenant, message.userId);
      const cached = this.store.getProcessedResult(this.tenant, message.id);
      if (cached) {
        return {
          ...cached,
          duplicate: true,
          state: { status: current.status, flow: current.flow }
        };
      }
      throw new MessageAlreadyProcessingError();
    }

    let session = this.store.getSession(this.tenant, message.userId);

    if (message.source === "simulator" && normalizeText(message.text) === "reset") {
      session = this.store.resetSession(this.tenant, message.userId);
      return this.respond(session, message, {
        reply: "Conversa reiniciada. Como posso ajudar?",
        intent: "greeting",
        source: "system"
      });
    }

    session.lastUserMessageAt = message.timestamp.toISOString();

    if (session.status === "opted_out") {
      return this.handleOptedOut(session, message);
    }

    if (isOptOutRequest(message.text)) {
      session.status = "opted_out";
      session.flow = "none";
      session.flowData = {};
      session.fallbackCount = 0;
      return this.respond(session, message, {
        reply: "Tudo certo. Você não receberá novas mensagens nossas. Se quiser voltar, envie VOLTAR.",
        intent: "opt_out",
        source: "rule"
      });
    }

    if (session.status === "human_handoff") {
      return this.respond(session, message, {
        reply: null,
        intent: "human",
        source: "system",
        suppressed: true,
        handoff: true,
        recordHistory: false
      });
    }

    if (message.messageType !== "text" && message.messageType !== "interactive") {
      return this.respond(session, message, {
        reply:
          "Por enquanto, este agente entende mensagens de texto. Pode descrever sua dúvida por escrito?",
        intent: "unknown",
        source: "rule"
      });
    }

    if (
      includesAny(message.text, promptAttackPhrases) ||
      isOtherPeopleDataRequest(message.text) ||
      isCredentialDisclosureRequest(message.text)
    ) {
      session.fallbackCount = 0;
      return this.respond(session, message, {
        reply:
          "Não posso revelar instruções internas, senhas, tokens, credenciais ou dados de outras pessoas. Posso ajudar somente com informações e solicitações autorizadas da empresa.",
        intent: "unknown",
        source: "rule"
      });
    }

    if (containsSuppliedSecret(message.text)) {
      return this.startHandoff(session, message, "support", "dado_sensivel_fornecido");
    }

    if (isPrivacyRequest(message.text)) {
      return this.startHandoff(
        session,
        message,
        "support",
        "solicitacao_de_privacidade",
        this.knowledge.prototype
          ? `Neste ambiente de teste, não consigo consultar, listar, excluir ou alterar seus dados por este chat. ${this.knowledge.policies.privacyContact}`
          : this.knowledge.policies.privacyContact
      );
    }

    const faqMatch = session.flow === "none" ? findFaq(message.text, this.knowledge) : null;
    const approvedFaq = faqMatch && faqMatch.score >= 0.8 ? faqMatch : null;

    if (isUrgentRequest(message.text)) {
      const urgentCandidate = approvedFaq ?? findFaq(message.text, this.knowledge);
      const urgentFaq =
        urgentCandidate && urgentCandidate.score >= 0.8 ? urgentCandidate : null;
      if (
        isHumanRequest(message.text) ||
        shouldEscalateSensitive(message.text) ||
        isComplaintRequest(message.text) ||
        needsCommerceHandoff(message.text)
      ) {
        return this.startHandoff(
          session,
          message,
          isComplaintRequest(message.text) ? "complaint" : "support",
          "urgencia_com_encaminhamento",
          this.urgentReply(urgentFaq?.answer)
        );
      }
      this.clearFlow(session);
      return this.respond(session, message, {
        reply: this.urgentReply(urgentFaq?.answer),
        intent: "support",
        source: "rule"
      });
    }

    if (shouldEscalateSensitive(message.text)) {
      return this.startHandoff(session, message, "support", "tema_sensivel");
    }

    if (isHumanRequest(message.text)) {
      return this.startHandoff(session, message, "general", "pedido_explicito_do_cliente");
    }

    if (isComplaintRequest(message.text)) {
      return this.startHandoff(session, message, "complaint", "reclamacao");
    }

    if (isNegatedCommerceAction(message.text)) {
      session.fallbackCount = 0;
      return this.respond(session, message, {
        reply:
          "Entendi. Não registrei nenhuma solicitação de cancelamento, troca, devolução ou reembolso. Como posso ajudar?",
        intent: "unknown",
        source: "rule"
      });
    }

    if (needsCommerceHandoff(message.text)) {
      if (approvedFaq) {
        session.fallbackCount = 0;
        return this.respond(session, message, {
          reply: approvedFaq.answer,
          intent: "faq",
          source: "faq"
        });
      }
      return this.startHandoff(session, message, "support", "pos_venda_ou_cobranca");
    }

    if (isUnverifiedActionRequest(message.text)) {
      session.fallbackCount = 0;
      return this.respond(session, message, {
        reply: this.knowledge.prototype
          ? "Não posso confirmar pagamento, envio ou prazo sem uma fonte verificada. Neste ambiente de teste não há sistema de pedidos ou pagamentos conectado."
          : "Não posso confirmar pagamento, envio ou prazo sem consultar uma fonte operacional verificada.",
        intent: "unknown",
        source: "rule"
      });
    }

    if (isPersonalContactRequest(message.text)) {
      session.fallbackCount = 0;
      return this.respond(session, message, {
        reply: `Não forneço contatos pessoais. Use os canais oficiais configurados: ${this.knowledge.company.humanPhone} ou ${this.knowledge.company.email}.`,
        intent: "faq",
        source: "rule"
      });
    }

    if (isExternalLinkRequest(message.text)) {
      session.fallbackCount = 0;
      return this.respond(session, message, {
        reply:
          "Não abro nem valido links enviados na conversa. Se a dúvida for sobre a empresa, descreva o conteúdo sem incluir credenciais ou dados pessoais.",
        intent: "unknown",
        source: "rule"
      });
    }

    if (isUnsupportedDiscountRequest(message.text)) {
      if (approvedFaq) {
        session.fallbackCount = 0;
        return this.respond(session, message, {
          reply: approvedFaq.answer,
          intent: "faq",
          source: "faq"
        });
      }
      session.fallbackCount = 0;
      return this.respond(session, message, {
        reply:
          "Não encontrei essa informação na base aprovada e não posso conceder ou confirmar descontos. Posso informar os preços configurados dos planos.",
        intent: "pricing",
        source: "rule"
      });
    }

    if (session.flow !== "none" && isCancellationQuestion(message.text)) {
      this.clearFlow(session);
      return this.respond(session, message, {
        reply: `O fluxo anterior foi cancelado. ${this.knowledge.policies.cancellation}`,
        intent: "faq",
        source: "rule"
      });
    }

    if (session.flow !== "none" && isFlowCancelRequest(message.text)) {
      this.clearFlow(session);
      return this.respond(session, message, {
        reply: "Fluxo cancelado. Posso ajudar com serviços, agendamento ou suporte.",
        intent: "unknown",
        source: "rule"
      });
    }

    if (session.flow !== "none") {
      return this.handleFlow(session, message);
    }

    if (isIdentityQuestion(message.text)) {
      session.fallbackCount = 0;
      return this.respond(session, message, {
        reply: `Sou ${this.knowledge.assistant.name}, a assistente virtual da ${this.knowledge.company.name}. Não sou uma pessoa. Posso responder com base nas informações aprovadas e encaminhar situações que precisem de análise humana.`,
        intent: "business_info",
        source: "rule"
      });
    }

    if (faqMatch) {
      session.fallbackCount = 0;
      return this.respond(session, message, {
        reply: faqMatch.answer,
        intent: "faq",
        source: "faq"
      });
    }

    if (isHoursQuestion(message.text)) {
      return this.respond(session, message, {
        reply: this.businessHoursReply(message),
        intent: "faq",
        source: "faq"
      });
    }

    if (isCancellationQuestion(message.text)) {
      session.fallbackCount = 0;
      return this.respond(session, message, {
        reply: `${this.knowledge.policies.cancellation} Diga qual plano, contrato ou solicitação você quer cancelar. Não envie dados sensíveis.`,
        intent: "faq",
        source: "rule"
      });
    }

    if (isCatalogQuestion(message.text)) {
      session.fallbackCount = 0;
      return this.respond(session, message, {
        reply: `Estas são as ofertas disponíveis na base aprovada deste agente:\n\n${formatServices(this.knowledge)}`,
        intent: "pricing",
        source: "rule"
      });
    }

    if (isCommerceDetailQuestion(message.text)) {
      session.fallbackCount = 0;
      return this.respond(session, message, {
        reply: this.commerceDetailReply(message.text),
        intent: "faq",
        source: "rule"
      });
    }

    const intent = this.classify(message.text);
    session.fallbackCount = intent === "unknown" ? session.fallbackCount : 0;

    switch (intent) {
      case "greeting":
        return this.respond(session, message, {
          reply: this.welcomeMessage(),
          intent,
          source: "rule"
        });
      case "business_info":
        return this.respond(session, message, {
          reply: `${this.knowledge.company.description}\n\nAtuamos com ${this.knowledge.company.industry}.`,
          intent,
          source: "rule"
        });
      case "pricing":
        return this.respond(session, message, {
          reply: `Estas são as ofertas configuradas na base aprovada:\n\n${formatServices(this.knowledge)}\n\nQuer saber mais ou falar sobre contratação?`,
          intent,
          source: "rule"
        });
      case "sales":
        session.flow = "lead_consent";
        session.flowData = {};
        return this.respond(session, message, {
          reply:
            "Ótimo! Posso usar os dados desta conversa para registrar seu interesse e permitir um contato sobre a solicitação? Responda SIM ou NÃO.",
          intent,
          source: "rule"
        });
      case "scheduling":
        session.flow = "schedule_service";
        session.flowData = { initialRequest: cleanUserValue(redactSecrets(message.text)) };
        return this.respond(session, message, {
          reply: `Para qual serviço ou assunto você quer agendar?\n\n${formatServices(this.knowledge)}`,
          intent,
          source: "rule"
        });
      case "support":
        return this.startSupport(session, message);
      case "complaint":
        return this.startHandoff(session, message, "complaint", "reclamacao");
      case "human":
        return this.startHandoff(session, message, "general", "opcao_de_menu");
      default:
        break;
    }

    return this.handleUnknown(session, message);
  }

  private async handleFlow(
    session: ConversationSession,
    message: IncomingMessage
  ): Promise<AgentResult> {
    const value = cleanUserValue(redactSecrets(message.text));

    switch (session.flow) {
      case "lead_consent":
        if (isConsentPositive(value)) {
          session.flowData.consentedAt = new Date().toISOString();
          session.flow = "lead_name";
          return this.respond(session, message, {
            reply: "Obrigado. Qual é o seu nome?",
            intent: "sales",
            source: "rule"
          });
        }
        if (isNegative(value)) {
          this.clearFlow(session);
          return this.respond(session, message, {
            reply:
              "Sem problema. Não vou cadastrar seus dados. Ainda posso responder perguntas gerais sobre a empresa.",
            intent: "sales",
            source: "rule"
          });
        }
        return this.askYesNo(session, message, "Posso registrar seus dados para contato? Responda SIM ou NÃO.", "sales");

      case "lead_name":
        {
          const name = cleanLeadName(value);
          if (name.length < 2) {
            return this.respond(session, message, {
              reply: "Não consegui identificar o nome. Como você gostaria de ser chamado?",
              intent: "sales",
              source: "rule"
            });
          }
          session.flowData.name = name;
          session.flow = "lead_company";
          return this.respond(session, message, {
            reply: "Qual é o nome da sua empresa? Se não se aplicar, responda “não se aplica”.",
            intent: "sales",
            source: "rule"
          });
        }

      case "lead_company":
        {
          const company = cleanLeadCompany(value);
          if (company.length < 2) {
            return this.respond(session, message, {
              reply: "Informe o nome da empresa ou responda “não se aplica”.",
              intent: "sales",
              source: "rule"
            });
          }
          session.flowData.company = company;
          session.flow = "lead_need";
          return this.respond(session, message, {
            reply: "Em poucas palavras, qual é a principal necessidade que você quer resolver?",
            intent: "sales",
            source: "rule"
          });
        }

      case "lead_need":
        if (value.length < 5) {
          return this.respond(session, message, {
            reply: "Pode dar um pouco mais de detalhe sobre a sua necessidade?",
            intent: "sales",
            source: "rule"
          });
        }
        session.flowData.need = value;
        session.flow = "lead_contact_time";
        return this.respond(session, message, {
          reply: "Qual é o melhor período para contato: manhã, tarde ou um horário específico?",
          intent: "sales",
          source: "rule"
        });

      case "lead_contact_time":
        if (value.length < 2) {
          return this.respond(session, message, {
            reply: "Qual período funciona melhor para você?",
            intent: "sales",
            source: "rule"
          });
        }
        session.flowData.contactTime = value.slice(0, 120);
        session.flow = "lead_confirm";
        return this.respond(session, message, {
          reply: `Vou registrar:\n• Nome: ${session.flowData.name}\n• Empresa: ${session.flowData.company}\n• Necessidade: ${session.flowData.need}\n• Melhor período: ${session.flowData.contactTime}\n\nEstá correto? Responda SIM ou NÃO.`,
          intent: "sales",
          source: "rule"
        });

      case "lead_confirm":
        if (isPositive(value)) {
          const lead = this.store.createLead(this.tenant, message.id, {
            userId: session.userId,
            name: session.flowData.name ?? "",
            company: session.flowData.company ?? "",
            need: session.flowData.need ?? "",
            contactTime: session.flowData.contactTime ?? "",
            consentedAt: session.flowData.consentedAt ?? new Date().toISOString()
          });
          this.clearFlow(session);
          return this.respond(session, message, {
            reply: this.knowledge.prototype
              ? `Cadastro concluído no ambiente de teste. Protocolo: ${lead.id}. Os dados estão apenas na memória local deste protótipo.`
              : `Solicitação registrada. Protocolo: ${lead.id}. O prazo de retorno é ${this.knowledge.assistant.humanResponseSla}.`,
            intent: "sales",
            source: "system",
            protocol: lead.id
          });
        }
        if (isNegative(value)) {
          this.clearFlow(session);
          return this.respond(session, message, {
            reply: "Tudo bem, não registrei o cadastro. Se quiser, podemos começar novamente.",
            intent: "sales",
            source: "rule"
          });
        }
        return this.askYesNo(session, message, "Os dados do resumo estão corretos? Responda SIM ou NÃO.", "sales");

      case "schedule_service":
        if (value.length < 2) {
          return this.respond(session, message, {
            reply: "Qual serviço ou assunto devemos considerar no agendamento?",
            intent: "scheduling",
            source: "rule"
          });
        }
        session.flowData.service = value.slice(0, 160);
        session.flow = "schedule_datetime";
        return this.respond(session, message, {
          reply: `Qual data e horário você prefere? Vou considerar o fuso ${this.knowledge.company.timezone}.`,
          intent: "scheduling",
          source: "rule"
        });

      case "schedule_datetime":
        if (value.length < 3) {
          return this.respond(session, message, {
            reply: "Informe uma preferência de data e horário, por exemplo: terça-feira às 15h.",
            intent: "scheduling",
            source: "rule"
          });
        }
        session.flowData.preferredDateTime = value.slice(0, 160);
        session.flow = "schedule_timezone";
        return this.respond(session, message, {
          reply: `Vou considerar o fuso ${this.knowledge.company.timezone}. Está correto? Responda SIM ou informe seu fuso/cidade.`,
          intent: "scheduling",
          source: "rule"
        });

      case "schedule_timezone":
        if (isNegative(value)) {
          return this.respond(session, message, {
            reply: "Qual é o seu fuso horário ou cidade?",
            intent: "scheduling",
            source: "rule"
          });
        }
        session.flowData.timezone = isPositive(value)
          ? this.knowledge.company.timezone
          : value.slice(0, 120);
        session.flow = "schedule_confirm";
        return this.respond(session, message, {
          reply: `Pedido: ${session.flowData.service}, em ${session.flowData.preferredDateTime}, fuso ${session.flowData.timezone}. Posso registrar essa preferência? Responda SIM ou NÃO.`,
          intent: "scheduling",
          source: "rule"
        });

      case "schedule_confirm":
        if (isPositive(value)) {
          const appointment = this.store.createAppointment(this.tenant, message.id, {
            userId: session.userId,
            service: session.flowData.service ?? "",
            preferredDateTime: session.flowData.preferredDateTime ?? "",
            timezone: session.flowData.timezone ?? this.knowledge.company.timezone
          });
          this.clearFlow(session);
          return this.respond(session, message, {
            reply: this.knowledge.prototype
              ? `Preferência registrada no ambiente de teste sob o protocolo ${appointment.id}. Este horário ainda não está confirmado e não há agenda real conectada.`
              : `Preferência registrada sob o protocolo ${appointment.id}. O horário ainda não está confirmado; a equipe retornará para confirmar.`,
            intent: "scheduling",
            source: "system",
            protocol: appointment.id
          });
        }
        if (isNegative(value)) {
          this.clearFlow(session);
          return this.respond(session, message, {
            reply: "Certo, não registrei o pedido de agendamento.",
            intent: "scheduling",
            source: "rule"
          });
        }
        return this.askYesNo(session, message, "Posso registrar essa preferência? Responda SIM ou NÃO.", "scheduling");

      case "support_description": {
        if (value.length < 5) {
          return this.respond(session, message, {
            reply: "Descreva o problema com um pouco mais de detalhe, sem enviar dados sensíveis.",
            intent: "support",
            source: "rule"
          });
        }
        const procedure = findSupportProcedure(value, this.knowledge);
        session.flowData.description = value;
        if (!procedure) {
          return this.startHandoff(session, message, "support", "procedimento_nao_documentado");
        }
        session.flowData.procedureId = procedure.id;
        session.flow = "support_check_1";
        return this.respond(session, message, {
          reply: `${procedure.steps[0]}\n\nIsso resolveu? Responda SIM ou NÃO.`,
          intent: "support",
          source: "rule"
        });
      }

      case "support_check_1":
        if (isPositive(value)) {
          this.clearFlow(session);
          return this.respond(session, message, {
            reply: "Ótimo, fico feliz que tenha resolvido. Se precisar de algo mais, estou por aqui.",
            intent: "support",
            source: "rule"
          });
        }
        if (isNegative(value)) {
          const procedure = this.knowledge.supportProcedures.find(
            (item) => item.id === session.flowData.procedureId
          );
          const secondStep = procedure?.steps[1];
          if (!secondStep) {
            return this.startHandoff(session, message, "support", "procedimento_esgotado");
          }
          session.flow = "support_check_2";
          return this.respond(session, message, {
            reply: `${secondStep}\n\nAgora resolveu? Responda SIM ou NÃO.`,
            intent: "support",
            source: "rule"
          });
        }
        return this.askYesNo(session, message, "A primeira orientação resolveu? Responda SIM ou NÃO.", "support");

      case "support_check_2":
        if (isPositive(value)) {
          this.clearFlow(session);
          return this.respond(session, message, {
            reply: "Perfeito. O atendimento foi encerrado como resolvido.",
            intent: "support",
            source: "rule"
          });
        }
        if (isNegative(value)) {
          return this.startHandoff(session, message, "support", "duas_tentativas_sem_sucesso");
        }
        return this.askYesNo(session, message, "A segunda orientação resolveu? Responda SIM ou NÃO.", "support");

      case "opt_in_confirm":
        return this.handleOptedOut(session, message);

      default:
        this.clearFlow(session);
        return this.handleUnknown(session, message);
    }
  }

  private handleOptedOut(
    session: ConversationSession,
    message: IncomingMessage
  ): AgentResult {
    if (session.flow === "opt_in_confirm") {
      if (isPositive(message.text)) {
        session.status = "active";
        this.clearFlow(session);
        return this.respond(session, message, {
          reply: "Mensagens reativadas. Como posso ajudar?",
          intent: "opt_in",
          source: "rule"
        });
      }
      if (isNegative(message.text)) {
        session.flow = "none";
        session.flowData = {};
        return this.respond(session, message, {
          reply: "Tudo bem. As mensagens continuam desativadas.",
          intent: "opt_out",
          source: "rule"
        });
      }
      return this.respond(session, message, {
        reply: "Para confirmar a reativação das mensagens, responda SIM. Para manter desativado, responda NÃO.",
        intent: "opt_in",
        source: "rule"
      });
    }

    if (isOptInRequest(message.text)) {
      session.flow = "opt_in_confirm";
      return this.respond(session, message, {
        reply: "Você quer voltar a receber mensagens e reativar o atendimento? Responda SIM ou NÃO.",
        intent: "opt_in",
        source: "rule"
      });
    }

    return this.respond(session, message, {
      reply: null,
      intent: "opt_out",
      source: "system",
      suppressed: true,
      recordHistory: false
    });
  }

  private async handleUnknown(
    session: ConversationSession,
    message: IncomingMessage
  ): Promise<AgentResult> {
    if (this.llm) {
      try {
        const decision = await this.llm.decide({
          message: redactSecrets(message.text),
          history: session.history,
          knowledge: this.knowledge
        });

        if (decision.needsHuman) {
          return this.startHandoff(session, message, "general", `llm:${decision.reason}`);
        }

        if (decision.confidence >= 0.55) {
          session.fallbackCount = 0;
          const routed = this.routeLlmIntent(session, message, decision.intent);
          if (routed) return routed;
          return this.respond(session, message, {
            reply: decision.reply,
            intent: decision.intent,
            source: "openai"
          });
        }
      } catch {
        // O fallback determinístico mantém o atendimento disponível sem expor detalhes técnicos.
      }
    }

    session.fallbackCount += 1;
    if (session.fallbackCount >= 3) {
      return this.startHandoff(session, message, "general", "tres_fallbacks_consecutivos");
    }

    const normalized = normalizeText(message.text);
    let reply: string;
    if (
      session.fallbackCount === 1 &&
      includesAny(normalized, [
        "aquele negocio",
        "aquela coisa",
        "esse produto",
        "essa opcao",
        "isso ai",
        "na cor",
        "modelo azul"
      ])
    ) {
      reply =
        "Pode dizer qual produto, item ou serviço você quer consultar e qual informação precisa? A base aprovada não identifica a referência citada.";
    } else if (session.fallbackCount === 1 && normalizeText(message.text).length <= 2) {
      reply =
        "Não consegui identificar a mensagem. Escreva sua dúvida ou escolha: 1. Serviços  2. Agendamento  3. Suporte  4. Atendente.";
    } else if (session.fallbackCount === 1) {
      reply =
        "Não encontrei essa informação na base aprovada. Pode explicar o que você quer saber e sobre qual serviço ou produto?";
    } else {
      reply =
        "Ainda não consegui entender. Responda com uma opção: 1. Serviços  2. Agendamento  3. Suporte  4. Atendente.";
    }

    return this.respond(session, message, {
      reply,
      intent: "unknown",
      source: "rule"
    });
  }

  private routeLlmIntent(
    session: ConversationSession,
    message: IncomingMessage,
    intent: Intent
  ): AgentResult | null {
    switch (intent) {
      case "greeting":
        return this.respond(session, message, {
          reply: this.welcomeMessage(),
          intent,
          source: "rule"
        });
      case "business_info":
        return this.respond(session, message, {
          reply: `${this.knowledge.company.description}\n\nAtuamos com ${this.knowledge.company.industry}.`,
          intent,
          source: "rule"
        });
      case "pricing":
        return this.respond(session, message, {
          reply: `Estas são as ofertas configuradas na base aprovada:\n\n${formatServices(this.knowledge)}\n\nQuer saber mais ou falar sobre contratação?`,
          intent,
          source: "rule"
        });
      case "sales":
        session.flow = "lead_consent";
        session.flowData = {};
        return this.respond(session, message, {
          reply:
            "Ótimo! Posso usar os dados desta conversa para registrar seu interesse e permitir um contato sobre a solicitação? Responda SIM ou NÃO.",
          intent,
          source: "rule"
        });
      case "scheduling":
        session.flow = "schedule_service";
        session.flowData = { initialRequest: cleanUserValue(redactSecrets(message.text)) };
        return this.respond(session, message, {
          reply: `Para qual serviço ou assunto você quer agendar?\n\n${formatServices(this.knowledge)}`,
          intent,
          source: "rule"
        });
      case "support":
        return this.startSupport(session, message);
      case "complaint":
        return this.startHandoff(session, message, "complaint", "llm_reclamacao");
      case "human":
        return this.startHandoff(session, message, "general", "llm_pedido_humano");
      case "opt_out":
        session.status = "opted_out";
        session.flow = "none";
        session.flowData = {};
        session.fallbackCount = 0;
        return this.respond(session, message, {
          reply: "Tudo certo. Você não receberá novas mensagens nossas. Se quiser voltar, envie VOLTAR.",
          intent,
          source: "rule"
        });
      case "opt_in":
        return this.respond(session, message, {
          reply: "O atendimento já está ativo. Como posso ajudar?",
          intent,
          source: "rule"
        });
      case "faq":
      case "unknown":
        return null;
    }
  }

  private startHandoff(
    session: ConversationSession,
    message: IncomingMessage,
    category: SupportTicket["category"],
    reason: string,
    contextReply?: string
  ): AgentResult {
    const summary = [
      ...session.history.slice(-6).map((item) => `${item.role}: ${item.text}`),
      `user: ${redactSecrets(message.text)}`
    ]
      .join(" | ")
      .slice(0, 1_500);
    const ticket = this.store.createTicket(this.tenant, message.id, {
      userId: session.userId,
      category,
      summary,
      reason
    });
    session.status = "human_handoff";
    session.flow = "none";
    session.flowData = {};
    session.fallbackCount = 0;

    const handoffReply = this.knowledge.prototype
        ? `A automação foi pausada e o encaminhamento foi registrado apenas neste ambiente de teste. Protocolo: ${ticket.id}. Não há uma equipe humana conectada ainda.`
        : `Vou encaminhar sua conversa para uma pessoa da equipe, com o contexto, para você não precisar repetir tudo. Protocolo: ${ticket.id}. Prazo de retorno: ${this.knowledge.assistant.humanResponseSla}.`;

    return this.respond(session, message, {
      reply: contextReply ? `${contextReply} ${handoffReply}` : handoffReply,
      intent: category === "complaint" ? "complaint" : "human",
      source: "system",
      handoff: true,
      protocol: ticket.id
    });
  }

  private startSupport(session: ConversationSession, message: IncomingMessage): AgentResult {
    const description = cleanUserValue(redactSecrets(message.text));
    const procedure = findSupportProcedure(description, this.knowledge);
    if (procedure) {
      session.flow = "support_check_1";
      session.flowData = { description, procedureId: procedure.id };
      return this.respond(session, message, {
        reply: `${procedure.steps[0]}\n\nIsso resolveu? Responda SIM ou NÃO.`,
        intent: "support",
        source: "rule"
      });
    }

    session.flow = "support_description";
    session.flowData = {};
    return this.respond(session, message, {
      reply:
        "Vou ajudar na triagem. Descreva em uma frase o que está acontecendo. Não envie senha, código de autenticação nem dados de cartão.",
      intent: "support",
      source: "rule"
    });
  }

  private askYesNo(
    session: ConversationSession,
    message: IncomingMessage,
    reply: string,
    intent: Intent
  ): AgentResult {
    return this.respond(session, message, { reply, intent, source: "rule" });
  }

  private classify(text: string): Intent {
    const normalized = normalizeText(text);

    if (normalized === "1") return "pricing";
    if (normalized === "2") return "scheduling";
    if (normalized === "3") return "support";
    if (normalized === "4") return "human";

    if (
      includesAny(normalized, [
        "que problema voces resolvem",
        "qual problema voces resolvem",
        "como voces ajudam"
      ])
    ) {
      return "business_info";
    }

    if (isComplaintRequest(normalized)) {
      return "complaint";
    }
    if (
      includesAny(normalized, [
        "quanto custa",
        "qual o preco",
        "precos",
        "plano",
        "planos",
        "valores",
        "servico",
        "servicos"
      ])
    ) {
      return "pricing";
    }
    if (
      includesAny(normalized, [
        "quero contratar",
        "tenho interesse",
        "quero comprar",
        "contratacao",
        "deixar meus dados",
        "podem me ligar",
        "quero receber contato",
        "entrar em contato comigo"
      ])
    ) {
      return "sales";
    }
    if (includesAny(normalized, ["agendar", "marcar reuniao", "marcar conversa", "agendamento"])) {
      return "scheduling";
    }
    if (
      isSupportOrOrderIssue(normalized) ||
      includesAny(normalized, [
        "suporte",
        "nao funciona",
        "erro",
        "problema",
        "nao abre",
        "travar",
        "travando"
      ])
    ) {
      return "support";
    }
    if (includesAny(normalized, ["o que voces fazem", "sobre a empresa", "quem sao voces"])) {
      return "business_info";
    }
    if (includesAny(normalized, ["oi", "ola", "bom dia", "boa tarde", "boa noite", "e ai", "menu"])) {
      return "greeting";
    }
    return "unknown";
  }

  private businessHoursReply(message: IncomingMessage): string {
    const { businessHours, timezone } = this.knowledge.company;
    const schedule = parseBusinessHours(businessHours);
    const current = zonedDayAndMinutes(message.timestamp, timezone);
    const normalized = normalizeText(message.text);
    const lines = [
      `O atendimento humano funciona ${businessHours}, no fuso ${timezone}.`
    ];

    const requestedDay = [
      { pattern: /\bdomingos?\b/, label: "O domingo", weekday: 0 },
      { pattern: /\bsegundas?\b/, label: "A segunda-feira", weekday: 1 },
      { pattern: /\btercas?\b/, label: "A terça-feira", weekday: 2 },
      { pattern: /\bquartas?\b/, label: "A quarta-feira", weekday: 3 },
      { pattern: /\bquintas?\b/, label: "A quinta-feira", weekday: 4 },
      { pattern: /\bsextas?\b/, label: "A sexta-feira", weekday: 5 },
      { pattern: /\bsabados?\b/, label: "O sábado", weekday: 6 }
    ].find((day) => day.pattern.test(normalized));

    if (requestedDay && schedule && !schedule.weekdays.has(requestedDay.weekday)) {
      lines.push(`${requestedDay.label} não está incluído nos dias de atendimento humano configurados.`);
    }

    const explicitTime = normalized.match(/\b(?:sao|agora sao)\s+(\d{1,2})h(?:\s*(\d{2}))?\b/);
    const asksUnknownDate = includesAny(normalized, [
      "amanha",
      "feriado",
      "feriados",
      "data especial"
    ]);
    const asksCurrentAvailability =
      (!asksUnknownDate &&
        !requestedDay &&
        includesAny(normalized, [
          "agora",
          "hoje",
          "aberto",
          "abertos",
          "atendendo",
          "disponivel"
        ])) ||
      (Boolean(explicitTime) && !asksUnknownDate && !requestedDay);

    if (asksUnknownDate) {
      lines.push(
        "A base aprovada contém apenas a grade regular e não informa feriados ou exceções para uma data futura; por isso, não posso confirmar essa data específica."
      );
    }

    if (schedule && current && asksCurrentAvailability) {
      const explicitHour = explicitTime ? Number(explicitTime[1]) : null;
      const explicitMinute = explicitTime ? Number(explicitTime[2] ?? 0) : null;
      const minutes =
        explicitHour !== null && explicitHour <= 23 && explicitMinute !== null && explicitMinute <= 59
          ? explicitHour * 60 + explicitMinute
          : current.minutes;
      const isOpen =
        schedule.weekdays.has(current.weekday) &&
        minutes >= schedule.startMinutes &&
        minutes < schedule.endMinutes;
      lines.push(
        isOpen
          ? "Nesse momento, o horário informado está dentro do expediente configurado."
          : "Nesse momento, estamos fora do horário de atendimento humano configurado."
      );
    }

    lines.push(
      this.knowledge.prototype
        ? "A assistente virtual pode continuar respondendo e fazendo a triagem, mas não há equipe humana conectada nesta demonstração."
        : `A assistente virtual pode continuar fornecendo informações; para atendimento humano, use o canal oficial ${this.knowledge.company.humanPhone}.`
    );
    return lines.join(" ");
  }

  private commerceDetailReply(text: string): string {
    const normalized = normalizeText(text);
    if (includesAny(normalized, ["parcelar", "vezes sem juros"])) {
      return `${this.knowledge.policies.paymentMethods} Não há condição de parcelamento aprovada na base; por isso, não posso confirmar número de parcelas ou juros.`;
    }
    if (includesAny(normalized, ["desconto", "promocao"])) {
      return "Não encontrei essa informação na base aprovada. Não há desconto ou promoção configurado, e eu não posso criar uma condição comercial.";
    }
    if (includesAny(normalized, ["entrega", "retirar na loja", "retirada na loja", "estacionamento"])) {
      return `${this.knowledge.company.remoteService} Entrega de produto, retirada e estacionamento não estão documentados na base aprovada.`;
    }
    return "A base aprovada não informa estoque, cores, tamanhos, reposição ou reservas para o item citado. Diga qual item você procura para eu orientar o próximo passo ou, se solicitado, encaminhar para atendimento humano.";
  }

  private urgentReply(approvedAnswer?: string): string {
    if (approvedAnswer) {
      return `${approvedAnswer} Se houver risco imediato à vida ou à segurança, procure o serviço público de emergência adequado.`;
    }
    return `Não posso confirmar por esta conversa que exista plantão de emergência. O horário informado na base é ${this.knowledge.company.businessHours}, no fuso ${this.knowledge.company.timezone}, e o telefone oficial é ${this.knowledge.company.humanPhone}. Se houver risco imediato à vida ou à segurança, procure o serviço público de emergência adequado. Posso continuar com uma triagem por texto sem dados sensíveis.`;
  }

  private welcomeMessage(): string {
    return `Olá! Sou ${this.knowledge.assistant.name}, assistente virtual da ${this.knowledge.company.name}. Como posso ajudar?\n\n1. Conhecer serviços\n2. Agendar uma conversa\n3. Pedir suporte\n\nVocê também pode escrever sua dúvida livremente.`;
  }

  private clearFlow(session: ConversationSession): void {
    session.flow = "none";
    session.flowData = {};
    session.fallbackCount = 0;
  }

  private respond(
    session: ConversationSession,
    message: IncomingMessage,
    input: ResponseInput
  ): AgentResult {
    const shouldRecord = input.recordHistory ?? true;
    if (shouldRecord) {
      session.history.push({
        role: "user",
        text: cleanUserValue(redactSecrets(message.text), 1_500),
        at: message.timestamp.toISOString()
      });
      if (input.reply) {
        session.history.push({ role: "assistant", text: input.reply, at: new Date().toISOString() });
      }
      session.history = session.history.slice(-20);
    }
    const result = this.result(session, input);
    this.store.commitResult(this.tenant, message.id, session, result);
    return result;
  }

  private scopedUserKey(userId: string): string {
    return tenantScopeKey(this.tenant, userId);
  }

  private result(session: ConversationSession, input: ResponseInput): AgentResult {
    return {
      agentId: this.release.identity.agentId,
      releaseVersion: this.release.identity.version,
      reply: input.reply,
      intent: input.intent,
      source: input.source,
      suppressed: input.suppressed ?? false,
      duplicate: input.duplicate ?? false,
      handoff: input.handoff ?? false,
      ...(input.protocol ? { protocol: input.protocol } : {}),
      state: { status: session.status, flow: session.flow }
    };
  }
}
