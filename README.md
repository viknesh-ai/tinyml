# tinyml

[![CI](https://github.com/viknesh-ai/tinyml/actions/workflows/ci.yml/badge.svg)](https://github.com/viknesh-ai/tinyml/actions/workflows/ci.yml)
![Python](https://img.shields.io/badge/python-3.11%2B-blue)
![License](https://img.shields.io/badge/license-Apache--2.0-green)
![Runs locally](https://img.shields.io/badge/runs-100%25%20locally-orange)

**Goal-first TinyML.** Describe in one sentence what a sensor should detect, upload a CSV, and get back a C library that is **proven** to give the same answers on the microcontroller as in Python, plus a ranking of the chips it fits on. Everything runs on your own machine.

```
"Alert me when my pump vibration looks abnormal. Battery, Wi-Fi."  +  pump.csv
        │
        ▼
 checks the data ─► rules → classic ML (settings tuned by cross-validation; stops at the simplest that works)
        │
        ▼
 C99 library ─► compiled with each chip's own compiler ─► run in an emulator ─► parity with Python
        │
        ▼
 top 3 chips with reasons  +  signed .zip (library, C++ wrapper, example, calibration, parity test, report)
```

## Contents

- [Why tinyml](#why-tinyml)
- [Requirements](#requirements)
- [Installation](#installation)
- [Running the app](#running-the-app)
- [Command line](#command-line)
- [What you get](#what-you-get)
- [Supported chips](#supported-chips)
- [How every number is sourced](#how-every-number-is-sourced)
- [The assistant](#the-assistant)
- [Project layout](#project-layout)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Why tinyml

- **Verified, not hoped.** No package ships unless golden-vector parity between Python and the compiled C passes inside an emulator of the target chip.
- **Simplest model that works.** An algorithm ladder tries rules first, then classic ML (random forest, XGBoost, isolation forest), and recommends the simplest method that meets the goal. Settings are chosen by cross-validation on the training recordings; the test recordings are used once, for the final score.
- **A person stays in the loop.** After every step a review card (written by code, not AI) appears in the assistant panel. Running jobs can be paused, resumed or cancelled, and optional review gates make each step wait for your approval.
- **Honest numbers.** Every flash, RAM, latency and energy figure comes from a compiler, linker, emulator or catalog, and is tagged `measured`, `emulated` or `estimated`.
- **Private by design.** No cloud services. Raw sensor data never leaves your machine; the optional assistant only ever sees column summaries.

## Requirements

| | |
|---|---|
| OS | macOS (Apple silicon or Intel) or Linux |
| Python | 3.11+ (managed by [uv](https://docs.astral.sh/uv/)) |
| Host compiler | Clang or GCC (for the host-side parity check) |
| Optional, per chip family | Arm GNU Toolchain, xPack RISC-V GCC, QEMU, ESP-IDF v5.5.6 + Espressif QEMU |

Disk: about 1 GB for the base setup, about 2 GB more with ESP-IDF.

## Installation

```sh
git clone https://github.com/viknesh-ai/tinyml.git
cd tinyml
```

**macOS**

```sh
scripts/setup_macos.sh             # uv, QEMU, Arm GCC, RISC-V GCC, Python environment
scripts/setup_macos.sh --espidf    # the same, plus ESP-IDF v5.5.6 and Espressif QEMU (~2 GB)
```

**Linux**

```sh
scripts/setup_linux.sh
```

**Docker (fully pinned)**

```sh
docker build -f ci/docker/Dockerfile -t tinyml .
```

Without ESP-IDF, the Arm chips work right away, the ESP32-C3 falls back to a bare-metal RISC-V build, and the ESP32-S3 stays unavailable until you run `scripts/setup_espidf.sh`.

Check what your machine can build and emulate:

```sh
uv run tinyml doctor
```

## Running the app

```sh
uv run tinyml serve                # opens http://127.0.0.1:8765
uv run tinyml serve --no-open --port 9000
```

The app opens on your workspaces. Create one with **New workspace** and an objective in your own words, then work down the six numbered steps in the sidebar: Brief, Targets, Data (upload your CSV recordings), Training (with Pipeline design under it), Benchmark and Deployment. Each step ends with Back and its main action. The Dashboard sums up the project, Runs keeps every run with its full log, and ⌘K searches pages and runs stages. Runs stream into the console at the bottom, where you can pause or stop them, and each stage's review card waits in the assistant panel on the right. Nothing is preloaded; to try it without your own recordings, write a demo CSV first with `uv run tinyml demo-data driving --out demo` and upload it on the Data page.

The built web app is checked in under `ui/dist/`, so running it needs no Node.js. To change the interface, see [`ui/CLAUDE.md`](ui/CLAUDE.md):

```sh
npm --prefix ui ci          # once
npm --prefix ui run dev     # live reload on http://127.0.0.1:5173, API calls go to tinyml serve
make ui                     # typecheck and rebuild ui/dist before committing
```

## Command line

The web app and the CLI call the same engine.

```sh
uv run tinyml demo-data cwru --out workspace/demo      # real CWRU bearing data (downloads from GitHub)
uv run tinyml demo-data pump --out workspace/demo      # synthetic data, no network
uv run tinyml build workspace/demo/pump_cwru.csv --chip esp32s3
uv run tinyml rank  workspace/demo/pump_cwru.csv --any-vendor --priority battery
uv run tinyml verify workspace/projects/<id>/packages/<package>.zip
```

| command | what it does |
|---|---|
| `build` | Sentence + CSV → verified C library for one chip (zip) |
| `rank` | Rank microcontrollers for this data and goal; prints the top 3 with reasons |
| `package` | Final build, parity test and signed package for an already ranked or trained project |
| `check` | Only run the CSV checks |
| `serve` | Start the local web app |
| `doctor` | Which chips this machine can build and emulate |
| `catalog` | List chips in the catalog |
| `demo-data` | Write a demo CSV (synthetic, or real CWRU bearing data) |
| `verify` | Check a package's signature and file hashes |
| `projects` | List projects in the workspace |
| `decisions` | Show the decision log |
| `settings` | Show or change settings, such as which assistant handles unsure decisions |

Run `uv run tinyml <command> --help` for the options of each command.

## What you get

The screen is split in two: the steps on the left, the **assistant panel** on the right.

1. **Goal** – a sentence becomes a problem spec, with one follow-up question if something important is missing.
2. **Chips** – pick a chip maker (or any), then optionally the exact chips you can use, plus connectivity, power, budget and priority. A live summary shows how many chips will be tested and why others are left out.
3. **Data** – column roles you can correct, plain-English data checks (missing values, gaps, clipping, uneven or mixed sampling rates, not enough data) and a look at the signal.
4. **Model** – the recommended method explained in plain words (for rules, the actual if-then rules), its test results against the target, why it was chosen, every other option with why it was not, and how it was tested (the split, the cross-validation and every setting tried).
5. **Compare** – a real build and emulator run per chip, the top three with reasons and trade-offs, and why the others were left out. Skipped when you chose exactly one chip.
6. **Build** – the final build for the chip you picked (no second chip picker), parity per golden window, and two downloads.

The assistant panel shows the running job with **Pause**, **Resume** and **Cancel** (they take effect after the current compile or emulator run), a **review card** for every finished step with Approve / Request changes, open questions, and a place to ask questions. Review gates (on by default, see Settings) make training wait for an approved data review, and comparing chips or building wait for an approved model.

Two downloads:

- **Essentials** – just `tinyml_model.h` and `tinyml_model.c`, byte-identical to the files in the signed package. That is all a firmware project needs.
- **Full package** – the signed `.zip` with the library, a C++ wrapper, an example, calibration data, a standalone parity test and a report. The page lists every file with what it is for, and you can open any of them.

## Supported chips

36 chips from 9 makers: Espressif, STMicroelectronics, Nordic, Raspberry Pi, NXP, Microchip, Silicon Labs, Texas Instruments and Renesas (`tinyml catalog` lists them).

| core | chips | how it is built and run | numbers |
|---|---|---|---|
| Xtensa LX7 / LX6 | ESP32-S3, ESP32 | ESP-IDF v5.5.6, Espressif QEMU (chip-level) | measured flash and RAM, emulated instructions |
| RISC-V RV32IMC | ESP32-C3 (ESP-IDF, or bare metal), ESP32-C6, ESP32-H2 | RISC-V GCC, QEMU `virt` (core-level) | measured flash and RAM, emulated instructions |
| Cortex-M0+ | STM32C0, STM32G0, SAM D21, CC2340, RP2040 | Arm GCC, QEMU MPS2 AN385 | measured; RP2040 estimated until onboarded |
| Cortex-M4 (with or without FPU) | STM32F4, STM32G4, STM32L4, STM32WB, nRF52, SAM D51, CC2652R, RA4M1 | Arm GCC, QEMU MPS2 AN386 | measured flash and RAM, emulated instructions |
| Cortex-M33 | STM32U5, STM32WBA, nRF53, nRF54L, LPC55S69, MCX N947, EFR32BG22/MG24, RP2350 | Arm GCC, QEMU MPS2 AN505 | measured; RP2350 estimated until onboarded |
| Cortex-M7 | STM32H743, i.MX RT1062 | Arm GCC, QEMU MPS2 AN500 | measured flash and RAM, emulated instructions |

Chips with the same core and compiler flags compile to the same binary, so one build and emulator run serves all of them; each chip's time, energy and battery numbers are then worked out from its own clock, speed factor and currents.

The chip catalog lives in `catalog/chips.yaml` and is hand-edited from datasheets for now; `get_catalog()` in `src/tinyml/catalog.py` is the only loader, so a chip catalog API can replace the file later.

## How every number is sourced

| tag | source |
|---|---|
| **measured** | Linker output from the chip's own compiler (flash, RAM including window buffer and worst-case stack) |
| **emulated** | Instruction counts from a chip- or core-level emulator run |
| **estimated** | Datasheet values or an uncalibrated per-core speed factor (`cpi` in the catalog) |

Time per prediction stays estimated until each core's speed factor is measured on a real board. Energy and battery life are always estimated. See [`docs/architecture.md`](docs/architecture.md) for details.

## The assistant

Rules make every judgement call first. When they are unsure, tinyml asks the assistant you choose:

- **Ask me** – no AI; you decide (default, `off`).
- **Claude Code** – runs `claude -p` on this machine with your login.
- **Claude chat** – gives you a prompt to paste.

Only column summaries are ever sent, never sensor data. Every decision is logged, and corrections you repeat three times become rules. The product works fully with the assistant turned off. See [`docs/decisions.md`](docs/decisions.md).

## Project layout

```
docs/             architecture, decisions, and the contracts everyone builds against
  contracts/      problem spec, CSV summary, features, model artifact, golden vectors, package
recipes/          per-use-case defaults (pump health, driving events, human activity)
catalog/          chip catalog
src/tinyml/       engine: data, features, ml, codegen, toolchains, ranking, packaging, decide, pipeline, api, cli
firmware/         parity harness, size probe, ports for Arm, RISC-V, host and ESP-IDF
ui/               the web app: React and TypeScript source in ui/src, the built copy in ui/dist (works offline)
tests/            unit tests and per-chip emulator parity tests
scripts/          setup scripts for macOS, Linux and ESP-IDF
ci/               pinned Docker image
```

Metadata lives in SQLite (`workspace/tinyml.db`); project files live under `workspace/projects/<id>/`. Only `src/tinyml/store/db.py` speaks SQL, so moving to Postgres later touches one file.

## Development

```sh
uv sync          # install
make test        # lint + unit tests (fast, host only)
make parity      # build and emulate every chip whose toolchain is installed
make demo        # write the three synthetic demo CSVs
make ui          # typecheck and rebuild the web app into ui/dist
```

CI (`.github/workflows/ci.yml`) runs lint, unit tests, the web app typecheck and build (and checks that `ui/dist` matches the source), and emulator parity tests on every pull request; all must pass to merge.

Before contributing, read [`AGENTS.md`](AGENTS.md) for the project rules and folder ownership, and [`docs/contracts/`](docs/contracts/) for the data formats. Changes to the contracts need the lead's approval and must update the Python and C sides together.

## Troubleshooting

- **`arm-none-eabi-gcc not found`** – the Arm toolchain installer needs your password. Run `brew install --cask gcc-arm-embedded` in a terminal, then `uv run tinyml doctor`.
- **ESP32-S3 shows "not ready"** – run `scripts/setup_espidf.sh`, or set `IDF_PATH` if ESP-IDF is already installed elsewhere.
- **Port 8765 already in use** – start on another port with `uv run tinyml serve --port 9000`.
- **Parity tests are skipped** – they skip chips whose toolchain is missing; `uv run tinyml doctor` shows what to install.

## License

Licensed under the [Apache License 2.0](LICENSE).
