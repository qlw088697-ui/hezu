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

/* 3) 分享链接编解码往返 */
const shareSeg = script.split("/* ---------- 示例数据 ---------- */")[1].split("/* ---------- 事件 ---------- */")[0];
const api2 = new Function(core + shareSeg + `
  state = null;
  return { encodeState, decodeState, setState: (s) => { state = s; } };`)();
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

console.log(failed === 0 ? "\n全部通过 ✅" : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
