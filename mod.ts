#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env

import { parse as parseFlags } from "std/flags/mod.ts";
import { ParsedPath } from "std/path/mod.ts";
import { SEP } from "std/path/separator.ts";
import { parse as parsePath } from "std/path/posix.ts";
import { Database } from "aloedb";

const args = parseFlags(Deno.args, {
  stopEarly: true, // populates "_"
});

const filesToConvert: Array<ParsedPath> = args._.map((f) =>
  parsePath(String(f))
);

// Structure of stored documents
interface Subtitle {
  hash: string;
}

// init
const database = new Database<Subtitle>(`${Deno.env.get("HOME")}/.clean_cow.json`);

for (const file of filesToConvert) {
  const filePath = `${file.dir}${SEP}${file.base}`;

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
  if (extension === ".mp4") {
    // convert external subs
    await Deno.run({
      stdout: "piped",
      stdin: "null", // ignore this program's input
      stderr: "null", // ignore this program's input
      cmd: [
        "ffmpeg",
        "-i",
        filePath,
        "-c:v",
        "copy",
        "-c:a",
        "copy",
        "-sn", // no subs
        `${file.dir + SEP + file.name}.mkv`,
      ],
    }).status();

    console.log("Converted to mkv: ", filePath);
    await cleanMKV(`${file.dir + SEP + file.name}.mkv`);
    await Deno.remove(filePath);
  } else if (extension === ".mkv" || extension === ".webm") {
    await cleanMKV(filePath);
  } else if (extension === ".srt") {
    const vttFilename = `${file.dir + SEP + file.name}.vtt`;

    // convert external subs
    await Deno.run({
      stdout: "piped",
      stdin: "null", // ignore this program's input
      stderr: "null", // ignore this program's input
      cmd: [
        "ffmpeg",
        "-i",
        filePath,
        vttFilename,
      ],
    }).status();

    await Deno.remove(filePath);
    console.log("Converted to vtt: ", filePath);
    await cleanVTT(vttFilename);
  } else if (extension === ".vtt") {
    await cleanVTT(filePath);
  }
}

/**
 * Util
 */

async function cleanVTT(filePath = "") {
  const srtContents = await Deno.readTextFile(filePath);

  if (
    srtContents.match(/4KVOD\.TV/ig)
  ) {
    danger(`${filePath} contains "4KVOD.TV"`);
  }

  if (
    srtContents.includes("explosiveskull")
  ) {
    danger(`${filePath} contains "explosiveskull"`);
  }

  if (
    srtContents.includes("ecOtOne")
  ) {
    danger(`${filePath} contains "ecOtOne"`);
  }

  if (
    srtContents.includes("P@rM!NdeR M@nkÖÖ")
  ) {
    danger(`${filePath} contains "P@rM!NdeR M@nkÖÖ"`);
  }

  if (
    srtContents.includes("@fashionstyles_4u")
  ) {
    danger(`${filePath} contains "@fashionstyles_4u"`);
  }

  if (
    srtContents.match(/http/ig)
  ) {
    danger(`${filePath} contains "http"`);
  }

  if (
    srtContents.match(/uploaded by/ig)
  ) {
    danger(`${filePath} contains "uploaded by"`);
  }

  if (
    srtContents.match(/@gmail\.com/ig)
  ) {
    danger(`${filePath} contains "@gmail.com"`);
  }

  if (
    srtContents.match(/@hotmail\.com/ig)
  ) {
    danger(`${filePath} contains "@hotmail.com"`);
  }

  if (
    srtContents.match(/allsubs/ig)
  ) {
    danger(`${filePath} contains "AllSubs"`);
  }

  if (
    srtContents.match(/torrent/ig)
  ) {
    warn(`${filePath} contains "torrent"`);
  }

  if (
    srtContents.includes("@")
  ) {
    warn(`${filePath} contains "@"`);
  }

  if (
    srtContents.match(/copyright/ig)
  ) {
    warn(`${filePath} contains "copyright"`);
  }

  if (
    srtContents.match(/subtitle/ig)
  ) {
    warn(`${filePath} contains "subtitle"`);
  }
}

async function cleanMKV(filePath = "") {
  // make backup
  await Deno.rename(filePath, `${filePath}.backup`);

  // remove video subs and title metadata
  const removeSubsTask = Deno.run({
    stdout: "piped",
    stdin: "null", // ignore this program's input
    stderr: "null", // ignore this program's input
    cmd: [
      "ffmpeg",
      "-i",
      `${filePath}.backup`,
      "-c",
      "copy",
      "-sn", // no subs
      /**
       * no title
       */
      "-metadata",
      "title=",
      filePath,
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
}

function warn(message = "") {
  console.log(`%c${message}`, "color: yellow");
}

function danger(message = "") {
  console.log(`%c${message}`, "color: red");
}
