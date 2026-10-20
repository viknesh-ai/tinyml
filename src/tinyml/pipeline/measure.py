"""Stage B steps 2-3 for one chip: build with the chip's toolchain, measure, and check parity early."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

from tinyml.catalog import Chip
from tinyml.codegen import golden as G
from tinyml.contracts import ChipMeasurement, GoldenSet, TaggedNumber
from tinyml.toolchains import ToolchainError, backend_for

BATTERY_MAH = 2000.0
VOLTAGE = 3.3


def instruction_tag(chip: Chip) -> str:
    return "estimated" if chip.emulator.fidelity == "community" else "emulated"


def latency_tag(chip: Chip) -> str:
    if chip.emulator.fidelity == "community":
        return "estimated"
    return "emulated" if chip.cpi.get("source") == "measured" else "estimated"


def derive(chip: Chip, flash: int, ram: int, stack: int, instructions: int | None, hop_s: float,
           toolchain: str, emulator: str, sensor_ma: float = 0.0) -> dict:
    out = {
        "flash_bytes": TaggedNumber(value=flash, unit="bytes", tag="measured", source="linker output of a size probe"),
        "ram_bytes": TaggedNumber(value=ram, unit="bytes", tag="measured",
                                  source="static data + window buffer from the linker, plus worst-case stack"),
        "stack_bytes": TaggedNumber(value=stack, unit="bytes", tag="measured", source="GCC call-graph stack usage"),
        "price_usd": TaggedNumber(value=chip.price_usd, unit="USD", tag="estimated", source="catalog"),
    }
    if instructions is not None:
        latency_ms = instructions * float(chip.cpi["value"]) / (chip.clock_mhz * 1e3)
        energy_uj = VOLTAGE * chip.active_ma * latency_ms
        duty = min(1.0, latency_ms / 1000.0 / max(hop_s, 1e-9))
        avg_ma = chip.sleep_ma + (chip.active_ma - chip.sleep_ma) * duty + sensor_ma
        out.update(
            instructions=TaggedNumber(value=instructions, unit="instructions", tag=instruction_tag(chip),
                                      source=emulator),
            latency_ms=TaggedNumber(value=round(latency_ms, 4), unit="ms", tag=latency_tag(chip),
                                    source=f"instructions x {chip.cpi['value']} cycles/instruction "
                                           f"({chip.cpi.get('source', 'estimated')}) at {chip.clock_mhz:g} MHz"),
            energy_uj=TaggedNumber(value=round(energy_uj, 3), unit="uJ", tag="estimated",
                                   source=f"{chip.active_ma:g} mA active at {VOLTAGE} V"),
            battery_days=TaggedNumber(value=round(BATTERY_MAH / avg_ma / 24.0, 1), unit="days", tag="estimated",
                                      source=f"MCU plus a {sensor_ma:g} mA sensor on {BATTERY_MAH:g} mAh, sleeping at "
                                             f"{chip.sleep_ma:g} mA between predictions; radio not included"),
        )
    return out


def subset(golden: GoldenSet, count: int) -> GoldenSet:
    copy = golden.model_copy(deep=True)
    copy.vectors = copy.vectors[:count]
    return copy


def build_signature(chip: Chip) -> tuple[str | None, str]:
    """Chips that compile to the same binary and run on the same emulator share one build.

    The signature comes from what the chosen backend really uses (compiler flags, emulator machine, tool
    versions), so editing a core in the catalog or upgrading GCC or QEMU starts a fresh build.
    Returns (signature, why-not-available); the signature is None when no backend is installed.
    """
    backend, why = backend_for(chip)
    if backend is None:
        return None, why
    if backend.name == "espidf":
        name = f"espidf-{chip.idf_target}"
        inputs = [backend.toolchain_version(chip), backend.emulator_name(chip)]
    else:
        name = f"{backend.name}-{backend.core(chip).id}"
        inputs = [*backend.cflags(chip), backend.machine(chip), backend.toolchain_version(chip),
                  backend.emulator_name(chip)]
    digest = hashlib.sha256("\n".join(inputs).encode()).hexdigest()[:8]
    return f"{name}-{digest}", ""


@dataclass
class BuildMeasurement:
    """What one build and emulator run tell us, before any chip-specific numbers are derived."""

    backend: str
    flash_bytes: int
    ram_bytes: int
    stack_bytes: int
    instructions: int | None
    parity: dict
    toolchain: str
    emulator: str


def measure_build(chip: Chip, gen_dir: Path, golden: GoldenSet, work: Path, window_bytes: int,
                  parity_windows: int | None = 4, timeout: int = 300) -> BuildMeasurement:
    backend, why = backend_for(chip)
    if backend is None:
        raise ToolchainError(f"toolchain not installed ({why})")
    work.mkdir(parents=True, exist_ok=True)
    size = backend.measure(chip, gen_dir, work, window_bytes)
    check = subset(golden, parity_windows) if parity_windows else golden
    if backend.name == "espidf":
        result = backend.run(chip, gen_dir, G.header(check), work, timing=True, parity=True, timeout=timeout)
        instructions = result.instructions
    else:
        timing = backend.run(chip, gen_dir, G.header(subset(golden, 1)), work, timing=True, parity=False,
                             timeout=timeout)
        instructions = timing.instructions
        result = backend.run(chip, gen_dir, G.header(check), work, timing=False, parity=True, timeout=timeout)
    rows, _, finished = G.parse_output(result.output)
    (work / "emulator_output.txt").write_text(result.output)
    return BuildMeasurement(backend=backend.name, flash_bytes=size.flash_bytes, ram_bytes=size.ram_bytes,
                            stack_bytes=size.stack_bytes, instructions=instructions,
                            parity=G.compare(check, rows, finished), toolchain=size.toolchain,
                            emulator=backend.emulator_name(chip))


def chip_measurement(chip: Chip, build: BuildMeasurement, hop_s: float, sensor_ma: float = 0.0) -> ChipMeasurement:
    numbers = derive(chip, build.flash_bytes, build.ram_bytes, build.stack_bytes, build.instructions, hop_s,
                     build.toolchain, build.emulator, sensor_ma)
    return ChipMeasurement(chip_id=chip.id, status="ok", backend=build.backend, parity_ok=build.parity["passed"],
                           parity_detail=build.parity, toolchain=build.toolchain, emulator=build.emulator, **numbers)
