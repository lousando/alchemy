.PHONY: install clean

bin/alchemy: mod.ts
	deno compile -o ./bin/alchemy --allow-run --allow-read --allow-write --allow-env --allow-net ./mod.ts

install: mod.ts
	deno install --global -c deno.json -f --allow-run --allow-read --allow-write --allow-env --allow-net ./mod.ts

clean:
	rm -rf ./bin