const { format, DEFAULT_CONFIG } = require('./out/formatter');

const src = `
  Procedure Init_Deal_With_Person_Data
  (
    i_Company_Id number,
    i_Filial_Id  number,
    i_Person_Id  number
  ) is
  begin
    insert into Ui_Anor1654_Deal_With_Person_Data
      select t.Mml_Id,
             f.Product_Id,
             k.Name,
             nvl(sum(Deal.Sold_Quant), 0) Total_Sold_Quant
        from Mcg_Mml_Headers t
        join Mcg_Filial_Mmls fl
          on fl.Company_Id = t.Company_Id
         and fl.Filial_Id = i_Filial_Id
         and fl.Mml_Id = t.Mml_Id
        join Mcg_Mml_Person_Type_Inventories f
          on f.Company_Id = t.Company_Id
         and f.Mml_Id = t.Mml_Id
        join Mr_Person_Type_Binds d
          on d.Company_Id = f.Company_Id
         and d.Person_Id = i_Person_Id
         and d.Person_Type_Id = f.Person_Type_Id
        join Mr_Products k
          on k.Company_Id = t.Company_Id
         and k.Product_Id = f.Product_Id
    left join (select m.Company_Id, w.Product_Id, w.Sold_Quant, m.Deal_Date from Mdeal_Headers m join Mdeal_Products w
          on w.Company_Id = m.Company_Id
         and w.Deal_Id = m.Deal_Id where m.Company_Id = i_Company_Id
         and m.Filial_Id = i_Filial_Id
         and m.Person_Id = i_Person_Id
         and m.Deal_Kind = Mdeal_Pref.c_Dk_Order
         and m.Base_Status = Mdeal_Pref.c_Ds_Archived) deal on deal.Company_Id = f.Company_Id and deal.Product_Id = f.Product_Id and t.Begin_Date <= deal.Deal_Date and(t.End_Date is null
         or deal.Deal_Date <= t.End_Date)
       where t.Company_Id = i_Company_Id
         and t.State = 'A'
    group by t.Mml_Id, f.Product_Id, k.Name;
  end;
`;

const result = format(src, DEFAULT_CONFIG);
console.log(result);
