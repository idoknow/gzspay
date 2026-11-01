// 主题先行：在 React 之前写入 data-theme，避免首帧主题闪动。
// 独立文件而不是内联脚本，生产环境才能启用 CSP「script-src 'self'」。
(function () {
  try {
    var mode = localStorage.getItem("gzspay-theme") || "auto";
    var dark =
      mode === "dark" ||
      (mode === "auto" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (error) {
    document.documentElement.dataset.theme = "light";
  }
})();
