const { format, DEFAULT_CONFIG } = require('./out/formatter/index.js');

// Test: for r in (with CTE as (...) select ...) loop
const src = `create or replace package body Test_Pkg is
  Procedure Test_Proc is
  begin
    for r in (with Cte as
                (select t.Id,
                        t.Name
                   from My_Table t
                  where t.Active = 'Y')
              select c.Id,
                     c.Name
                from Cte c
               order by c.Name)
    loop
      null;
    end loop;
  end;
end;
/`;

const out = format(src, DEFAULT_CONFIG);
console.log('=== INPUT ===');
console.log(src);
console.log('\n=== OUTPUT ===');
console.log(out);
console.log('\n=== Are they similar? ===');
const outLines = out.split('\n');
outLines.forEach((ln, i) => console.log(`  ${i+1}: ${ln}`));
