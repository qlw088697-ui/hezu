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
