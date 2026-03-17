const { format, DEFAULT_CONFIG } = require('./out/formatter/index.js');

// Reproduce the WITH inside FOR loop issue
// The bug: processForLoop calls collectUntil(LOOP)
// That grabs all tokens up to LOOP, including the entire WITH clause.
// Then isCursorFor checks: headerTokens[2] === LPAREN and headerTokens[3] === WITH/SELECT.
// The inner select tokens are headerTokens.slice(3, len-1) — the full WITH+SELECT+FROM+WHERE+... all as flat tokens.
// Then formatDML is called with those tokens. formatDML checks firstKw === 'WITH' -> no handler exists.
// The fallback is: return baseIndent + tokensToStr(stmtTokens, cfg) → puts everything on ONE LINE.

// Evidence from dml-formatter.ts line 280-307:
//   if (firstKw === 'SELECT') -> formatSelect
//   if (firstKw === 'INSERT') -> ...
//   if (firstKw === 'WITH')   -> NO HANDLER -> falls through to line 306:
//     return baseIndent + tokensToStr(stmtTokens, cfg);  // <-- entire WITH on one line!

const src = `create or replace package body Test_Pkg is
  Procedure Test_Proc is
  begin
    for r in (select t.Id from My_Table t where t.Active = 'Y')
    loop null; end loop;
  end;
end;
/`;

const out = format(src, DEFAULT_CONFIG);
console.log('=== SELECT in FOR LOOP (no WITH) ===');
console.log(out);
console.log();

const src2 = `create or replace package body Test_Pkg is
  Procedure Test_Proc is
  begin
    for r in (with Cte as (select 1 Id from dual)
              select * from Cte)
    loop null; end loop;
  end;
end;
/`;
const out2 = format(src2, DEFAULT_CONFIG);
console.log('=== WITH in FOR LOOP ===');
console.log(out2);
console.log();
console.log('BUG CONFIRMED: formatDML has no WITH handler -> falls to tokensToStr -> one line');
