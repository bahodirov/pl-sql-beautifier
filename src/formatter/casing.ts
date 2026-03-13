import { Token, TokenType } from './token';
import { BeautifierConfig } from './config';

export function applyKeywordCase(val: string, cfg: BeautifierConfig): string {
  // Check special case words first (e.g., FUNCTION → Function, PROCEDURE → Procedure)
  if (cfg.useSpecialCase) {
    const lc = val.toLowerCase();
    const special = cfg.specialCaseWords.get(lc);
    if (special !== undefined) return special;
  }
  if (cfg.keywordCase === 'UPPER') return val.toUpperCase();
  if (cfg.keywordCase === 'LOWER') return val.toLowerCase();
  if (cfg.keywordCase === 'PRESERVE') return val;
  // INIT_CAP (keywords separated by space, e.g. "END IF")
  return initCapWords(val, ' ');
}

export function applyIdentifierCase(raw: string, cfg: BeautifierConfig): string {
  if (cfg.useSpecialCase) {
    const lc = raw.toLowerCase();
    const special = cfg.specialCaseWords.get(lc);
    if (special !== undefined) return special;
  }
  if (cfg.identifierCase === 'PRESERVE') return raw;
  if (cfg.identifierCase === 'UPPER') return raw.toUpperCase();
  if (cfg.identifierCase === 'LOWER') return raw.toLowerCase();
  // INIT_CAP: capitalize first letter of each underscore-separated word
  // c_ft_date_format -> C_Ft_Date_Format
  // filial_ids       -> Filial_Ids
  // ui_trade171      -> Ui_Trade171
  return initCapWords(raw, '_');
}

function initCapWords(str: string, sep: string): string {
  return str.split(sep)
    .map((part, idx) => {
      if (part.length === 0) return '';
      // Single-char first segment with underscore separator (v_, i_, c_, g_, etc.) stays lowercase
      if (sep === '_' && idx === 0 && part.length === 1) return part.toLowerCase();
      // Single-char non-first segment: preserve original case (_t stays _t, not _T)
      if (sep === '_' && part.length === 1) return part;
      return part[0].toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(sep);
}

export function applyCasing(t: Token, cfg: BeautifierConfig): string {
  if (t.type === TokenType.KEYWORD) return applyKeywordCase(t.value, cfg);
  if (t.type === TokenType.IDENTIFIER) return applyIdentifierCase(t.raw, cfg);
  return t.raw;
}
