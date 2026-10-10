import { defineConfig } from 'vite'

/**
 * Vite 配置
 *
 * 【最重要的一项】base
 *   GitHub Pages 的"项目站点"地址是：
 *     https://<用户名>.github.io/<仓库名>/
 *   本项目的地址将是：
 *     https://qinz5595-dev.github.io/Newgame/
 *   所以打包后的资源路径必须以 /Newgame/ 开头；
 *   如果写成 '/' 或 './'，线上会去 https://qinz5595-dev.github.io/ 根目录找文件，页面会白屏。
 *
 * 【本地开发不受影响】
 *   平时启动游戏用的是自己的零依赖服务器：
 *     pnpm dev        →  http://localhost:5173/          （直接读取 src/ 源码）
 *   它不走 Vite，所以 base 不会影响它。
 *   如果以后用 Vite 的开发服务器（pnpm dev:vite），地址会变成 http://localhost:5173/Newgame/
 */
export default defineConfig({
  base: '/Newgame/',

  server: {
    host: true,
    port: 5173,
    open: false,
  },

  preview: {
    host: true,
    port: 4173,
  },

  build: {
    // 打包产物目录（已在 .gitignore 中忽略，不会提交到仓库）
    outDir: 'dist',
    // 打包前先清空 dist，避免旧文件残留
    emptyOutDir: true,
    // 生成 sourcemap 会让产物变大，这里关掉
    sourcemap: false,
  },
})
