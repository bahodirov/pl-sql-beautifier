export interface ItemListConfig {
  format: 1 | 2;       // 1=each on new line, 2=single line if fits
  align: boolean;
  commaAfter: boolean;
  atLeftMargin: boolean;
}

export interface BeautifierConfig {
  rightMargin: number;
  indent: number;
  useTabCharacter: boolean;
  tabCharacterSize: number;
  alignDeclarationGroups: boolean;
  alignAssignmentGroups: boolean;
  keywordCase: 'UPPER' | 'LOWER' | 'INIT_CAP' | 'PRESERVE';
  identifierCase: 'PRESERVE' | 'UPPER' | 'LOWER' | 'INIT_CAP';
  useSpecialCase: boolean;
  specialCaseWords: Map<string, string>; // lowercase key -> original value
  itemList: ItemListConfig;
  emptyLines: number;
  thenOnNewLine: boolean;
  loopOnNewLine: boolean;
  dml: {
    leftAlignKeywords: boolean;
    leftAlignItems: boolean;
    onOneLineIfPossible: boolean;
    where: {
      splitAndOr: boolean;
      andOrAfterExpression: boolean;
      andOrUnderWhere: boolean;
    };
    joinSplitBeforeOn: boolean;
    insertItemList: ItemListConfig;
    selectItemList: ItemListConfig;
    updateItemList: ItemListConfig;
  };
  parameterDeclarationList: ItemListConfig;
  recordFieldList: ItemListConfig;
  splitAndOr: boolean;
  andOrAfterExpression: boolean;
}

export const DEFAULT_CONFIG: BeautifierConfig = {
  rightMargin: 100,
  indent: 2,
  useTabCharacter: false,
  tabCharacterSize: 2,
  alignDeclarationGroups: true,
  alignAssignmentGroups: false,
  keywordCase: 'LOWER',
  identifierCase: 'INIT_CAP',
  useSpecialCase: true,
  specialCaseWords: new Map([
    // PL/SQL structural keywords
    ['ex',        'ex'],
    ['function',  'Function'],
    ['out',       'out'],
    ['procedure', 'Procedure'],
    // Conversion functions (keep lowercase to match common Oracle style)
    ['to_char',   'to_char'],
    ['to_date',   'to_date'],
    ['to_number', 'to_number'],
    // ── Oracle built-in functions → Init_Cap ──────────────────────────────
    // String
    ['lower',           'Lower'],
    ['upper',           'Upper'],
    ['initcap',         'Initcap'],
    ['length',          'Length'],
    ['lengthb',         'Lengthb'],
    ['substr',          'Substr'],
    ['substrb',         'Substrb'],
    ['instr',           'Instr'],
    ['instrb',          'Instrb'],
    ['replace',         'Replace'],
    ['trim',            'Trim'],
    ['ltrim',           'Ltrim'],
    ['rtrim',           'Rtrim'],
    ['lpad',            'Lpad'],
    ['rpad',            'Rpad'],
    ['concat',          'Concat'],
    ['chr',             'Chr'],
    ['ascii',           'Ascii'],
    ['translate',       'Translate'],
    ['soundex',         'Soundex'],
    // Regex
    ['regexp_like',     'Regexp_Like'],
    ['regexp_instr',    'Regexp_Instr'],
    ['regexp_replace',  'Regexp_Replace'],
    ['regexp_substr',   'Regexp_Substr'],
    ['regexp_count',    'Regexp_Count'],
    // Numeric
    ['abs',    'Abs'],
    ['ceil',   'Ceil'],
    ['floor',  'Floor'],
    ['round',  'Round'],
    ['trunc',  'Trunc'],
    ['mod',    'Mod'],
    ['power',  'Power'],
    ['sqrt',   'Sqrt'],
    ['sign',   'Sign'],
    ['greatest', 'Greatest'],
    ['least',    'Least'],
    ['nanvl',    'Nanvl'],
    // Date / timestamp
    ['sysdate',           'Sysdate'],
    ['systimestamp',      'Systimestamp'],
    ['current_date',      'Current_Date'],
    ['current_timestamp', 'Current_Timestamp'],
    ['add_months',        'Add_Months'],
    ['months_between',    'Months_Between'],
    ['next_day',          'Next_Day'],
    ['last_day',          'Last_Day'],
    ['extract',           'Extract'],
    ['to_timestamp',      'To_Timestamp'],
    ['to_timestamp_tz',   'To_Timestamp_Tz'],
    ['from_tz',           'From_Tz'],
    // Null / conditional
    ['nvl',     'Nvl'],
    ['nvl2',    'Nvl2'],
    ['nullif',  'Nullif'],
    ['coalesce','Coalesce'],
    ['decode',  'Decode'],
    ['lnnvl',   'Lnnvl'],
    // Aggregate
    ['count',    'Count'],
    ['sum',      'Sum'],
    ['avg',      'Avg'],
    ['min',      'Min'],
    ['max',      'Max'],
    ['median',   'Median'],
    ['stddev',   'Stddev'],
    ['variance', 'Variance'],
    ['listagg',  'Listagg'],
    ['wm_concat','Wm_Concat'],
    // Analytic / window
    ['row_number',   'Row_Number'],
    ['rank',         'Rank'],
    ['dense_rank',   'Dense_Rank'],
    ['percent_rank', 'Percent_Rank'],
    ['cume_dist',    'Cume_Dist'],
    ['ntile',        'Ntile'],
    ['lag',          'Lag'],
    ['lead',         'Lead'],
    ['first_value',  'First_Value'],
    ['last_value',   'Last_Value'],
    ['nth_value',    'Nth_Value'],
    // Type conversion / misc
    ['cast',       'Cast'],
    ['convert',    'Convert'],
    ['hextoraw',   'Hextoraw'],
    ['rawtohex',   'Rawtohex'],
    ['dump',       'Dump'],
    ['vsize',      'Vsize'],
    ['sys_guid',   'Sys_Guid'],
    ['uid',        'Uid'],
    ['user',       'User'],
    ['userenv',    'Userenv'],
    ['sys_context','Sys_Context'],
  ]),
  itemList: { format: 1, align: true, commaAfter: true, atLeftMargin: false },
  emptyLines: 1,
  thenOnNewLine: false,
  loopOnNewLine: true,
  dml: {
    leftAlignKeywords: false,
    leftAlignItems: false,
    onOneLineIfPossible: false,
    where: {
      splitAndOr: true,
      andOrAfterExpression: false,
      andOrUnderWhere: true,
    },
    joinSplitBeforeOn: true,
    insertItemList: { format: 1, align: false, commaAfter: true, atLeftMargin: false },
    selectItemList: { format: 1, align: true, commaAfter: true, atLeftMargin: false },
    updateItemList: { format: 2, align: true, commaAfter: true, atLeftMargin: false },
  },
  parameterDeclarationList: { format: 2, align: true, commaAfter: true, atLeftMargin: false },
  recordFieldList: { format: 1, align: true, commaAfter: true, atLeftMargin: false },
  splitAndOr: false,
  andOrAfterExpression: false,
};

