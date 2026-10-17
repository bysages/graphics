import { describe, expect, it } from "vite-plus/test";

import { expectConsistentOperation } from "../fixtures/images";

describe("threshold recipe", () => {
  it("produces equivalent dimensions across raster drivers", async () => {
    const results = await expectConsistentOperation({
      type: "threshold",
      value: 128,
      grayscale: true,
    });
    expect(results).toHaveLength(3);
  });
});
