import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  build: {
    minify: true,          // これでJSの圧縮をOFF（esbuild/oxcどちらも無効化）
    cssMinify: true,       // CSSも圧縮したくない場合は追加（なくてもJSは無効になる）
  },
});