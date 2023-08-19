#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env

import { parse as parseFlags } from "std/flags/mod.ts";
import { ParsedPath } from "std/path/mod.ts";
import { SEP } from "std/path/separator.ts";
import { parse as parsePath } from "std/path/posix.ts";
import { Database } from "aloedb";
import VttToObject from "npm:vtt-cue-object";
import { VttCue, WebVtt } from "npm:@audapolis/webvtt-writer@1.0.6";
import { crypto } from "std/crypto/mod.ts";
import { toHashString } from "std/crypto/to_hash_string.ts";

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
  if (extension === ".mp4" || extension === ".avi") {
    // convert external subs
    await Deno.run({
      stdout: "piped",
      stdin: "null", // ignore this program's input
      stderr: "null", // ignore this program's input
      cmd: [
        "ffmpeg",
        "-i",
        filePath,

        /**
         * Copy all streams
         */
        "-map",
        "0",

        "-c:v",
        "copy",
        "-c:a",
        "copy",
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

interface ParsedCues {
  startTime: number;
  endTime: number;
  text: string;
}

async function cleanVTT(filePath = "") {
  const vttContents = await Deno.readTextFile(filePath);
  const newVtt = new WebVtt();

  return new Promise((resolve) => {
    let deletedCount = 0;

    VttToObject(
      vttContents,
      async function (error, result: { cues: ParsedCues[] }) {
        if (error) {
          console.error(`Failed to parse ${filePath}`);
          return resolve(error);
        }

        for (const cue of result.cues) {
          const cueText = cue.text.trim();

          let newCue;

          try {
            newCue = new VttCue({
              startTime: cue.startTime,
              endTime: cue.endTime,
              payload: cueText,
            });
          } catch (error) {
            console.error(
              `Failed to create cue for ${filePath} @ ${cue.startTime}`,
            );
            return resolve(error);
          }

          const hash = toHashString(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(cueText),
            ),
          );

          const subtitleRecord: Subtitle = await subTitleDatabase.findOne({
            hash,
          });

          if (subtitleRecord?.command === "delete") {
            deletedCount++;
            continue;
          }

          if (subtitleRecord?.command === "keep") {
            newVtt.add(newCue);
            continue;
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
            cueText.match(/subtitle/ig) ||
            cueText.match(/Subscene/ig) ||
            cueText.match(/DonToribio/ig) ||
            cueText.match(/synced/ig)
          ) {
            console.log(
              `%c\n${filePath} contains:\n${cue.startTime} --> ${cue.endTime}\n"${cueText}\n`,
              "color: yellow",
            );
            const shouldDeleteInFuture = confirm(
              "Delete this text from now on?",
            );

            if (shouldDeleteInFuture) {
              await subTitleDatabase.insertOne({
                hash,
                command: "delete",
              });
              deletedCount++;
              continue;
            }

            await subTitleDatabase.insertOne({
              hash,
              command: "keep",
            });
          }

          newVtt.add(newCue);
        }

        if (deletedCount > 0) {
          console.log(
            `%cRemoving unwanted cues for ${filePath}`,
            "color: cyan",
          );
          // overwrite file
          await Deno.writeTextFile(filePath, newVtt.toString(), {
            mode: 0o664,
          });
        }

        resolve();
      },
    );
  });
}

async function cleanMKV(filePath = "") {
  // remove unwanted video meta
  const cleanMkvTask = await Deno.run({
    stdout: "piped",
    stdin: "null", // ignore this program's input
    stderr: "null", // ignore this program's input
    cmd: [
      "mkvpropedit",
      "-d",
      // no video title
      "title",
      // no audio track title names
      "--edit",
      "track:a1",
      "-d",
      "name",
      "--edit",
      "track:a2",
      "-d",
      "name",
      filePath,
    ],
  });

  if (await cleanMkvTask.status()) {
    console.log("Cleaned: ", filePath);
  } else {
    // task failed, restore backup
    console.error("Failed to clean: ", filePath);
  }
}
