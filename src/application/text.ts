const stopWords = new Set([
  "a",
  "ao",
  "aos",
  "as",
  "com",
  "como",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "eu",
  "o",
  "os",
  "para",
  "por",
  "qual",
  "que",
  "um",
  "uma",
  "voces"
]);

// Only expand exact, well-known chat spellings. Deliberately avoid edit-distance
// or other global fuzzy matching here: a close spelling can still be a product,
// person or company name that must be preserved verbatim.
const chatWordAliases: Readonly<Record<string, string>> = {
  agr: "agora",
  disconto: "desconto",
  dinhero: "dinheiro",
  entrga: "entrega",
  hj: "hoje",
  hr: "hora",
  hrs: "horas",
  keria: "queria",
  msg: "mensagem",
  msgs: "mensagens",
  n: "nao",
  naum: "nao",
  obg: "obrigado",
  obgd: "obrigado",
  obgda: "obrigada",
  pedio: "pedido",
  pfv: "por favor",
  pfvr: "por favor",
  pixx: "pix",
  pq: "porque",
  q: "que",
  qdo: "quando",
  qnt: "quanto",
  qria: "queria",
  qro: "quero",
  qto: "quanto",
  ta: "esta",
  tb: "tambem",
  tbm: "tambem",
  vc: "voce",
  vcs: "voces",
  wpp: "whatsapp",
  zap: "whatsapp"
};

function expandChatAliases(value: string): string {
  const expandedWords = value
    .split(" ")
    .map((word) => chatWordAliases[word] ?? word)
    .join(" ");

  return expandedWords
    // "chego" and "cm" have legitimate meanings, so fix them only in
    // unambiguous customer-service contexts instead of as global aliases.
    .replace(/\b(meu|o) pedido ainda nao chego\b/g, "$1 pedido ainda nao chegou")
    .replace(/\b(meu|o) pedido nao chego\b/g, "$1 pedido nao chegou")
    .replace(/\bcm (?=(?:faco|faz|resolvo|procedo)\b)/g, "como ")
    .replace(/\bqueria fala (?=com\b)/g, "queria falar ")
    .replace(/\b(pare|parem) d me manda (?=mensage(?:m|ns)\b)/g, "$1 de me mandar ")
    .replace(/\bonde fica voces\b/g, "onde voces ficam");
}

export function normalizeText(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\be[\s-]?mail\b/g, "email")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return expandChatAliases(normalized);
}

export function tokens(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((token) => token.length > 1 && !stopWords.has(token))
  );
}

export function includesAny(value: string, candidates: string[]): boolean {
  const normalized = ` ${normalizeText(value)} `;
  return candidates.some((candidate) => normalized.includes(` ${normalizeText(candidate)} `));
}

export function isPositive(value: string): boolean {
  const normalized = normalizeText(value);
  return /^(sim|s|claro|claro que sim|com certeza|pode|pode sim|sim pode|confirmo|confirmado|correto|isso|isso mesmo|esta tudo certo|tudo certo|os dados estao corretos|quero|quero sim)$/.test(normalized);
}

export function isConsentPositive(value: string): boolean {
  const normalized = normalizeText(value);
  return (
    isPositive(normalized) ||
    /^(concordo|aceito|autorizo|autorizo o contato|aceito o contato|pode entrar em contato comigo|sim pode entrar em contato comigo|pode me contatar|pode me chamar|pode falar comigo)$/.test(
      normalized
    )
  );
}

export function isNegative(value: string): boolean {
  const normalized = normalizeText(value);
  return /^(nao|nao quero|prefiro nao|nao obrigado|nao obrigada|agora nao|de jeito nenhum|nao pode|nao autorizo|nao concordo|nao aceito|nao quero contato|nao quero receber contato|nao quero receber mensagens|nao entre em contato|nao entre em contato comigo|nao me ligue|nao me chame|cancelar|quero cancelar|cancela|cancelado|incorreto)$/.test(normalized);
}

export function cleanUserValue(value: string, maxLength = 500): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function redactSecrets(value: string): string {
  return value
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[TOKEN DO GITHUB REDIGIDO]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[TOKEN DO GITHUB REDIGIDO]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[CHAVE DE API REDIGIDA]")
    .replace(/\b(?:\d[ .-]?){13,19}\b/g, "[DADO DE CARTÃO REDIGIDO]")
    .replace(
      /\b(senha(?: atual)?|password|token(?: de acesso)?|cvv|otp|c[oó]digo(?: de autentica[cç][aã]o| por sms)?)\b(?:\s*(?:[:=#]|é|e|is)\s*|\s+)([^,;\r\n]+)/gi,
      "$1: [REDIGIDO]"
    );
}
