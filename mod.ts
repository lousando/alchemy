#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env

import { parse as parseFlags } from "std/flags/mod.ts";
import { ParsedPath } from "std/path/mod.ts";
import { SEP } from "std/path/separator.ts";
import { parse as parsePath } from "std/path/posix.ts";
import { Database } from "aloedb";
import { VTTCue, WebVTT } from "npm:vtt.js@0.13.0";
import {
  VttCue as AudapolisVttCue,
  WebVtt as AudapolisWebVTT,
} from "npm:@audapolis/webvtt-writer@1.0.6";
import { crypto } from "std/crypto/mod.ts";
import { toHashString } from "std/crypto/to_hash_string.ts";

const vttParser = new WebVTT.Parser({
  VTTCue,
}, WebVTT.StringDecoder());

const args = parseFlags(Deno.args, {
  stopEarly: true, // populates "_"
});

const filesToConvert: Array<ParsedPath> = args._.map((f) =>
  parsePath(String(f))
);

// Structure of stored documents
interface Subtitle {
  hash: string;
  command: string;
}

// init
const subTitleDatabase = new Database<Subtitle>(
  `${Deno.env.get("HOME")}/.clean_cow.json`,
);

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
  const vttContents = await Deno.readTextFile(filePath);
  const newVtt = new AudapolisWebVTT();

  return new Promise((resolve, reject) => {
    vttParser.onflush = resolve;

    vttParser.onparsingerror = (error) => reject(error);

    vttParser.oncue = async function (cue) {
      const cueText = cue.text.trim();
      const newCue = new AudapolisVttCue({
        startTime: cue.startTime,
        endTime: cue.endTime,
        payload: cueText,
      });

      const hash = toHashString(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(cueText),
        ),
      );

      const subtitleRecord: Subtitle = await subTitleDatabase.findOne({ hash });

      if (subtitleRecord?.command === "delete") {
        return;
      }

      if (subtitleRecord?.command === "keep") {
        newVtt.add(newCue);
        return;
      }

      if (
        cueText.match(/4KVOD\.TV/ig) ||
        cueText.match(/explosiveskull/ig) ||
        cueText.match(/ecOtOne/ig) ||
        cueText.includes("P@rM!NdeR M@nkÖÖ") ||
        cueText.includes("@fashionstyles_4u") ||
        cueText.match(/http/ig) ||
        cueText.match(/uploaded by/ig) ||
        cueText.match(/@gmail\.com/ig) ||
        cueText.match(/@hotmail\.com/ig) ||
        cueText.match(/allsubs/ig) ||
        cueText.match(/torrent/ig) ||
        cueText.includes("@") ||
        cueText.match(/copyright/ig) ||
        cueText.match(/subtitle/ig)
      ) {
        danger(`${filePath} contains "${cueText}"`);
        const shouldDeleteInFuture = confirm("Delete this text from now on?");

        if (shouldDeleteInFuture) {
          await subTitleDatabase.insertOne({
            hash,
            command: "delete",
          });
          return;
        }

        await subTitleDatabase.insertOne({
          hash,
          command: "keep",
        });
      }

      newVtt.add(newCue);
    };

    vttParser.parse(vttContents);

    vttParser.flush();
  });
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
