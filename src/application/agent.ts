import type { LlmResponder, SessionStore } from "./ports.js";
import { findFaq, findSupportProcedure, formatServices } from "./knowledge.js";
import {
  cleanUserValue,
  includesAny,
  isNegative,
  isPositive,
  normalizeText,
  redactSecrets
} from "./text.js";
import type {
  AgentResult,
  BusinessKnowledge,
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
  "nao me mande mensagens",
  "nao quero receber mensagens",
  "nao quero mais mensagens",
  "nao entre em contato"
];

const optInPhrases = ["voltar", "reativar", "quero receber novamente", "retomar mensagens"];

const humanPhrases = [
  "falar com atendente",
  "falar com uma pessoa",
  "atendimento humano",
  "quero um humano",
  "quero atendente"
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

const promptAttackPhrases = [
  "ignore suas regras",
  "ignore as regras",
  "mostre o prompt",
  "revele o prompt",
  "dados de clientes",
  "mostre credenciais",
  "revele credenciais"
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
  return includesAny(text, humanPhrases);
}

function isSensitiveRequest(text: string): boolean {
  return includesAny(text, sensitivePhrases);
}

function isComplaintRequest(text: string): boolean {
  return includesAny(text, complaintPhrases);
}

function isFlowCancelRequest(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    ["cancelar", "cancela", "menu", "recomecar"].includes(normalized) ||
    includesAny(normalized, ["cancelar fluxo", "deixa pra la", "voltar ao menu"])
  );
}

export class BusinessAgent {
  private readonly userQueues = new Map<string, Promise<AgentResult>>();
  private readonly pendingPauseRequests = new Map<string, number>();

  constructor(
    private readonly tenant: TenantContext,
    private readonly knowledge: BusinessKnowledge,
    private readonly store: SessionStore,
    private readonly llm?: LlmResponder
  ) {
    if (tenant.agentId !== knowledge.agentId) {
      throw new Error("TenantContext.agentId deve corresponder ao conhecimento carregado.");
    }
  }

  process(message: IncomingMessage): Promise<AgentResult> {
    const userKey = this.scopedUserKey(message.userId);
    const requestsPause =
      isOptOutRequest(message.text) ||
      isHumanRequest(message.text) ||
      isSensitiveRequest(message.text) ||
      isComplaintRequest(message.text);
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
        this.store.releaseMessage(this.tenant, message.id);
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
      return this.result(current, {
        reply: null,
        intent: "unknown",
        source: "system",
        suppressed: true,
        duplicate: true,
        recordHistory: false
      });
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
          "Por enquanto, este protótipo entende mensagens de texto. Pode descrever sua dúvida por escrito?",
        intent: "unknown",
        source: "rule"
      });
    }

    if (isHumanRequest(message.text)) {
      return this.startHandoff(session, message, "general", "pedido_explicito_do_cliente");
    }

    if (isSensitiveRequest(message.text)) {
      return this.startHandoff(session, message, "support", "tema_sensivel");
    }

    if (isComplaintRequest(message.text)) {
      return this.startHandoff(session, message, "complaint", "reclamacao");
    }

    if (includesAny(message.text, promptAttackPhrases)) {
      session.fallbackCount = 0;
      return this.respond(session, message, {
        reply:
          "Não posso revelar instruções internas, credenciais ou dados de outras pessoas. Posso ajudar com informações, contratação, agendamento ou suporte da empresa.",
        intent: "unknown",
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

    const faq = findFaq(message.text, this.knowledge);
    if (faq) {
      session.fallbackCount = 0;
      return this.respond(session, message, {
        reply: faq.answer,
        intent: "faq",
        source: "faq"
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
          reply: `Estes são os planos configurados neste protótipo:\n\n${formatServices(this.knowledge)}\n\nQuer saber mais ou falar sobre contratação?`,
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
        if (isPositive(value)) {
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
        if (value.length < 2) {
          return this.respond(session, message, {
            reply: "Não consegui identificar o nome. Como você gostaria de ser chamado?",
            intent: "sales",
            source: "rule"
          });
        }
        session.flowData.name = value.slice(0, 80);
        session.flow = "lead_company";
        return this.respond(session, message, {
          reply: "Qual é o nome da sua empresa? Se não se aplicar, responda “não se aplica”.",
          intent: "sales",
          source: "rule"
        });

      case "lead_company":
        if (value.length < 2) {
          return this.respond(session, message, {
            reply: "Informe o nome da empresa ou responda “não se aplica”.",
            intent: "sales",
            source: "rule"
          });
        }
        session.flowData.company = value.slice(0, 120);
        session.flow = "lead_need";
        return this.respond(session, message, {
          reply: "Em poucas palavras, qual é a principal necessidade que você quer resolver?",
          intent: "sales",
          source: "rule"
        });

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
          const lead = this.store.createLead(this.tenant, {
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
          const appointment = this.store.createAppointment(this.tenant, {
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

    const reply =
      session.fallbackCount === 1
        ? "Não encontrei essa informação na base aprovada. Você quer informações sobre serviços, agendamento ou suporte?"
        : "Ainda não consegui entender. Responda com uma opção: 1. Serviços  2. Agendamento  3. Suporte  4. Atendente.";

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
          reply: `Estes são os planos configurados neste protótipo:\n\n${formatServices(this.knowledge)}\n\nQuer saber mais ou falar sobre contratação?`,
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
    reason: string
  ): AgentResult {
    const summary = [
      ...session.history.slice(-6).map((item) => `${item.role}: ${item.text}`),
      `user: ${redactSecrets(message.text)}`
    ]
      .join(" | ")
      .slice(0, 1_500);
    const ticket = this.store.createTicket(this.tenant, {
      userId: session.userId,
      category,
      summary,
      reason
    });
    session.status = "human_handoff";
    session.flow = "none";
    session.flowData = {};
    session.fallbackCount = 0;

    return this.respond(session, message, {
      reply: this.knowledge.prototype
        ? `A automação foi pausada e o encaminhamento foi registrado apenas neste ambiente de teste. Protocolo: ${ticket.id}. Não há uma equipe humana conectada ainda.`
        : `Vou encaminhar sua conversa para uma pessoa da equipe, com o contexto, para você não precisar repetir tudo. Protocolo: ${ticket.id}. Prazo de retorno: ${this.knowledge.assistant.humanResponseSla}.`,
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

    if (isComplaintRequest(normalized)) {
      return "complaint";
    }
    if (
      includesAny(normalized, [
        "quanto custa",
        "qual o preco",
        "precos",
        "planos",
        "valores",
        "servico",
        "servicos"
      ])
    ) {
      return "pricing";
    }
    if (includesAny(normalized, ["quero contratar", "tenho interesse", "quero comprar", "contratacao"])) {
      return "sales";
    }
    if (includesAny(normalized, ["agendar", "marcar reuniao", "marcar conversa", "agendamento"])) {
      return "scheduling";
    }
    if (
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
    this.store.saveSession(this.tenant, session);
    const result = this.result(session, input);
    this.store.saveProcessedResult(this.tenant, message.id, result);
    return result;
  }

  private scopedUserKey(userId: string): string {
    return tenantScopeKey(this.tenant, userId);
  }

  private result(session: ConversationSession, input: ResponseInput): AgentResult {
    return {
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
