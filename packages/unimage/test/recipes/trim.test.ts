import { describe, expect, it } from "vite-plus/test";

import { borderedGradientImage, expectConsistentOperation } from "../fixtures/images";

describe("trim recipe", () => {
  it("produces equivalent dimensions across raster drivers", async () => {
    const results = await expectConsistentOperation(
      { type: "trim", threshold: 10 },
      { input: borderedGradientImage(), width: 6, height: 4 },
    );
    expect(results).toHaveLength(3);
  });
});
