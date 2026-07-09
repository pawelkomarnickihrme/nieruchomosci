// Ocena oferty wzgledem wymagan uzytkownika przez Vercel AI SDK. Wymaga DEEPSEEK_API_KEY.
import { streamObject } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { z } from "zod";

// DeepSeek nie ma natywnego JSON-schema — SDK ostrzega o trybie kompatybilnosci przy kazdym callu. Szum, wyciszamy.
globalThis.AI_SDK_LOG_WARNINGS = false;

const schema = z.object({
  score: z.number().int().min(1).max(10), // jak dobrze oferta spelnia wymagania
  reason: z.string(), // krotkie uzasadnienie po polsku
});

// onPartial (opcjonalne) dostaje czesciowy obiekt w trakcie generowania -> streaming do UI.
export async function rateOffer(offer, requirements, onPartial) {
  if (!requirements || !requirements.trim()) throw new Error("Brak wymagań.");
  const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY });
  const result = streamObject({
    model: deepseek("deepseek-chat"),
    schema,
    system:
      "Oceniasz ofertę nieruchomości względem wymagań użytkownika. " +
      "Zwróć score 1-10 (jak dobrze pasuje) i uzasadnienie po polsku w 1-2 zdaniach.",
    prompt: `Wymagania:\n${requirements}\n\nOferta:\n${JSON.stringify(offer)}`,
  });
  for await (const partial of result.partialObjectStream) onPartial?.(partial);
  return result.object;
}
