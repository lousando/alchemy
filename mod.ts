#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write

import { parse as parseFlags } from "std/flags/mod.ts";
import { ParsedPath } from "std/path/mod.ts";
import { parse as parsePath } from "std/path/posix.ts";

const args = parseFlags(Deno.args, {
  stopEarly: true, // populates "_"
});

const filesToConvert: Array<ParsedPath> = args._.map((f) =>
  parsePath(String(f))
);

filesToConvert.map(async (file) => {
  const filePath = file.dir + file.base;
  const extension = file.ext.toLowerCase();

  if (extension === ".mkv" || extension === ".webm") {
    await Deno.run({
      stdout: "piped",
      stdin: "null", // ignore this program's input
      stderr: "null", // ignore this program's input
      cmd: [
        "mkvpropedit",
        "-d",
        "title",
        filePath,
      ],
    }).status();

    // make backup
    await Deno.rename(filePath, `${filePath}.backup`);

    // remove video subs
    const removeSubsTask = Deno.run({
      stdout: "piped",
      stdin: "null", // ignore this program's input
      stderr: "null", // ignore this program's input
      cmd: [
        "mkvmerge",
        "-o",
        filePath,
        "--no-subtitles",
        `${filePath}.backup`,
      ],
    });

    if (await removeSubsTask.status()) {
      await Deno.remove(`${filePath}.backup`);
      console.log("Cleaned: ", filePath);
    } else {
      // task failed, restore backup
      await Deno.rename(`${filePath}.backup`, filePath);
      console.error("Failed to clean: ", filePath);
    }
  } else if (extension === ".srt") {
    // convert external subs
    await Deno.run({
      stdout: "piped",
      stdin: "null", // ignore this program's input
      stderr: "null", // ignore this program's input
      cmd: [
        "ffmpeg",
        "-i",
        filePath,
        `${file.dir + file.name}.vtt`,
      ],
    }).status();

    await Deno.remove(filePath);
    console.log("Converted: ", filePath);
  }
});
