.PHONY: install clean

bin/webm-convert: mod.ts
	deno compile -o ./bin/clean-cow --allow-run --allow-read --allow-write ./mod.ts

install: mod.ts
	deno install -c deno.json -f --allow-run --allow-read --allow-write ./mod.ts

clean:
	rm -rf ./bin