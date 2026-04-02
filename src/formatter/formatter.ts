import { Token, TokenType } from './token';
import { BeautifierConfig } from './config';
import { tokenize } from './tokenizer';
import { formatDML, splitIntoClauses, getMaxClauseKeywordWidth } from './dml-formatter';
import { applyKeywordCase, applyIdentifierCase } from './casing';
import { alignDeclarations, alignAssignments, DeclLine, AssignLine, alignParams, ParamLine } from './aligner';

export { applyIdentifierCase };

enum Context {
  TOP_LEVEL,
  DECLARE_SECTION,
  BEGIN_BLOCK,
  IF_CONDITION,
  LOOP_BODY,
  CASE_EXPR,
  EXCEPTION_SECTION,
  PARAM_LIST,
  CREATE_HEADER,
}

interface ContextFrame {
  type: Context;
  indentLevel: number;
}

interface OutputLine {
  text: string;
  blankBefore: number;  // how many blank lines before this line
}

export function format(src: string, cfg: BeautifierConfig): string {
  const rawTokens = tokenize(src);

  // Build a map: token index -> blank lines preceding it (from original source)
  const blanksBefore = computeBlanksBefore(rawTokens);

  // Filter to non-whitespace, non-newline tokens
  const tokens: Token[] = [];
  const blanksMap = new Map<number, number>();
  for (let i = 0; i < rawTokens.length; i++) {
    const t = rawTokens[i];
    if (t.type !== TokenType.WHITESPACE && t.type !== TokenType.NEWLINE) {
      blanksMap.set(tokens.length, blanksBefore[i] ?? 0);
      tokens.push(t);
    }
  }

  const lines: string[] = [];
  let pos = 0;
  const stack: ContextFrame[] = [{ type: Context.TOP_LEVEL, indentLevel: 0 }];

  function ctx(): ContextFrame { return stack[stack.length - 1]; }
  function indentStr(extra = 0): string {
    const n = (ctx().indentLevel + extra) * cfg.indent;
    return cfg.useTabCharacter ? '\t'.repeat(Math.floor(n / cfg.tabCharacterSize)) : ' '.repeat(n);
  }
  function push(type: Context, extraIndent = 1): void {
    stack.push({ type, indentLevel: ctx().indentLevel + extraIndent });
  }
  function pop(): ContextFrame | undefined { return stack.pop(); }

  function peek(offset = 0): Token {
    const idx = pos + offset;
    return idx < tokens.length ? tokens[idx] : { type: TokenType.EOF, raw: '', value: '', line: 0, col: 0 };
  }

  function consume(): Token {
    return pos < tokens.length ? tokens[pos++] : { type: TokenType.EOF, raw: '', value: '', line: 0, col: 0 };
  }

  function applyCase(t: Token): string {
    if (t.type === TokenType.KEYWORD) return applyKeywordCase(t.value, cfg);
    if (t.type === TokenType.IDENTIFIER) return applyIdentifierCase(t.raw, cfg);
    return t.raw;
  }

  // Collect tokens until a stop condition, handling paren depth
  function collectUntil(
    stopFn: (t: Token, depth: number) => boolean,
    includeStopper = false
  ): Token[] {
    const result: Token[] = [];
    let depth = 0;
    while (!isDone()) {
      const t = peek();
      if (t.type === TokenType.LPAREN) depth++;
      else if (t.type === TokenType.RPAREN) depth--;
      if (depth < 0) break; // unmatched )
      if (stopFn(t, depth)) {
        if (includeStopper) result.push(consume());
        break;
      }
      result.push(consume());
    }
    return result;
  }

  function isDone(): boolean {
    return pos >= tokens.length || peek().type === TokenType.EOF;
  }

  // Format a token stream inline (within a single expression)
  function inlineTokens(toks: Token[]): string {
    const parts: string[] = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const next = toks[i + 1];
      const val = applyCase(t);
      parts.push(val);
      if (next) {
        if (
          t.type === TokenType.LPAREN ||
          next.type === TokenType.RPAREN ||
          next.type === TokenType.COMMA ||
          next.type === TokenType.SEMICOLON ||
          next.type === TokenType.DOT ||
          t.type === TokenType.DOT ||
          (next.type === TokenType.LPAREN && t.type === TokenType.IDENTIFIER) ||
          (next.type === TokenType.LPAREN && t.type === TokenType.KEYWORD && t.value !== 'IN' && t.value !== 'NOT' && t.value !== 'EXISTS') ||
          next.raw.startsWith('%')
        ) {
          // no space
        } else if (
          t.type === TokenType.MINUS &&
          (next.type === TokenType.NUMBER_LITERAL || next.type === TokenType.LPAREN)
        ) {
          // unary minus - no space
        } else {
          parts.push(' ');
        }
      }
    }
    return parts.join('');
  }

  // Returns true if a LINE_COMMENT token is a separator line (only dashes after --)
  function isSeparatorComment(raw: string): boolean {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('--')) return false;
    const rest = trimmed.slice(2);
    return rest.length >= 10 && /^-+\s*$/.test(rest);
  }

  // Emit a line of output
  function emit(text: string, blanks = 0): void {
    if (blanks > 0) {
      const allowed = Math.min(blanks, cfg.emptyLines);
      for (let i = 0; i < allowed; i++) lines.push('');
    }
    lines.push(text);
  }

  // ─── Declaration group handling ──────────────────────────────────────────

  interface PendingDecl {
    blankBefore: number;
    line: DeclLine;
  }

  function flushDeclGroup(group: PendingDecl[], indent: string): void {
    if (group.length === 0) return;
    if (cfg.alignDeclarationGroups && group.length > 1) {
      const aligned = alignDeclarations(group.map(g => g.line));
      for (let i = 0; i < aligned.length; i++) {
        emit(aligned[i], i === 0 ? group[0].blankBefore : 0);
      }
    } else {
      for (const g of group) {
        const l = g.line;
        const typeWithConstraint = l.constraint ? `${l.constraint} ${l.dataType}` : l.dataType;
        const def = l.defaultVal ? ` := ${l.defaultVal}` : '';
        const comment = l.comment ? ` ${l.comment}` : '';
        emit(`${indent}${l.identifier} ${typeWithConstraint}${def}${l.semicolon}${comment}`, g.blankBefore);
      }
    }
  }

  interface PendingAssign {
    blankBefore: number;
    line: AssignLine;
  }

  function flushAssignGroup(group: PendingAssign[]): void {
    if (group.length === 0) return;
    if (cfg.alignAssignmentGroups && group.length > 1) {
      const aligned = alignAssignments(group.map(g => g.line));
      for (let i = 0; i < aligned.length; i++) {
        emit(aligned[i], i === 0 ? group[0].blankBefore : 0);
      }
    } else {
      for (const g of group) {
        const l = g.line;
        emit(`${l.indent}${l.lhs} := ${l.rhs};${l.comment ? ' ' + l.comment : ''}`, g.blankBefore);
      }
    }
  }

  // ─── Main parse loop ──────────────────────────────────────────────────────

  let declGroup: PendingDecl[] = [];
  let assignGroup: PendingAssign[] = [];

  function processDeclarativeSection(): void {
    // Process DECLARE body until BEGIN
    while (!isDone()) {
      const t = peek();
      if (t.value === 'BEGIN' && t.type === TokenType.KEYWORD) break;
      if (t.value === 'END' && t.type === TokenType.KEYWORD) break;
      if (t.type === TokenType.LINE_COMMENT || t.type === TokenType.BLOCK_COMMENT) {
        flushDeclGroup(declGroup, indentStr());
        declGroup = [];
        const blanks = blanksMap.get(pos) ?? 0;
        const commentRaw = consume().raw;
        emit(indentStr() + commentRaw, blanks);
        continue;
      }

      const blanks = blanksMap.get(pos) ?? 0;
      if (blanks > 0) {
        flushDeclGroup(declGroup, indentStr());
        declGroup = [];
      }

      // Parse a declaration: identifier TYPE [:= expr];
      if (t.type !== TokenType.IDENTIFIER && t.type !== TokenType.KEYWORD) {
        consume(); continue;
      }

      // Could be: identifier [CONSTANT] type [:= expr];
      // Or: CURSOR ident IS SELECT ...;
      // Or: PROCEDURE/FUNCTION declaration (just consume)
      // Or: TYPE ident IS ...;
      if (t.value === 'CURSOR' || t.value === 'TYPE' || t.value === 'SUBTYPE') {
        flushDeclGroup(declGroup, indentStr());
        declGroup = [];
        const stmt = collectUntil(tok => tok.type === TokenType.SEMICOLON, true);
        // Check for TYPE ident IS RECORD (...) — format multiline
        if (
          stmt[0]?.value === 'TYPE' &&
          stmt[2]?.value === 'IS' &&
          stmt[3]?.value === 'RECORD' &&
          stmt[4]?.type === TokenType.LPAREN
        ) {
          const typeKw    = applyKeywordCase('TYPE', cfg);
          const typeName  = applyIdentifierCase(stmt[1].raw, cfg);
          const isKw      = applyKeywordCase('IS', cfg);
          const recordKw  = applyKeywordCase('RECORD', cfg);
          // Find content between RECORD ( ... )
          let depth = 0;
          let closeIdx = stmt.length - 1;
          for (let i = 4; i < stmt.length; i++) {
            if (stmt[i].type === TokenType.LPAREN) depth++;
            else if (stmt[i].type === TokenType.RPAREN) { depth--; if (depth === 0) { closeIdx = i; break; } }
          }
          const fieldTokens = stmt.slice(5, closeIdx);
          // Split on commas at depth 0
          const fields: Token[][] = [];
          let cur: Token[] = [];
          let d = 0;
          for (const tok of fieldTokens) {
            if (tok.type === TokenType.LPAREN) d++;
            else if (tok.type === TokenType.RPAREN) d--;
            if (d === 0 && tok.type === TokenType.COMMA) { fields.push(cur); cur = []; }
            else cur.push(tok);
          }
          if (cur.length > 0) fields.push(cur);
          // Align field names and types
          const fieldIndent = indentStr() + ' '.repeat(cfg.indent);
          const parsed = fields.map(f => ({
            name: applyIdentifierCase(f[0].raw, cfg),
            typeStr: inlineTokens(f.slice(1)),
          }));
          const maxNameLen = Math.max(...parsed.map(f => f.name.length));
          const formattedFields = parsed.map((f, i) => {
            const paddedName = f.name.padEnd(maxNameLen);
            const comma = i < parsed.length - 1 ? ',' : '';
            return `${fieldIndent}${paddedName}  ${f.typeStr}${comma}`;
          });
          const semi = stmt[stmt.length - 1].type === TokenType.SEMICOLON ? ';' : '';
          emit(`${indentStr()}${typeKw} ${typeName} ${isKw} ${recordKw}(\n${formattedFields.join('\n')})${semi}`, blanks);
        } else {
          emit(indentStr() + inlineTokens(stmt), blanks);
        }
        continue;
      }
      if (t.value === 'PROCEDURE' || t.value === 'FUNCTION') {
        flushDeclGroup(declGroup, indentStr());
        declGroup = [];
        processSubprogram();
        continue;
      }
      if (t.value === 'PRAGMA') {
        flushDeclGroup(declGroup, indentStr());
        declGroup = [];
        const stmt = collectUntil(tok => tok.type === TokenType.SEMICOLON, true);
        emit(indentStr() + inlineTokens(stmt), blanks);
        continue;
      }

      // Regular variable declaration
      const identTok = consume();
      const identName = applyIdentifierCase(identTok.raw, cfg);

      // optional CONSTANT (may appear before OR after the datatype)
      let constraint = '';
      if (peek().value === 'CONSTANT') {
        constraint = applyKeywordCase('CONSTANT', cfg);
        consume();
      }

      // datatype: collect until := or ; (handle CONSTANT appearing after type too)
      const typeTokens: Token[] = [];
      while (!isDone() && peek().type !== TokenType.SEMICOLON &&
             !(peek().type === TokenType.ASSIGNMENT_OP)) {
        const tok = peek();
        if (tok.value === 'CONSTANT' && tok.type === TokenType.KEYWORD && constraint === '') {
          constraint = applyKeywordCase('CONSTANT', cfg);
          consume();
        } else {
          typeTokens.push(consume());
        }
      }

      let defaultVal = '';
      if (!isDone() && peek().type === TokenType.ASSIGNMENT_OP) {
        consume(); // :=
        const valTokens = collectUntil(tok => tok.type === TokenType.SEMICOLON);
        defaultVal = inlineTokens(valTokens);
      }

      // collect semicolon
      let semi = '';
      let semiLine = -1;
      if (!isDone() && peek().type === TokenType.SEMICOLON) {
        const semiTok = consume();
        semi = semiTok.raw;
        semiLine = semiTok.line;
      }

      // Inline comment? Only if on the same source line as the semicolon AND not a separator
      let comment = '';
      if (!isDone() && peek().type === TokenType.LINE_COMMENT) {
        if (!isSeparatorComment(peek().raw) && semiLine >= 0 && peek().line === semiLine) {
          comment = consume().raw;
        }
      }

      const typeStr = inlineTokens(typeTokens);
      const declLine: DeclLine = {
        indent: indentStr(),
        identifier: identName,
        dataType: typeStr,
        constraint,
        defaultVal,
        comment,
        semicolon: semi,
      };
      declGroup.push({ blankBefore: blanks, line: declLine });
    }
    flushDeclGroup(declGroup, indentStr());
    declGroup = [];
  }

  function processBeginBlock(isTopLevel = false): void {
    let firstStatement = true;
    let pendingBlanks = 0;
    while (!isDone()) {
      const t = peek();
      const sourceBlanks = firstStatement ? 0 : (blanksMap.get(pos) ?? 0);
      const blanks = Math.max(sourceBlanks, pendingBlanks);
      pendingBlanks = 0;

      if (t.type === TokenType.LINE_COMMENT || t.type === TokenType.BLOCK_COMMENT) {
        flushAssignGroup(assignGroup);
        assignGroup = [];
        const commentRaw = consume().raw;
        emit(indentStr() + commentRaw, blanks);
        continue;
      }

      if (blanks > 0) {
        flushAssignGroup(assignGroup);
        assignGroup = [];
      }

      if (t.value === 'END' && t.type === TokenType.KEYWORD) break;
      if (t.value === 'EXCEPTION' && t.type === TokenType.KEYWORD) break;
      if (t.value === 'ELSIF' && t.type === TokenType.KEYWORD) break;
      if (t.value === 'ELSE' && t.type === TokenType.KEYWORD) break;
      if (t.value === 'WHEN' && t.type === TokenType.KEYWORD) break;
      if (t.type === TokenType.EOF) break;

      firstStatement = false;

      // ── IF statement ──
      if (t.value === 'IF' && t.type === TokenType.KEYWORD) {
        flushAssignGroup(assignGroup);
        assignGroup = [];
        processIf(blanks);
        pendingBlanks = 1;
        continue;
      }

      // ── CASE statement ──
      if (t.value === 'CASE' && t.type === TokenType.KEYWORD) {
        flushAssignGroup(assignGroup);
        assignGroup = [];
        processCaseStatement(blanks);
        continue;
      }

      // ── FOR loop ──
      if (t.value === 'FOR' && t.type === TokenType.KEYWORD) {
        flushAssignGroup(assignGroup);
        assignGroup = [];
        processForLoop(blanks);
        continue;
      }

      // ── WHILE loop ──
      if (t.value === 'WHILE' && t.type === TokenType.KEYWORD) {
        flushAssignGroup(assignGroup);
        assignGroup = [];
        processWhileLoop(blanks);
        continue;
      }

      // ── Plain LOOP ──
      if (t.value === 'LOOP' && t.type === TokenType.KEYWORD) {
        flushAssignGroup(assignGroup);
        assignGroup = [];
        consume(); // LOOP
        emit(indentStr() + applyKeywordCase('LOOP', cfg), blanks);
        push(Context.LOOP_BODY);
        processBeginBlock();
        pop();
        // END LOOP
        if (peek().value === 'END') {
          consume();
          if (peek().value === 'LOOP') consume();
          const label = peek().type === TokenType.IDENTIFIER ? applyIdentifierCase(consume().raw, cfg) + ' ' : '';
          if (peek().type === TokenType.SEMICOLON) consume();
          emit(indentStr() + applyKeywordCase('END LOOP', cfg) + ' ' + label + ';');
        }
        continue;
      }

      // ── DML statements ──
      if ((t.value === 'SELECT' || t.value === 'INSERT' || t.value === 'UPDATE' ||
           t.value === 'DELETE' || t.value === 'MERGE' || t.value === 'WITH') && t.type === TokenType.KEYWORD) {
        flushAssignGroup(assignGroup);
        assignGroup = [];
        // Check if SELECT INTO or cursor FOR loop
        const stmtTokens = collectUntil(tok => tok.type === TokenType.SEMICOLON, false);
        const dmlIndent = indentStr();
        const dmlFormatted = formatDML(stmtTokens, cfg, dmlIndent);
        emit(dmlFormatted, blanks);
        if (peek().type === TokenType.SEMICOLON) {
          consume();
          // Append semicolon to last line
          if (lines.length > 0) lines[lines.length - 1] += ';';
        }
        continue;
      }

      // ── OPEN cursor FOR SELECT/WITH ──
      if (t.value === 'OPEN' && t.type === TokenType.KEYWORD) {
        flushAssignGroup(assignGroup);
        assignGroup = [];
        const stmtToks = collectUntil(tok => tok.type === TokenType.SEMICOLON, false);
        const forIdx = stmtToks.findIndex(
          (tok, i) => i > 0 && tok.value === 'FOR' && tok.type === TokenType.KEYWORD
        );
        if (
          forIdx >= 0 &&
          forIdx + 1 < stmtToks.length &&
          stmtToks[forIdx + 1].type === TokenType.KEYWORD &&
          (stmtToks[forIdx + 1].value === 'SELECT' || stmtToks[forIdx + 1].value === 'WITH')
        ) {
          const openPart = inlineTokens(stmtToks.slice(0, forIdx + 1));
          const selectToks = stmtToks.slice(forIdx + 1);
          const prefix = `${indentStr()}${openPart} `;
          const formattedSelect = formatDML(selectToks, cfg, ' '.repeat(prefix.length));
          const selLines = formattedSelect.split('\n');
          selLines[0] = prefix + selLines[0].trimStart();
          if (peek().type === TokenType.SEMICOLON) consume();
          emit(selLines.join('\n') + ';', blanks);
        } else {
          if (peek().type === TokenType.SEMICOLON) consume();
          emit(indentStr() + inlineTokens(stmtToks) + ';', blanks);
        }
        continue;
      }

      // ── Nested anonymous BEGIN ... [EXCEPTION] ... END block ──
      if (t.value === 'BEGIN' && t.type === TokenType.KEYWORD) {
        flushAssignGroup(assignGroup);
        assignGroup = [];
        consume(); // BEGIN
        emit(indentStr() + applyKeywordCase('BEGIN', cfg), blanks);
        push(Context.BEGIN_BLOCK);
        processBeginBlock();

        // EXCEPTION clause (optional)
        if (!isDone() && peek().value === 'EXCEPTION' && peek().type === TokenType.KEYWORD) {
          consume();
          emit(indentStr(-1) + applyKeywordCase('EXCEPTION', cfg));
          processExceptionSection();
        }

        pop();

        // END [label] ;
        if (!isDone() && peek().value === 'END' && peek().type === TokenType.KEYWORD) {
          consume();
          let endLabel = '';
          if (!isDone() && peek().type === TokenType.IDENTIFIER) {
            endLabel = ' ' + applyIdentifierCase(consume().raw, cfg);
          }
          if (!isDone() && peek().type === TokenType.SEMICOLON) consume();
          emit(indentStr() + applyKeywordCase('END', cfg) + endLabel + ';');
        }
        continue;
      }

      // ── Assignment: identifier :=  ──
      if ((t.type === TokenType.IDENTIFIER || t.type === TokenType.KEYWORD) &&
          lookAheadForAssignment()) {
        const lhsToks = collectUntil(tok => tok.type === TokenType.ASSIGNMENT_OP);
        consume(); // :=
        const rhsToks = collectUntil(tok => tok.type === TokenType.SEMICOLON);
        let assignSemiLine = -1;
        if (peek().type === TokenType.SEMICOLON) { assignSemiLine = peek().line; consume(); }
        let comment = '';
        if (peek().type === TokenType.LINE_COMMENT && !isSeparatorComment(peek().raw) && assignSemiLine >= 0 && peek().line === assignSemiLine) comment = consume().raw;

        const lhs = inlineTokens(lhsToks);

        const prefixLen = indentStr().length + lhs.length + ' := '.length;
        if (hasMultipleCallArgs(rhsToks) || hasBreakableCall(rhsToks)) {
          // Multi-arg function call: flush pending group and emit with line breaks
          flushAssignGroup(assignGroup);
          assignGroup = [];
          const rhs = formatCallWithBreaking(rhsToks, prefixLen);
          const commentStr = comment ? ` ${comment}` : '';
          emit(`${indentStr()}${lhs} := ${rhs};${commentStr}`, blanks);
        } else {
          const rhs = inlineTokens(rhsToks);
          const assignLine: AssignLine = { indent: indentStr(), lhs, rhs, comment };
          assignGroup.push({ blankBefore: blanks, line: assignLine });
        }
        continue;
      }

      // ── RETURN statement ──
      if (t.value === 'RETURN' && t.type === TokenType.KEYWORD) {
        flushAssignGroup(assignGroup);
        assignGroup = [];
        const stmt = collectUntil(tok => tok.type === TokenType.SEMICOLON, true);
        // stmt = [RETURN, ...expr..., ;]
        const hasSemi = stmt[stmt.length - 1]?.type === TokenType.SEMICOLON;
        const exprToks = stmt.slice(1, hasSemi ? -1 : undefined);
        if (hasMultipleCallArgs(exprToks)) {
          const returnKw = applyKeywordCase('RETURN', cfg);
          const prefixLen = indentStr().length + returnKw.length + 1;
          const formatted = formatCallWithBreaking(exprToks, prefixLen);
          emit(`${indentStr()}${returnKw} ${formatted};`, blanks);
        } else {
          emit(indentStr() + inlineTokens(stmt), blanks);
        }
        continue;
      }

      // ── EXECUTE IMMEDIATE statement ──
      if (t.value === 'EXECUTE' && t.type === TokenType.KEYWORD &&
          peek(1).value === 'IMMEDIATE' && peek(1).type === TokenType.KEYWORD) {
        flushAssignGroup(assignGroup);
        assignGroup = [];
        consume(); // EXECUTE
        consume(); // IMMEDIATE
        const execKw = applyKeywordCase('EXECUTE', cfg) + ' ' + applyKeywordCase('IMMEDIATE', cfg);
        // Collect until USING or semicolon
        const dynToks: Token[] = [];
        let depth = 0;
        while (!isDone()) {
          const nt = peek();
          if (nt.type === TokenType.SEMICOLON) break;
          if (depth === 0 && nt.value === 'USING' && nt.type === TokenType.KEYWORD) break;
          if (nt.type === TokenType.LPAREN) depth++;
          else if (nt.type === TokenType.RPAREN) depth--;
          dynToks.push(consume());
        }
        const dynStr = inlineTokens(dynToks);
        if (peek().value === 'USING' && peek().type === TokenType.KEYWORD) {
          consume(); // USING
          const usingToks = collectUntil(tok => tok.type === TokenType.SEMICOLON);
          if (peek().type === TokenType.SEMICOLON) consume();
          const usingKw = applyKeywordCase('USING', cfg);
          const usingIndent = indentStr() + ' '.repeat(cfg.indent);
          emit(`${indentStr()}${execKw} ${dynStr}`, blanks);
          emit(`${usingIndent}${usingKw} ${inlineTokens(usingToks)};`);
        } else {
          if (peek().type === TokenType.SEMICOLON) consume();
          emit(`${indentStr()}${execKw} ${dynStr};`, blanks);
        }
        continue;
      }

      // ── Generic statement ──
      flushAssignGroup(assignGroup);
      assignGroup = [];
      const stmt = collectUntil(tok => tok.type === TokenType.SEMICOLON, true);
      if (stmt.length > 0) {
        // stmt ends with ';' — check if it's a multi-arg procedure call
        const stmtBody = stmt[stmt.length - 1]?.type === TokenType.SEMICOLON
          ? stmt.slice(0, -1) : stmt;
        if (hasMultipleCallArgs(stmtBody) || hasBreakableCall(stmtBody)) {
          const prefixLen = indentStr().length;
          const formatted = formatCallWithBreaking(stmtBody, prefixLen);
          emit(`${indentStr()}${formatted};`, blanks);
        } else {
          emit(indentStr() + inlineTokens(stmt), blanks);
        }
      }
    }

    flushAssignGroup(assignGroup);
    assignGroup = [];
  }

  function lookAheadForAssignment(): boolean {
    // Look for := within the next ~20 tokens at depth 0
    let depth = 0;
    for (let i = pos; i < Math.min(pos + 20, tokens.length); i++) {
      const t = tokens[i];
      if (t.type === TokenType.LPAREN) depth++;
      else if (t.type === TokenType.RPAREN) depth--;
      else if (depth === 0 && t.type === TokenType.ASSIGNMENT_OP) return true;
      else if (depth === 0 && t.type === TokenType.SEMICOLON) return false;
    }
    return false;
  }

  // Check if any sub-sequence of toks forms a named call with 2+ args (or positional 3+).
  function hasBreakableCall(toks: Token[]): boolean {
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== TokenType.IDENTIFIER) continue;
      let j = i + 1;
      while (j + 1 < toks.length && toks[j].type === TokenType.DOT && toks[j + 1].type === TokenType.IDENTIFIER) j += 2;
      if (j >= toks.length || toks[j].type !== TokenType.LPAREN) continue;
      j++;
      let depth = 0, commas = 0, named = false;
      for (let k = j; k < toks.length; k++) {
        const tok = toks[k];
        if (tok.type === TokenType.RPAREN && depth === 0) break;
        if (tok.type === TokenType.LPAREN) depth++;
        else if (tok.type === TokenType.RPAREN) depth--;
        else if (depth === 0 && tok.type === TokenType.COMMA) commas++;
        else if (depth === 0 && tok.type === TokenType.ARROW_OP) named = true;
      }
      if (commas >= (named ? 1 : 2)) return true;
    }
    return false;
  }

  // Check if toks is a standalone function/procedure call with 2+ arguments.
  // Returns false if there are meaningful tokens after the closing parenthesis.
  function hasMultipleCallArgs(toks: Token[]): boolean {
    if (toks.length < 4) return false;
    let j = 0;
    if (toks[j].type !== TokenType.IDENTIFIER) return false;
    j++;
    // Allow dotted name: Pkg.Func or Pkg.Sub.Func
    while (j + 1 < toks.length &&
           toks[j].type === TokenType.DOT &&
           toks[j + 1].type === TokenType.IDENTIFIER) {
      j += 2;
    }
    if (j >= toks.length || toks[j].type !== TokenType.LPAREN) return false;
    j++; // past LPAREN
    // Scan args, track depth, look for comma at depth 0
    let depth = 0;
    let commaCount = 0;
    let isNamed = false;
    for (; j < toks.length; j++) {
      const tok = toks[j];
      if (tok.type === TokenType.RPAREN && depth === 0) { j++; break; }
      if (tok.type === TokenType.LPAREN) depth++;
      else if (tok.type === TokenType.RPAREN) depth--;
      else if (depth === 0 && tok.type === TokenType.COMMA) commaCount++;
      else if (depth === 0 && tok.type === TokenType.ARROW_OP) isNamed = true;
    }
    // Named notation (param => value): break at 2+ args; positional: break at 3+ args
    const minCommas = isNamed ? 1 : 2;
    if (commaCount < minCommas) return false;
    // Ensure nothing meaningful follows the closing paren (only semicolons allowed)
    for (; j < toks.length; j++) {
      if (toks[j].type !== TokenType.SEMICOLON) return false;
    }
    return true;
  }

  // Check if toks contains a CASE expression at depth 0.
  function hasCaseExpr(toks: Token[]): boolean {
    let depth = 0;
    for (const tok of toks) {
      if (tok.type === TokenType.LPAREN) depth++;
      else if (tok.type === TokenType.RPAREN) depth--;
      else if (depth === 0 && tok.value === 'CASE' && tok.type === TokenType.KEYWORD) return true;
    }
    return false;
  }

  // Format a CASE expression (toks starting from CASE keyword) with multi-line layout.
  // baseIndent: the indent string for WHEN/ELSE/END lines relative to the CASE keyword position.
  function formatCaseExpr(toks: Token[], baseIndent: string): string {
    const caseKw = applyKeywordCase('CASE', cfg);
    const whenKw = applyKeywordCase('WHEN', cfg);
    const thenKw = applyKeywordCase('THEN', cfg);
    const elseKw = applyKeywordCase('ELSE', cfg);
    const endKw  = applyKeywordCase('END', cfg);
    const innerIndent = baseIndent + ' '.repeat(cfg.indent);
    const valueIndent = innerIndent + ' '.repeat(cfg.indent);

    const lines: string[] = [];
    let i = 0;
    // Skip to CASE keyword
    while (i < toks.length && !(toks[i].value === 'CASE' && toks[i].type === TokenType.KEYWORD)) i++;
    i++; // skip CASE

    // Optional expr before first WHEN (simple CASE)
    const exprToks: Token[] = [];
    while (i < toks.length &&
           !(toks[i].value === 'WHEN' && toks[i].type === TokenType.KEYWORD) &&
           !(toks[i].value === 'END'  && toks[i].type === TokenType.KEYWORD)) {
      exprToks.push(toks[i++]);
    }
    lines.push(caseKw + (exprToks.length > 0 ? ' ' + inlineTokens(exprToks) : ''));

    while (i < toks.length) {
      const tok = toks[i];
      if (tok.value === 'END' && tok.type === TokenType.KEYWORD) {
        i++;
        lines.push(baseIndent + endKw);
        break;
      }
      if (tok.value === 'WHEN' && tok.type === TokenType.KEYWORD) {
        i++;
        const condToks: Token[] = [];
        while (i < toks.length && !(toks[i].value === 'THEN' && toks[i].type === TokenType.KEYWORD)) {
          condToks.push(toks[i++]);
        }
        i++; // skip THEN
        const thenToks: Token[] = [];
        let depth = 0;
        while (i < toks.length) {
          const t = toks[i];
          if (t.type === TokenType.LPAREN) depth++;
          else if (t.type === TokenType.RPAREN) depth--;
          else if (depth === 0 && (t.value === 'WHEN' || t.value === 'ELSE' || t.value === 'END') && t.type === TokenType.KEYWORD) break;
          thenToks.push(toks[i++]);
        }
        lines.push(innerIndent + whenKw + ' ' + inlineTokens(condToks) + ' ' + thenKw);
        lines.push(valueIndent + inlineTokens(thenToks));
        continue;
      }
      if (tok.value === 'ELSE' && tok.type === TokenType.KEYWORD) {
        i++;
        const elseToks: Token[] = [];
        let depth = 0;
        while (i < toks.length) {
          const t = toks[i];
          if (t.type === TokenType.LPAREN) depth++;
          else if (t.type === TokenType.RPAREN) depth--;
          else if (depth === 0 && t.value === 'END' && t.type === TokenType.KEYWORD) break;
          elseToks.push(toks[i++]);
        }
        lines.push(innerIndent + elseKw);
        lines.push(valueIndent + inlineTokens(elseToks));
        continue;
      }
      i++;
    }
    return lines.join('\n');
  }

  // Format a multi-arg function call with each argument on its own line,
  // aligned to the column right after the opening parenthesis.
  // prefixLen = number of characters before the function name on the current output line.
  function formatCallWithBreaking(toks: Token[], prefixLen: number): string {
    let j = 0;
    const nameToks: Token[] = [];
    while (j < toks.length && toks[j].type !== TokenType.LPAREN) {
      nameToks.push(toks[j]);
      j++;
    }
    const funcName = inlineTokens(nameToks);
    if (j >= toks.length || toks[j].type !== TokenType.LPAREN) {
      return inlineTokens(toks); // fallback: no LPAREN found
    }
    j++; // skip LPAREN

    // Extract comma-separated argument groups at depth 0
    const argGroups: Token[][] = [];
    let curGroup: Token[] = [];
    let depth = 0;
    for (; j < toks.length; j++) {
      const tok = toks[j];
      if (depth === 0 && tok.type === TokenType.RPAREN) break;
      if (tok.type === TokenType.LPAREN) depth++;
      else if (tok.type === TokenType.RPAREN) depth--;
      if (depth === 0 && tok.type === TokenType.COMMA) {
        argGroups.push(curGroup);
        curGroup = [];
      } else {
        curGroup.push(tok);
      }
    }
    if (curGroup.length > 0) argGroups.push(curGroup);

    // Any tokens after the closing ) (e.g. .Currency_Id, [idx], etc.)
    const suffix = j + 1 < toks.length ? inlineTokens(toks.slice(j + 1)) : '';

    if (argGroups.length <= 1) {
      // Single arg — recurse into it if it contains a breakable nested call
      if (argGroups.length === 1 && hasBreakableCall(argGroups[0])) {
        const innerPrefixLen = prefixLen + funcName.length + 1;
        const innerFormatted = formatCallWithBreaking(argGroups[0], innerPrefixLen);
        return funcName + '(' + innerFormatted + ')' + suffix;
      }
      return inlineTokens(toks); // single arg with no breakable nested — keep inline
    }

    // Column where the first argument starts (one past the opening parenthesis)
    const argStartCol = prefixLen + funcName.length + 1;
    const argIndent   = ' '.repeat(argStartCol);

    // Check if all args use named notation (param => value)
    const isNamed = argGroups.every(g => g.length >= 2 && g[1].type === TokenType.ARROW_OP);
    let formattedArgs: string[];
    if (isNamed) {
      const maxNameLen = Math.max(...argGroups.map(g => inlineTokens([g[0]]).length));
      formattedArgs = argGroups.map(g => {
        const name = inlineTokens([g[0]]).padEnd(maxNameLen);
        const valToks = g.slice(2);
        const valCol = argStartCol + maxNameLen + 4; // ' => '.length === 4
        const val = hasCaseExpr(valToks)
          ? formatCaseExpr(valToks, ' '.repeat(argStartCol + maxNameLen + 4))
          : hasMultipleCallArgs(valToks) || hasBreakableCall(valToks)
            ? formatCallWithBreaking(valToks, valCol)
            : inlineTokens(valToks);
        return `${name} => ${val}`;
      });
    } else {
      formattedArgs = argGroups.map(g => inlineTokens(g));
    }

    let result = funcName + '(' + formattedArgs[0] + ',\n';
    for (let k = 1; k < formattedArgs.length; k++) {
      const isLast = k === formattedArgs.length - 1;
      result += argIndent + formattedArgs[k] + (isLast ? ')' : ',\n');
    }
    return result + suffix;
  }

  // Split boolean condition on AND/OR at depth 0 for IF/ELSIF conditions
  function formatBoolCond(condTokens: Token[], contCol: number): string {
    if (!cfg.splitAndOr) return inlineTokens(condTokens);
    const contIndent = ' '.repeat(contCol);
    const parts: Token[][] = [];
    let cur: Token[] = [];
    let depth = 0;
    for (const tok of condTokens) {
      if (tok.type === TokenType.LPAREN) depth++;
      else if (tok.type === TokenType.RPAREN) depth--;
      if (depth === 0 && (tok.value === 'AND' || tok.value === 'OR') && tok.type === TokenType.KEYWORD) {
        if (cfg.andOrAfterExpression) {
          cur.push(tok);
          parts.push(cur);
          cur = [];
        } else {
          parts.push(cur);
          cur = [tok];
        }
      } else {
        cur.push(tok);
      }
    }
    if (cur.length > 0) parts.push(cur);
    if (parts.length <= 1) return inlineTokens(condTokens);
    return parts.map((p, i) => i === 0 ? inlineTokens(p) : contIndent + inlineTokens(p)).join('\n');
  }

  function processIf(blankBefore: number): void {
    consume(); // IF
    const condTokens = collectUntil(tok => tok.value === 'THEN' && tok.type === TokenType.KEYWORD);
    consume(); // THEN

    const ifKw = applyKeywordCase('IF', cfg);
    const thenKw = applyKeywordCase('THEN', cfg);
    const contCol = indentStr().length + ifKw.length + 1;
    const cond = formatBoolCond(condTokens, contCol);
    const isMultiLine = cond.includes('\n');

    if (cfg.thenOnNewLine || isMultiLine) {
      emit(indentStr() + ifKw + ' ' + cond, blankBefore);
      emit(indentStr() + thenKw);
    } else {
      emit(indentStr() + ifKw + ' ' + cond + ' ' + thenKw, blankBefore);
    }

    push(Context.BEGIN_BLOCK);
    processBeginBlock();
    pop();

    // ELSIF / ELSE / END IF
    while (!isDone() && peek().value !== 'END') {
      const t = peek();
      if (t.value === 'ELSIF' && t.type === TokenType.KEYWORD) {
        consume();
        const elsifCond = collectUntil(tok => tok.value === 'THEN' && tok.type === TokenType.KEYWORD);
        consume(); // THEN
        const elsifKw = applyKeywordCase('ELSIF', cfg);
        const elsifContCol = indentStr().length + elsifKw.length + 1;
        const elsifCond2 = formatBoolCond(elsifCond, elsifContCol);
        const elsifMultiLine = elsifCond2.includes('\n');
        if (cfg.thenOnNewLine || elsifMultiLine) {
          emit(indentStr() + elsifKw + ' ' + elsifCond2);
          emit(indentStr() + thenKw);
        } else {
          emit(indentStr() + elsifKw + ' ' + elsifCond2 + ' ' + thenKw);
        }
        push(Context.BEGIN_BLOCK);
        processBeginBlock();
        pop();
      } else if (t.value === 'ELSE' && t.type === TokenType.KEYWORD) {
        consume();
        emit(indentStr() + applyKeywordCase('ELSE', cfg));
        push(Context.BEGIN_BLOCK);
        processBeginBlock();
        pop();
      } else {
        break;
      }
    }

    // END IF
    if (peek().value === 'END') {
      consume();
      if (peek().value === 'IF') consume();
      if (peek().type === TokenType.SEMICOLON) consume();
      emit(indentStr() + applyKeywordCase('END IF', cfg) + ';');
    }
  }

  function processCaseStatement(blankBefore: number): void {
    consume(); // CASE
    const caseKw = applyKeywordCase('CASE', cfg);

    // Optional expression after CASE (before first WHEN)
    const exprTokens = collectUntil(tok => tok.value === 'WHEN' && tok.type === TokenType.KEYWORD);
    const expr = exprTokens.length > 0 ? ' ' + inlineTokens(exprTokens) : '';
    emit(indentStr() + caseKw + expr, blankBefore);

    push(Context.CASE_EXPR);

    while (!isDone() && peek().value !== 'END') {
      const t = peek();
      if (t.value === 'WHEN' && t.type === TokenType.KEYWORD) {
        consume();
        const whenCond = collectUntil(tok => tok.value === 'THEN' && tok.type === TokenType.KEYWORD);
        consume(); // THEN
        emit(indentStr(-1) + applyKeywordCase('WHEN', cfg) + ' ' + inlineTokens(whenCond) + ' ' + applyKeywordCase('THEN', cfg));
        push(Context.BEGIN_BLOCK);
        processBeginBlock();
        pop();
      } else if (t.value === 'ELSE' && t.type === TokenType.KEYWORD) {
        consume();
        emit(indentStr(-1) + applyKeywordCase('ELSE', cfg));
        push(Context.BEGIN_BLOCK);
        processBeginBlock();
        pop();
      } else {
        break;
      }
    }

    pop();
    if (peek().value === 'END') {
      consume();
      if (peek().value === 'CASE') consume();
      if (peek().type === TokenType.SEMICOLON) consume();
      emit(indentStr() + applyKeywordCase('END CASE', cfg) + ';');
    }
  }

  function processForLoop(blankBefore: number): void {
    consume(); // FOR
    const headerTokens = collectUntil(tok => tok.value === 'LOOP' && tok.type === TokenType.KEYWORD);
    const forKw = applyKeywordCase('FOR', cfg);

    // Detect cursor FOR loop: var IN (SELECT ...)
    const isCursorFor =
      headerTokens.length >= 4 &&
      headerTokens[1]?.value === 'IN' &&
      headerTokens[2]?.type === TokenType.LPAREN &&
      (headerTokens[3]?.value === 'SELECT' || headerTokens[3]?.value === 'WITH');

    if (isCursorFor) {
      const varName = applyIdentifierCase(headerTokens[0].raw, cfg);
      const inKw = applyKeywordCase('IN', cfg);
      // Tokens between outer parens: skip leading LPAREN and trailing RPAREN
      const selectToks = headerTokens.slice(3, headerTokens.length - 1);
      const prefix = `${indentStr()}${forKw} ${varName} ${inKw} (`;
      // Compute kwWidth so all keywords right-align to the column where SELECT ends
      const kwWidth = cfg.dml?.leftAlignKeywords ? 0 : getMaxClauseKeywordWidth(splitIntoClauses(selectToks));
      const selectLen = 6; // 'SELECT'.length
      // dmlIndent set so that: dmlIndent.length + kwWidth = prefix.length + selectLen
      const dmlIndent = ' '.repeat(Math.max(0, prefix.length + selectLen - kwWidth));
      const formattedDML = formatDML(selectToks, cfg, dmlIndent);
      const dmlLines = formattedDML.split('\n');
      dmlLines[0] = prefix + dmlLines[0].trimStart();
      dmlLines[dmlLines.length - 1] += ')';
      const forLine = dmlLines.join('\n');
      if (cfg.loopOnNewLine) {
        emit(forLine, blankBefore);
        emit(indentStr() + applyKeywordCase('LOOP', cfg));
      } else {
        emit(forLine + ' ' + applyKeywordCase('LOOP', cfg), blankBefore);
      }
    } else {
      if (cfg.loopOnNewLine) {
        emit(indentStr() + forKw + ' ' + inlineTokens(headerTokens), blankBefore);
        emit(indentStr() + applyKeywordCase('LOOP', cfg));
      } else {
        emit(indentStr() + forKw + ' ' + inlineTokens(headerTokens) + ' ' + applyKeywordCase('LOOP', cfg), blankBefore);
      }
    }
    consume(); // LOOP

    push(Context.LOOP_BODY);
    processBeginBlock();
    pop();

    if (peek().value === 'END') {
      consume();
      if (peek().value === 'LOOP') consume();
      const label = peek().type === TokenType.IDENTIFIER ? ' ' + applyIdentifierCase(consume().raw, cfg) : '';
      if (peek().type === TokenType.SEMICOLON) consume();
      emit(indentStr() + applyKeywordCase('END LOOP', cfg) + label + ';');
    }
  }

  function processWhileLoop(blankBefore: number): void {
    consume(); // WHILE
    const condTokens = collectUntil(tok => tok.value === 'LOOP' && tok.type === TokenType.KEYWORD);
    const whileKw = applyKeywordCase('WHILE', cfg);

    if (cfg.loopOnNewLine) {
      emit(indentStr() + whileKw + ' ' + inlineTokens(condTokens), blankBefore);
      emit(indentStr() + applyKeywordCase('LOOP', cfg));
    } else {
      emit(indentStr() + whileKw + ' ' + inlineTokens(condTokens) + ' ' + applyKeywordCase('LOOP', cfg), blankBefore);
    }
    consume(); // LOOP

    push(Context.LOOP_BODY);
    processBeginBlock();
    pop();

    if (peek().value === 'END') {
      consume();
      if (peek().value === 'LOOP') consume();
      if (peek().type === TokenType.SEMICOLON) consume();
      emit(indentStr() + applyKeywordCase('END LOOP', cfg) + ';');
    }
  }

  function processSubprogram(): void {
    // PROCEDURE/FUNCTION name [(params)] [RETURN type] IS/AS [DECLARE] BEGIN ... END [name];
    const kwTok = consume(); // PROCEDURE or FUNCTION
    const kw = applyKeywordCase(kwTok.value, cfg);
    const blanks = blanksMap.get(pos - 1) ?? 0;

    // Name
    const nameTok = consume();
    const name = applyIdentifierCase(nameTok.raw, cfg);

    let header = indentStr() + kw + ' ' + name;

    // Parameters
    if (peek().type === TokenType.LPAREN) {
      const paramResult = formatParams(cfg);
      header += paramResult;
    }

    // RETURN type
    if (peek().value === 'RETURN') {
      consume();
      const retType = collectUntil(tok => tok.value === 'IS' || tok.value === 'AS' || tok.type === TokenType.SEMICOLON);
      header += ' ' + applyKeywordCase('RETURN', cfg) + ' ' + inlineTokens(retType);
    }

    // IS / AS / ;
    if (peek().value === 'IS' || peek().value === 'AS') {
      const isAs = consume();
      header += ' ' + applyKeywordCase(isAs.value, cfg);
      emit(header, blanks);

      push(Context.DECLARE_SECTION);
      processDeclarativeSection();

      if (peek().value === 'BEGIN') {
        consume();
        emit(indentStr(-1) + applyKeywordCase('BEGIN', cfg));
        processBeginBlock();

        // EXCEPTION
        if (peek().value === 'EXCEPTION') {
          consume();
          emit(indentStr(-1) + applyKeywordCase('EXCEPTION', cfg));
          processExceptionSection();
        }

        pop(); // DECLARE_SECTION

        // END [name]
        if (peek().value === 'END') {
          consume();
          let endLabel = '';
          if (peek().type === TokenType.IDENTIFIER) {
            endLabel = ' ' + applyIdentifierCase(consume().raw, cfg);
          }
          if (peek().type === TokenType.SEMICOLON) consume();
          emit(indentStr() + applyKeywordCase('END', cfg) + endLabel + ';');
        }
      } else {
        pop();
      }
    } else if (peek().type === TokenType.SEMICOLON) {
      consume(); // forward declaration
      header += ';';
      emit(header, blanks);
    } else {
      emit(header, blanks);
    }
  }

  function formatParams(cfg: BeautifierConfig): string {
    consume(); // (
    // Manually collect until the matching outer ), tracking nested paren depth
    const paramTokens: Token[] = [];
    let paramDepth = 0;
    while (!isDone()) {
      const pt = peek();
      if (pt.type === TokenType.LPAREN) { paramDepth++; paramTokens.push(consume()); }
      else if (pt.type === TokenType.RPAREN) {
        if (paramDepth === 0) { consume(); break; } // outer closing )
        paramDepth--;
        paramTokens.push(consume());
      } else {
        paramTokens.push(consume());
      }
    }

    if (paramTokens.length === 0) return '()';

    // Split on commas at depth 0
    const parts: Token[][] = [];
    let current: Token[] = [];
    let depth = 0;
    for (const t of paramTokens) {
      if (t.type === TokenType.LPAREN) depth++;
      else if (t.type === TokenType.RPAREN) depth--;
      if (depth === 0 && t.type === TokenType.COMMA) {
        parts.push(current); current = [];
      } else {
        current.push(t);
      }
    }
    if (current.length > 0) parts.push(current);

    if (parts.length === 1) {
      return '(' + inlineTokens(parts[0]) + ')';
    }

    // Multi-line params
    const paramLines: ParamLine[] = parts.map((part, idx) => {
      // name [IN|OUT|IN OUT] type [DEFAULT|:= val]
      let pi = 0;
      const name = pi < part.length ? applyIdentifierCase(part[pi++].raw, cfg) : '';

      // Direction
      let direction = '';
      if (pi < part.length && (part[pi].value === 'IN' || part[pi].value === 'OUT')) {
        if (part[pi].value === 'IN' && pi + 1 < part.length && part[pi + 1].value === 'OUT') {
          direction = applyKeywordCase('IN', cfg) + ' ' + applyKeywordCase('OUT', cfg);
          pi += 2;
        } else {
          direction = applyKeywordCase(part[pi++].value, cfg);
        }
      }
      // NOCOPY
      if (pi < part.length && part[pi].value === 'NOCOPY') pi++;

      // type: collect until DEFAULT or :=
      const typeToks: Token[] = [];
      while (pi < part.length && part[pi].value !== 'DEFAULT' && part[pi].type !== TokenType.ASSIGNMENT_OP) {
        typeToks.push(part[pi++]);
      }
      const dataType = inlineTokens(typeToks);

      // default
      let defaultVal = '';
      if (pi < part.length) {
        if (part[pi].value === 'DEFAULT') pi++;
        else if (part[pi].type === TokenType.ASSIGNMENT_OP) pi++;
        defaultVal = inlineTokens(part.slice(pi));
      }

      const paramIndent = indentStr() + ' '.repeat(cfg.indent);

      return {
        indent: paramIndent,
        name,
        direction,
        dataType,
        defaultVal,
        hasComma: idx < parts.length - 1,
        comment: '',
      };
    });

    const aligned = cfg.parameterDeclarationList.align && paramLines.length > 1
      ? alignParams(paramLines)
      : paramLines.map(p => {
          const dir = p.direction ? ' ' + p.direction : '';
          const type = p.dataType ? ' ' + p.dataType : '';
          const def = p.defaultVal ? ' := ' + p.defaultVal : '';
          const comma = p.hasComma ? ',' : '';
          return (`${p.indent}${p.name}${dir}${type}${def}`).trimEnd() + comma;
        });

    return '\n' + indentStr() + '(\n' + aligned.join('\n') + '\n' + indentStr() + ')';
  }

  function processExceptionSection(): void {
    while (!isDone() && peek().value !== 'END') {
      const t = peek();
      const blanks = blanksMap.get(pos) ?? 0;
      if (t.value === 'WHEN' && t.type === TokenType.KEYWORD) {
        consume();
        const whenCond = collectUntil(tok => tok.value === 'THEN' && tok.type === TokenType.KEYWORD);
        consume(); // THEN
        emit(indentStr() + applyKeywordCase('WHEN', cfg) + ' ' + inlineTokens(whenCond) + ' ' + applyKeywordCase('THEN', cfg), blanks);
        push(Context.BEGIN_BLOCK);
        processBeginBlock();
        pop();
      } else if (t.type === TokenType.LINE_COMMENT || t.type === TokenType.BLOCK_COMMENT) {
        emit(indentStr() + consume().raw, blanks);
      } else {
        break;
      }
    }
  }

  // ─── Top-level processing ─────────────────────────────────────────────────

  while (!isDone()) {
    const t = peek();
    const blanks = blanksMap.get(pos) ?? 0;

    if (t.type === TokenType.LINE_COMMENT || t.type === TokenType.BLOCK_COMMENT) {
      emit(indentStr() + consume().raw, blanks);
      continue;
    }

    if (t.type === TokenType.SEMICOLON) {
      consume(); continue;
    }

    // CREATE [OR REPLACE] PROCEDURE/FUNCTION/PACKAGE ...
    if (t.value === 'CREATE' && t.type === TokenType.KEYWORD) {
      consume();
      let header = applyKeywordCase('CREATE', cfg);
      if (peek().value === 'OR') {
        consume();
        if (peek().value === 'REPLACE') consume();
        header += ' ' + applyKeywordCase('OR REPLACE', cfg);
      }
      // The next token should be PROCEDURE, FUNCTION, PACKAGE, TYPE, TRIGGER
      if (peek().type === TokenType.KEYWORD || peek().type === TokenType.IDENTIFIER) {
        const subKw = consume();
        // Check for PACKAGE BODY
        const isPackageBody = subKw.value === 'PACKAGE';
        let objectType = applyKeywordCase(subKw.value, cfg);
        if (subKw.value === 'PACKAGE' && peek().value === 'BODY') {
          objectType += ' ' + applyKeywordCase(consume().value, cfg);
        }

        // Name
        const nameTok = consume();
        const name = applyIdentifierCase(nameTok.raw, cfg);

        let fullHeader = header + ' ' + objectType + ' ' + name;
        // Parameters
        if (peek().type === TokenType.LPAREN) {
          fullHeader += formatParams(cfg);
        }
        // RETURN
        if (peek().value === 'RETURN') {
          consume();
          const retType = collectUntil(tok => tok.value === 'IS' || tok.value === 'AS' || tok.type === TokenType.SEMICOLON);
          fullHeader += ' ' + applyKeywordCase('RETURN', cfg) + ' ' + inlineTokens(retType);
        }

        // IS/AS
        if (peek().value === 'IS' || peek().value === 'AS') {
          const isAs = consume();
          fullHeader += ' ' + applyKeywordCase(isAs.value, cfg);
          emit(fullHeader, blanks);

          push(Context.DECLARE_SECTION);
          processDeclarativeSection();

          if (peek().value === 'BEGIN') {
            consume();
            emit(applyKeywordCase('BEGIN', cfg));
            // Run body at same level as declarations (DECLARE_SECTION level)
            processBeginBlock();

            if (peek().value === 'EXCEPTION') {
              consume();
              emit(applyKeywordCase('EXCEPTION', cfg));
              processExceptionSection();
            }
            pop(); // DECLARE_SECTION
          } else {
            pop();
          }
        } else {
          emit(fullHeader, blanks);
        }

        if (peek().value === 'END') {
          consume();
          let endLabel = '';
          if (peek().type === TokenType.IDENTIFIER) {
            endLabel = ' ' + applyIdentifierCase(consume().raw, cfg);
          }
          if (peek().type === TokenType.SEMICOLON) consume();
          emit(applyKeywordCase('END', cfg) + endLabel + ';', isPackageBody ? 1 : 0);
        }
      }
      // Preserve trailing /
      if (peek().type === TokenType.DIVIDE) { consume(); emit('/'); }
      continue;
    }

    // Anonymous block: DECLARE or BEGIN
    if (t.value === 'DECLARE' && t.type === TokenType.KEYWORD) {
      consume();
      emit(applyKeywordCase('DECLARE', cfg), blanks);
      push(Context.DECLARE_SECTION);
      processDeclarativeSection();
      pop();
    }

    if (peek().value === 'BEGIN' && peek().type === TokenType.KEYWORD) {
      consume();
      emit(applyKeywordCase('BEGIN', cfg), blanks);
      push(Context.BEGIN_BLOCK);
      processBeginBlock();
      pop();

      if (peek().value === 'EXCEPTION') {
        consume();
        emit(applyKeywordCase('EXCEPTION', cfg));
        processExceptionSection();
      }

      if (peek().value === 'END') {
        consume();
        let endLabel = '';
        if (peek().type === TokenType.IDENTIFIER) {
          endLabel = ' ' + applyIdentifierCase(consume().raw, cfg);
        }
        if (peek().type === TokenType.SEMICOLON) consume();
        emit(applyKeywordCase('END', cfg) + endLabel + ';');
      }
      // Preserve trailing /
      if (peek().type === TokenType.DIVIDE) { consume(); emit('/'); }
      continue;
    }

    // Standalone DML at top level
    if ((t.value === 'SELECT' || t.value === 'INSERT' || t.value === 'UPDATE' ||
         t.value === 'DELETE' || t.value === 'MERGE') && t.type === TokenType.KEYWORD) {
      const stmtTokens = collectUntil(tok => tok.type === TokenType.SEMICOLON, false);
      const dmlFormatted = formatDML(stmtTokens, cfg, '');
      emit(dmlFormatted, blanks);
      if (peek().type === TokenType.SEMICOLON) {
        consume();
        if (lines.length > 0) lines[lines.length - 1] += ';';
      }
      if (peek().type === TokenType.DIVIDE) { consume(); emit('/'); }
      continue;
    }

    // Unknown top-level token — collect tokens on the same source line and emit as-is.
    // If a semicolon appears on the same line, include it and stop.
    // This handles SQL*Plus directives like WHENEVER, PROMPT, SET, SPOOL, etc.
    {
      const firstLine = t.line;
      const unknownToks: Token[] = [];
      while (!isDone()) {
        const ut = peek();
        // Stop at next line (comment or token on different line)
        if (ut.line !== firstLine) break;
        // Stop at LINE_COMMENT on same line (emit it separately next iteration)
        if (ut.type === TokenType.LINE_COMMENT || ut.type === TokenType.BLOCK_COMMENT) break;
        unknownToks.push(consume());
        if (ut.type === TokenType.SEMICOLON) break;
      }
      if (unknownToks.length > 0) {
        const parts: string[] = [];
        for (let ui = 0; ui < unknownToks.length; ui++) {
          const ut = unknownToks[ui];
          const un = unknownToks[ui + 1];
          parts.push(ut.raw);
          if (un && un.type !== TokenType.SEMICOLON) parts.push(' ');
        }
        emit(parts.join(''), blanks);
      }
    }
  }

  // Normalize empty lines
  const result: string[] = [];
  let consecutive = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      consecutive++;
      if (consecutive <= cfg.emptyLines) result.push('');
    } else {
      consecutive = 0;
      result.push(line.trimEnd());
    }
  }

  return result.join('\n').trimEnd() + '\n';
}

function computeBlanksBefore(tokens: Token[]): number[] {
  const result: number[] = new Array(tokens.length).fill(0);
  let newlineCount = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === TokenType.NEWLINE) {
      newlineCount++;
    } else if (t.type === TokenType.WHITESPACE) {
      // ignore
    } else {
      // blank lines = newlines - 1 (one newline = end of previous line, not blank)
      result[i] = Math.max(0, newlineCount - 1);
      newlineCount = 0;
    }
  }
  return result;
}
