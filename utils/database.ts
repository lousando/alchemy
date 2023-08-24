import * as yaml from "std/yaml/mod.ts";
import nano from "npm:nano@10.1.2";

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

/**
 * databases
 */
export const subTitleDatabase = remoteDB.use("clean_cow_subtitles");
export const stopWordsDatabase = remoteDB.use("clean_cow_stop_words");
