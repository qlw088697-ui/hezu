// HeZu 测试套件:node test/test.js
// 1) 内联脚本语法检查  2) 核心分摊/结算算法  3) 分享链接编解码往返
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
let failed = 0;
function assert(cond, msg){
  if(cond) console.log("PASS:", msg);
  else { console.log("FAIL:", msg); failed++; }
}

/* 1) 语法检查:new Function 只解析、不执行 */
try{ new Function(script); assert(true, "内联脚本语法检查"); }
catch(e){ assert(false, "内联脚本语法检查: " + e.message); }

/* 2) 核心算法(渲染之前的纯逻辑部分,不依赖 DOM) */
const core = script.split("/* ---------- 渲染")[0];
function makeApi(initState){
  return new Function(core + `
    state = ${JSON.stringify(initState)};
    return {
      setState: (s) => { state = s; },
      fmt, splitEqual, splitWeight, expenseOfBill, expenseOfMeter, computeAll,
      roomRentOf, sanitizeState, settlementCsv, copyBillsFromMonth, parseBackup, computeAllFor,
      parseCsv, billsFromCsv, aggregateMonths, findDupNames, needsBackup, aggregateMonths,
    };`);
}
const sampleState = {
  month: "2026-08",
  members: [
    { id: "a", name: "张三", weight: 1 },
    { id: "b", name: "李四", weight: 1 },
    { id: "c", name: "王五", weight: 2 },
  ],
  bills: [
    { id: "b1", name: "房租", amount: 300000, mode: "weight", shares: {}, payer: "a", participants: ["a","b","c"] },
    { id: "b2", name: "网费", amount: 9000, mode: "equal", shares: {}, payer: "c", participants: ["a","b","c"] },
  ],
  meters: [
    { id: "m1", name: "电费", prev: 100, curr: 200, price: 0.6, mode: "equal", payer: "b", participants: ["a","b","c"] },
  ],
};
const api = makeApi(sampleState)();
const r = api.computeAll();
const owed = Object.fromEntries(r.per.map(p => [p.m.name, p.owed]));
assert(owed["张三"] === 80000, "张三应付 ¥800.00(实际 " + api.fmt(owed["张三"]) + ")");
assert(owed["李四"] === 80000, "李四应付 ¥800.00(实际 " + api.fmt(owed["李四"]) + ")");
assert(owed["王五"] === 155000, "按权重分摊:王五应付 ¥1550.00(实际 " + api.fmt(owed["王五"]) + ")");
assert(r.total === 315000, "总支出 ¥3150.00(实际 " + api.fmt(r.total) + ")");
const sumT = r.transfers.reduce((s, t) => s + t.amount, 0);
assert(sumT === 220000, "转账合计 ¥2200.00(实际 " + api.fmt(sumT) + ")");
assert(r.transfers.some(t => t.from.name === "王五" && t.to.name === "张三" && t.amount === 146000), "王五 → 张三 ¥1460.00");
assert(r.transfers.some(t => t.from.name === "李四" && t.to.name === "张三" && t.amount === 74000), "李四 → 张三 ¥740.00");

/* 均摊/按权重余数处理:合计必须与总额分毫不差 */
const s1 = api.splitEqual(10000, ["x", "y", "z"]);
assert(Object.values(s1).reduce((a, b) => a + b, 0) === 10000, "均摊余数处理:每人份额合计 === 总额");
const s2 = api.splitWeight(10000, [{ id: "x", weight: 1 }, { id: "y", weight: 1 }, { id: "z", weight: 1 }]);
assert(Object.values(s2).reduce((a, b) => a + b, 0) === 10000, "按权重余数处理(最大余数法):合计 === 总额");
const s3 = api.splitWeight(10001, [{ id: "x", weight: 3 }, { id: "y", weight: 7 }]);
assert(Object.values(s3).reduce((a, b) => a + b, 0) === 10001 && s3.x === 3000 && s3.y === 7001, "按权重精确整除时不丢分");

/* 抄表异常:本期读数 < 上期,不计入金额 */
api.setState({ ...sampleState, meters: [...sampleState.meters, { id: "m2", name: "水费", prev: 300, curr: 100, price: 3, mode: "equal", payer: "", participants: ["a","b","c"] }] });
const r2 = api.computeAll();
assert(r2.hasAbnormal === true, "读数异常被检测");
assert(r2.total === 315000, "异常抄表不计入总金额");

/* 房间模式:金额由各住客房间租金推导 */
api.setState({
  month: "2026-09",
  members: [{ id: "a", name: "A", weight: 1 }, { id: "b", name: "B", weight: 1 }],
  rooms: [
    { id: "r1", name: "Master", rent: 200000, occupantId: "a" },
    { id: "r2", name: "Small", rent: 120000, occupantId: "b" },
  ],
  bills: [{ id: "b1", name: "Rent", amount: 0, mode: "room", shares: {}, payer: "a", participants: ["a","b"] }],
  meters: [],
});
const r3 = api.computeAll();
const owed3 = Object.fromEntries(r3.per.map(p => [p.m.name, p.owed]));
assert(owed3["A"] === 200000 && owed3["B"] === 120000, "按房间分摊:各付各的房间租金");
assert(r3.total === 320000, "按房间模式金额自动汇总为 ¥3200.00");
const e3 = api.expenseOfBill({ id: "x", name: "Rent", amount: 0, mode: "room", shares: {}, payer: "", participants: ["a","b"] });
assert(e3.missingRooms === 0, "全员有房间时无缺失提醒");
api.setState({
  ...({ month: "2026-09",
    members: [{ id: "a", name: "A", weight: 1 }, { id: "b", name: "B", weight: 1 }, { id: "c", name: "C", weight: 1 }],
    rooms: [
      { id: "r1", name: "Master", rent: 200000, occupantId: "a" },
      { id: "r2", name: "Small", rent: 120000, occupantId: "b" },
    ],
    bills: [], meters: [] }),
});
const e4 = api.expenseOfBill({ id: "x", name: "Rent", amount: 0, mode: "room", shares: {}, payer: "", participants: ["a","b","c"] });
assert(e4.missingRooms === 1, "未分配房间的参与人被标记(按 0 计)");
assert(e4.amount === 320000, "缺失房间不影响有房间者的汇总金额");

/* 数据消毒:畸形/恶意数据被规范化 */
const dirty = {
  month: "999x",
  members: [{ name: "<img src=x onerror=alert(1)>", weight: "abc", id: 123 }, { name: "A", id: "a", weight: 1 }],
  bills: [{ mode: "HACK", amount: 1250, participants: ["ghost", "a"], payer: { evil: 1 }, shares: { a: "oops" } },
          { mode: "custom", amount: 1000, shares: { a: -500 }, participants: ["a"] }],
  meters: [{ prev: "x", curr: 1e13, price: -3, mode: "explode" }],
  rooms: [{ rent: "-5", occupantId: "ghost" }, "junk"],
  extra: { nested: true },
};
const clean = api.sanitizeState(dirty, "2026-09");
assert(clean.month === "2026-09", "非法月份回退到默认月份");
assert(typeof clean.members[0].id === "string" && clean.members[0].id.length > 0, "成员 id 强制为字符串");
assert(typeof clean.members[0].name === "string" && clean.members[0].name.length <= 40, "成员名称截断为字符串(渲染层再转义)");
assert(clean.members[0].weight === 1, "非法权重回退默认值 1");
assert(clean.bills[0].mode === "equal", "未知的分摊方式回退为均摊");
assert(clean.bills[0].amount === 1250, "金额以整数分规范化(1250 保持不变)");
assert(clean.bills[0].participants.length === 1 && clean.bills[0].participants[0] === "a", "未知参与者被过滤");
assert(clean.bills[0].payer === "", "非法垫付人被清空");
assert(clean.bills[1].shares.a === 0, "负数份额被钳制为 0");
assert(clean.meters[0].prev === null && clean.meters[0].curr === 1000000000000 && clean.meters[0].price === 0, "抄表读数/单价被钳制");
assert(clean.meters[0].mode === "equal", "未知抄表分摊方式回退");
assert(clean.rooms[0].rent === 0 && clean.rooms[0].occupantId === "", "房间负租金与未知住客被钳制");
assert(Array.isArray(clean.rooms) && clean.rooms.length === 2, "数组长度仍在白名单范围内");
assert(!("extra" in clean), "消毒器丢弃未知字段");

/* 结算 CSV 输出 */
api.setState(sampleState);
const csv = api.settlementCsv();
assert(csv.includes('"租客","应付","已垫付","净额(正=应收)"'), "CSV 表头");
assert(csv.includes('"张三","800.00","3000.00","2200.00"'), "CSV 数据行(应付/垫付/净额)");
assert(csv.includes('"王五","→ 张三","1460.00"'), "CSV 转账行");
assert(csv.includes("\r\n"), "CSV 使用 CRLF 行尾");
assert(!csv.includes(",800,"), "CSV 字段均带引号包裹");

/* 复制历史账单到本月:按名字匹配 + 抄表读数衔接 */
const srcMonth = {
  month: "2026-08",
  members: [{ id: "s1", name: "张三", weight: 1 }, { id: "s2", name: "李四", weight: 1 }, { id: "s3", name: "王五", weight: 1 }],
  bills: [
    { id: "sb1", name: "房租", amount: 360000, mode: "equal", shares: {}, payer: "s1", participants: ["s1", "s2", "s3"] },
    { id: "sb2", name: "清洁费", amount: 4500, mode: "custom", shares: { s1: 3000, s2: 1500 }, payer: "", participants: ["s1", "s2"] },
    { id: "sb3", name: "已退租者的账单", amount: 1000, mode: "equal", shares: {}, payer: "", participants: ["s3"] },
  ],
  meters: [
    { id: "sm1", name: "电费", prev: 1200, curr: 1568, price: 0.55, mode: "equal", payer: "s1", participants: ["s1", "s2"] },
  ],
};
const dstMonth = {
  month: "2026-09",
  members: [{ id: "d1", name: "李四", weight: 1 }, { id: "d2", name: "张三", weight: 1 }],
  bills: [], meters: [],
};
const copied = api.copyBillsFromMonth(srcMonth, dstMonth);
assert(copied.bills.length === 2, "已退租成员的独立账单被跳过(无匹配参与人)");
const rentCopy = copied.bills.find(b => b.name === "房租");
assert(rentCopy.payer === "d2", "垫付人按名字映射到新 id(张三 → d2)");
assert(rentCopy.participants.length === 2, "参与人按名字映射");
const cleanCopy = copied.bills.find(b => b.name === "清洁费");
assert(cleanCopy.shares.d2 === 3000 && cleanCopy.shares.d1 === 1500, "自定义份额按名字重映射");
const meterCopy = copied.meters[0];
assert(meterCopy.prev === 1568 && meterCopy.curr === null, "抄表上期读数衔接上月本期,本期留空");
assert(meterCopy.participants.length === 2, "抄表参与人按名字映射");
const copied2 = api.copyBillsFromMonth(
  { members: [{ id: "z", name: "陌生产" }], bills: [], meters: [{ name: "水费", prev: 10, curr: 20, price: 3, mode: "equal", payer: "", participants: ["z"] }] },
  { month: "2026-09", members: [{ id: "d1", name: "李四" }], bills: [], meters: [] });
assert(copied2.meters[0].participants.length === 1 && copied2.meters[0].participants[0] === "d1", "无匹配时抄表参与人回退为全部成员");

/* 复制历史包含房间(住客按名字映射;当前已有房间则不覆盖) */
const srcRooms = { members: [{ id: "s1", name: "A" }], rooms: [{ id: "r1", name: "主卧", rent: 150000, occupantId: "s1" }], bills: [], meters: [] };
const cp1 = api.copyBillsFromMonth(srcRooms, { month: "2026-09", members: [{ id: "d1", name: "A" }], bills: [], meters: [], rooms: [] });
assert(cp1.rooms.length === 1 && cp1.rooms[0].rent === 150000 && cp1.rooms[0].occupantId === "d1", "复制历史包含房间且住客按名字映射");
const cp2 = api.copyBillsFromMonth(srcRooms, { month: "2026-09", members: [{ id: "d1", name: "A" }], bills: [], meters: [], rooms: [{ id: "dr", name: "已有", rent: 1, occupantId: "" }] });
assert(cp2.rooms.length === 0, "当前已有房间时不复制覆盖");

/* 全量备份信封解析 */
const goodBackup = {
  app: "hezu", version: 1, exportedAt: "2026-09-05T00:00:00Z",
  current: { month: "2026-09", members: [{ id: "a", name: "张三", weight: 1 }], bills: [{ amount: "junk", participants: "notarray" }], meters: [], rooms: [] },
  history: {
    "2026-08": { month: "2026-08", members: [{ id: "b", name: "李四", weight: 1 }], bills: [], meters: [] },
    "bad-key": { members: [] },
  },
};
const parsed = api.parseBackup(goodBackup);
assert(parsed !== null, "合法备份信封被识别");
assert(parsed.current.members[0].name === "张三" && parsed.current.bills[0].amount === 0, "备份 current 被消毒(畸形金额归零)");
assert(Object.keys(parsed.history).length === 1 && parsed.history["2026-08"].members[0].name === "李四", "历史按月份键消毒,非法键丢弃");
assert(api.parseBackup({ members: [] }) === null, "非备份 JSON 返回 null(走单月导入)");
assert(api.parseBackup({ app: "hezu", current: {}, history: [] }) === null, "history 为数组时拒绝");
assert(api.parseBackup(null) === null, "空数据拒绝");

/* computeAllFor:对历史快照计算且不污染当前状态 */
api.setState(sampleState);
const altState = {
  month: "2026-01",
  members: [{ id: "q1", name: "Q", weight: 1 }],
  bills: [{ id: "qb", name: "B", amount: 9000, mode: "equal", shares: {}, payer: "", participants: ["q1"] }],
  meters: [], rooms: [],
};
const rAlt = api.computeAllFor(altState);
assert(rAlt.total === 9000 && rAlt.per[0].owed === 9000, "computeAllFor 对快照正确结算");
assert(api.computeAll().total === 315000, "computeAllFor 不影响当前状态(仍为原账单)");
const rAgain = api.computeAllFor(altState);
assert(rAgain.total === 9000, "computeAllFor 可重复调用");

/* CSV 解析器与账单导入 */
const csvRows = api.parseCsv('名称,金额\r\n"电费,8月","120.50"\r\n水费,60\r\n\r\n垃圾清运,"30"');
assert(csvRows.length === 4, "CSV 基本行解析(CRLF,纯空行跳过)");
assert(csvRows[1][0] === "电费,8月" && csvRows[1][1] === "120.50", "引号内逗号不切分");
assert(csvRows[3][1] === "30", "引号字段正常读取");
const csvText = "项目,费用,备注\n电费,\"1,200.50\",备注,逗号\n水费,60\n无效行\n,45\n清洁,−20";
const csvBills = api.billsFromCsv(csvText);
assert(!csvBills.error && csvBills.bills.length === 2, "表头识别与无效行跳过(实际 " + JSON.stringify(csvBills).slice(0, 80) + ")");
assert(csvBills.bills[0].name === "电费" && csvBills.bills[0].amount === 120050, "金额去除千分位并转为分");
assert(csvBills.skipped === 3, "无效/负数/缺名行计入跳过(实际 " + csvBills.skipped + ")");
assert(api.billsFromCsv("a,b\n1,2").error === "noHeader", "无名称/金额表头时报错");
assert(api.billsFromCsv("").error === "empty", "空文件报错");
const gbkSimulated = "名称,金额\n电费,120\n宽带,99";
const gbkBills = api.billsFromCsv(gbkSimulated);
assert(gbkBills.bills.length === 2 && gbkBills.bills[1].amount === 9900, "中文名称(GBK 解码后)正常导入");

/* 跨月累计统计 */
function monthFixture(mo, payerId, withMeter){
  return { month: mo,
    members: [{ id: "a", name: "A", weight: 1 }, { id: "b", name: "B", weight: 1 }],
    bills: [{ id: "b" + mo, name: "房租", amount: 200000, mode: "equal", shares: {}, payer: payerId, participants: ["a","b"] }],
    meters: withMeter ? [{ id: "m" + mo, name: "电费", prev: 0, curr: 100, price: 1, mode: "equal", payer: payerId, participants: ["a","b"] }] : [] };
}
const hist = {
  "2026-01": monthFixture("2026-01", "a", false),   // A 垫付 2000,每人应付 1000
  "2026-02": monthFixture("2026-02", "b", true),    // B 垫付 2100,每人应付 1050
  "bad-key": { members: [] },
};
const agg = api.aggregateMonths(hist);
assert(agg.months === 2, "累计月数正确(非法键不计)");
assert(agg.total === 410000 && agg.paid === 410000, "累计总支出与总垫付 ¥4100.00(实际 " + api.fmt(agg.total) + ")");
const aggA = agg.per.find(p => p.name === "A"), aggB = agg.per.find(p => p.name === "B");
assert(aggA.owed === 205000 && aggB.owed === 205000, "每人累计应付 ¥2050.00");
assert(aggA.balance === -5000 && aggB.balance === 5000, "累计净额守恒(A -¥50 / B +¥50)");
assert(api.aggregateMonths(null).months === 0, "空历史返回零月");

/* computeAllFor 对畸形快照先消毒再计算,不抛异常 */
const rDirty = api.computeAllFor({ members: "x", bills: null, meters: "y", rooms: 7 });
assert(rDirty.total === 0 && Array.isArray(rDirty.per) && rDirty.per.length === 0, "computeAllFor 对畸形快照消毒后安全计算");

/* 周期说明标签:消毒截断 + 分享链接往返保留 */
const withLabel = api.sanitizeState({ month: "2026-09", periodLabel: "租期 9/15–10/14，超出四十个字符的很长很长很长很长很长很长很长很长的说明文本", members: [{ id: "a", name: "A" }] }, "2026-09");
assert(withLabel.periodLabel.length <= 40 && withLabel.periodLabel.startsWith("租期 9/15–10/14"), "周期说明截断至 40 字符");

/* 3) 分享链接编解码往返 */
const shareSeg = script.split("/* ---------- 示例数据 ---------- */")[1].split("/* ---------- 事件 ---------- */")[0];
const api2 = new Function(core + shareSeg + `
  globalThis.localStorage = { getItem(){ return null; }, setItem(){}, removeItem(){} };
  globalThis.document = { getElementById(){ return { textContent:"", innerHTML:"", value:"",
    classList:{ add(){}, remove(){} }, querySelector(){ return null; }, style:{}, focus(){} }; } };
  globalThis.renderAll = () => {};
  state = null;
  return { encodeState, decodeState, setState: (s) => { state = s; },
    loadSample, stateRef: () => state };`)();
api2.setState({
  month: "2026-09",
  members: [{ id: "a", name: "张三", weight: 1.5 }, { id: "b", name: "李四", weight: 1 }, { id: "c", name: "王五", weight: 1 }],
  bills: [
    { id: "b1", name: "房租", amount: 360000, mode: "weight", shares: {}, payer: "a", participants: ["a","b","c"] },
    { id: "b2", name: "清洁费", amount: 4500, mode: "equal", shares: {}, payer: "b", participants: ["a","c"] },
    { id: "b3", name: "杂项", amount: 10000, mode: "custom", shares: { a: 6000, b: 4000, c: 0 }, payer: "c", participants: ["a","b","c"] },
  ],
  meters: [
    { id: "m1", name: "电费", prev: 1200, curr: 1568, price: 0.55, mode: "equal", payer: null, participants: ["a","b","c"] },
    { id: "m2", name: "水费", prev: 308, curr: 321, price: 3.6, mode: "weight", payer: "b", participants: ["a","b","c"] },
  ],
});
const code = api2.encodeState();
const decoded = api2.decodeState(code);
api2.setState(decoded);
assert(code === api2.encodeState(), "分享链接编解码往返一致");
assert(decoded.members[0].name === "张三" && decoded.members[0].weight === 1.5, "中文名称与权重保留");
assert(decoded.bills[2].shares[decoded.members[0].id] === 6000, "自定义份额映射正确");
assert(decoded.meters[0].payer === "" && decoded.bills[0].payer === decoded.members[0].id, "垫付人映射正确(含空垫付人)");
assert(decoded.bills[1].participants.length === 2, "参与人映射正确");
const url = "https://qlw088697-ui.github.io/hezu/#d=" + code;
assert(url.length < 8000, "分享链接长度可控(" + url.length + " 字符 < 8000)");

/* 金额千分位显示 */
assert(api.fmt(123456789) === "¥1,234,567.89", "大额金额千分位(" + api.fmt(123456789) + ")");
assert(api.fmt(80000) === "¥800.00", "小额金额不受影响");

/* 账单备注:消毒截断 + 复制文本包含 + 分享链接保留 */
const noteClean = api.sanitizeState({ month: "2026-09", members: [{ id: "a", name: "A" }],
  bills: [{ name: "电费", amount: 10000, note: "x".repeat(80) }] }, "2026-09");
assert(noteClean.bills[0].note.length <= 60, "备注截断至 60 字符");
api.setState({ month: "2026-09", periodLabel: "9/15–10/14",
  members: [{ id: "a", name: "A", weight: 1 }], bills: [], meters: [], rooms: [] });
api2.setState({ month: "2026-09", periodLabel: "9/15–10/14",
  members: [{ id: "a", name: "A", weight: 1 }],
  bills: [{ id: "b1", name: "电费", amount: 20240, mode: "equal", shares: {}, payer: "", participants: ["a"], note: "高温空调" }],
  meters: [], rooms: [] });
assert(api2.decodeState(api2.encodeState()).bills[0].note === "高温空调", "备注在分享链接中保留");

/* 周期说明在分享链接中保留 */
api2.setState({ month: "2026-09", periodLabel: "9/15–10/14", members: [{ id: "a", name: "A", weight: 1 }], bills: [], meters: [], rooms: [] });
assert(api2.decodeState(api2.encodeState()).periodLabel === "9/15–10/14", "周期说明在分享链接中保留");

/* 载入示例保留周期说明 */
api2.setState({ month: "2026-09", periodLabel: "租期 9/15–10/14", members: [], bills: [], meters: [], rooms: [] });
api2.loadSample();
assert(api2.stateRef().periodLabel === "租期 9/15–10/14", "载入示例不丢失周期说明");
assert(api2.stateRef().members.length === 3, "载入示例数据完整");

/* 重名检测 */
const dups = api.findDupNames([
  { id: "1", name: "张三" }, { id: "2", name: "张三" }, { id: "3", name: " 李四 " },
  { id: "4", name: "李四" }, { id: "5", name: "王五" }, { id: "6", name: "" },
]);
assert(dups.length === 2 && dups[0] === "张三" && dups[1] === "李四", "重名检测(去空白后比较,空名忽略)");

/* 备份提醒判定 */
const NOW = new Date("2026-09-05T12:00:00Z").getTime();
const histRecent = { "2026-09": { month: "2026-09", members: [], bills: [], meters: [] } };
const histOld = { "2026-01": { month: "2026-01", members: [], bills: [], meters: [] } };
assert(api.needsBackup(0, NOW, histRecent) === false, "仅当月数据且从未备份:不提醒");
assert(api.needsBackup(0, NOW, histOld) === true, "一个月前历史从未备份:提醒");
assert(api.needsBackup(NOW - 31 * 864e5, NOW, histRecent) === true, "上次备份超 30 天:提醒");
assert(api.needsBackup(NOW - 5 * 864e5, NOW, histOld) === false, "最近备份过:不提醒");
assert(api.needsBackup(0, NOW, {}) === false, "无历史:不提醒");

console.log(failed === 0 ? "\n全部通过 ✅" : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
