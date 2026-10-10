/**
 * 零依赖本地开发服务器（只用 Node.js 自带模块，不需要安装任何东西）
 *
 * 用法：
 *   node tools/dev-server.mjs                 服务器根目录 = 项目目录
 *   node tools/dev-server.mjs --dir dist      服务器根目录 = dist（预览构建结果）
 *   node tools/dev-server.mjs --port 8080     换一个端口
 *
 * 作用：把项目里的 HTML / CSS / JS 通过 http:// 提供给浏览器。
 * 为什么需要它：浏览器不允许用 file:// 直接打开 ES 模块（会报 CORS 错误），
 * 所以必须有一个小服务器把文件发出去。
 */
import { createServer } from 'node:http'
import { createReadStream, promises as fs } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

const args = process.argv.slice(2)
function readArg(name, fallback) {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const serveDir = resolve(PROJECT_ROOT, readArg('--dir', '.'))
const port = Number(readArg('--port', process.env.PORT || 5173))

// 浏览器需要的文件类型对照表
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
}

/** 把网址路径转换成磁盘上的真实文件；找不到或不安全就返回 null */
async function resolveFile(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split('?')[0])
  const target = normalize(join(serveDir, cleanPath))

  // 安全检查：不允许通过 ../ 访问项目目录以外的文件
  if (target !== serveDir && !target.startsWith(serveDir + sep)) return null

  try {
    const info = await fs.stat(target)
    if (info.isDirectory()) {
      const indexFile = join(target, 'index.html')
      await fs.stat(indexFile)
      return indexFile
    }
    return target
  } catch {
    return null
  }
}

const server = createServer(async (req, res) => {
  const file = await resolveFile(req.url || '/')

  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`404 找不到：${req.url}`)
    return
  }

  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    // 开发阶段不要缓存，改完代码刷新即可看到最新效果
    'cache-control': 'no-store',
  })
  createReadStream(file).pipe(res)
})

// 判断网卡是不是"真实局域网"：VPN、虚拟机网卡对别人访问没有用，单独列出来，避免看错地址
const VIRTUAL_HINTS = [
  'vpn',
  'virtual',
  'veethernet',
  'vmware',
  'hyper-v',
  'loopback',
  'radmin',
  'lightxtreme',
  'zerotier',
  'tailscale',
  'wsl',
  'docker',
  'tap',
  'tun',
]

function collectAddresses() {
  const real = []
  const virtual = []
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const item of list || []) {
      if (item.family !== 'IPv4' || item.internal) continue
      const lowerName = name.toLowerCase()
      const entry = { name, address: item.address }
      if (VIRTUAL_HINTS.some((hint) => lowerName.includes(hint))) virtual.push(entry)
      else real.push(entry)
    }
  }
  return { real, virtual }
}

server.listen(port, '0.0.0.0', () => {
  const { real, virtual } = collectAddresses()

  console.log('')
  console.log('  本地开发服务器已启动')
  console.log(`  ① 这台电脑自己打开：http://localhost:${port}/`)

  if (real.length > 0) {
    console.log(`  ② 别人（同一 WiFi 下的电脑 / 手机）打开：http://${real[0].address}:${port}/`)
    for (const item of real.slice(1)) {
      console.log(`     其他网卡（${item.name}）：http://${item.address}:${port}/`)
    }
    console.log('     ⚠ 别人必须用上面这个"带 IP 的地址"，不能用 localhost')
    console.log('       （localhost 指的就是他自己那台电脑，当然打不开）')
    console.log('     ⚠ 打不开时依次检查：1) 两台设备连的是同一个 WiFi；2) 允许 Node.js 通过 Windows 防火墙')
  } else {
    console.log('  ② 没有找到可对外的局域网地址，别人可能无法访问')
  }

  for (const item of virtual) {
    console.log(`  （${item.name} 是虚拟/VPN 网卡，一般不用：http://${item.address}:${port}/）`)
  }

  console.log('  停止服务器：在本窗口按 Ctrl+C')
})
