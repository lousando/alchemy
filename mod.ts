#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env --allow-net --allow-sys

import "zx/globals";
import { parse as parseFlags } from "std/flags/mod.ts";
import { ParsedPath } from "std/path/mod.ts";
import { SEP } from "std/path/separator.ts";
import { parse as parsePath } from "std/path/posix.ts";
import cleanVTT from "./utils/cleanVTT.ts";
import cleanMKV from "./utils/cleanMKV.ts";

const args = parseFlags(Deno.args, {
  stopEarly: true, // populates "_"
});

const filesToConvert: Array<ParsedPath> = args._.map((f) =>
  parsePath(String(f))
);

for (const file of filesToConvert) {
  let fileDirectory = file.dir;

  // file is in the current directory
  if (fileDirectory === "") {
    fileDirectory = ".";

  }

  const filePath = `${fileDirectory}${SEP}${file.base}`;

  let fileInfo;

  try {
    fileInfo = await Deno.stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log(`Not found: ${filePath}`);
      continue;
    }

    console.error("ERROR: ", error);
    Deno.exit(1);
  }

  if (fileInfo.isDirectory) {
    // skip this
    continue;
  }

  const extension = file.ext.toLowerCase();

  // convert to MkV
  if (extension === ".mp4" || extension === ".avi" || extension === ".flv") {
    console.log("Converting: ", filePath);

    const flagsCopyAllStreams = [
      /**
       * Copy all streams
       */
      "-map",
      "0",

      "-c:v",
      "copy",
      "-c:a",
      "copy",
    ];

    const newFileName = `${fileDirectory + SEP + file.name}.mkv`;

    // -sn = no subs
    await spinner(() => $`ffmpeg -hide_banner -loglevel error -i ${filePath} ${flagsCopyAllStreams} -sn ${newFileName}`);

    console.log("Converted to mkv: ", filePath);
    await cleanMKV(newFileName);

    // todo: make removal explicit
    await Deno.remove(filePath);
  } else if (extension === ".mkv" || extension === ".webm") {
    await cleanMKV(filePath);
  } else if (extension === ".srt") {
    const vttFilename = `${fileDirectory + SEP + file.name}.vtt`;

    // convert external subs
    await spinner(() => $`ffmpeg -hide_banner -loglevel error -i ${filePath} ${vttFilename}`);

    // todo: make removal explicit
    await Deno.remove(filePath);
    console.log("Converted to vtt: ", filePath);
    await cleanVTT(vttFilename);
  } else if (extension === ".vtt") {
    await cleanVTT(filePath);
  }
}
