import { login, logout } from "./auth.ts";

async function main(args: string[]) {
  if (args.length === 1 && args[0] === "login") return login();
  if (args.length === 1 && args[0] === "logout") return logout();
  if (!args.length || args[0] === "--help" || args[0] === "-h") {
    console.log("vprint login   登录本机\nvprint logout  退出本机登录");
    return;
  }
  throw new Error("无法识别该命令，运行 vprint --help 查看用法。");
}

main(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : "VPrint 请求失败。");
  process.exitCode = 1;
});
