import { describe, expect, it } from "vite-plus/test";

import { expectConsistentOperation } from "../fixtures/images";

describe("modulate recipe", () => {
  it("produces equivalent dimensions across raster drivers", async () => {
    const results = await expectConsistentOperation({
      type: "modulate",
      brightness: 1.1,
      saturation: 1.1,
    });
    expect(results).toHaveLength(3);
  });
});
