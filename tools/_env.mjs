// Shared environment of the test / capture tools.
//   BASE        dev-server URL, from TOF_URL (default http://127.0.0.1:5173/). Several dev servers can run side by
//               side (`npx vite --port 5181 --strictPort` + TOF_URL=http://127.0.0.1:5181/).
//   PORT        port of BASE (tools that start their own dev server use it).
//   SOFT        software WebGL (SwiftShader) when --soft is passed or TOF_SOFT=1; otherwise the real GPU
//               (full Chromium in new headless mode, which keeps hardware acceleration).
//   launchOpts(extraArgs, { headed })  options for chromium.launch(). PW_EXE = explicit Chromium binary (cloud).
export const BASE = (process.env.TOF_URL || 'http://127.0.0.1:5173/').replace(/\/?$/, '/');
export const PORT = new URL(BASE).port || '5173';
export const SOFT = process.env.TOF_SOFT === '1' || process.argv.includes('--soft');

export function launchOpts(extra = [], { headed = false } = {}) {
  const exe = process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : null;
  if (SOFT) return { ...(exe || {}), headless: !headed, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...extra] };
  return { ...(exe || { channel: 'chromium' }), headless: !headed, args: ['--enable-gpu', '--ignore-gpu-blocklist', ...extra] };
}
