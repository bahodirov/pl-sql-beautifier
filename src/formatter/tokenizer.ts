import { Token, TokenType } from './token';
import { ALL_KEYWORDS } from './keywords';

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let col = 1;

  function peek(offset = 0): string {
    return src[pos + offset] ?? '';
  }

  function advance(): string {
    const ch = src[pos++];
    if (ch === '\n') { line++; col = 1; } else { col++; }
    return ch;
  }

  function makeToken(type: TokenType, raw: string, startLine: number, startCol: number): Token {
    const value = (type === TokenType.KEYWORD) ? raw.toUpperCase() : raw;
    return { type, raw, value, line: startLine, col: startCol };
  }

  while (pos < src.length) {
    const startLine = line;
    const startCol = col;
    const ch = peek();

    // Newline
    if (ch === '\n') {
      advance();
      tokens.push(makeToken(TokenType.NEWLINE, '\n', startLine, startCol));
      continue;
    }

    // Carriage return (skip)
    if (ch === '\r') {
      advance();
      continue;
    }

    // Whitespace
    if (ch === ' ' || ch === '\t') {
      let ws = '';
      while (pos < src.length && (peek() === ' ' || peek() === '\t')) {
        ws += advance();
      }
      tokens.push(makeToken(TokenType.WHITESPACE, ws, startLine, startCol));
      continue;
    }

    // Line comment --
    if (ch === '-' && peek(1) === '-') {
      let comment = '';
      while (pos < src.length && peek() !== '\n') {
        comment += advance();
      }
      tokens.push(makeToken(TokenType.LINE_COMMENT, comment, startLine, startCol));
      continue;
    }

    // Block comment /* ... */
    if (ch === '/' && peek(1) === '*') {
      let comment = advance() + advance(); // /*
      while (pos < src.length) {
        if (peek() === '*' && peek(1) === '/') {
          comment += advance() + advance();
          break;
        }
        comment += advance();
      }
      tokens.push(makeToken(TokenType.BLOCK_COMMENT, comment, startLine, startCol));
      continue;
    }

    // Quoted identifier "..."
    if (ch === '"') {
      let qi = advance();
      while (pos < src.length) {
        const c = advance();
        qi += c;
        if (c === '"') {
          if (peek() === '"') { qi += advance(); } // escaped ""
          else { break; }
        }
      }
      const tok: Token = { type: TokenType.QUOTED_IDENTIFIER, raw: qi, value: qi, line: startLine, col: startCol };
      tokens.push(tok);
      continue;
    }

    // String literal: 'normal', q'[...]', n'...', nq'[...]'
    if (
      ch === '\'' ||
      (ch.toLowerCase() === 'n' && peek(1) === '\'') ||
      (ch.toLowerCase() === 'q' && peek(1) === '\'') ||
      (ch.toLowerCase() === 'n' && peek(1).toLowerCase() === 'q' && peek(2) === '\'')
    ) {
      let str = '';
      // Determine prefix
      let isQ = false;
      if (ch.toLowerCase() === 'n' && peek(1).toLowerCase() === 'q') {
        str += advance() + advance(); // nq
        isQ = true;
      } else if (ch.toLowerCase() === 'q') {
        str += advance(); // q
        isQ = true;
      } else if (ch.toLowerCase() === 'n') {
        str += advance(); // n
      }
      str += advance(); // opening '

      if (isQ) {
        // q'[delim]...[delim]'  where delim pairs: [] {} () <>
        const delim = advance();
        str += delim;
        const closeDelim = delim === '[' ? ']' : delim === '{' ? '}' : delim === '(' ? ')' : delim === '<' ? '>' : delim;
        while (pos < src.length) {
          const c = advance();
          str += c;
          if (c === closeDelim && peek() === '\'') {
            str += advance(); // closing '
            break;
          }
        }
      } else {
        while (pos < src.length) {
          const c = advance();
          str += c;
          if (c === '\'') {
            if (peek() === '\'') { str += advance(); } // escaped ''
            else { break; }
          }
        }
      }
      tokens.push(makeToken(TokenType.STRING_LITERAL, str, startLine, startCol));
      continue;
    }

    // Number
    if (ch >= '0' && ch <= '9') {
      let num = '';
      while (pos < src.length && ((peek() >= '0' && peek() <= '9') || peek() === '.')) {
        num += advance();
      }
      if ((peek() === 'e' || peek() === 'E') && pos < src.length) {
        num += advance();
        if (peek() === '+' || peek() === '-') num += advance();
        while (pos < src.length && peek() >= '0' && peek() <= '9') num += advance();
      }
      tokens.push(makeToken(TokenType.NUMBER_LITERAL, num, startLine, startCol));
      continue;
    }

    // Two-char operators first
    if (ch === ':' && peek(1) === '=') {
      tokens.push(makeToken(TokenType.ASSIGNMENT_OP, ':=', startLine, startCol));
      advance(); advance();
      continue;
    }
    if (ch === '=' && peek(1) === '>') {
      tokens.push(makeToken(TokenType.ARROW_OP, '=>', startLine, startCol));
      advance(); advance();
      continue;
    }
    if (ch === '|' && peek(1) === '|') {
      tokens.push(makeToken(TokenType.CONCAT_OP, '||', startLine, startCol));
      advance(); advance();
      continue;
    }
    if (ch === '<' && peek(1) === '>') {
      tokens.push(makeToken(TokenType.COMPARISON_OP, '<>', startLine, startCol));
      advance(); advance();
      continue;
    }
    if (ch === '!' && peek(1) === '=') {
      tokens.push(makeToken(TokenType.COMPARISON_OP, '!=', startLine, startCol));
      advance(); advance();
      continue;
    }
    if (ch === '<' && peek(1) === '=') {
      tokens.push(makeToken(TokenType.COMPARISON_OP, '<=', startLine, startCol));
      advance(); advance();
      continue;
    }
    if (ch === '>' && peek(1) === '=') {
      tokens.push(makeToken(TokenType.COMPARISON_OP, '>=', startLine, startCol));
      advance(); advance();
      continue;
    }

    // Single-char operators
    if (ch === '=') { advance(); tokens.push(makeToken(TokenType.COMPARISON_OP, '=', startLine, startCol)); continue; }
    if (ch === '<') { advance(); tokens.push(makeToken(TokenType.COMPARISON_OP, '<', startLine, startCol)); continue; }
    if (ch === '>') { advance(); tokens.push(makeToken(TokenType.COMPARISON_OP, '>', startLine, startCol)); continue; }
    if (ch === '+') { advance(); tokens.push(makeToken(TokenType.PLUS, '+', startLine, startCol)); continue; }
    if (ch === '-') { advance(); tokens.push(makeToken(TokenType.MINUS, '-', startLine, startCol)); continue; }
    if (ch === '*') { advance(); tokens.push(makeToken(TokenType.STAR, '*', startLine, startCol)); continue; }
    if (ch === '/') { advance(); tokens.push(makeToken(TokenType.DIVIDE, '/', startLine, startCol)); continue; }
    if (ch === '.') { advance(); tokens.push(makeToken(TokenType.DOT, '.', startLine, startCol)); continue; }
    if (ch === ',') { advance(); tokens.push(makeToken(TokenType.COMMA, ',', startLine, startCol)); continue; }
    if (ch === ';') { advance(); tokens.push(makeToken(TokenType.SEMICOLON, ';', startLine, startCol)); continue; }
    if (ch === ':') { advance(); tokens.push(makeToken(TokenType.COLON, ':', startLine, startCol)); continue; }
    if (ch === '(') { advance(); tokens.push(makeToken(TokenType.LPAREN, '(', startLine, startCol)); continue; }
    if (ch === ')') { advance(); tokens.push(makeToken(TokenType.RPAREN, ')', startLine, startCol)); continue; }
    if (ch === '%') {
      // Handle %TYPE, %ROWTYPE
      let word = advance(); // %
      while (pos < src.length && /[A-Za-z_]/.test(peek())) {
        word += advance();
      }
      tokens.push({ type: TokenType.IDENTIFIER, raw: word, value: word.toUpperCase(), line: startLine, col: startCol });
      continue;
    }

    // Word (identifier or keyword)
    if (/[A-Za-z_]/.test(ch)) {
      let word = '';
      while (pos < src.length && /[A-Za-z0-9_$#]/.test(peek())) {
        word += advance();
      }
      const upper = word.toUpperCase();
      const type = ALL_KEYWORDS.has(upper) ? TokenType.KEYWORD : TokenType.IDENTIFIER;
      tokens.push({ type, raw: word, value: upper, line: startLine, col: startCol });
      continue;
    }

    // Unknown character - skip
    advance();
  }

  tokens.push({ type: TokenType.EOF, raw: '', value: '', line, col });
  return tokens;
}

export class TokenStream {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    // Filter whitespace/newlines for the main formatter
    this.tokens = tokens.filter(
      t => t.type !== TokenType.WHITESPACE && t.type !== TokenType.NEWLINE
    );
  }

  peek(offset = 0): Token {
    const idx = this.pos + offset;
    return idx < this.tokens.length
      ? this.tokens[idx]
      : { type: TokenType.EOF, raw: '', value: '', line: 0, col: 0 };
  }

  consume(): Token {
    if (this.pos < this.tokens.length) return this.tokens[this.pos++];
    return { type: TokenType.EOF, raw: '', value: '', line: 0, col: 0 };
  }

  isDone(): boolean {
    return this.pos >= this.tokens.length || this.peek().type === TokenType.EOF;
  }

  /** How many blank lines were between the last consumed token and next token in original source */
  blankLinesBefore(): number {
    // We lost this info by filtering; restore by keeping originals
    return 0;
  }
}

export class RawTokenStream {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  peek(offset = 0): Token {
    const idx = this.pos + offset;
    return idx < this.tokens.length
      ? this.tokens[idx]
      : { type: TokenType.EOF, raw: '', value: '', line: 0, col: 0 };
  }

  consume(): Token {
    if (this.pos < this.tokens.length) return this.tokens[this.pos++];
    return { type: TokenType.EOF, raw: '', value: '', line: 0, col: 0 };
  }

  isDone(): boolean {
    return this.pos >= this.tokens.length || this.peek().type === TokenType.EOF;
  }
}
