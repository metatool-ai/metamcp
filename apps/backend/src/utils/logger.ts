import { createWriteStream, WriteStream } from "fs";
import { format } from "util";
const { LOG_LEVEL } = process.env;

const validLogLevels = ["all", "info", "errors-only", "none"] as const;
type ValidLogLevel = (typeof validLogLevels)[number];

const getValidLogLevel = (
  level: string | undefined,
): LoggerOptions["shouldConsoleLog"] => {
  if (!level) return "errors-only";
  if (validLogLevels.includes(level as ValidLogLevel)) {
    return level as ValidLogLevel;
  }
  return "errors-only";
};

export interface LoggerOptions {
  logFilePath?: string;
  errorFilePath?: string;
  shouldConsoleLog?: boolean | "all" | "info" | "errors-only" | "none";
}

export class Logger {
  public static readonly defaultLogFilePath = "app.log";
  public static readonly defaultErrorFilePath = "error.log";

  private logFile: WriteStream | null;
  private errorFile: WriteStream | null;
  private consoleMode: "all" | "info" | "errors-only" | "none";

  constructor(options: LoggerOptions = {}) {
    const {
      logFilePath = Logger.defaultLogFilePath,
      errorFilePath = Logger.defaultErrorFilePath,
      shouldConsoleLog = "all",
    } = options;

    // A read-only or full file system must not crash the process: file
    // logging is then turned off (the console keeps working).
    this.logFile = createWriteStream(logFilePath, { flags: "a" });
    this.logFile.on("error", () => {
      this.logFile = null;
    });
    this.errorFile = createWriteStream(errorFilePath, { flags: "a" });
    this.errorFile.on("error", () => {
      this.errorFile = null;
    });

    this.consoleMode =
      typeof shouldConsoleLog === "boolean"
        ? shouldConsoleLog
          ? "all"
          : "none"
        : shouldConsoleLog;
  }

  private formatDate(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, "0");

    return (
      `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} - ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    );
  }

  private customLog(
    outputStream: "log" | "error",
    level: "DEBUG" | "INFO" | "WARN" | "ERROR",
    ...args: unknown[]
  ) {
    // LOG_LEVEL applies to the log files too (they are not rotated)
    const selected =
      this.consoleMode === "all" ||
      (this.consoleMode === "info" && level === "INFO") ||
      (this.consoleMode === "errors-only" &&
        (level === "WARN" || level === "ERROR"));
    if (!selected) return;

    // The first argument is a message, never a format string: messages
    // interpolate data ("%s" in a server name must stay text).
    const [first, ...rest] = args;
    const logMessage =
      typeof first === "string"
        ? format("%s", first, ...rest)
        : format(...args);
    const formattedMessage = `[${level}] ${this.formatDate(new Date())} | ${logMessage}\n`;

    (outputStream === "error" ? this.errorFile : this.logFile)?.write(
      formattedMessage,
    );

    const trimmed = formattedMessage.trim();
    if (level === "INFO") {
      console.info(trimmed);
    } else if (level === "ERROR") {
      console.error(trimmed);
    } else if (level === "WARN") {
      console.warn(trimmed);
    } else {
      console.log(trimmed);
    }
  }

  public debug = (...args: unknown[]) =>
    this.customLog("log", "DEBUG", ...args);
  public info = (...args: unknown[]) => this.customLog("log", "INFO", ...args);
  public warn = (...args: unknown[]) => this.customLog("log", "WARN", ...args);
  public error = (...args: unknown[]) =>
    this.customLog("error", "ERROR", ...args);

  public close(): void {
    this.logFile?.end();
    this.errorFile?.end();
  }
}

const logger = new Logger({
  shouldConsoleLog: getValidLogLevel(LOG_LEVEL),
});

export default logger;
