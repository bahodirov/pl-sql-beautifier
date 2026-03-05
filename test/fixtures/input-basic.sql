declare
  v_name varchar2(100);
  v_count number;
  v_flag boolean := false;
begin
  v_name := 'John';
  v_count := 0;


  if v_count > 0 then
    v_name := to_char(v_count);
  elsif v_count = 0 then
    v_name := 'zero';
  else
    null;
  end if;

  for i in 1..10 loop
    v_count := v_count + i;
  end loop;

  select count(*) into v_count from dual where 1=1 and 2=2;
exception
  when no_data_found then
    null;
  when others then
    raise;
end;
