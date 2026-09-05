// 生成 PWA 图标(渐变圆角方块 + 白色小房子)
// 用法:node tools/gen-icons.js   输出到 icons/icon-192.png、icons/icon-512.png
const fs = require("fs"), path = require("path"), zlib = require("zlib");

function crc32(buf){
  if(!crc32.table){
    crc32.table = [];
    for(let n = 0; n < 256; n++){
      let c = n;
      for(let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32.table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for(let i = 0; i < buf.length; i++) crc = crc32.table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data){
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
function png(size, pixel){
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for(let y = 0; y < size; y++){
    raw[y * (size * 4 + 1)] = 0; // 每行 filter: none
    for(let x = 0; x < size; x++){
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function icon(size){
  const s = size / 512, R = 96 * s;
  const lerp = (a, b, t) => a + (b - a) * t;
  const inHouse = (x, y) => {
    const X = x / s, Y = y / s; // 统一到 512 坐标系
    const body = X >= 156 && X <= 356 && Y >= 256 && Y <= 400;
    const roof = Y >= 116 && Y <= 256 && Math.abs(X - 256) <= (Y - 116) * (128 / 140);
    const door = X >= 226 && X <= 286 && Y >= 320 && Y <= 400;
    return (body || roof) && !door;
  };
  return png(size, (x, y) => {
    const cx = Math.min(Math.max(x, R), size - R);
    const cy = Math.min(Math.max(y, R), size - R);
    if((x - cx) ** 2 + (y - cy) ** 2 > R * R) return [0, 0, 0, 0];
    if(inHouse(x, y)) return [255, 255, 255, 255];
    const t = y / size; // 背景:#5b6cff → #8f5bff 垂直渐变
    return [Math.round(lerp(91, 143, t)), Math.round(lerp(108, 91, t)), 255, 255];
  });
}
const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for(const size of [192, 512]){
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, icon(size));
  console.log("generated", file, fs.statSync(file).size, "bytes");
}
