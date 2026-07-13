import { z } from "zod";

const slugPattern = /^[a-z0-9][a-z0-9-]*$/;
const semverPattern = /^\d+\.\d+\.\d+$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const relativePathSchema = z.string().min(1).refine(
  (value) =>
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((segment) => segment && segment !== "." && segment !== ".."),
  { message: "Caminho POSIX relativo esperado." }
);

function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
}

const isoDateSchema = z.string().regex(datePattern).refine(isCalendarDate, {
  message: "Data de calendário inválida."
});

export const releaseManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    compilerVersion: z.literal("1.0"),
    publicationId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    agentId: z.string().regex(slugPattern),
    version: z.string().regex(semverPattern),
    asOf: isoDateSchema,
    publishedAt: z.string().datetime(),
    composition: z.array(
      z
        .object({
          layer: z.enum(["shared", "segment", "agent"]),
          id: z.string().min(1)
        })
        .strict()
    ),
    inputs: z.array(
      z
        .object({
          path: relativePathSchema,
          id: z.string().min(1),
          type: z.string().min(1),
          version: z.string().regex(semverPattern),
          sensitivity: z.string().min(1),
          origin: z.string().min(1),
          sha256: z.string().regex(sha256Pattern)
        })
        .strict()
    ),
    policyInputs: z.array(
      z
        .object({
          path: relativePathSchema,
          id: z.string().min(1),
          type: z.string().min(1),
          version: z.string().regex(semverPattern),
          sensitivity: z.string().min(1),
          origin: z.string().min(1),
          sha256: z.string().regex(sha256Pattern)
        })
        .strict()
    ),
    output: z
      .object({
        file: z.literal("business-knowledge.json"),
        sha256: z.string().regex(sha256Pattern)
      })
      .strict(),
    evals: z
      .object({
        files: z.array(relativePathSchema),
        suiteSha256: z.string().regex(sha256Pattern),
        critical: z.number().int().positive(),
        passed: z.number().int().positive(),
        failed: z.literal(0)
      })
      .strict()
      .refine((evals) => evals.passed === evals.critical, {
        message: "passed deve ser igual a critical quando failed é zero."
      })
  })
  .strict();

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;
