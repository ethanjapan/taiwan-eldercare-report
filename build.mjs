// デプロイ用ビルド: 可読ソース -> dist/ に minify して出力する。
// リポジトリ内のソースは触らない。Pages が配信するのは dist/ のみ。
import { cp, mkdir, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { minify as minifyHtml } from 'html-minifier-terser'
import * as esbuild from 'esbuild'

const ROOT = import.meta.dirname
const DIST = join(ROOT, 'dist')

// dist に入れないもの（ソース専用・開発用・公開不要）
const EXCLUDE = new Set([
  'dist', 'node_modules', '.git', '.github', '.claude',
  'build.mjs', 'package.json', 'package-lock.json',
  'README.md', '.gitignore',
  '.DS_Store', 'Thumbs.db',   // OS が撒くゴミ。配信するとファイル名が漏れる
])

const HTML_OPTS = {
  collapseWhitespace: true,
  removeComments: true,
  removeRedundantAttributes: false,   // ?v= 付きの src/href を壊さない
  minifyCSS: true,                    // <style> と style="" を圧縮
  minifyJS: { compress: true, mangle: true },   // <script> を圧縮
  sortAttributes: true,
  sortClassName: true,
}
// esbuild の charset 既定は ascii で、日本語を \uXXXX に展開して逆に太らせる。
// target を下げると ?. / ?? が展開されて同じく太る。どちらも明示的に止める。
const JS_OPTS = { loader: 'js', minify: true, legalComments: 'none', target: 'esnext', charset: 'utf8' }
const CSS_OPTS = { loader: 'css', minify: true, legalComments: 'none', charset: 'utf8' }

async function walk(dir, base = '') {
  const out = []
  for (const name of await readdir(dir)) {
    const rel = base ? `${base}/${name}` : name
    if (EXCLUDE.has(rel) || EXCLUDE.has(name)) continue
    const full = join(dir, name)
    if ((await stat(full)).isDirectory()) out.push(...await walk(full, rel))
    else out.push(rel)
  }
  return out
}

const rows = []
await rm(DIST, { recursive: true, force: true })
await mkdir(DIST, { recursive: true })

for (const rel of await walk(ROOT)) {
  const src = join(ROOT, rel)
  const dst = join(DIST, rel)
  await mkdir(join(dst, '..'), { recursive: true })
  const ext = extname(rel).toLowerCase()

  if (!['.html', '.css', '.js'].includes(ext)) {
    await cp(src, dst)   // 画像・動画・音声はそのまま
    continue
  }
  const raw = await readFile(src, 'utf8')
  const out = ext === '.html'
    ? await minifyHtml(raw, HTML_OPTS)
    : (await esbuild.transform(raw, ext === '.js' ? JS_OPTS : CSS_OPTS)).code
  await writeFile(dst, out)
  rows.push({ rel, before: Buffer.byteLength(raw, 'utf8'), after: Buffer.byteLength(out, 'utf8') })
}

const b = rows.reduce((s, x) => s + x.before, 0)
const a = rows.reduce((s, x) => s + x.after, 0)
for (const x of rows.sort((p, q) => q.before - p.before)) {
  console.log(`${x.rel.padEnd(24)} ${String(x.before).padStart(7)} -> ${String(x.after).padStart(7)}  -${((1 - x.after / x.before) * 100).toFixed(1)}%`)
}
console.log(`${'合計'.padEnd(23)} ${String(b).padStart(7)} -> ${String(a).padStart(7)}  -${((1 - a / b) * 100).toFixed(1)}%`)
