.PHONY: build dev test clean

build:
	cargo build --release -p maestro-mcp-server
	npm run tauri build

dev:
	npm run tauri dev

test:
	npm run test
	cd src-tauri && cargo test --workspace

clean:
	cargo clean
	rm -rf dist
	rm -rf src-tauri/binaries
