// Conformance cases for the spreadsheet engine (SPREADSHEET_DESIGN.md §3): each formula
// was computed by Google Sheets itself (scripts/sheet-conformance.mjs builds the sheet;
// the answers are in sheet-conformance.json) and the engine must give the same answer.
//
// The data block the formulas read (E1:I10):

export const DATA = {
  E: [1, 2, 3, 4, 5, 10, -2, 0.5, null, '="7"'],
  F: ["apple", "Banana", "cherry", "apple", null, "TRUE", 3, "=1/0", '=""', "Apple pie"],
  G: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  H: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
  I: ["1/15/2026", "2/28/2026", "3/31/2026", "12/31/2025", "2/29/2024", "7/4/2026", "11/9/2026", "1/1/2000", "6/30/2026", "10/31/2026"],
};

// A small table with a header row (J1:M8) for QUERY and the database functions.
export const TABLE = {
  J: ["Name", "Ann", "Bob", "Cy", "Dee", "Eve", "Fay", "Gus"],
  K: ["Dept", "Ops", "IT", "Ops", "IT", "HR", "Ops", "IT"],
  L: ["Salary", 50, 70, 55, 90, 40, 65, 80],
  M: ["Start", "1/5/2020", "3/1/2019", "7/15/2021", "11/30/2018", "2/2/2022", "9/9/2020", "4/4/2023"],
};

export const CASES = [
  // arithmetic and operators
  "=1+2*3", "=(1+2)*3", "=-2^2", "=2^-1", "=2^3^2", "=10%", "=50%%", "=1/3", "=0.1+0.2", "=1E+20*10", "=5-\"3\"", "=\"2\"*\"3\"", "=TRUE+1", "=\"a\"&1.5", "=1&TRUE",
  "=\"abc\"=\"ABC\"", "=\"a\"<\"B\"", "=1<\"a\"", "=\"a\"<TRUE", "=1=TRUE", "=E9=0", "=E9=\"\"", "=E9", "=E9+1", "=E9&\"x\"", "=F9", "=F9=E9", "=\"x\"*1", "=1/0", "=0^0", "=(-8)^(1/3)",
  "=E1:E3*2", "=SUM(E1:E3*2)", "=E10+1", "=E10&\"\"", "=-E10", "=F6", "=NOT(F6)", "=F7*2",
  // math
  "=ABS(-3.5)", "=ROUND(2.5)", "=ROUND(-2.5)", "=ROUND(2.675,2)", "=ROUND(1234.5678,-2)", "=ROUNDUP(1.21,1)", "=ROUNDUP(-1.21,1)", "=ROUNDDOWN(-1.29,1)", "=TRUNC(-4.7)", "=TRUNC(3.14159,3)",
  "=INT(-4.5)", "=MOD(10,3)", "=MOD(-10,3)", "=MOD(10,-3)", "=MOD(5.5,2)", "=MOD(1,0)", "=QUOTIENT(-7,2)", "=CEILING(4.2)", "=CEILING(4.2,0.5)", "=CEILING(-4.2,-1)", "=CEILING(-4.2,1)", "=FLOOR(4.7)", "=FLOOR(-4.2,1)", "=FLOOR(4.7,2)",
  "=CEILING.MATH(-4.2)", "=CEILING.MATH(-4.2,1,1)", "=FLOOR.MATH(-4.2)", "=FLOOR.MATH(-4.2,1,1)", "=MROUND(10,3)", "=MROUND(-10,-3)", "=EVEN(1.5)", "=EVEN(-1.5)", "=ODD(2)", "=ODD(-2.1)",
  "=SQRT(16)", "=SQRT(-1)", "=POWER(2,10)", "=EXP(1)", "=LN(10)", "=LOG(8,2)", "=LOG(100)", "=LOG10(0)", "=PI()", "=SIN(PI()/2)", "=COS(0)", "=TAN(PI()/4)", "=ATAN2(1,1)", "=DEGREES(PI())", "=RADIANS(180)",
  "=FACT(5)", "=FACT(5.9)", "=FACTDOUBLE(7)", "=COMBIN(5,2)", "=COMBINA(4,3)", "=GCD(12,18,24)", "=LCM(4,6)", "=SIGN(-3)", "=PRODUCT(E1:E5)", "=SUMSQ(1,2,3)", "=SUMPRODUCT(E1:E3,G1:G3)",
  "=SUMIF(E1:E8,\">2\")", "=SUMIF(F1:F4,\"apple\",G1:G4)", "=SUMIF(F1:F10,\"a*\",G1:G10)", "=SUMIF(F1:F10,\"<>apple\",G1:G10)", "=SUMIF(E1:E10,7,G1:G10)", "=SUMIF(E1:E10,\"7\",G1:G10)", "=SUMIFS(G1:G10,E1:E10,\">=2\",E1:E10,\"<5\")", "=SUMIF(F1:F10,\"\",G1:G10)", "=SUMIF(F1:F10,\"=\",G1:G10)",
  "=SUM(E1:E10)", "=SUM(F1:F10)", "=SUM(\"3\",2)", "=SUM(TRUE,1)", "=SUM(E8:E10)", "=SUM(1,\"x\")", "=SUBTOTAL(9,E1:E5)", "=SUBTOTAL(1,E1:E5)", "=BASE(255,16)", "=BASE(5,2,8)", "=DECIMAL(\"FF\",16)", "=MULTINOMIAL(2,3)",
  "=SUMX2MY2(E1:E3,G1:G3)", "=SUMXMY2(E1:E3,G1:G3)", "=ACOS(2)", "=ASINH(1)", "=COT(1)", "=SEC(0)", "=ISEVEN(-2.5)", "=ISODD(3)",
  // statistics and counting
  "=AVERAGE(E1:E10)", "=AVERAGE(F1:F7)", "=AVERAGEA(E1:E10)", "=AVERAGEIF(E1:E8,\">0\")", "=AVERAGEIFS(G1:G10,E1:E10,\">1\")", "=COUNT(E1:E10)", "=COUNT(F1:F10)", "=COUNT(1,\"2\",\"x\",TRUE)", "=COUNTA(E1:E10)", "=COUNTA(F1:F10)",
  "=COUNTBLANK(E1:F10)", "=COUNTIF(F1:F10,\"apple\")", "=COUNTIF(F1:F10,\"APPLE*\")", "=COUNTIF(F1:F10,\"?pple\")", "=COUNTIF(E1:E10,\">=3\")", "=COUNTIF(E1:E10,\"<>3\")", "=COUNTIF(F1:F10,\"<>\")", "=COUNTIF(F1:F10,\"\")", "=COUNTIF(F1:F10,TRUE)", "=COUNTIF(F1:F10,\"TRUE\")", "=COUNTIF(E1:E10,\"7\")",
  "=COUNTIFS(E1:E10,\">1\",G1:G10,\"<60\")", "=COUNTUNIQUE(F1:F10)", "=COUNTUNIQUE(1,1,2,\"a\",\"A\")", "=MAX(E1:E10)", "=MIN(E1:E10)", "=MAX(F1:F10)", "=MAXA(F1:F7)", "=MINA(F1:F7)", "=MAXIFS(G1:G10,E1:E10,\"<4\")", "=MINIFS(G1:G10,F1:F10,\"apple\")",
  "=MEDIAN(E1:E8)", "=MEDIAN(1,2,3,4)", "=MODE(1,2,2,3,3)", "=MODE(1,2,3)", "=LARGE(E1:E8,2)", "=SMALL(E1:E8,2)", "=LARGE(E1:E8,20)", "=RANK(3,E1:E8)", "=RANK(3,E1:E8,1)", "=RANK.AVG(2,{1,2,2,3})",
  "=PERCENTILE(E1:E8,0.3)", "=PERCENTILE.EXC(E1:E8,0.3)", "=QUARTILE(E1:E8,1)", "=QUARTILE.EXC(E1:E8,1)", "=PERCENTRANK(E1:E8,3)", "=PERCENTRANK(E1:E8,3.5)", "=PERCENTRANK.EXC(E1:E8,3)",
  "=STDEV(E1:E8)", "=STDEVP(E1:E8)", "=VAR(E1:E8)", "=VARP(E1:E8)", "=STDEVA(F1:F7)", "=VAR(1)", "=AVEDEV(E1:E8)", "=DEVSQ(E1:E8)", "=GEOMEAN(1,2,4)", "=HARMEAN(1,2,4)", "=TRIMMEAN(E1:E8,0.25)",
  "=CORREL(E1:E5,G1:G5)", "=SLOPE(G1:G5,E1:E5)", "=INTERCEPT(G1:G5,E1:E5)", "=RSQ(G1:G6,E1:E6)", "=FORECAST(6,G1:G5,E1:E5)", "=STEYX(G1:G6,E1:E6)", "=COVAR(E1:E5,G1:G5)", "=COVARIANCE.S(E1:E5,G1:G5)",
  // logic and information
  "=IF(TRUE,1,2)", "=IF(FALSE,1)", "=IF(TRUE,,2)", "=IF(\"TRUE\",1,2)", "=IF(\"x\",1,2)", "=IF(0,1,2)", "=IF(E9,1,2)", "=IFS(E1>5,\"a\",E1>0,\"b\")", "=IFS(FALSE,1)", "=IFERROR(1/0,\"x\")", "=IFERROR(1/0)", "=IFERROR(5,\"x\")", "=IFNA(NA(),\"x\")", "=IFNA(1/0,\"x\")",
  "=AND(TRUE,1)", "=AND(TRUE,\"x\")", "=AND(F1:F7)", "=OR(FALSE,0)", "=OR(E9)", "=XOR(TRUE,TRUE,TRUE)", "=NOT(0)", "=SWITCH(2,1,\"a\",2,\"b\",\"c\")", "=SWITCH(9,1,\"a\",\"c\")", "=SWITCH(9,1,\"a\")", "=SWITCH(\"B\",\"b\",1,2)",
  "=ISBLANK(E9)", "=ISBLANK(F9)", "=ISERR(NA())", "=ISERROR(F8)", "=ISNA(F8)", "=ISNUMBER(E10)", "=ISTEXT(E10)", "=ISLOGICAL(F6)", "=ISNONTEXT(E9)", "=ISREF(E1)", "=ISREF(1)", "=ISFORMULA(F8)", "=ISEMAIL(\"a@b.co\")", "=ISURL(\"example.com\")",
  "=N(\"7\")", "=N(TRUE)", "=TYPE(1)", "=TYPE(\"a\")", "=TYPE(TRUE)", "=TYPE(F8)", "=TYPE(E1:E2)", "=TYPE(E9)", "=ERROR.TYPE(F8)", "=ERROR.TYPE(1)",
  // text
  "=LEN(\"héllo\")", "=LEFT(\"hello\",2)", "=LEFT(\"hello\")", "=RIGHT(\"hello\",10)", "=MID(\"hello\",2,3)", "=MID(\"hello\",10,2)", "=FIND(\"l\",\"hello\")", "=FIND(\"L\",\"hello\")", "=SEARCH(\"L\",\"hello\")", "=SEARCH(\"l?o\",\"hello\")", "=SEARCH(\"x\",\"hello\")",
  "=SUBSTITUTE(\"aaa\",\"a\",\"b\")", "=SUBSTITUTE(\"aaa\",\"a\",\"b\",2)", "=REPLACE(\"hello\",2,3,\"ipp\")", "=REPT(\"ab\",3)", "=UPPER(\"aBc\")", "=LOWER(\"aBc\")", "=PROPER(\"hello wORLD o'neil\")", "=TRIM(\"  a   b  \")", "=CLEAN(\"a\"&CHAR(10)&\"b\")",
  "=CHAR(65)", "=CODE(\"A\")", "=UNICHAR(9731)", "=UNICODE(\"☃\")", "=EXACT(\"a\",\"A\")", "=CONCATENATE(\"a\",1,TRUE)", "=CONCATENATE(H1:H3)", "=CONCAT(\"a\",\"b\")", "=TEXTJOIN(\"-\",TRUE,F1:F5)", "=TEXTJOIN(\"-\",FALSE,E8:E10)", "=JOIN(\",\",E1:E3)",
  "=VALUE(\"1,234.5\")", "=VALUE(\"12%\")", "=VALUE(\"1/2/2026\")", "=VALUE(\"x\")", "=T(1)", "=T(\"a\")", "=DOLLAR(1234.567)", "=DOLLAR(-1234.567,1)", "=FIXED(1234.567,1)", "=FIXED(1234.567,-2,TRUE)",
  "=TEXT(1234.5,\"#,##0.00\")", "=TEXT(0.256,\"0.0%\")", "=TEXT(46335,\"yyyy-mm-dd\")", "=TEXT(46335,\"dddd, mmmm d\")", "=TEXT(0.75,\"h:mm AM/PM\")", "=TEXT(1.5,\"[h]:mm\")", "=TEXT(-5,\"0;(0)\")", "=TEXT(0,\"0;-0;\"\"zero\"\"\")", "=TEXT(3.14159,\"0.00\")", "=TEXT(12,\"000\")",
  "=TEXT(1234567,\"#,##0,\")", "=TEXT(0.5,\"# ?/?\")", "=TEXT(1.25,\"# ?/?\")", "=TEXT(123456,\"0.00E+00\")", "=TEXT(\"abc\",\"@\")", "=TEXT(5,\"$0.00\")", "=TEXT(46335.5,\"m/d/yy h:mm\")", "=TEXT(0.5,\"General\")",
  "=REGEXMATCH(\"abc123\",\"\\d+\")", "=REGEXEXTRACT(\"abc123\",\"\\d+\")", "=REGEXEXTRACT(\"abc123\",\"([a-z]+)\\d\")", "=REGEXREPLACE(\"a1b2\",\"\\d\",\"#\")", "=REGEXMATCH(\"ABC\",\"(?i)abc\")",
  "=INDEX(SPLIT(\"a,b,,c\",\",\"),1,3)", "=COLUMNS(SPLIT(\"a,b,,c\",\",\"))", "=COLUMNS(SPLIT(\"a,b,,c\",\",\",TRUE,FALSE))", "=INDEX(SPLIT(\"1-2\",\"-\"),1,1)+1",
  // dates
  "=DATE(2026,11,9)", "=DATE(2026,13,1)", "=DATE(2026,1,0)", "=DATE(26,1,1)", "=DATEVALUE(\"11/9/2026\")", "=DATEVALUE(\"2026-11-09 10:30\")", "=TIMEVALUE(\"6:30 PM\")", "=YEAR(I1)", "=MONTH(I2)", "=DAY(I3)", "=WEEKDAY(I7)", "=WEEKDAY(I7,2)", "=WEEKDAY(I7,3)",
  "=WEEKNUM(I7)", "=WEEKNUM(I7,2)", "=WEEKNUM(DATE(2026,1,1))", "=ISOWEEKNUM(DATE(2026,1,1))", "=ISOWEEKNUM(I7)", "=EDATE(I3,1)", "=EDATE(I3,-1)", "=EOMONTH(I1,0)", "=EOMONTH(I1,1)", "=EOMONTH(I5,12)",
  "=DAYS(I7,I1)", "=DAYS360(I1,I7)", "=DATEDIF(I8,I7,\"Y\")", "=DATEDIF(I8,I7,\"M\")", "=DATEDIF(I8,I7,\"D\")", "=DATEDIF(I8,I7,\"MD\")", "=DATEDIF(I8,I7,\"YM\")", "=DATEDIF(I8,I7,\"YD\")", "=DATEDIF(I7,I8,\"D\")",
  "=NETWORKDAYS(I1,I7)", "=NETWORKDAYS(I1,I7,I6)", "=NETWORKDAYS.INTL(I1,I7,11)", "=NETWORKDAYS.INTL(I1,I7,\"0000011\")", "=WORKDAY(I7,10)", "=WORKDAY(I7,-10)", "=WORKDAY.INTL(I7,5,7)",
  "=YEARFRAC(I1,I7)", "=YEARFRAC(I1,I7,1)", "=YEARFRAC(I8,I7,1)", "=YEARFRAC(I1,I7,3)", "=HOUR(0.75)", "=MINUTE(0.7604166)", "=SECOND(0.5000116)", "=TIME(25,0,0)", "=TIME(1,90,0)", "=EPOCHTODATE(1700000000)", "=I7+1", "=I7-I1",
  // lookup and reference
  "=VLOOKUP(35,G1:H10,2)", "=VLOOKUP(35,G1:H10,2,FALSE)", "=VLOOKUP(5,G1:H10,2)", "=VLOOKUP(\"c\",{\"a\",1;\"b\",2;\"c\",3},2,FALSE)", "=VLOOKUP(\"C\",{\"a\",1;\"b\",2;\"c\",3},2,FALSE)", "=VLOOKUP(\"b*\",F1:G10,2,FALSE)", "=VLOOKUP(10,G1:H10,3,FALSE)",
  "=HLOOKUP(\"b\",{\"a\",\"b\";1,2},2,FALSE)", "=MATCH(40,G1:G10,0)", "=MATCH(45,G1:G10)", "=MATCH(45,G1:G10,1)", "=MATCH(5,G1:G10)", "=MATCH(\"APPLE\",F1:F10,0)", "=MATCH(\"ch*\",F1:F10,0)", "=MATCH(55,{100,80,60,40},-1)",
  "=INDEX(G1:H10,3,2)", "=INDEX(G1:G10,4)", "=INDEX({1,2,3},2)", "=SUM(INDEX(G1:H10,0,1))", "=INDEX(G1:H10,11,1)", "=LOOKUP(45,G1:G10,H1:H10)", "=LOOKUP(45,G1:H10)", "=LOOKUP(5,G1:G10,H1:H10)",
  "=XLOOKUP(40,G1:G10,H1:H10)", "=XLOOKUP(45,G1:G10,H1:H10)", "=XLOOKUP(45,G1:G10,H1:H10,\"none\")", "=XLOOKUP(45,G1:G10,H1:H10,,-1)", "=XLOOKUP(45,G1:G10,H1:H10,,1)", "=XLOOKUP(\"a*\",F1:F10,G1:G10,,2)", "=XLOOKUP(\"apple\",F1:F10,G1:G10,,0,-1)", "=XMATCH(40,G1:G10)", "=XMATCH(45,G1:G10,1)",
  "=ROW(E5)", "=ROWS(E1:F10)", "=COLUMN(F1)", "=COLUMNS(E1:I1)", "=ROWS({1;2;3})", "=ADDRESS(2,3)", "=ADDRESS(2,3,4)", "=ADDRESS(2,3,1,FALSE)", "=ADDRESS(2,28,2,TRUE,\"My tab\")",
  "=CHOOSE(2,\"a\",\"b\",\"c\")", "=CHOOSE(4,\"a\",\"b\")", "=SUM(OFFSET(E1,1,0,3,1))", "=OFFSET(G1,2,1)", "=SUM(INDIRECT(\"E1:E3\"))", "=INDIRECT(\"R2C5\",FALSE)", "=INDIRECT(\"nope!!\")", "=FORMULATEXT(F8)",
  // arrays (results joined into one cell)
  "=TEXTJOIN(\",\",TRUE,SORT(E1:E8))", "=TEXTJOIN(\",\",TRUE,SORT(E1:E8,1,FALSE))", "=TEXTJOIN(\",\",TRUE,SORT(F1:F7))", "=TEXTJOIN(\",\",TRUE,UNIQUE(F1:F4))", "=TEXTJOIN(\",\",TRUE,UNIQUE({1;1;2;3;3},FALSE,TRUE))",
  "=TEXTJOIN(\",\",TRUE,FILTER(H1:H10,G1:G10>50))", "=TEXTJOIN(\",\",TRUE,FILTER(H1:H10,G1:G10>50,E1:E10>0))", "=FILTER(H1:H10,G1:G10>500)", "=SUM(SEQUENCE(4))", "=TEXTJOIN(\",\",TRUE,SEQUENCE(2,3,10,-1))",
  "=TEXTJOIN(\",\",TRUE,TRANSPOSE({1,2;3,4}))", "=SUM(MMULT({1,2;3,4},{5;6}))", "=TEXTJOIN(\",\",TRUE,ARRAYFORMULA(E1:E3*10))", "=SUM(ARRAYFORMULA(IF(E1:E8>2,E1:E8,0)))", "=TEXTJOIN(\",\",TRUE,FLATTEN({1,2;3,4}))",
  "=TEXTJOIN(\",\",TRUE,SORTN(G1:G10,3,0,1,FALSE))", "=ROWS(UNIQUE(F1:F10))", "=TEXTJOIN(\",\",TRUE,CHOOSECOLS({1,2,3},3,1))", "=TEXTJOIN(\",\",TRUE,VSTACK({1,2},{3}))", "=TEXTJOIN(\",\",TRUE,HSTACK({1;2},{3;4}))", "=TEXTJOIN(\",\",TRUE,TOCOL({1,2;3,4}))", "=TEXTJOIN(\",\",TRUE,WRAPROWS(SEQUENCE(5),2,0))",
  "=LET(x,5,y,x*2,x+y)", "=REDUCE(0,E1:E5,LAMBDA(a,v,a+v))", "=TEXTJOIN(\",\",TRUE,MAP({1,2,3},LAMBDA(v,v*v)))", "=TEXTJOIN(\",\",TRUE,SCAN(0,{1,2,3},LAMBDA(a,v,a+v)))", "=TEXTJOIN(\",\",TRUE,BYROW({1,2;3,4},LAMBDA(r,SUM(r))))", "=TEXTJOIN(\",\",TRUE,MAKEARRAY(2,2,LAMBDA(r,c,r*10+c)))",
  "={1,2;3,4}", "=SUM({1,2;3,4})", "=SUMPRODUCT((E1:E8>2)*(G1:G8))", "=SUMPRODUCT(--(F1:F10=\"apple\"))", "=COUNTA(UNIQUE(H1:H10))",
  // ---- pass B/C (2026-11-10) ----
  // financial
  "=PMT(0.05/12,360,300000)", "=PMT(0.06/12,60,-20000,0,1)", "=PMT(0,12,1200)", "=FV(0.05/12,120,-200)", "=FV(0.04,10,-1000,-5000,1)", "=PV(0.08/12,240,-1500)", "=PV(0,10,-100)",
  "=IPMT(0.05/12,1,360,300000)", "=IPMT(0.05/12,12,360,300000)", "=PPMT(0.05/12,12,360,300000)", "=IPMT(0.06/12,2,60,-20000,0,1)", "=NPER(0.05/12,-1500,200000)", "=NPER(0,-100,1000)", "=NPER(0.1,-100,10000)",
  "=RATE(360,-1610.46,300000)", "=RATE(10,-100,800)", "=NPV(0.1,-1000,300,400,500)", "=IRR({-1000,300,400,500})", "=IRR({-100,-50,200,40})", "=IRR({1,2,3})",
  "=XNPV(0.09,{-10000,2750,4250,3250,2750},{39448,39508,39751,39859,39904})", "=XIRR({-10000,2750,4250,3250,2750},{39448,39508,39751,39859,39904})", "=MIRR({-120000,39000,30000,21000,37000,46000},0.1,0.12)",
  "=CUMIPMT(0.09/12,360,125000,13,24,0)", "=CUMPRINC(0.09/12,360,125000,13,24,0)", "=EFFECT(0.0525,4)", "=NOMINAL(0.053543,4)", "=RRI(96,10000,11000)", "=PDURATION(0.025,2000,2200)", "=FVSCHEDULE(1,{0.09,0.11,0.1})",
  "=SLN(30000,7500,10)", "=SYD(30000,7500,10,1)", "=DDB(2400,300,10,1)", "=DDB(2400,300,10,2)", "=DDB(2400,300,10,10)", "=DB(1000000,100000,6,1,7)", "=DB(1000000,100000,6,2,7)", "=DB(1000000,100000,6,7,7)", "=ISPMT(0.1/12,1,36,8000000)", "=DOLLARDE(1.02,16)", "=DOLLARFR(1.125,16)",
  // distributions and tests
  "=NORM.DIST(42,40,1.5,TRUE)", "=NORM.DIST(42,40,1.5,FALSE)", "=NORMDIST(1,0,1,TRUE)", "=NORM.INV(0.908789,40,1.5)", "=NORM.S.DIST(1.333,TRUE)", "=NORM.S.INV(0.908789)", "=NORMSINV(0.001)", "=NORMSDIST(-3)", "=STANDARDIZE(42,40,1.5)", "=GAUSS(2)", "=PHI(0.75)",
  "=ERF(1)", "=ERF(0,1.5)", "=ERFC(1)", "=ERF(-0.3)", "=GAMMA(5)", "=GAMMA(2.5)", "=GAMMA(-1.5)", "=GAMMALN(10)", "=GAMMA.DIST(10.00001131,9,2,FALSE)", "=GAMMA.DIST(10.00001131,9,2,TRUE)", "=GAMMA.INV(0.068094,9,2)",
  "=BINOM.DIST(6,10,0.5,FALSE)", "=BINOM.DIST(6,10,0.5,TRUE)", "=BINOMDIST(3,8,0.3,TRUE)", "=BINOM.INV(6,0.5,0.75)", "=CRITBINOM(10,0.3,0.5)", "=NEGBINOM.DIST(10,5,0.25,FALSE)", "=NEGBINOM.DIST(10,5,0.25,TRUE)", "=HYPGEOM.DIST(1,4,8,20,TRUE)", "=HYPGEOM.DIST(1,4,8,20,FALSE)",
  "=POISSON.DIST(2,5,TRUE)", "=POISSON.DIST(2,5,FALSE)", "=EXPON.DIST(0.2,10,TRUE)", "=EXPON.DIST(0.2,10,FALSE)", "=WEIBULL.DIST(105,20,100,TRUE)", "=WEIBULL.DIST(105,20,100,FALSE)", "=LOGNORM.DIST(4,3.5,1.2,TRUE)", "=LOGNORM.DIST(4,3.5,1.2,FALSE)", "=LOGNORM.INV(0.039084,3.5,1.2)",
  "=BETA.DIST(2,8,10,TRUE,1,3)", "=BETA.DIST(2,8,10,FALSE,1,3)", "=BETADIST(0.4,2,3)", "=BETA.INV(0.685470,8,10,1,3)",
  "=T.DIST(60,1,TRUE)", "=T.DIST(8,3,FALSE)", "=T.DIST.2T(1.959999998,60)", "=T.DIST.RT(1.959999998,60)", "=TDIST(1.96,60,2)", "=T.INV(0.75,2)", "=T.INV.2T(0.546449,60)", "=TINV(0.05,10)",
  "=CHISQ.DIST(0.5,1,TRUE)", "=CHISQ.DIST(2,3,FALSE)", "=CHISQ.DIST.RT(18.307,10)", "=CHIDIST(3,2)", "=CHISQ.INV(0.93,1)", "=CHISQ.INV.RT(0.050001,10)", "=CHITEST({58,35;11,25;10,23},{45.35,47.65;17.56,18.44;16.09,16.91})",
  "=F.DIST(15.2069,6,4,TRUE)", "=F.DIST(15.2069,6,4,FALSE)", "=F.DIST.RT(15.2069,6,4)", "=F.INV(0.01,6,4)", "=F.INV.RT(0.01,6,4)", "=FDIST(3,5,10)",
  "=CONFIDENCE.NORM(0.05,2.5,50)", "=CONFIDENCE.T(0.05,1,50)", "=CONFIDENCE(0.1,3,30)", "=Z.TEST(G1:G10,40)", "=Z.TEST(G1:G10,40,20)", "=T.TEST(E1:E5,G1:G5,2,1)", "=T.TEST(E1:E8,G1:G8,2,2)", "=T.TEST(E1:E8,G1:G8,1,3)", "=F.TEST(E1:E8,G1:G8)",
  "=FISHER(0.75)", "=FISHERINV(0.972955)", "=KURT(E1:E8)", "=SKEW(E1:E8)", "=SKEW.P(E1:E8)", "=PERMUT(100,3)", "=PERMUTATIONA(3,2)", "=PROB({0,1,2,3},{0.2,0.3,0.1,0.4},2)", "=PROB({0,1,2,3},{0.2,0.3,0.1,0.4},1,3)",
  // engineering, matrices, misc
  "=BIN2DEC(1100100)", "=BIN2DEC(1111111111)", "=DEC2BIN(9,4)", "=DEC2BIN(-100)", "=HEX2DEC(\"A5\")", "=HEX2DEC(\"FFFFFFFF5B\")", "=DEC2HEX(100,4)", "=DEC2HEX(-54)", "=OCT2DEC(54)", "=DEC2OCT(58,3)", "=BIN2HEX(11111011,4)", "=HEX2BIN(\"F\",8)", "=OCT2HEX(100,4)", "=DEC2BIN(600)",
  "=BITAND(13,25)", "=BITOR(23,10)", "=BITXOR(5,3)", "=BITLSHIFT(4,2)", "=BITRSHIFT(13,2)", "=DELTA(5,4)", "=DELTA(5,5)", "=GESTEP(-4,-5)", "=CONVERT(1,\"lbm\",\"kg\")", "=CONVERT(68,\"F\",\"C\")", "=CONVERT(2.5,\"ft\",\"sec\")", "=CONVERT(6,\"mi\",\"km\")", "=CONVERT(1,\"gal\",\"l\")",
  "=ROMAN(499)", "=ROMAN(1999)", "=ARABIC(\"MCMXCIX\")", "=ARABIC(\"-XIV\")", "=SERIESSUM(PI()/4,0,2,{1,-0.5,0.041666667,-0.001388889})", "=MDETERM({1,3,8,5;1,3,6,1;1,1,1,0;7,3,10,2})", "=MDETERM({3,6;1,1})", "=SUM(MINVERSE({4,-1;2,0}))", "=INDEX(MINVERSE({4,-1;2,0}),1,2)", "=MINVERSE({1,2;2,4})", "=SUM(MUNIT(3))",
  "=TEXTJOIN(\",\",TRUE,FREQUENCY(G1:G10,{25,50,75}))", "=INDEX(TREND(G1:G5,E1:E5,{6;7}),2,1)", "=INDEX(GROWTH({33100,47300,69000,102000,150000},{11,12,13,14,15},{16}),1,1)", "=INDEX(LINEST(G1:G5,E1:E5),1,1)", "=INDEX(LINEST(G1:G5,E1:E5),1,2)",
  "=ISBETWEEN(5,1,10)", "=ISBETWEEN(10,1,10,TRUE,FALSE)", "=ENCODEURL(\"a b&c\")", "=HYPERLINK(\"https://x.com\",\"site\")",
  // database
  "=DSUM(J1:M8,\"Salary\",{\"Dept\";\"Ops\"})", "=DAVERAGE(J1:M8,3,{\"Dept\";\"IT\"})", "=DCOUNT(J1:M8,\"Salary\",{\"Salary\";\">60\"})", "=DCOUNTA(J1:M8,\"Name\",{\"Dept\",\"Salary\";\"Ops\",\">52\"})", "=DMAX(J1:M8,\"Salary\",{\"Dept\";\"IT\"})",
  "=DMIN(J1:M8,\"Salary\",{\"Dept\";\"Ops\";\"HR\"})", "=DGET(J1:M8,\"Name\",{\"Salary\";90})", "=DGET(J1:M8,\"Name\",{\"Dept\";\"IT\"})", "=DPRODUCT(J1:M8,\"Salary\",{\"Dept\";\"HR\"})", "=DSTDEV(J1:M8,\"Salary\",{\"Dept\";\"IT\"})", "=DVARP(J1:M8,\"Salary\",{\"Dept\";\"Ops\"})",
  // QUERY (results joined into one cell)
  "=TEXTJOIN(\",\",TRUE,QUERY(J1:M8,\"select J where L > 60\"))", "=TEXTJOIN(\",\",TRUE,QUERY(J1:M8,\"select J, L where K = 'Ops' order by L desc\"))", "=TEXTJOIN(\",\",TRUE,QUERY(J1:M8,\"select K, sum(L) group by K\"))",
  "=TEXTJOIN(\",\",TRUE,QUERY(J1:M8,\"select K, count(J), avg(L) group by K order by count(J) desc\"))", "=TEXTJOIN(\",\",TRUE,QUERY(J1:M8,\"select J order by L limit 3\"))", "=TEXTJOIN(\",\",TRUE,QUERY(J1:M8,\"select J order by L limit 2 offset 1\",1))",
  "=TEXTJOIN(\",\",TRUE,QUERY(J1:M8,\"select max(L), min(L)\"))", "=TEXTJOIN(\",\",TRUE,QUERY(J1:M8,\"select J where J contains 'e'\"))", "=TEXTJOIN(\",\",TRUE,QUERY(J1:M8,\"select J where J starts with 'C' or J ends with 'y'\"))",
  "=TEXTJOIN(\",\",TRUE,QUERY(J1:M8,\"select J where J like '_e%'\"))", "=TEXTJOIN(\",\",TRUE,QUERY(J1:M8,\"select J where J matches '[A-C].*'\"))", "=TEXTJOIN(\",\",TRUE,QUERY(J1:M8,\"select J, L*2 where L >= 70 label L*2 'Double'\"))",
  "=TEXTJOIN(\",\",TRUE,QUERY(J1:M8,\"select J where year(M) = 2020\"))", "=TEXTJOIN(\",\",TRUE,QUERY(J1:M8,\"select J, month(M) where month(M) < 3\"))", "=TEXTJOIN(\",\",TRUE,QUERY(J1:M8,\"select K, sum(L) group by K pivot\"))",
  "=TEXTJOIN(\",\",TRUE,QUERY(J1:M8,\"select sum(L) pivot K\"))", "=TEXTJOIN(\",\",TRUE,QUERY(J1:M8,\"select J where M > date '2020-06-01' and K != 'IT'\"))", "=TEXTJOIN(\",\",TRUE,QUERY(J1:M8,\"select J where not K = 'Ops'\"))",
  "=ROWS(QUERY(J1:M8,\"select *\"))", "=ROWS(QUERY(J2:M8,\"select *\",0))", "=QUERY(J1:M8,\"select J where L > 1000\")", "=QUERY(J1:M8,\"select Z\")", "=QUERY(J1:M8,\"selec J\")", "=INDEX(QUERY(J1:M8,\"select sum(L)\"),1,1)", "=INDEX(QUERY(J1:M8,\"select sum(L) label sum(L) 'Total'\"),1,1)",
  "=TEXTJOIN(\",\",TRUE,QUERY({1,\"a\";2,\"b\";3,\"c\"},\"select Col2 where Col1 > 1\"))", "=TEXTJOIN(\",\",TRUE,QUERY(G1:H10,\"select H where G > 50 and G < 90\"))",
];
