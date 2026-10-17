import { describe, expect, it } from "vite-plus/test";

import { expectConsistentOperation } from "../fixtures/images";

describe("convolve recipe", () => {
  it("produces equivalent dimensions across raster drivers", async () => {
    const results = await expectConsistentOperation({
      type: "convolve",
      width: 3,
      height: 3,
      kernel: [0, 0, 0, 0, 1, 0, 0, 0, 0],
      border: "copy",
    });
    expect(results).toHaveLength(3);
  });
});
