#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env --allow-net

import { parse as parseFlags } from "std/flags/mod.ts";
import { ParsedPath } from "std/path/mod.ts";
import { SEP } from "std/path/separator.ts";
import { parse as parsePath } from "std/path/posix.ts";
import VttToObject from "npm:vtt-cue-object";
import { VttCue, WebVtt } from "npm:@audapolis/webvtt-writer@1.0.6";
import { crypto } from "std/crypto/mod.ts";
import { toHashString } from "std/crypto/to_hash_string.ts";
import nano from "npm:nano@10.1.2";
import * as yaml from "std/yaml/mod.ts";

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

const configFilePath = `${Deno.env.get("HOME")}/.clean_cow.yaml`;

let config;

try {
  config = yaml.parse(
    await Deno.readTextFile(configFilePath),
  );
} catch (error) {
  if (error.code === "ENOENT") {
    await Deno.writeTextFile(
      configFilePath,
      yaml.stringify({
        couchdb_url: "http://admin:password@localhost:5984",
      }),
    );
    console.log(`Created config file at: ${configFilePath}`);
    Deno.exit(0);
  } else {
    console.error(error);
    Deno.exit(1);
  }
}

const remoteDB = nano(config.couchdb_url);
const subTitleDatabase = remoteDB.use("clean_cow_subtitles");

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
    console.log("Converting: ", filePath);

    // convert external subs
    await new Deno.Command("ffmpeg", {
      args: [
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
        "-sn", // no subs
        `${file.dir + SEP + file.name}.mkv`,
      ],
    }).output();

    console.log("Converted to mkv: ", filePath);
    await cleanMKV(`${file.dir + SEP + file.name}.mkv`);
    await Deno.remove(filePath);
  } else if (extension === ".mkv" || extension === ".webm") {
    await cleanMKV(filePath);
  } else if (extension === ".srt") {
    const vttFilename = `${file.dir + SEP + file.name}.vtt`;

    // convert external subs
    await new Deno.Command("ffmpeg", {
      args: [
        "-i",
        filePath,
        vttFilename,
      ],
    }).output();

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
  console.log(`Processing: ${filePath}`);

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

          try {
            const subtitleRecord: Subtitle = await subTitleDatabase.get(hash);

            if (subtitleRecord?.command === "delete") {
              deletedCount++;
              continue;
            }

            if (subtitleRecord?.command === "keep") {
              newVtt.add(newCue);
              continue;
            }
          } catch (_error) {
            // intentionally left blank
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
            cueText.match(/synced/ig) ||
            cueText.match(/YTS\.MX/ig) ||
            cueText.match(/YIFY/ig)
          ) {
            console.log(
              `%c\n${filePath} contains:\n${cue.startTime} --> ${cue.endTime}\n"${cueText}\n`,
              "color: yellow",
            );
            const shouldDeleteInFuture = confirm(
              "Delete this text from now on?",
            );

            if (shouldDeleteInFuture) {
              await subTitleDatabase.insert({
                _id: hash,
                hash,
                command: "delete",
              });
              deletedCount++;
              continue;
            }

            await subTitleDatabase.insert({
              _id: hash,
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

        console.log(`%cCleaned: ${filePath}`, "color: green");

        resolve();
      },
    );
  });
}

async function cleanMKV(filePath = "") {
  const mediaInfoCommand = await new Deno.Command("mediainfo", {
    args: [
      "--Output=JSON",
      filePath,
    ],
  }).output();

  const mediaInfo = JSON.parse(
    new TextDecoder().decode(mediaInfoCommand.stdout),
  );

  const hasSubs = mediaInfo.media?.track?.find((t) => t["@type"] === "Text");

  if (mediaInfoCommand.code !== 0) {
    console.error("%cFailed to get video metadata.", "color: red");
    Deno.exit(mediaInfoCommand.code);
  }

  // remove unwanted video meta
  const mkvpropeditCommand = await new Deno.Command("mkvpropedit", {
    args: [
      // no video title
      "-d",
      "title",
      // no audio track title names
      "--edit",
      "track:a1",
      "-d",
      "name",
      // todo: more intelligently remove all audio track names
      // "--edit",
      // "track:a2",
      // "-d",
      // "name",
      filePath,
    ],
  }).output();

  if (mkvpropeditCommand.code !== 0) {
    console.error(
      `%cFailed to Remove video metadata [${mkvpropeditCommand.code}]: ${filePath}`,
      "color: red",
    );
    console.error(new TextDecoder().decode(mediaInfoCommand.stderr));
    return;
  }

  if (!hasSubs) {
    console.log("No subs found");
    console.log(`%cCleaned: ${filePath}`, "color: green");
    return;
  }

  console.log("Subs found, removing...");

  // make backup
  await Deno.rename(filePath, `${filePath}.backup`);

  // remove video subs and title metadata
  const removeSubsTask = await new Deno.Command("ffmpeg", {
    args: [
      "-i",
      `${filePath}.backup`,

      /**
       * Copy all streams
       */
      "-map",
      "0",

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
  }).output();

  if (removeSubsTask.code === 0) {
    await Deno.remove(`${filePath}.backup`);
    console.log(`%cCleaned: ${filePath}`, "color: green");
  } else {
    // task failed, restore backup
    await Deno.rename(`${filePath}.backup`, filePath);
    console.error("Failed to clean: ", filePath);
  }
}
