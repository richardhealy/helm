import "./load-env";
import { tickAll } from "../src/simulation/driver";

const TICK_MS = 1000;
const SPEED_MPS = Number(process.env.SIM_SPEED_MPS ?? "12"); // ~43 km/h

async function loop() {
  try {
    await tickAll({ speedMps: SPEED_MPS, dtSeconds: TICK_MS / 1000 });
  } catch (err) {
    console.error("tick error", err);
  }
}

console.log(`simulator running: ${SPEED_MPS} m/s, tick ${TICK_MS}ms`);
setInterval(loop, TICK_MS);
