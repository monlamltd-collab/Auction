// lib/search-parse.js — AI search response parsing.
//
// The smart-search Layer 2 model returns `{"indices":[...],"report":"..."}`.
// In production the response is sometimes truncated at the maxTokens cap
// (2026-06-28: tokens_out hit the cap exactly, JSON.parse failed, and the
// route's empty-indices fallback dumped all 400 candidate lots to the user).
// This parser salvages every complete index from a truncated array instead
// of discarding the whole response.

/**
 * Parse the Layer-2 AI response into { indices, report, salvaged }.
 * `salvaged` is true when strict JSON parsing failed and the values were
 * recovered by regex from malformed/truncated output.
 */
export function parseAIResponse(responseText) {
  const cleaned = String(responseText || '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  try {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(cleaned);
    if (parsed && Array.isArray(parsed.indices)) {
      return {
        indices: parsed.indices.filter(n => Number.isInteger(n) && n >= 0),
        report: typeof parsed.report === 'string' ? parsed.report : '',
        salvaged: false,
      };
    }
  } catch { /* fall through to salvage */ }

  // Salvage path — no closing `]` required, so a mid-array truncation still
  // yields every complete index that made it out.
  const indicesMatch = cleaned.match(/"indices"\s*:\s*\[([\d,\s]*)/);
  const reportMatch = cleaned.match(/"report"\s*:\s*"([\s\S]*?)(?:"\s*[,}]|$)/);
  return {
    indices: indicesMatch
      ? indicesMatch[1].split(',').map(n => parseInt(n.trim(), 10)).filter(n => Number.isInteger(n) && n >= 0)
      : [],
    report: reportMatch ? reportMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : '',
    salvaged: true,
  };
}
