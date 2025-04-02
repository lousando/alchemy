export default async function cleanMKV(filePath = "") {
  console.log(`Cleaning ${filePath}`);

  const mediaInfoCommand = await $`mediainfo --Output=JSON ${filePath}`;

  let mediaInfo;

  try {
    mediaInfo = JSON.parse(mediaInfoCommand.stdout);
  } catch (_error) {
    console.error(
      `%cFailed to parse video metadata for ${filePath}.`,
      "color: red",
    );
    console.error(mediaInfoCommand.stderr);
    // console.error(
    //   `%cWill attempt to patch video metadata for ${filePath}.`,
    //   "color: yellow",
    // );
    // await removeSubs(filePath);
    // await cleanMetadata(filePath);
    return;
  }

  const hasSubs = mediaInfo.media?.track?.find((t) => t["@type"] === "Text");

  if (mediaInfoCommand.exitCode !== 0) {
    console.error("%cFailed to get video metadata.", "color: red");
    return;
  }

  if (!hasSubs) {
    console.log("No subs found");
    console.log(`%cCleaned: ${filePath}`, "color: green");
    return;
  }

  await cleanMetadata(filePath);

  console.log("%cSubs found, removing...", "color: yellow");
  await removeSubs(filePath);
}

async function cleanMetadata(filePath = "") {
  const flags = [
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
  ];

  // remove unwanted video meta
  const mkvpropeditCommand = await $`mkvpropedit ${flags} ${filePath}`;

  if (mkvpropeditCommand.exitCode !== 0) {
    console.error(
      `%cFailed to Remove video metadata [${mkvpropeditCommand.exitCode}]: ${filePath}`,
      "color: red",
    );
    console.error(mkvpropeditCommand.stderr);
    return;
  }
}

async function removeSubs(filePath = "") {
  // make backup
  await Deno.rename(filePath, `${filePath}.backup`);

  const flags = [
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
  ];

  // remove video subs and title metadata
  const removeSubsTask =
    await $`ffmpeg -i ${filePath}.backup ${flags} ${filePath}`;

  if (removeSubsTask.exitCode === 0) {
    await Deno.remove(`${filePath}.backup`);
    console.log(`%cCleaned: ${filePath}`, "color: green");
  } else {
    // task failed, restore backup
    await Deno.rename(`${filePath}.backup`, filePath);
    console.error("Failed to clean: ", filePath);
  }
}
