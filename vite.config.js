import { defineConfig } from 'vite'

// Vite 开发/构建配置
export default defineConfig({
  // host: true 让同一 WiFi 下的手机也能访问电脑上的开发服务器
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
    outDir: 'dist',
    // 以后要部署到 GitHub Pages 时，若仓库名不是根路径，在这里改成 '/仓库名/'
    base: './',
  },
})
