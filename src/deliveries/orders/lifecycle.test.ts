import { describe, it, expect } from "vitest";
import { isFinal } from "./lifecycle";

describe("isFinal", () => {
  it("treats delivered and failed stops as final", () => {
    expect(isFinal("delivered")).toBe(true);
    expect(isFinal("failed")).toBe(true);
  });

  it("leaves stops that are still in play open to change", () => {
    expect(isFinal("unassigned")).toBe(false);
    expect(isFinal("assigned")).toBe(false);
    expect(isFinal("en_route")).toBe(false);
  });
});
