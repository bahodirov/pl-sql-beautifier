export interface DeclLine {
  indent: string;
  identifier: string;
  dataType: string;
  constraint: string;    // CONSTANT, NOT NULL, etc.
  defaultVal: string;    // := value or DEFAULT value
  comment: string;       // trailing -- comment
  semicolon: string;     // ; or empty
}

export interface AssignLine {
  indent: string;
  lhs: string;
  rhs: string;
  comment: string;
}

export interface ParamLine {
  indent: string;
  name: string;
  direction: string;   // IN, OUT, IN OUT, empty
  dataType: string;
  defaultVal: string;
  hasComma: boolean;
  comment: string;
}

export function alignDeclarations(lines: DeclLine[]): string[] {
  const maxIdLen = Math.max(...lines.map(l => l.identifier.length));

  return lines.map(l => {
    const id      = l.identifier.padEnd(maxIdLen);
    const typeStr = l.constraint ? `${l.constraint} ${l.dataType}` : l.dataType;
    const def     = l.defaultVal ? ` := ${l.defaultVal}` : '';
    const comment = l.comment ? `  ${l.comment}` : '';
    return `${l.indent}${id} ${typeStr}${def}${l.semicolon}${comment}`;
  });
}

export function alignAssignments(lines: AssignLine[]): string[] {
  const maxLHSLen = Math.max(...lines.map(l => l.lhs.length));
  return lines.map(l => {
    const lhs = l.lhs.padEnd(maxLHSLen);
    const comment = l.comment ? `  ${l.comment}` : '';
    return `${l.indent}${lhs} := ${l.rhs};${comment}`;
  });
}

export function alignParams(lines: ParamLine[]): string[] {
  const maxNameLen = Math.max(...lines.map(l => l.name.length));

  return lines.map(l => {
    const name    = l.name.padEnd(maxNameLen);
    const dir     = l.direction ? ' ' + l.direction : '';
    const type    = l.dataType  ? ' ' + l.dataType  : '';
    const def     = l.defaultVal ? ` := ${l.defaultVal}` : '';
    const comma   = l.hasComma ? ',' : '';
    const comment = l.comment ? `  ${l.comment}` : '';
    const base = (`${l.indent}${name}${dir}${type}${def}`).trimEnd();
    return base + comma + comment;
  });
}

export function alignUpdateSet(lines: { indent: string; col: string; val: string; comment: string; hasComma: boolean }[]): string[] {
  const maxColLen = Math.max(...lines.map(l => l.col.length));
  return lines.map(l => {
    const col = l.col.padEnd(maxColLen);
    const comma = l.hasComma ? ',' : '';
    const comment = l.comment ? `  ${l.comment}` : '';
    return `${l.indent}${col} = ${l.val}${comma}${comment}`;
  });
}
