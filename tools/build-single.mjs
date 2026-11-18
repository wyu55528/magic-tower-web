/**
 * 打包成"单文件版"：把 CSS 和所有 ES Module 全部内联进一个 HTML。
 *
 * 为什么需要：项目用了 ES Module，浏览器会拦截 file:// 下的模块请求，
 * 所以原版必须起本地服务器才能玩。拼成一个普通 <script> 之后，
 * 整个游戏不再发任何跨文件请求，双击 HTML 就能直接玩。
 *
 * 做法（够用即可，不引第三方打包器）：
 *   1. 扫出所有模块，按 import 关系做拓扑排序（保证顶层执行顺序和 ESM 一致）
 *   2. 去掉 import 语句和 export 关键字，剩下的代码拼成一个作用域
 *   3. CSS 内联成 <style>，JS 内联成普通 <script>
 *
 * 运行： node tools/build-single.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 递归收集 js/ 下的所有 .js */
function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = collect(join(ROOT, 'js'));
const IMPORT_RE = /^\s*import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?\s*$/gm;
const EXPORT_LIST_RE = /^\s*export\s*\{[^}]*\};?\s*$/gm;
const EXPORT_KW_RE = /^export\s+(?=(const|let|var|function|class|async)\b)/gm;

/** 解析一个模块：去掉 import/export，记下它的依赖 */
function parse(file) {
  let code = readFileSync(file, 'utf8');
  const deps = [];
  code = code.replace(IMPORT_RE, (m) => {
    const from = m.match(/from\s*['"]([^'"]+)['"]/);
    if (from) deps.push(from[1]);
    return '';
  });
  if (EXPORT_LIST_RE.test(code)) {
    throw new Error('暂不支持 export { ... } 形式：' + relative(ROOT, file));
  }
  EXPORT_LIST_RE.lastIndex = 0;
  code = code.replace(EXPORT_LIST_RE, '');
  code = code.replace(EXPORT_KW_RE, '');
  return { file, code, deps };
}

const modules = files.map(parse);
const byPath = new Map(modules.map((m) => [m.file, m]));

/** 把相对说明符解析成绝对路径 */
function resolve(fromFile, spec) {
  return join(dirname(fromFile), spec);
}

/** 拓扑排序：被依赖的排前面 */
const order = [];
const state = new Map();   // file -> 'visiting' | 'done'
function visit(file, stack) {
  if (state.get(file) === 'done') return;
  if (state.get(file) === 'visiting') {
    throw new Error('存在循环依赖：' + [...stack, file].map((f) => relative(ROOT, f)).join(' -> '));
  }
  state.set(file, 'visiting');
  const mod = byPath.get(file);
  for (const spec of mod.deps) {
    const dep = resolve(file, spec);
    if (!byPath.has(dep)) throw new Error('找不到依赖：' + spec + '（被 ' + relative(ROOT, file) + ' 引用）');
    visit(dep, [...stack, file]);
  }
  state.set(file, 'done');
  order.push(mod);
}
const entry = join(ROOT, 'js', 'main.js');
visit(entry, []);
modules.forEach((m) => visit(m.file, []));

/** 顶层标识符重名检查（拼到同一作用域后重名会互相覆盖） */
const DECL_RE = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
const seen = new Map();
const clashes = [];
for (const mod of order) {
  const names = new Set();
  let mm;
  DECL_RE.lastIndex = 0;
  while ((mm = DECL_RE.exec(mod.code))) names.add(mm[1]);
  for (const n of names) {
    if (seen.has(n)) clashes.push(n + '（' + relative(ROOT, seen.get(n)) + ' 与 ' + relative(ROOT, mod.file) + '）');
    else seen.set(n, mod.file);
  }
}
if (clashes.length) {
  console.error('❌ 顶层标识符冲突：' + clashes.join('、'));
  process.exit(1);
}

const bundle = order
  .map((m) => '// ===== ' + relative(ROOT, m.file).replace(/\\/g, '/') + ' =====\n' + m.code.trim() + '\n')
  .join('\n');

const css = readFileSync(join(ROOT, 'css', 'style.css'), 'utf8');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

/**
 * 把 index.html 改成单文件版：
 *   - <link rel="stylesheet"> 换成内联 <style>
 *   - <script type="module" src="js/main.js"> 换成内联普通 <script>
 *   - 删掉只在 file:// 下有意义、但单文件版用不上的启动提示脚本
 */
// 注意：replace 的第二个参数一定要用函数形式。
// JS/CSS 里到处是 $ 和 `，直接传字符串会被当成 $& / $' / $` 之类的替换模式，把内容搞乱。
let out = html
  .replace(/<link rel="stylesheet" href="css\/style\.css" \/>/, () => '<style>\n' + css + '\n</style>')
  .replace(/<script type="module" src="js\/main\.js"><\/script>/, () => '<script>\n' + bundle + '\n</script>')
  .replace(/<title>[\s\S]*?<\/title>/, () => '<title>魔塔 · 网页版 30 层（单文件版 · 双击即玩）</title>');

// 注意：bundle 里每段都有 "// ===== js/xxx.js =====" 注释，
// 所以不能拿 'js/main.js' 这种字符串来判断有没有替换成功，要看原始标签。
if (out.includes('src="js/main.js"') || out.includes('href="css/style.css"')) {
  throw new Error('内联替换没有生效，请检查 index.html 的标签写法');
}
if (!out.includes('<style>') || !out.includes('type="module"') === false) {
  throw new Error('内联替换结果异常：style 或 script 标签不对');
}
// bundle 里不应该再有 import/export 语句
const badImport = bundle.match(/^\s*import\s+\{/m);
const badExport = bundle.match(/^\s*export\s/m);
if (badImport) throw new Error('bundle 里还残留 import 语句');
if (badExport) throw new Error('bundle 里还残留 export 语句');

mkdirSync(join(ROOT, 'dist'), { recursive: true });
const dest = join(ROOT, 'dist', '魔塔-单文件版.html');
writeFileSync(dest, out, 'utf8');

// 产物自检：关键机制必须真的内联进来了，删掉的旧机制不能残留
const MUST_HAVE = [
  ['标题', '魔塔 · 网页版 30 层（单文件版'],
  ['主入口', 'const $ = (id) => document.getElementById(id);'],
  ['30 层数据', 'const LEVELS = ['],
  ['图鉴按层过滤', 'monsterIdsOnLevel(state.level)'],
  ['规则层入口', 'function step(state, action)'],
  ['传送卷轴', 'warp_scroll'],
  ['楼梯上箭头', '\u2191'],
  ['楼梯下箭头', '\u2193'],
];
const MUST_NOT_HAVE = [
  ['旧的跨层阶梯', 'teleportOptions'],
];
let bad = 0;
for (const [name, text] of MUST_HAVE) {
  if (!out.includes(text)) { console.error('  FAIL ' + name + ' — 缺: ' + text); bad++; }
}
for (const [name, text] of MUST_NOT_HAVE) {
  if (out.includes(text)) { console.error('  FAIL ' + name + ' — 还有残留: ' + text); bad++; }
}
if (bad) {
  console.error('❌ 单文件版产物自检失败：' + bad + ' 项');
  process.exit(1);
}

const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
console.log('✅ 单文件版已生成：' + relative(ROOT, dest));
console.log('   模块 ' + order.length + ' 个 → ' + order.map((m) => relative(ROOT, m.file)).join(', '));
console.log('   大小 ' + kb + ' KB');
