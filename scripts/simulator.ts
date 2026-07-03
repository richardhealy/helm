import "./load-env";
import { tickAll } from "../src/simulation/driver";

const TICK_MS = 1000;
// Compressed demo pace: fast enough to watch a compact city route finish in a
// minute or two, slow enough to see the vehicle visit each stop. Override with
// SIM_SPEED_MPS (real city speed is ~10–13 m/s).
const SPEED_MPS = Number(process.env.SIM_SPEED_MPS ?? "40");

async function loop() {
  try {
    await tickAll({ speedMps: SPEED_MPS, dtSeconds: TICK_MS / 1000 });
  } catch (err) {
    console.error("tick error", err);
  }
}

console.log(`simulator running: ${SPEED_MPS} m/s, tick ${TICK_MS}ms`);
setInterval(loop, TICK_MS);
