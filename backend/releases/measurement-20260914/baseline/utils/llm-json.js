"use strict";
/**
 * Extract + repair LLM JSON blobs (OpenRouter / Groq / Cerebras).
 * Trading decisions must not invent missing fields — truncated objects stay null.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.escapeControlCharsInJsonStrings = escapeControlCharsInJsonStrings;
exports.stripLlmJsonNoise = stripLlmJsonNoise;
exports.extractJsonObjectSlice = extractJsonObjectSlice;
exports.quoteUnquotedKeys = quoteUnquotedKeys;
exports.insertMissingCommas = insertMissingCommas;
exports.repairLlmJsonSyntax = repairLlmJsonSyntax;
exports.parseLlmJsonObject = parseLlmJsonObject;
/** Escape raw control chars (U+0000–U+001F) inside JSON string literals. */
function escapeControlCharsInJsonStrings(json) {
    let out = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < json.length; i++) {
        const c = json[i];
        const code = c.charCodeAt(0);
        if (!inString) {
            if (c === '"')
                inString = true;
            out += c;
            continue;
        }
        if (escaped) {
            out += c;
            escaped = false;
            continue;
        }
        if (c === '\\') {
            out += c;
            escaped = true;
            continue;
        }
        if (c === '"') {
            out += c;
            inString = false;
            continue;
        }
        if (code < 0x20) {
            if (c === '\n')
                out += '\\n';
            else if (c === '\r')
                out += '\\r';
            else if (c === '\t')
                out += '\\t';
            else
                out += `\\u${code.toString(16).padStart(4, '0')}`;
            continue;
        }
        out += c;
    }
    return out;
}
/** Strip markdown fences / BOM / zero-width junk around a JSON blob. */
function stripLlmJsonNoise(raw) {
    let s = raw.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '');
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1])
        s = fence[1];
    return s.trim();
}
/**
 * Slice first complete `{...}` object. Brace matching ignores braces inside strings.
 * Returns null if no object or object never closes (truncated).
 */
function extractJsonObjectSlice(raw) {
    const start = raw.indexOf('{');
    if (start === -1)
        return null;
    let braceCount = 0;
    let end = -1;
    let inString = false;
    let escaped = false;
    for (let i = start; i < raw.length; i++) {
        const c = raw[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            }
            else if (c === '\\') {
                escaped = true;
            }
            else if (c === '"') {
                inString = false;
            }
            continue;
        }
        if (c === '"')
            inString = true;
        else if (c === '{')
            braceCount++;
        else if (c === '}')
            braceCount--;
        if (braceCount === 0) {
            end = i;
            break;
        }
    }
    if (end === -1)
        return null;
    return raw.substring(start, end + 1);
}
/** Quote bare object keys: `{fvg_distance: 1}` → `{"fvg_distance": 1}`. */
function quoteUnquotedKeys(json) {
    return json.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
}
/**
 * Insert missing commas between a finished value and the next `"key"`.
 * Covers: `0.005\n"fvg_distance"` / `true\n"x"` / `}\n"y"` / `"val"\n"key"`.
 */
function insertMissingCommas(json) {
    let out = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < json.length; i++) {
        const c = json[i];
        if (inString) {
            out += c;
            if (escaped)
                escaped = false;
            else if (c === '\\')
                escaped = true;
            else if (c === '"')
                inString = false;
            continue;
        }
        if (c === '"') {
            // Missing comma: previous non-ws token was a value, then ws/newline, now `"key"`
            const prev = out.trimEnd();
            const last = prev[prev.length - 1];
            const looksLikeValueEnd = last === '"' ||
                last === '}' ||
                last === ']' ||
                /[0-9]/.test(last) ||
                prev.endsWith('true') ||
                prev.endsWith('false') ||
                prev.endsWith('null');
            // Don't insert before a key that already has a colon path; only when
            // we're starting a new property after a value (not after `{` or `,`).
            if (looksLikeValueEnd && last !== '{' && last !== ',' && last !== ':') {
                const gap = out.slice(prev.length); // trailing whitespace in out
                if (/\n/.test(gap) || gap.length > 0) {
                    out = `${prev},${gap}`;
                }
            }
            inString = true;
            out += c;
            continue;
        }
        out += c;
    }
    return out;
}
function repairLlmJsonSyntax(jsonString) {
    let s = escapeControlCharsInJsonStrings(jsonString);
    s = quoteUnquotedKeys(s);
    s = insertMissingCommas(s);
    s = s.replace(/,(\s*[}\]])/g, '$1');
    s = s.replace(/,,+/g, ',');
    return s;
}
/** Parse LLM text into an object; null if unrecoverable / truncated. */
function parseLlmJsonObject(rawResponse) {
    try {
        const cleaned = stripLlmJsonNoise(rawResponse);
        const slice = extractJsonObjectSlice(cleaned);
        if (!slice)
            return null;
        const repaired = repairLlmJsonSyntax(slice);
        const parsed = JSON.parse(repaired);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=llm-json.js.map