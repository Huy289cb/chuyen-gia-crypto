/**
 * Extract + repair LLM JSON blobs (OpenRouter / Groq / Cerebras).
 * Trading decisions must not invent missing fields — truncated objects stay null.
 */
/** Escape raw control chars (U+0000–U+001F) inside JSON string literals. */
export declare function escapeControlCharsInJsonStrings(json: string): string;
/** Strip markdown fences / BOM / zero-width junk around a JSON blob. */
export declare function stripLlmJsonNoise(raw: string): string;
/**
 * Slice first complete `{...}` object. Brace matching ignores braces inside strings.
 * Returns null if no object or object never closes (truncated).
 */
export declare function extractJsonObjectSlice(raw: string): string | null;
/** Quote bare object keys: `{fvg_distance: 1}` → `{"fvg_distance": 1}`. */
export declare function quoteUnquotedKeys(json: string): string;
/**
 * Insert missing commas between a finished value and the next `"key"`.
 * Covers: `0.005\n"fvg_distance"` / `true\n"x"` / `}\n"y"` / `"val"\n"key"`.
 */
export declare function insertMissingCommas(json: string): string;
export declare function repairLlmJsonSyntax(jsonString: string): string;
/** Parse LLM text into an object; null if unrecoverable / truncated. */
export declare function parseLlmJsonObject(rawResponse: string): Record<string, unknown> | null;
//# sourceMappingURL=llm-json.d.ts.map