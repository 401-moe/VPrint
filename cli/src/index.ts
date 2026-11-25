import { Command, InvalidArgumentError } from "commander";
import manifest from "../package.json" with { type: "json" };
import { errorMessage, report } from "./terminal.ts";
import { login, logout } from "./auth.ts";
import { printFile, useContest } from "./printing.ts";

function selector(value: string) {
  if (!value.trim()) throw new InvalidArgumentError("请输入名称或 ID。");
  return value;
}

const cli = new Command("vprint")
  .usage("[选项] [文件] 或 vprint <命令>")
  .description("将文件打印到当前目录绑定的比赛。")
  .version(manifest.version, "-V, --version", "显示版本")
  .configureHelp({
    styleSubcommandTerm: term => term.replace("[options]", "[选项]"),
    styleTitle: title => ({ "Usage:": "用法", "Arguments:": "参数", "Options:": "选项", "Commands:": "命令" })[title] ?? title,
  })
  .helpOption("-h, --help", "显示帮助")
  .helpCommand(false)
  .enablePositionalOptions()
  .option("-y, --yes", "显示打印信息后直接打印")
  .allowExcessArguments()
  .argument("[文件]", "要打印的一个 UTF-8 文本文件")
  .action(async (file: string | undefined, options: { yes?: boolean }) => {
    if (cli.args.length > 1) throw new Error("每次只能打印一个文件，请分别运行 vprint。");
    if (file !== undefined) await printFile(file, Boolean(options.yes));
    else if (process.argv.length > 2) throw new Error("请指定要打印的文件。");
    else cli.outputHelp();
  });

cli.command("login").description("登录本机").action(login);
cli.command("use")
  .usage("[--team <名称或ID>] [--contest <名称或ID>]")
  .description("为当前目录选择比赛。交互终端可补选，脚本须同时指定队伍和比赛。")
  .option("--team <名称或ID>", "选择队伍", selector)
  .option("--contest <名称或ID>", "选择该队的比赛", selector)
  .addHelpText("after", "\n示例\n  vprint use\n  vprint use --team 校队\n  vprint use --team 校队 --contest 周六训练")
  .action(useContest);
cli.command("logout").description("退出本机登录").action(logout);

async function main(args: string[]) {
  // Commander dispatches subcommand names even after the end-of-options marker.
  const separator = args.indexOf("--");
  if (separator >= 0 && cli.commands.some(command => command.name() === args[separator + 1])) {
    args[separator + 1] = "./" + args[separator + 1];
  }
  await cli.parseAsync(args, { from: "user" });
}

main(process.argv.slice(2)).catch(error => {
  report("error", errorMessage(error));
  process.exitCode = 1;
});
