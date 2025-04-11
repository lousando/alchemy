import VttToObject from "npm:vtt-cue-object";
import { VttCue, WebVtt } from "npm:@audapolis/webvtt-writer@1.0.6";
import { crypto } from "@std/crypto/crypto";
import { encodeHex } from "@std/encoding/hex";
import { stopWordsDatabase, subTitleDatabase } from "./database.ts";

// cache for current run
let subTitleCache = await getAllSubTitleDocs();
const stopWords = (await stopWordsDatabase.list()).rows.map((r) => r.id);

interface ParsedCues {
  startTime: number;
  endTime: number;
  text: string;
}

export default async function cleanVTT(filePath = "") {
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

          const hash = encodeHex(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(cueText),
            ),
          );

          try {
            const subtitleRecord: Subtitle | undefined = subTitleCache.get(
              hash,
            );

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

          const foundStopWord = stopWords.reduce((acc, word) => {
            const stopWordRegex = new RegExp(word, "ig");
            return acc || stopWordRegex.test(cueText);
          }, false);

          if (foundStopWord) {
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
              // reset cache
              subTitleCache = await getAllSubTitleDocs();
              deletedCount++;
              continue;
            }

            await subTitleDatabase.insert({
              _id: hash,
              hash,
              command: "keep",
            });
            // reset cache
            subTitleCache = await getAllSubTitleDocs();
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

/**
 * Private Util
 */

// Structure of stored documents
interface Subtitle {
  _id: string;
  _rev: string;
  hash: string;
  command: string;
}

async function getAllSubTitleDocs(): Promise<Map<string, Subtitle>> {
  console.log("Reloading subtitle cache");
  const dbResponse = await subTitleDatabase.list({ include_docs: true });
  const subMap = new Map();

  dbResponse.rows.forEach((r) => {
    subMap.set(r.id, r.doc);
  });

  return subMap;
}
