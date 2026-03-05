export enum TokenType {
  KEYWORD,
  IDENTIFIER,
  QUOTED_IDENTIFIER,
  STRING_LITERAL,
  NUMBER_LITERAL,
  LINE_COMMENT,
  BLOCK_COMMENT,
  ASSIGNMENT_OP,   // :=
  COMPARISON_OP,   // = < > <> != <= >=
  CONCAT_OP,       // ||
  ARROW_OP,        // =>
  DOT,             // .
  LPAREN,          // (
  RPAREN,          // )
  COMMA,           // ,
  SEMICOLON,       // ;
  COLON,           // :
  PLUS,            // +
  MINUS,           // -
  STAR,            // *
  DIVIDE,          // /
  SLASH,           // / as statement terminator
  WHITESPACE,
  NEWLINE,
  EOF
}

export interface Token {
  type: TokenType;
  raw: string;
  value: string;
  line: number;
  col: number;
}
