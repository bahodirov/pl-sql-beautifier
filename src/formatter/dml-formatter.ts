import { Token, TokenType } from './token';
import { BeautifierConfig } from './config';
import { alignUpdateSet } from './aligner';
import { applyIdentifierCase, applyKeywordCase, applyCasing } from './casing';

// DML clause keywords that start a new line
const DML_CLAUSE_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'HAVING',
  'GROUP', 'ORDER', 'CONNECT', 'START',
  'INTO',   // INSERT INTO / BULK COLLECT INTO
  'VALUES',
  'SET',    // UPDATE SET
  'MERGE', 'USING', 'MATCHED',
  'UNION', 'INTERSECT', 'MINUS',
  'WITH',
  'BULK',   // BULK COLLECT INTO
]);

const JOIN_KEYWORDS = new Set([
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'NATURAL',
]);

const SQL_FUNCTIONS = new Set([
  'count', 'sum', 'max', 'min', 'avg',
  'nvl', 'nvl2', 'decode', 'coalesce', 'nullif', 'greatest', 'least',
  'to_char', 'to_date', 'to_number', 'to_timestamp', 'to_clob', 'to_blob',
  'substr', 'substrb', 'length', 'lengthb', 'upper', 'lower', 'initcap',
  'trim', 'ltrim', 'rtrim', 'lpad', 'rpad', 'replace', 'instr', 'instrb',
  'round', 'trunc', 'mod', 'abs', 'ceil', 'floor', 'sign', 'power', 'sqrt',
  'sysdate', 'systimestamp', 'current_date', 'current_timestamp',
  'rank', 'dense_rank', 'row_number', 'lead', 'lag', 'first_value', 'last_value',
  'listagg', 'xmlagg', 'cast', 'convert',
  'regexp_like', 'regexp_substr', 'regexp_replace', 'regexp_instr', 'regexp_count',
  'sys_guid', 'uid', 'user', 'userenv', 'dump', 'vsize',
  'sys_connect_by_path', 'connect_by_root',
]);

function tokensToStr(tokens: Token[], cfg: BeautifierConfig, lowerAliases = false, lowerFunctions = true): string {
  const parts: string[] = [];
  let prevMeaningful: Token | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];

    if (t.type === TokenType.LINE_COMMENT || t.type === TokenType.BLOCK_COMMENT) {
      parts.push(applyCasing(t, cfg));
      continue;
    }

    let val: string;
    if (t.type === TokenType.IDENTIFIER && next?.type === TokenType.LPAREN
        && SQL_FUNCTIONS.has(t.raw.toLowerCase())) {
      val = t.raw.toLowerCase();
    } else if (lowerAliases && t.type === TokenType.IDENTIFIER) {
      // Only treat as alias if it has no underscores (PL/SQL variables always have underscores)
      const isPLSQLVar = t.raw.includes('_');
      const isAliasDef = !isPLSQLVar && prevMeaningful !== null && (
        prevMeaningful.type === TokenType.IDENTIFIER ||
        prevMeaningful.type === TokenType.RPAREN ||
        (prevMeaningful.type === TokenType.KEYWORD && prevMeaningful.value === 'AS')
      );
      const isAliasQualifier = !isPLSQLVar && next?.type === TokenType.DOT;
      val = (isAliasDef || isAliasQualifier) ? t.raw.toLowerCase() : applyCasing(t, cfg);
    } else {
      val = applyCasing(t, cfg);
    }

    prevMeaningful = t;
    parts.push(val);

    if (next) {
      if (
        t.type === TokenType.LPAREN ||
        next.type === TokenType.RPAREN ||
        next.type === TokenType.COMMA ||
        next.type === TokenType.SEMICOLON ||
        next.type === TokenType.DOT ||
        t.type === TokenType.DOT
      ) {
        // no space
      } else if (next.type === TokenType.LPAREN && t.type === TokenType.IDENTIFIER) {
        // function call: no space before (
      } else if (next.type === TokenType.LPAREN && t.type === TokenType.KEYWORD && t.value !== 'IN' && t.value !== 'NOT') {
        // keyword followed by ( — no space, except IN/NOT IN which need space
      } else if (next.raw.startsWith('%')) {
        // no space before %TYPE, %ROWTYPE, etc.
      } else {
        parts.push(' ');
      }
    }
  }
  return parts.join('');
}


interface DMLClause {
  keyword: string;      // SELECT, FROM, WHERE, etc.
  tokens: Token[];      // everything after the keyword until next clause
}

/**
 * Format a token sequence, rendering any embedded (SELECT ...) or (WITH ...)
 * subqueries as multiline blocks using formatDML.
 * Mirrors tokensToStr casing logic but recurses into subqueries.
 *
 * @param tokens       tokens to render
 * @param cfg          formatter config
 * @param startCol     characters already on the current line before these tokens
 * @param lowerAliases lowercase table alias identifiers (use true for WHERE/FROM)
 */
function formatTokensWithSubqueries(
  tokens: Token[],
  cfg: BeautifierConfig,
  startCol: number,
  lowerAliases = false
): string {
  const out: string[] = [];
  let col = startCol;
  let i = 0;
  let prevMeaningful: Token | null = null;

  while (i < tokens.length) {
    const t = tokens[i];
    const next = tokens[i + 1];

    // Detect subquery: LPAREN immediately followed by SELECT or WITH keyword
    if (
      t.type === TokenType.LPAREN &&
      next?.type === TokenType.KEYWORD &&
      (next.value === 'SELECT' || next.value === 'WITH')
    ) {
      const inner: Token[] = [];
      let depth = 1;
      let k = i + 1;
      while (k < tokens.length) {
        const tok = tokens[k];
        if (tok.type === TokenType.LPAREN) depth++;
        else if (tok.type === TokenType.RPAREN) { depth--; if (depth === 0) break; }
        inner.push(tok);
        k++;
      }
      // k is at the closing RPAREN (or past end if malformed)
      const subBaseIndent = ' '.repeat(col + 1); // +1 for '('
      const formattedSub = formatDML(inner, cfg, subBaseIndent);
      const subLines = formattedSub.split('\n');
      subLines[0] = '(' + subLines[0].trimStart();
      subLines[subLines.length - 1] += ')';
      out.push(subLines.join('\n'));
      col = subLines[subLines.length - 1].length;
      i = k + 1; // advance past closing RPAREN
      prevMeaningful = { type: TokenType.RPAREN, raw: ')', value: ')', line: 0, col: 0 };
      // Add space after ) if the next token needs it
      if (i < tokens.length) {
        const aft = tokens[i];
        if (
          aft.type !== TokenType.COMMA &&
          aft.type !== TokenType.RPAREN &&
          aft.type !== TokenType.SEMICOLON &&
          aft.type !== TokenType.DOT
        ) {
          out.push(' ');
          col++;
        }
      }
      continue;
    }

    // Detect paren group with AND/OR for multi-line expansion
    if (t.type === TokenType.LPAREN) {
      const inner: Token[] = [];
      let depth = 1;
      let k = i + 1;
      while (k < tokens.length) {
        const tok = tokens[k];
        if (tok.type === TokenType.LPAREN) depth++;
        else if (tok.type === TokenType.RPAREN) { depth--; if (depth === 0) break; }
        inner.push(tok);
        k++;
      }
      const andOrParts = splitOnAndOr(inner);
      if (andOrParts.length > 1) {
        const innerCol = col + 1;
        const innerIndent = ' '.repeat(innerCol);
        const renderedLines: string[] = [];
        for (let pi = 0; pi < andOrParts.length; pi++) {
          const p = andOrParts[pi];
          const nextConnector = andOrParts[pi + 1]?.connector ?? '';
          // AND is leading (start of next line), OR is trailing (end of current line)
          const andKw = p.connector === 'AND' ? applyKeywordCase('AND', cfg) + ' ' : '';
          const partCol = innerCol + andKw.length;
          const str = formatTokensWithSubqueries(p.tokens, cfg, partCol, lowerAliases);
          let line = pi === 0 ? str : `${innerIndent}${andKw}${str}`;
          if (nextConnector === 'OR') line += ' ' + applyKeywordCase('OR', cfg);
          renderedLines.push(line);
        }
        const lastLine = renderedLines[renderedLines.length - 1] + ')';
        out.push('(' + renderedLines.join('\n') + ')');
        col = lastLine.length;
        i = k + 1;
        prevMeaningful = { type: TokenType.RPAREN, raw: ')', value: ')', line: 0, col: 0 };
        if (i < tokens.length) {
          const aft = tokens[i];
          if (aft.type !== TokenType.COMMA && aft.type !== TokenType.RPAREN &&
              aft.type !== TokenType.SEMICOLON && aft.type !== TokenType.DOT) {
            out.push(' ');
            col++;
          }
        }
        continue;
      }
      // else: fall through to regular LPAREN processing
    }

    // Regular token — mirror tokensToStr casing logic
    let val: string;
    if (t.type === TokenType.IDENTIFIER && next?.type === TokenType.LPAREN
        && SQL_FUNCTIONS.has(t.raw.toLowerCase())) {
      val = t.raw.toLowerCase();
    } else if (lowerAliases && t.type === TokenType.IDENTIFIER) {
      const isPLSQLVar = t.raw.includes('_');
      const isAliasDef = !isPLSQLVar && prevMeaningful !== null && (
        prevMeaningful.type === TokenType.IDENTIFIER ||
        prevMeaningful.type === TokenType.RPAREN ||
        (prevMeaningful.type === TokenType.KEYWORD && prevMeaningful.value === 'AS')
      );
      const isAliasQualifier = !isPLSQLVar && next?.type === TokenType.DOT;
      val = (isAliasDef || isAliasQualifier) ? t.raw.toLowerCase() : applyCasing(t, cfg);
    } else {
      val = applyCasing(t, cfg);
    }

    out.push(val);
    col += val.length;
    prevMeaningful = t;

    if (next) {
      if (
        t.type === TokenType.LPAREN ||
        next.type === TokenType.RPAREN ||
        next.type === TokenType.COMMA ||
        next.type === TokenType.SEMICOLON ||
        next.type === TokenType.DOT ||
        t.type === TokenType.DOT ||
        (next.type === TokenType.LPAREN && t.type === TokenType.IDENTIFIER) ||
        (next.type === TokenType.LPAREN && t.type === TokenType.KEYWORD && t.value !== 'IN' && t.value !== 'NOT')
      ) {
        // no space
      } else {
        out.push(' ');
        col++;
      }
    }
    i++;
  }

  return out.join('');
}

/** Split SELECT item list into groups of tokens (one group per item, no commas). */
function splitSelectItemTokens(tokens: Token[]): Token[][] {
  const items: Token[][] = [];
  let depth = 0;
  let current: Token[] = [];

  for (const t of tokens) {
    if (t.type === TokenType.LPAREN) depth++;
    else if (t.type === TokenType.RPAREN) depth--;
    if (depth === 0 && t.type === TokenType.COMMA) {
      if (current.length > 0) items.push(current);
      current = [];
    } else {
      current.push(t);
    }
  }
  if (current.length > 0) items.push(current);
  return items;
}

export function formatDML(
  stmtTokens: Token[],
  cfg: BeautifierConfig,
  baseIndent: string
): string {
  if (stmtTokens.length === 0) return '';

  const firstKw = stmtTokens[0]?.value;

  if (firstKw === 'SELECT') {
    return formatSelect(stmtTokens, cfg, baseIndent);
  }
  if (firstKw === 'INSERT') {
    return formatInsert(stmtTokens, cfg, baseIndent);
  }
  if (firstKw === 'UPDATE') {
    return formatUpdate(stmtTokens, cfg, baseIndent);
  }
  if (firstKw === 'DELETE') {
    return formatDelete(stmtTokens, cfg, baseIndent);
  }
  if (firstKw === 'MERGE') {
    return formatMerge(stmtTokens, cfg, baseIndent);
  }
  if (firstKw === 'WITH') {
    return formatWith(stmtTokens, cfg, baseIndent);
  }

  // Fallback: just join tokens
  return baseIndent + tokensToStr(stmtTokens, cfg);
}

// ─── SELECT ─────────────────────────────────────────────────────────────────

function formatSelect(tokens: Token[], cfg: BeautifierConfig, baseIndent: string): string {
  const clauses = splitIntoClauses(tokens);
  const lines: string[] = [];

  // Calculate keyword padding width for right-alignment
  const kwWidth = cfg.dml.leftAlignKeywords ? 0 : getMaxClauseKeywordWidth(clauses);

  for (const clause of clauses) {
    const kw = applyKeywordCase(clause.keyword, cfg);

    if (clause.keyword === 'SELECT') {
      const padded = padKeyword(kw, kwWidth, cfg.dml.leftAlignKeywords);
      const itemIndent = baseIndent + ' '.repeat(padded.length + 1);
      const itemGroups = splitSelectItemTokens(clause.tokens);

      if (itemGroups.length === 0) {
        lines.push(`${baseIndent}${padded}`);
      } else if (cfg.dml.selectItemList.format === 1) {
        const firstPrefix = `${baseIndent}${padded} `;
        const firstStr = formatTokensWithSubqueries(itemGroups[0], cfg, firstPrefix.length);
        lines.push(firstPrefix + firstStr + (itemGroups.length > 1 ? ',' : ''));
        for (let si = 1; si < itemGroups.length; si++) {
          const isLast = si === itemGroups.length - 1;
          const itemStr = formatTokensWithSubqueries(itemGroups[si], cfg, itemIndent.length);
          lines.push(itemIndent + itemStr + (isLast ? '' : ','));
        }
      } else {
        const prefix = `${baseIndent}${padded} `;
        const allStr = itemGroups.map((g, idx) => {
          const s = formatTokensWithSubqueries(g, cfg, prefix.length);
          return idx < itemGroups.length - 1 ? s + ',' : s;
        }).join(' ');
        lines.push(prefix + allStr);
      }

    } else if (clause.keyword === 'FROM') {
      const padded = padKeyword(kw, kwWidth, cfg.dml.leftAlignKeywords);
      const fromLines = formatFromClause(clause.tokens, cfg, baseIndent, padded, kwWidth);
      lines.push(...fromLines);

    } else if (clause.keyword === 'WHERE') {
      const padded = padKeyword(kw, kwWidth, cfg.dml.leftAlignKeywords);
      const whereLines = formatWhereClause(clause.tokens, cfg, baseIndent, padded, kwWidth);
      lines.push(...whereLines);

    } else if (clause.keyword === 'GROUP' || clause.keyword === 'ORDER') {
      // GROUP BY or ORDER BY
      const nextIsBy = clause.tokens[0]?.value === 'BY';
      let fullKw = kw;
      let restTokens = clause.tokens;
      if (nextIsBy) {
        fullKw = kw + ' ' + applyKeywordCase('BY', cfg);
        restTokens = clause.tokens.slice(1);
      }
      const padded = padKeyword(fullKw, kwWidth, cfg.dml.leftAlignKeywords);
      lines.push(`${baseIndent}${padded} ${tokensToStr(restTokens, cfg)}`);

    } else if (clause.keyword === 'HAVING') {
      const padded = padKeyword(kw, kwWidth, cfg.dml.leftAlignKeywords);
      const havingLines = formatWhereClause(clause.tokens, cfg, baseIndent, padded, kwWidth);
      lines.push(...havingLines);

    } else if (clause.keyword === 'UNION' || clause.keyword === 'INTERSECT' || clause.keyword === 'MINUS') {
      lines.push('');
      let fullKw = kw;
      let restTokens = clause.tokens;
      if (clause.tokens[0]?.value === 'ALL') {
        fullKw = kw + ' ' + applyKeywordCase('ALL', cfg);
        restTokens = clause.tokens.slice(1);
      }
      lines.push(`${baseIndent}${fullKw}`);
      if (restTokens.length > 0) {
        const subResult = formatDML(restTokens, cfg, baseIndent);
        lines.push(subResult);
      }

    } else if (clause.keyword === 'CONNECT') {
      const padded = padKeyword(kw + ' ' + applyKeywordCase('BY', cfg), kwWidth, cfg.dml.leftAlignKeywords);
      const restTokens = clause.tokens[0]?.value === 'BY' ? clause.tokens.slice(1) : clause.tokens;
      lines.push(`${baseIndent}${padded} ${tokensToStr(restTokens, cfg)}`);

    } else if (clause.keyword === 'START') {
      const padded = padKeyword(kw + ' ' + applyKeywordCase('WITH', cfg), kwWidth, cfg.dml.leftAlignKeywords);
      const restTokens = clause.tokens[0]?.value === 'WITH' ? clause.tokens.slice(1) : clause.tokens;
      lines.push(`${baseIndent}${padded} ${tokensToStr(restTokens, cfg)}`);

    } else {
      const padded = padKeyword(kw, kwWidth, cfg.dml.leftAlignKeywords);
      lines.push(`${baseIndent}${padded} ${tokensToStr(clause.tokens, cfg)}`);
    }
  }

  return lines.join('\n');
}

function formatFromClause(
  tokens: Token[], cfg: BeautifierConfig,
  baseIndent: string, fromPadded: string, kwWidth: number
): string[] {
  const lines: string[] = [];
  // Split on JOIN keywords
  const joinSplit = splitOnJoins(tokens);

  if (joinSplit.length === 1) {
    lines.push(`${baseIndent}${fromPadded} ${tokensToStr(joinSplit[0].tokens, cfg, true)}`);
  } else {
    lines.push(`${baseIndent}${fromPadded} ${tokensToStr(joinSplit[0].tokens, cfg, true)}`);
    for (let i = 1; i < joinSplit.length; i++) {
      const j = joinSplit[i];
      const joinKw = applyKeywordCase(j.keyword, cfg);
      const padded = padKeyword(joinKw, kwWidth, cfg.dml.leftAlignKeywords);

      if (cfg.dml.joinSplitBeforeOn) {
        // Split before ON
        const onIdx = j.tokens.findIndex(t => t.value === 'ON');
        if (onIdx >= 0) {
          const beforeOn = j.tokens.slice(0, onIdx);
          const afterOn  = j.tokens.slice(onIdx + 1);
          lines.push(`${baseIndent}${padded} ${tokensToStr(beforeOn, cfg, true)}`);
          const onPadded = padKeyword(applyKeywordCase('ON', cfg), kwWidth, cfg.dml.leftAlignKeywords);
          // AND in ON clause right-aligned to kwWidth so data aligns with ON data
          const onAndOrIndent = cfg.dml.leftAlignKeywords
            ? baseIndent
            : baseIndent + ' '.repeat(Math.max(0, kwWidth - applyKeywordCase('AND', cfg).length));
          lines.push(...formatWhereClause(afterOn, cfg, baseIndent, onPadded, kwWidth, onAndOrIndent));
        } else {
          lines.push(`${baseIndent}${padded} ${tokensToStr(j.tokens, cfg, true)}`);
        }
      } else {
        lines.push(`${baseIndent}${padded} ${tokensToStr(j.tokens, cfg, true)}`);
      }
    }
  }
  return lines;
}

function formatWhereClause(
  tokens: Token[], cfg: BeautifierConfig,
  baseIndent: string, wherePadded: string, kwWidth: number,
  overrideAndOrIndent?: string
): string[] {
  if (!cfg.dml.where.splitAndOr || tokens.length === 0) {
    const prefix = `${baseIndent}${wherePadded} `;
    return [prefix + formatTokensWithSubqueries(tokens, cfg, prefix.length, true)];
  }

  const lines: string[] = [];
  const andOrIndent = overrideAndOrIndent ?? computeAndOrIndent(wherePadded, kwWidth, baseIndent, cfg);

  // Split on top-level AND/OR (not inside parentheses)
  const parts = splitOnAndOr(tokens);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === 0) {
      const prefix0 = `${baseIndent}${wherePadded} `;
      lines.push(prefix0 + formatTokensWithSubqueries(part.tokens, cfg, prefix0.length, true));
    } else {
      const andOr = applyKeywordCase(part.connector, cfg);
      const prefixN = `${andOrIndent}${andOr} `;
      lines.push(prefixN + formatTokensWithSubqueries(part.tokens, cfg, prefixN.length, true));
    }
  }
  return lines;
}

function computeAndOrIndent(wherePadded: string, kwWidth: number, baseIndent: string, cfg: BeautifierConfig): string {
  if (cfg.dml.where.andOrUnderWhere) {
    // AND/OR aligns with WHERE position, then indented by one extra indent level
    const wherePos = baseIndent.length + wherePadded.length - 5; // position of W in WHERE
    return ' '.repeat(Math.max(0, wherePos)) + ' '.repeat(cfg.indent);
  }
  return baseIndent + ' '.repeat(kwWidth + 1);
}

interface AndOrPart {
  connector: string;  // '' for first, 'AND' or 'OR' for others
  tokens: Token[];
}

function splitOnAndOr(tokens: Token[]): AndOrPart[] {
  const parts: AndOrPart[] = [];
  let depth = 0;
  let current: Token[] = [];
  let connector = '';

  for (const t of tokens) {
    if (t.type === TokenType.LPAREN) depth++;
    else if (t.type === TokenType.RPAREN) depth--;

    if (depth === 0 && (t.value === 'AND' || t.value === 'OR') && t.type === TokenType.KEYWORD) {
      parts.push({ connector, tokens: current });
      connector = t.value;
      current = [];
    } else {
      current.push(t);
    }
  }
  if (current.length > 0 || parts.length === 0) {
    parts.push({ connector, tokens: current });
  }
  return parts;
}

interface JoinPart {
  keyword: string;
  tokens: Token[];
}

function splitOnJoins(tokens: Token[]): JoinPart[] {
  const parts: JoinPart[] = [{ keyword: 'FROM', tokens: [] }];
  let depth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === TokenType.LPAREN) depth++;
    else if (t.type === TokenType.RPAREN) depth--;

    if (depth === 0 && JOIN_KEYWORDS.has(t.value) && t.type === TokenType.KEYWORD) {
      let joinKw = t.value;
      // Check for compound join: LEFT OUTER JOIN, LEFT JOIN, etc.
      let j = i + 1;
      while (j < tokens.length && JOIN_KEYWORDS.has(tokens[j].value)) {
        joinKw += ' ' + tokens[j].value;
        j++;
      }
      i = j - 1;
      parts.push({ keyword: joinKw, tokens: [] });
    } else {
      parts[parts.length - 1].tokens.push(t);
    }
  }
  return parts;
}

// ─── INSERT ─────────────────────────────────────────────────────────────────

function formatInsert(tokens: Token[], cfg: BeautifierConfig, baseIndent: string): string {
  const kw = applyKeywordCase('INSERT', cfg);
  const kwWidth = 6; // INSERT
  const intoKw = applyKeywordCase('INTO', cfg);
  const valuesKw = applyKeywordCase('VALUES', cfg);

  // Simple approach: INSERT INTO table (cols) VALUES (vals)
  const lines: string[] = [];

  // Find INTO, column list parens, VALUES, value list parens
  let i = 0;
  const advance = () => tokens[i++];

  // Consume INSERT
  advance(); i = 1;

  // Collect: INTO tableName [(cols)] [VALUES (vals)] [SELECT ...]
  let intoAndTable: Token[] = [];
  let colTokens: Token[] = [];
  let valTokens: Token[] = [];
  let selectTokens: Token[] = [];

  // Collect INTO + tableName (skip the INTO keyword itself — we add it explicitly)
  while (i < tokens.length && tokens[i]?.value !== 'VALUES' && tokens[i]?.type !== TokenType.LPAREN && tokens[i]?.value !== 'SELECT') {
    intoAndTable.push(tokens[i++]);
  }
  // Drop leading INTO keyword if present (avoid duplication)
  if (intoAndTable[0]?.value === 'INTO') intoAndTable = intoAndTable.slice(1);

  // Column list?
  if (i < tokens.length && tokens[i]?.type === TokenType.LPAREN) {
    colTokens = extractParenContent(tokens, i);
    i += colTokens.length + 2; // skip ( and )
  }

  // VALUES or SELECT
  if (i < tokens.length && tokens[i]?.value === 'VALUES') {
    i++; // skip VALUES
    if (i < tokens.length && tokens[i]?.type === TokenType.LPAREN) {
      valTokens = extractParenContent(tokens, i);
      i += valTokens.length + 2;
    }
  } else if (i < tokens.length && tokens[i]?.value === 'SELECT') {
    selectTokens = tokens.slice(i);
  }

  const intoStr = tokensToStr(intoAndTable, cfg);
  // INSERT INTO — no padding, just a single space between keywords
  lines.push(`${baseIndent}${kw} ${intoKw} ${intoStr}`);

  if (colTokens.length > 0) {
    const cols = splitCommaList(colTokens);
    if (cfg.dml.insertItemList.format === 1 && cols.length > 1) {
      const colIndent = baseIndent + ' '.repeat(kwWidth + 1);
      lines.push(`${baseIndent}  (`);
      for (let ci = 0; ci < cols.length; ci++) {
        const comma = ci < cols.length - 1 ? ',' : '';
        lines.push(`${colIndent}${tokensToStr(cols[ci], cfg)}${comma}`);
      }
      lines.push(`${baseIndent}  )`);
    } else {
      lines.push(`${baseIndent}  (${tokensToStr(colTokens, cfg)})`);
    }
  }

  if (valTokens.length > 0) {
    const vals = splitCommaList(valTokens);
    const valuesPadded = padKeyword(valuesKw, kwWidth, cfg.dml.leftAlignKeywords);
    if (cfg.dml.insertItemList.format === 1 && vals.length > 1) {
      const valIndent = baseIndent + ' '.repeat(kwWidth + 1);
      lines.push(`${baseIndent}${valuesPadded}`);
      lines.push(`${baseIndent}  (`);
      for (let vi = 0; vi < vals.length; vi++) {
        const comma = vi < vals.length - 1 ? ',' : '';
        lines.push(`${valIndent}${tokensToStr(vals[vi], cfg)}${comma}`);
      }
      lines.push(`${baseIndent}  )`);
    } else {
      lines.push(`${baseIndent}${valuesPadded} (${tokensToStr(valTokens, cfg)})`);
    }
  }

  if (selectTokens.length > 0) {
    lines.push(formatDML(selectTokens, cfg, baseIndent));
  }

  return lines.join('\n');
}

// ─── UPDATE ─────────────────────────────────────────────────────────────────

function formatUpdate(tokens: Token[], cfg: BeautifierConfig, baseIndent: string): string {
  const kwWidth = cfg.dml.leftAlignKeywords ? 0 : 6; // UPDATE

  const updateKw  = padKeyword(applyKeywordCase('UPDATE', cfg), kwWidth, cfg.dml.leftAlignKeywords);
  const setKw     = padKeyword(applyKeywordCase('SET', cfg), kwWidth, cfg.dml.leftAlignKeywords);
  const whereKw   = padKeyword(applyKeywordCase('WHERE', cfg), kwWidth, cfg.dml.leftAlignKeywords);

  const lines: string[] = [];

  let i = 1; // skip UPDATE
  // Collect table name and alias
  const tableTokens: Token[] = [];
  while (i < tokens.length && tokens[i]?.value !== 'SET') {
    tableTokens.push(tokens[i++]);
  }
  lines.push(`${baseIndent}${updateKw} ${tokensToStr(tableTokens, cfg)}`);

  if (i < tokens.length && tokens[i]?.value === 'SET') {
    i++; // skip SET
    // Collect SET items until WHERE or end
    const setTokens: Token[] = [];
    while (i < tokens.length && tokens[i]?.value !== 'WHERE') {
      setTokens.push(tokens[i++]);
    }
    const setParts = splitCommaList(setTokens);

    if (cfg.dml.updateItemList.format === 2 && cfg.dml.updateItemList.align && setParts.length > 1) {
      // Align = signs
      const setItemIndent = baseIndent + ' '.repeat(kwWidth + 1);
      const setItems = setParts.map(part => {
        const eqIdx = part.findIndex(t => t.type === TokenType.COMPARISON_OP && t.value === '=');
        if (eqIdx < 0) return { indent: setItemIndent, col: tokensToStr(part, cfg), val: '', comment: '', hasComma: false };
        const col = tokensToStr(part.slice(0, eqIdx), cfg).trimEnd();
        const val = tokensToStr(part.slice(eqIdx + 1), cfg).trimStart();
        return { indent: setItemIndent, col, val, comment: '', hasComma: false };
      });
      // Add commas
      for (let si = 0; si < setItems.length - 1; si++) setItems[si].hasComma = true;

      const aligned = alignUpdateSet(setItems);
      lines.push(`${baseIndent}${setKw}`);
      lines.push(...aligned);
    } else {
      const setItemIndent = baseIndent + ' '.repeat(kwWidth + 1);
      lines.push(`${baseIndent}${setKw}`);
      setParts.forEach((part, idx) => {
        const comma = idx < setParts.length - 1 ? ',' : '';
        lines.push(`${setItemIndent}${tokensToStr(part, cfg)}${comma}`);
      });
    }
  }

  // WHERE clause
  if (i < tokens.length && tokens[i]?.value === 'WHERE') {
    i++; // skip WHERE
    const whereTokens = tokens.slice(i);
    const whereLines = formatWhereClause(whereTokens, cfg, baseIndent, whereKw, kwWidth);
    lines.push(...whereLines);
  }

  return lines.join('\n');
}

// ─── DELETE ─────────────────────────────────────────────────────────────────

function formatDelete(tokens: Token[], cfg: BeautifierConfig, baseIndent: string): string {
  const kwWidth = cfg.dml.leftAlignKeywords ? 0 : 6;
  const deleteKw = padKeyword(applyKeywordCase('DELETE', cfg), kwWidth, cfg.dml.leftAlignKeywords);
  const whereKw  = padKeyword(applyKeywordCase('WHERE', cfg), kwWidth, cfg.dml.leftAlignKeywords);
  const lines: string[] = [];

  let i = 1;
  const tableTokens: Token[] = [];
  while (i < tokens.length && tokens[i]?.value !== 'WHERE') {
    tableTokens.push(tokens[i++]);
  }
  lines.push(`${baseIndent}${deleteKw} ${tokensToStr(tableTokens, cfg)}`);

  if (i < tokens.length && tokens[i]?.value === 'WHERE') {
    i++;
    const whereLines = formatWhereClause(tokens.slice(i), cfg, baseIndent, whereKw, kwWidth);
    lines.push(...whereLines);
  }
  return lines.join('\n');
}

// ─── WITH (CTE) ──────────────────────────────────────────────────────────────

function formatWith(tokens: Token[], cfg: BeautifierConfig, baseIndent: string): string {
  const withKw = applyKeywordCase('WITH', cfg);
  const asKw   = applyKeywordCase('AS', cfg);
  const lines: string[] = [];
  const cteIndent = baseIndent + ' '; // one extra space for CTE subquery

  let i = 1; // skip WITH token
  let isFirst = true;

  while (i < tokens.length) {
    // CTE name
    const nameTok = tokens[i];
    if (!nameTok || (nameTok.type !== TokenType.IDENTIFIER && nameTok.type !== TokenType.KEYWORD)) break;
    const cteName = applyIdentifierCase(nameTok.raw, cfg);
    i++;

    // AS
    if (tokens[i]?.value !== 'AS') break;
    i++;

    // (SELECT ...)
    if (tokens[i]?.type !== TokenType.LPAREN) break;
    i++; // skip (
    const subTokens: Token[] = [];
    let depth = 1;
    while (i < tokens.length) {
      const tok = tokens[i];
      if (tok.type === TokenType.LPAREN) depth++;
      else if (tok.type === TokenType.RPAREN) { depth--; if (depth === 0) { i++; break; } }
      subTokens.push(tok);
      i++;
    }

    const hasMore = tokens[i]?.type === TokenType.COMMA;
    const closingParen = hasMore ? '),' : ')';

    const prefix = isFirst
      ? `${baseIndent}${withKw} ${cteName} ${asKw}`
      : `${baseIndent}${cteName} ${asKw}`;
    lines.push(prefix);

    const subResult = formatDML(subTokens, cfg, cteIndent + ' ');
    const subLines  = subResult.split('\n');
    subLines[0] = cteIndent + '(' + subLines[0].trimStart();
    subLines[subLines.length - 1] += closingParen;
    lines.push(...subLines);

    isFirst = false;
    if (hasMore) { i++; } else { break; }
  }

  // Main query (SELECT / INSERT / etc.)
  if (i < tokens.length) {
    lines.push(formatDML(tokens.slice(i), cfg, baseIndent));
  }

  return lines.join('\n');
}

// ─── MERGE ──────────────────────────────────────────────────────────────────

function formatMerge(tokens: Token[], cfg: BeautifierConfig, baseIndent: string): string {
  // Simple: just format as-is with basic keyword handling
  return baseIndent + tokensToStr(tokens, cfg);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function padKeyword(kw: string, width: number, leftAlign: boolean): string {
  if (leftAlign || width === 0) return kw;
  return kw.padStart(width);
}

function getMaxClauseKeywordWidth(clauses: DMLClause[]): number {
  const widths = clauses.map(c => {
    if (c.keyword === 'GROUP' || c.keyword === 'ORDER') return c.keyword.length + 3; // "+ BY"
    if (c.keyword === 'CONNECT') return 10; // "CONNECT BY"
    if (c.keyword === 'START') return 10; // "START WITH"
    // JOIN compound keywords
    if (JOIN_KEYWORDS.has(c.keyword)) return c.keyword.length;
    return c.keyword.length;
  });
  return Math.max(6, ...widths); // minimum 6 (SELECT)
}

function splitIntoClauses(tokens: Token[]): DMLClause[] {
  const clauses: DMLClause[] = [];
  let depth = 0;

  if (tokens.length === 0) return clauses;

  let currentKw = tokens[0]?.value ?? '';
  let currentTokens: Token[] = [];
  let i = 1;

  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === TokenType.LPAREN) depth++;
    else if (t.type === TokenType.RPAREN) depth--;

    if (depth === 0 && t.type === TokenType.KEYWORD && DML_CLAUSE_KEYWORDS.has(t.value)) {
      // START WITH: don't split on WITH when current clause is START
      if (t.value === 'WITH' && currentKw === 'START') {
        currentTokens.push(t);
        continue;
      }
      // Check if this is a subquery SELECT - preceded by (
      const prevNonWs = currentTokens[currentTokens.length - 1];
      if (t.value === 'SELECT' && prevNonWs?.type !== TokenType.LPAREN) {
        clauses.push({ keyword: currentKw, tokens: currentTokens });
        currentKw = t.value;
        currentTokens = [];
        continue;
      }
      if (t.value !== 'SELECT') {
        clauses.push({ keyword: currentKw, tokens: currentTokens });
        currentKw = t.value;
        currentTokens = [];
        continue;
      }
    }
    currentTokens.push(t);
  }
  clauses.push({ keyword: currentKw, tokens: currentTokens });
  return clauses;
}

function splitSelectItems(tokens: Token[], cfg: BeautifierConfig): string[] {
  const items: string[] = [];
  let depth = 0;
  let current: Token[] = [];

  for (const t of tokens) {
    if (t.type === TokenType.LPAREN) depth++;
    else if (t.type === TokenType.RPAREN) depth--;

    if (depth === 0 && t.type === TokenType.COMMA) {
      const str = tokensToStr(current, cfg);
      if (str.trim()) items.push(str.trim() + ',');
      current = [];
    } else {
      current.push(t);
    }
  }
  if (current.length > 0) {
    const str = tokensToStr(current, cfg);
    if (str.trim()) items.push(str.trim());
  }
  return items;
}

function splitCommaList(tokens: Token[]): Token[][] {
  const parts: Token[][] = [];
  let depth = 0;
  let current: Token[] = [];

  for (const t of tokens) {
    if (t.type === TokenType.LPAREN) depth++;
    else if (t.type === TokenType.RPAREN) depth--;

    if (depth === 0 && t.type === TokenType.COMMA) {
      parts.push(current);
      current = [];
    } else {
      current.push(t);
    }
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

function extractParenContent(tokens: Token[], startIdx: number): Token[] {
  // Assumes tokens[startIdx] is LPAREN
  const content: Token[] = [];
  let depth = 0;
  let i = startIdx;

  while (i < tokens.length) {
    const t = tokens[i];
    if (t.type === TokenType.LPAREN) {
      if (depth > 0) content.push(t);
      depth++;
    } else if (t.type === TokenType.RPAREN) {
      depth--;
      if (depth === 0) break;
      content.push(t);
    } else {
      if (depth > 0) content.push(t);
    }
    i++;
  }
  return content;
}
