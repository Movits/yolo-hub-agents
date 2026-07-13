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

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\be[\s-]?mail\b/g, "email")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  return /^(sim|s|claro|pode|pode sim|confirmo|confirmado|correto|isso|isso mesmo|quero)$/.test(
    normalized
  );
}

export function isNegative(value: string): boolean {
  const normalized = normalizeText(value);
  return /^(nao|n|nao quero|prefiro nao|cancelar|cancela|incorreto)$/.test(normalized);
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
