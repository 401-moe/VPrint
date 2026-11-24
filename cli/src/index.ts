import { login, logout } from "./auth.ts";
import { printFiles, useContest } from "./printing.ts";

async function main(args: string[]) {
  if (args.length === 1 && args[0] === "login") return login();
  if (args.length === 1 && args[0] === "logout") return logout();
  if (args.length === 1 && args[0] === "use") return useContest();
  if (!args.length || args[0] === "--help" || args[0] === "-h") {
    console.log("vprint login   登录本机\nvprint use     为当前目录选择比赛\nvprint <文件...>  打印一个或多个文件\nvprint logout  退出本机登录");
    return;
  }
  const paths = args[0] === "--" ? args.slice(1) : args;
  if (paths.length) return printFiles(paths);
  throw new Error("请指定要打印的文件。");
}

main(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : "VPrint 请求失败。");
  process.exitCode = 1;
});
